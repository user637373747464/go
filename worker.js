// worker.js — le « cerveau » de l'app, dans un Web Worker (pour que l'écran reste fluide pendant que le bot réfléchit).
// Messages reçus : init, jouer, fin, analyser
// Messages envoyés : pret, erreur, coup, morts, pos, lot
importScripts('goban.js', 'situation.js', 'features.js', 'moteur_nn.js', 'recherche.js', 'fin.js', 'bot.js', 'analyse.js', 'niveaux.js');

let reseau = null, bot = null, modeCourant = '';
let derniere = null;                // { n, komi, coups, sit } : dernière situation construite (on réutilise l'arbre de recherche)
const analyses = new Map();

function situationPour(n, komi, coups) {
  const SIT = self.GoSituation;
  let sit, depuis = 0;
  const d = derniere;
  if (d && d.n === n && d.komi === komi && d.coups.length <= coups.length) {
    let ok = true;
    for (let i = 0; i < d.coups.length; i++) if (d.coups[i][0] !== coups[i][0] || d.coups[i][1] !== coups[i][1]) { ok = false; break; }
    if (ok) { sit = d.sit; depuis = d.coups.length; }
  }
  if (!sit) { sit = SIT.Situation.initiale(n, komi); depuis = 0; }
  for (let i = depuis; i < coups.length; i++) sit = sit.jouer(coups[i][1], coups[i][0], true);
  derniere = { n, komi, coups: coups.map(c => [c[0], c[1]]), sit };
  return sit;
}

// Les deux gros fichiers sont gardés sur l'appareil (Cache API) pour ne pas les retélécharger.
// Si la copie gardée est abîmée, on la jette et on retélécharge une fois.
const NOM_CACHE = 'go-gros-v1';
async function lireGros(nom, cache, ignorerCopie) {
  if (cache && !ignorerCopie) {
    try {
      const r = await cache.match(nom);
      if (r) { const b = await r.arrayBuffer(); if (b.byteLength) return { nom, b, copie: true }; }
    } catch (e) { /* on retélécharge */ }
  }
  const r = await fetch(nom, { cache: 'no-cache' });
  if (!r.ok) throw new Error(nom + ' introuvable (code ' + r.status + ')');
  return { nom, b: await r.arrayBuffer(), copie: false };
}

function simdOk() {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); }
  catch (e) { return false; }
}

// charge un fichier wasm + le réseau ; renvoie le réseau prêt à calculer
async function charger(nomWasm, nomPoids, cache) {
  const noms = [nomWasm, nomPoids];
  for (let essai = 0; ; essai++) {
    const [w, p] = await Promise.all(noms.map((n) => lireGros(n, cache, essai > 0)));
    let r;
    try {
      r = await self.GoNN.creer(w.b, p.b);
    } catch (e) {
      if (essai === 0 && (w.copie || p.copie)) {
        if (cache) for (const n of noms) { try { await cache.delete(n); } catch (e2) { /* rien */ } }
        continue;
      }
      throw e;
    }
    if (cache) for (const f of [w, p]) if (!f.copie) { try { cache.put(f.nom, new Response(f.b)).catch(() => {}); } catch (e2) { /* rien */ } }
    return r;
  }
}

async function init(msg) {
  try {
    let cache = null;
    try { cache = await caches.open(NOM_CACHE); } catch (e) { cache = null; }
    // version rapide (SIMD) si le téléphone sait la lire, sinon version de secours (plus lente)
    const rapide = !msg.scalaire && simdOk();
    const liste = msg.wasm ? [msg.wasm] : rapide ? ['nn.wasm', 'nn_scalaire.wasm'] : ['nn_scalaire.wasm'];
    let derniere = null;
    for (const nom of liste) {
      try {
        reseau = await charger(nom, msg.poids || 'reseau.bin', cache);
        derniere = null; modeCourant = nom === 'nn.wasm' ? 'rapide' : 'compatible';
        break;
      } catch (e) {
        derniere = e;
        if (!/CompileError|LinkError|wasm|simd/i.test(String(e && (e.name + ' ' + e.message)))) break;   // autre souci (fichier manquant…) : inutile d'essayer l'autre version
      }
    }
    if (derniere || !reseau) throw derniere || new Error('réseau absent');
    self.GoBot.definirTable(self.GONIVEAUX);
    bot = new self.GoBot.Bot(reseau, {});
    postMessage({ type: 'pret', mode: modeCourant });
  } catch (e) {
    postMessage({ type: 'erreur', msg: String(e && e.message || e) });
  }
}

function jouer(msg) {
  const { GoFin, GoGoban } = self;
  const sit = situationPour(msg.n, msg.komi, msg.coups);
  bot.definirNiveau(msg.k);
  // l'adversaire vient de passer : si la partie est réglée et que le bot est devant (ou si l'adversaire insiste en repassant), il passe aussi (fin de partie)
  if (sit.passes === 1) {
    const ev = reseau.evaluer(sit, 1);
    const f = GoFin.scoreFinal(sit, GoFin.mortesAuto(sit, ev));
    let passesAdverses = 0;
    for (let i = Math.max(0, msg.coups.length - 12); i < msg.coups.length; i++) if (msg.coups[i][0] !== sit.trait && msg.coups[i][1] === GoGoban.PASSE) passesAdverses++;
    // la partie est-elle « réglée » ? (presque toutes les cases vides appartiennent à un camp)
    const g = sit.g, n = g.n;
    let neutres = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const l = g.loc(x, y); if (g.c[l] === GoGoban.VIDE && !f.zone[l]) neutres++; }
    const reglee = neutres <= Math.max(3, Math.round(0.04 * n * n));
    if ((reglee && f.gagnant === sit.trait) || passesAdverses >= 2) { postMessage({ type: 'coup', id: msg.id, loc: GoGoban.PASSE, gain: ev.gain, lead: ev.lead }); return; }
  }
  const t0 = Date.now();
  const r = bot.jouer(sit, {});
  let loc = r.loc;
  if (loc !== GoGoban.PASSE && !sit.estLegal(loc, sit.trait)) loc = GoGoban.PASSE;     // garde-fou
  postMessage({ type: 'coup', id: msg.id, loc, gain: r.gain, lead: r.lead, ms: Date.now() - t0 });
}

function fin(msg) {
  const { GoFin } = self;
  const sit = situationPour(msg.n, msg.komi, msg.coups);
  const ev = reseau.evaluer(sit, 1);
  const mortes = GoFin.mortesAuto(sit, ev);
  postMessage({ type: 'morts', id: msg.id, mortes, poss: Array.from(ev.poss), trait: sit.trait });
}

function analyser(msg) {
  let a = analyses.get(msg.job);
  if (!a) {
    analyses.clear();
    a = new self.GoAnalyse.Analyse(reseau, msg.n, msg.komi, msg.coups, {});
    analyses.set(msg.job, a);
  }
  let prev = -10;
  for (const idx of msg.indices) {
    const res = a.chercherUne(idx, msg.visites, msg.neuf || idx !== prev + 1);
    prev = idx;
    postMessage({ type: 'pos', job: msg.job, phase: msg.phase, idx, res });
  }
  postMessage({ type: 'lot', job: msg.job, phase: msg.phase });
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') init(m);
    else if (!reseau) postMessage({ type: 'erreur', msg: 'réseau pas prêt' });
    else if (m.type === 'jouer') jouer(m);
    else if (m.type === 'fin') fin(m);
    else if (m.type === 'analyser') analyser(m);
  } catch (err) {
    postMessage({ type: 'erreur', id: m.id, job: m.job, msg: String(err && err.stack || err) });
  }
};
