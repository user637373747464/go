// features.js — décrit une position au réseau de neurones, exactement comme KataGo (entrées « version 7 »).
// 22 plans spatiaux + 19 valeurs globales. Règles supposées : zone (area), super-ko positionnel, suicide interdit, pas de « bouton ».
(function (racine, usine) {
  if (typeof module === 'object' && module.exports) module.exports = usine(require('./goban.js'));
  else racine.GoFeatures = usine(racine.GoGoban);
})(typeof self !== 'undefined' ? self : this, function (GG) {
  'use strict';
  const { VIDE, NOIR, BLANC, NUL, PASSE } = GG;
  const NB_PLANS = 22, NB_GLOBAL = 19;

  // tIn : Float32Array de taille (n+4)^2 * 22 (bord de 2 cases autour du plateau, rempli de zéros)
  // tGlob : Float32Array(19)
  function remplir(sit, tIn, tGlob) {
    const g = sit.g, n = g.n, l = g.l, W2 = n + 4;
    const pla = sit.trait, opp = 3 - pla;
    tIn.fill(0, 0, W2 * W2 * NB_PLANS);
    tGlob.fill(0);
    const pos = (loc) => {           // case du plateau -> index dans tIn (sans le décalage de plan)
      const x = (loc % l) - 1, y = ((loc / l) | 0) - 1;
      return ((y + 2) * W2 + (x + 2)) * NB_PLANS;
    };

    const c = g.c;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const loc = (x + 1) + (y + 1) * l;
      const p = ((y + 2) * W2 + (x + 2)) * NB_PLANS;
      tIn[p] = 1;
      const st = c[loc];
      if (st === pla) tIn[p + 1] = 1; else if (st === opp) tIn[p + 2] = 1;
      if (st === pla || st === opp) {
        const lb = g.nLibs[g.tete[loc]];
        if (lb === 1) tIn[p + 3] = 1; else if (lb === 2) tIn[p + 4] = 1; else if (lb === 3) tIn[p + 5] = 1;
      }
    }

    // 6 : ko et super-ko
    if (g.ko !== NUL) tIn[pos(g.ko) + 6] = 1;
    const bannis = sit.bannisSuperko();
    for (let i = 0; i < bannis.length; i++) tIn[pos(bannis[i]) + 6] = 1;

    // zone déjà acquise (pierres passe-vivantes + grands territoires)
    const zone = g.zone(true, true, true);
    let scorePla = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const loc = (x + 1) + (y + 1) * l;
      const p = ((y + 2) * W2 + (x + 2)) * NB_PLANS;
      if (zone[loc] === pla) { tIn[p + 18] = 1; scorePla++; }
      else if (zone[loc] === opp) { tIn[p + 19] = 1; scorePla--; }
    }

    // 9..13 : les 5 derniers coups (en alternance adversaire / moi / ...), et les passes dans les valeurs globales
    const hist = sit.derniersCoups(5);          // du plus ancien au plus récent
    const L = hist.length;
    let nInclus = 0;
    const att = Math.min(5, L);
    for (let k = 1; k <= att; k++) {
      const m = hist[L - k];
      const attendu = (k % 2 === 1) ? opp : pla;
      if (m[0] !== attendu) break;
      nInclus = k;
      if (m[1] === PASSE) tGlob[k - 1] = 1;
      else if (m[1] !== NUL) tIn[pos(m[1]) + 8 + k] = 1;
    }

    // 14 : pierres prises dans une échelle ; 17 : coups qui marchent pour les sauver (ou les attaquer)
    const ech = g.echelles();
    for (let i = 0; i < ech.length; i++) {
      const loc = ech[i][0], travail = ech[i][1];
      tIn[pos(loc) + 14] = 1;
      if (c[loc] === opp && g.nLibs[g.tete[loc]] > 1) for (let j = 0; j < travail.length; j++) tIn[pos(travail[j]) + 17] = 1;
    }
    const s1 = (nInclus < 1) ? sit : sit.parent;
    const s2 = (nInclus < 2) ? s1 : s1.parent;
    const e1 = s1.g.echelles();
    for (let i = 0; i < e1.length; i++) tIn[pos(e1[i][0]) + 15] = 1;
    const e2 = s2.g.echelles();
    for (let i = 0; i < e2.length; i++) tIn[pos(e2[i][0]) + 16] = 1;

    // valeurs globales
    let selfKomi = pla === BLANC ? sit.jeu.komi : -sit.jeu.komi;
    const aire = n * n;
    if (selfKomi > aire + 20) selfKomi = aire + 20;
    if (selfKomi < -aire - 20) selfKomi = -aire - 20;
    tGlob[5] = selfKomi / 20;
    tGlob[6] = 1; tGlob[7] = 0.5;             // super-ko positionnel
    tGlob[14] = (sit.passes >= 1) ? 1 : 0;      // une passe terminerait-elle la partie ?
    {
      const pair = (aire % 2) === 0;
      let plancher;
      if (pair) plancher = Math.floor(selfKomi / 2) * 2;
      else plancher = Math.floor((selfKomi - 1) / 2) * 2 + 1;
      let delta = selfKomi - plancher;
      if (delta < 0) delta = 0;
      if (delta > 2) delta = 2;
      let onde;
      if (delta < 0.5) onde = delta; else if (delta < 1.5) onde = 1 - delta; else onde = delta - 2;
      tGlob[18] = onde;
    }
    return { scorePla };
  }

  return { remplir, NB_PLANS, NB_GLOBAL };
});
