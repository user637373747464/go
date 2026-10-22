// fin.js — fin de partie : repérer les pierres mortes avec l'avis du réseau (possession), puis compter par zone.
(function (racine, usine) {
  if (typeof module === 'object' && module.exports) module.exports = usine(require('./goban.js'), require('./situation.js'));
  else racine.GoFin = usine(racine.GoGoban, racine.GoSituation);
})(typeof self !== 'undefined' ? self : this, function (GG, SIT) {
  'use strict';
  const { VIDE, NOIR, BLANC } = GG;

  // chaînes de pierres du plateau : [{couleur, pierres:[loc...]}]
  function chaines(g) {
    const n = g.n, res = [], vu = new Uint8Array(g.taille);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const loc = g.loc(x, y);
      if (g.c[loc] === VIDE || vu[loc]) continue;
      const pierres = [];
      let cur = loc;
      do { pierres.push(cur); vu[cur] = 1; cur = g.suiv[cur]; } while (cur !== loc);
      res.push({ couleur: g.c[loc], pierres });
    }
    return res;
  }

  // ev : évaluation du réseau (ev.poss = possession du point de vue du joueur au trait, entre -1 et 1)
  // renvoie la liste des cases de pierres jugées mortes
  function mortesAuto(sit, ev, seuil) {
    const g = sit.g, n = g.n, mortes = [];
    seuil = seuil === undefined ? 0.35 : seuil;
    for (const ch of chaines(g)) {
      let s = 0;
      for (const p of ch.pierres) {
        const o = ev.poss[g.y(p) * n + g.x(p)];
        s += (ch.couleur === sit.trait) ? o : -o;      // > 0 : le propriétaire de la pierre la possède
      }
      if (s / ch.pierres.length < -seuil) for (const p of ch.pierres) mortes.push(p);
    }
    return mortes;
  }

  // score final : pierres mortes retirées puis comptage par zone. diff > 0 : Blanc gagne.
  function scoreFinal(sit, mortes) {
    const s = SIT.scoreZone(sit.g, mortes);
    const diff = s.blanc + sit.jeu.komi - s.noir;
    return { noir: s.noir, blanc: s.blanc, komi: sit.jeu.komi, diff, gagnant: diff > 0 ? BLANC : NOIR, zone: s.zone };
  }

  return { chaines, mortesAuto, scoreFinal };
});
