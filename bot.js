// bot.js — le joueur artificiel : un seul bot, avec un niveau réglable de 30 kyu à 9 dan et plus.
// Idée : en bas de l'échelle, le bot choisit parmi quelques coups tirés au hasard celui que le réseau aime le plus
// (plus il y a de coups tirés, plus il joue juste). En haut de l'échelle, il réfléchit en cherchant (arbre de variantes),
// avec de plus en plus de visites. Le niveau affiché est une ESTIMATION (calibrée en faisant jouer le bot contre lui-même).
(function (racine, usine) {
  if (typeof module === 'object' && module.exports) module.exports = usine(require('./goban.js'), require('./recherche.js'));
  else racine.GoBot = usine(racine.GoGoban, racine.GoRecherche);
})(typeof self !== 'undefined' ? self : this, function (GG, REC) {
  'use strict';
  const { PASSE, VIDE } = GG;
  const { Recherche } = REC;

  // ----- l'échelle des niveaux -----
  // rang numérique k : 30 = 30 kyu, 1 = 1 kyu, 0 = 1 dan, -1 = 2 dan, ... -8 = 9 dan, -9 = « 9 dan + » (pleine puissance)
  const K_MIN = 30, K_MAX = -9;
  function nomNiveau(k) {
    if (k <= -9) return '9 dan +';
    if (k >= 1) return k + ' kyu';
    return (1 - k) + ' dan';
  }
  function listeNiveaux() { const r = []; for (let k = K_MIN; k >= K_MAX; k--) r.push({ k, nom: nomNiveau(k) }); return r; }

  // ----- profils de force -----
  // Un profil décrit comment le bot choisit son coup :
  //  - kt : rang « calibré » (même idée que le bot « rang calibré » de KaTrain, voir nCoupsRang) : on tire au hasard quelques coups
  //    légaux et on joue celui que le réseau préfère. Moins on en tire, plus le bot est faible.
  //  - mix (0..1) : (avec kt) on se rapproche du meilleur coup du réseau : 0 = comme kt, 1 = toujours le meilleur coup
  //  - lambda : variante simple utilisée pour les essais : on tire N^lambda coups
  //  - visites : taille de la recherche (1 = pas de recherche, on lit seulement l'avis du réseau)
  //  - tempsMax : plafond de temps (ms) par coup
  // Pour les rangs forts (5 dan et plus) la force vient de la recherche : le tableau est dans niveaux.js.
  let TABLE = null;
  function definirTable(t) { TABLE = t; }
  function profilNiveau(k) {
    if (TABLE && TABLE[k]) return TABLE[k];
    if (k >= 0) return { kt: k, visites: 1 };
    if (k >= -3) return { kt: 0, mix: -k / 4, visites: 1 };         // 2 à 4 dan : de plus en plus près du meilleur coup du réseau
    return { visites: Math.pow(2, -4 - k) | 0 || 1, tempsMax: 8000 };
  }

  // Nombre de coups tirés au hasard selon le rang k (kyu positif, dan = 1 - rang). N : nombre de cases, L : coups légaux.
  // Formule de KaTrain (licence MIT), calibrée sur des joueurs humains.
  function nCoupsRang(k, N, L) {
    const n = L / N;
    const orig = 0.063015 + 0.7624 * N / Math.pow(10, -0.05737 * k + 1.9482);
    const e = 3.002 * n * n - n - 0.034889 * k - 0.5097;
    const mod = (0.3931 + 0.6559 * n * Math.exp(-e * e) - 0.01093 * k) * orig;
    const d = 1.31165 * (mod + 1) - 0.082653;
    return Math.max(1, Math.min(L, Math.round(L / d)));
  }

  // Choix d'un coup par tirage. ev : évaluation du réseau pour la situation. profil : voir plus haut.
  function choixParTirage(sit, ev, profil, rnd) {
    const n = sit.g.n, NN = n * n;
    const legaux = [];
    for (let i = 0; i < NN; i++) if (ev.pol[i] > 0) legaux.push(i);
    const N = legaux.length;
    if (N === 0) return PASSE;
    let top = -1, topP = -1, secP = -1;
    for (const i of legaux) {
      const p = ev.pol[i];
      if (p > topP) { secP = topP; top = i; topP = p; }
      else if (p > secP) { secP = p; }
    }
    const passP = ev.pol[NN];
    let rangPasse = 0; for (const i of legaux) if (ev.pol[i] > passP) rangPasse++;
    if (rangPasse < 3 && passP > 0.25) return PASSE;
    const aLoc = (i) => sit.g.loc(i % n, (i / n) | 0);
    // coup « évident » (prise, défense urgente…) : on le joue quand le réseau est très sûr de lui
    const k = profil.kt === undefined ? 0 : profil.kt;
    const ratio = (NN - N) / NN;
    const override = 0.8 * (1 - 0.5 * ratio);
    const overrideDeux = 0.85 + Math.max(0, 0.02 * (k - 8));
    if (topP > override || topP + (secP > 0 ? secP : 0) > overrideDeux) return aLoc(top);
    let nCoups;
    if (profil.mix !== undefined) { const m0 = nCoupsRang(profil.kt, NN, N); nCoups = Math.max(1, Math.min(N, Math.round(m0 + (N - m0) * profil.mix))); }
    else if (profil.kt !== undefined) nCoups = nCoupsRang(profil.kt, NN, N);
    else if (profil.lambda !== undefined) nCoups = Math.max(1, Math.min(N, Math.round(Math.pow(N, profil.lambda))));
    else nCoups = N;
    let meilleur = -1, meilleurP = -1;
    const tab = legaux.slice();
    for (let j = 0; j < nCoups; j++) {
      const r = j + Math.floor(rnd() * (tab.length - j));
      const t = tab[j]; tab[j] = tab[r]; tab[r] = t;
      const p = ev.pol[tab[j]];
      if (p > meilleurP) { meilleurP = p; meilleur = tab[j]; }
    }
    return aLoc(meilleur);
  }

  // Début de partie des niveaux forts : on varie un peu (tirage selon l'avis du réseau parmi les bons coups)
  function ouvertureVariee(sit, ev, rnd) {
    const n = sit.g.n, NN = n * n;
    let topP = 0; for (let i = 0; i < NN; i++) if (ev.pol[i] > topP) topP = ev.pol[i];
    const cand = []; let tot = 0;
    for (let i = 0; i < NN; i++) if (ev.pol[i] >= Math.max(0.08, topP * 0.25)) { cand.push(i); tot += ev.pol[i]; }
    let u = rnd() * tot;
    for (const i of cand) { u -= ev.pol[i]; if (u <= 0) return sit.g.loc(i % n, (i / n) | 0); }
    return -1;
  }

  class Bot {
    constructor(reseau, opts) {
      opts = opts || {};
      this.reseau = reseau;
      this.rnd = opts.rnd || Math.random;
      this.rech = new Recherche(reseau, opts.recherche || {});
      this.k = opts.k === undefined ? 10 : opts.k;
      this.profil = opts.profil || null;      // profil imposé (calibrage) ; sinon déduit du niveau
    }
    definirNiveau(k) { this.k = k; this.profil = null; }

    // Renvoie { loc, gain, lead, ... }  ; gain = estimation de victoire du bot (0..1) si dispo
    jouer(sit, hooks) {
      hooks = hooks || {};
      const n = sit.g.n;
      const r = this.profil || profilNiveau(this.k);
      const ouverture = n <= 9 ? 4 : n <= 13 ? 6 : 8;
      if (r.visites <= 1) {
        const ev = this.reseau.evaluer(sit, 1);
        let loc = -1;
        if (r.kt === undefined && r.lambda === undefined && sit.ply < ouverture) loc = ouvertureVariee(sit, ev, this.rnd);
        if (loc < 0) loc = choixParTirage(sit, ev, r, this.rnd);
        return { loc, gain: ev.gain, lead: ev.lead, ev };
      }
      const rec = this.rech;
      rec.definirRacine(sit);
      rec.executer(r.visites, r.tempsMax || 0, hooks.arreter);
      const st = rec.stats();
      const res = rec.resume();
      let choix = st[0];
      if (sit.ply < ouverture && st.length > 1) {
        const ev = rec.racine.ev;
        const loc = ouvertureVariee(sit, ev, this.rnd);
        if (loc >= 0) return { loc, gain: (res.wl + 1) / 2, lead: res.lead, stats: st };
      }
      return { loc: choix.loc, gain: (res.wl + 1) / 2, lead: res.lead, stats: st };
    }
  }

  return { Bot, nomNiveau, listeNiveaux, profilNiveau, definirTable, choixParTirage, nCoupsRang, K_MIN, K_MAX };
});
