// Fait jouer deux bots l'un contre l'autre (utilisé pour tester et calibrer).
const GG = require('../goban.js');
const { Situation } = require('../situation.js');
const FIN = require('../fin.js');
const { Bot } = require('../bot.js');
const O = require('./oracle.js');

function alea(graine) { let s = graine >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// identifiant de profil : "L30" = lambda 0.30 sans recherche ; "V8" = recherche de 8 visites ; "k12" = niveau 12 kyu de la table
function profilDepuisId(id) {
  let m;
  if ((m = /^L(\d+)$/.exec(id))) return { lambda: +m[1] / 100, visites: 1 };
  if ((m = /^V(\d+)$/.exec(id))) return { visites: +m[1] };
  if ((m = /^K(-?\d+)$/.exec(id))) return { kt: +m[1], visites: 1 };
  if ((m = /^M(\d+)$/.exec(id))) return { kt: 0, mix: +m[1] / 100, visites: 1 };
  return null;
}

// joue une partie ; renvoie { diff, gagnant, coups }
function jouerPartie(reseau, kNoir, kBlanc, n, komi, graine, options) {
  options = options || {};
  const rnd = alea(graine);
  const bots = {};
  bots[GG.NOIR] = new Bot(reseau, { k: typeof kNoir === 'number' ? kNoir : 0, profil: typeof kNoir === 'string' ? profilDepuisId(kNoir) : null, rnd });
  bots[GG.BLANC] = new Bot(reseau, { k: typeof kBlanc === 'number' ? kBlanc : 0, profil: typeof kBlanc === 'string' ? profilDepuisId(kBlanc) : null, rnd });
  let sit = Situation.initiale(n, komi);
  const coups = [];
  const MAX = n * n * 2;
  let t0 = Date.now();
  while (!sit.termine && coups.length < MAX) {
    const bot = bots[sit.trait];
    let loc;
    if (coups.length < (options.ouverture || 0)) {
      // ouverture aléatoire parmi les coups les plus plausibles (diversité des parties)
      const ev = reseau.evaluer(sit, 1);
      const idx = []; for (let i = 0; i < n * n; i++) if (ev.pol[i] > 0.03) idx.push(i);
      if (idx.length) { const i = idx[(rnd() * idx.length) | 0]; loc = sit.g.loc(i % n, (i / n) | 0); }
    }
    if (loc === undefined) loc = bot.jouer(sit).loc;
    if (!sit.estLegal(loc, sit.trait)) throw new Error('coup illégal du bot : ' + loc);
    coups.push([sit.trait, loc]);
    sit = sit.jouer(loc, sit.trait, true);
  }
  const ev = reseau.evaluer(sit, 1);
  const mortes = FIN.mortesAuto(sit, ev);
  const fin = FIN.scoreFinal(sit, mortes);
  return { diff: fin.diff, gagnant: fin.gagnant, coups: coups.length, ms: Date.now() - t0, sit, mortes };
}
module.exports = { jouerPartie, alea, profilDepuisId };

if (require.main === module) {
  (async () => {
    const reseau = await O.chargerMoi();
    const n = +process.argv[2] || 9, kN = process.argv[3] || 'L50', kB = process.argv[4] || 'L20';
    const r = jouerPartie(reseau, kN, kB, n, n === 9 ? 6.5 : 7.5, 1, { ouverture: 2 });
    console.log(`noir k=${kN} contre blanc k=${kB} : ${r.coups} coups, diff(blanc-noir)=${r.diff}, gagnant ${r.gagnant === GG.NOIR ? 'Noir' : 'Blanc'}, ${r.ms} ms, mortes ${r.mortes.length}`);
  })().catch(e => { console.error(e); process.exit(1); });
}
