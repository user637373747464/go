// situation.js — une « situation » de jeu (plateau + historique) et la partie entière.
// Règles utilisées dans l'app : comptage par zone (area), super-ko positionnel, suicide interdit, deux passes = fin.
// Une Situation ne change jamais une fois créée : jouer un coup en fabrique une nouvelle (utile pour l'arbre de recherche).
(function (racine, usine) {
  if (typeof module === 'object' && module.exports) module.exports = usine(require('./goban.js'));
  else racine.GoSituation = usine(racine.GoGoban);
})(typeof self !== 'undefined' ? self : this, function (GG) {
  'use strict';
  const { Goban, VIDE, NOIR, BLANC, NUL, PASSE } = GG;

  // Mémoire commune d'une partie : toutes les positions déjà vues (clé -> numéro du coup où elle est apparue la 1re fois)
  // et les cases où une pierre a déjà été posée un jour.
  class Jeu {
    constructor(n, komi) {
      this.n = n; this.komi = komi;
      this.vus = new Map();
      this.occupe = new Uint8Array((n + 1) * (n + 2) + 1);
    }
  }

  class Situation {
    constructor(g, parent, coup, jeu, ply) {
      this.g = g;
      this.parent = parent;          // situation précédente (ou null)
      this.coup = coup;              // [joueur, case] du coup qui mène ici (ou null au début)
      this.jeu = jeu;
      this.ply = ply;
      this.trait = coup ? 3 - coup[0] : NOIR;
      this.passes = 0;               // nombre de passes consécutives qui viennent d'être jouées
      if (coup && coup[1] === PASSE) this.passes = (parent ? parent.passes : 0) + 1;
      this.profondeur = 0;           // distance à la racine de la recherche (0 si c'est la racine)
      this.racine = this;            // dernière situation « réelle » de la partie
    }
    static initiale(n, komi) {
      const jeu = new Jeu(n, komi);
      const g = new Goban(n);
      const s = new Situation(g, null, null, jeu, 0);
      jeu.vus.set(g.cle(), 0);
      return s;
    }
    get termine() { return this.passes >= 2; }

    // Le plateau obtenu avec cette position a-t-il déjà existé (super-ko positionnel) ?
    dejaVue(cle) {
      const p = this.jeu.vus.get(cle);
      const base = this.racine;
      if (p !== undefined && p <= base.ply) return true;
      for (let s = this; s !== base; s = s.parent) if (s.g.cle() === cle) return true;
      return false;
    }

    coupBanniSuperko(loc, pla) {
      const g = this.g;
      if (g.c[loc] !== VIDE || loc === g.ko || g.estSuicideInterdit(loc, pla, false)) return false;
      g.empreinteApres(loc, pla);
      const cle = (g._r1 >>> 0) * 2097152 + (g._r2 >>> 11);
      return this.dejaVue(cle);
    }

    estLegal(loc, pla) {
      if (loc === PASSE) return true;
      const g = this.g;
      if (!g.estLegal(loc, pla, false)) return false;
      g.empreinteApres(loc, pla);
      const cle = (g._r1 >>> 0) * 2097152 + (g._r2 >>> 11);
      return !this.dejaVue(cle);
    }

    // Liste des cases interdites par le super-ko (hors ko simple) pour le joueur au trait
    bannisSuperko() {
      const res = [];
      const g = this.g, n = g.n, pla = this.trait, jeu = this.jeu;
      const chemin = [];
      for (let s = this; s !== this.racine; s = s.parent) if (s.coup && s.coup[1] !== PASSE) chemin.push(s.coup[1]);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const loc = (x + 1) + (y + 1) * g.l;
        if (g.c[loc] !== VIDE || loc === g.ko) continue;
        if (!jeu.occupe[loc] && chemin.indexOf(loc) < 0 && !g.estSuicide(loc, pla)) continue;
        if (this.coupBanniSuperko(loc, pla)) res.push(loc);
      }
      return res;
    }

    // Nouvelle situation après le coup (suppose légal). Si 'reel' est vrai, ce coup est joué dans la vraie partie.
    jouer(loc, pla, reel) {
      const g2 = this.g.cloner();
      g2.jouer(loc, pla);
      const s = new Situation(g2, this, [pla, loc], this.jeu, this.ply + 1);
      if (reel) {
        s.racine = s;
        s.profondeur = 0;
        if (loc !== PASSE) this.jeu.occupe[loc] = 1;
        const cle = g2.cle();
        if (!this.jeu.vus.has(cle)) this.jeu.vus.set(cle, s.ply);
      } else {
        s.racine = this.racine;
        s.profondeur = this.profondeur + 1;
      }
      return s;
    }

    // Les 5 derniers coups, du plus ancien au plus récent : [[pla, loc], ...]
    derniersCoups(k) {
      const r = [];
      for (let s = this; s && s.coup && r.length < k; s = s.parent) r.unshift(s.coup);
      return r;
    }
    ancetre(k) { let s = this; for (let i = 0; i < k && s.parent; i++) s = s.parent; return s; }

    // Tous les coups légaux (cases) pour le joueur au trait, sans la passe
    coupsLegaux() {
      const g = this.g, n = g.n, pla = this.trait, res = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const loc = (x + 1) + (y + 1) * g.l;
        if (g.c[loc] === VIDE && this.estLegal(loc, pla)) res.push(loc);
      }
      return res;
    }
  }

  // ---------- score par zone ----------
  // mortes : tableau/Set de cases dont la pierre est considérée morte (retirée avant de compter)
  // renvoie { noir, blanc, territoireNoir, territoireBlanc, zone: Uint8Array }
  function scoreZone(g, mortes) {
    const n = g.n, l = g.l;
    const c = g.c.slice();
    if (mortes) for (const m of mortes) if (c[m] === NOIR || c[m] === BLANC) c[m] = VIDE;
    const zone = new Uint8Array(g.taille);
    const vu = new Uint8Array(g.taille);
    let noir = 0, blanc = 0;
    const a = g.adj;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const loc = (x + 1) + (y + 1) * l;
      if (c[loc] === NOIR) { noir++; zone[loc] = NOIR; }
      else if (c[loc] === BLANC) { blanc++; zone[loc] = BLANC; }
      else if (!vu[loc]) {
        const pile = [loc]; vu[loc] = 1;
        const region = [];
        let tN = false, tB = false;
        while (pile.length) {
          const p = pile.pop(); region.push(p);
          for (let i = 0; i < 4; i++) {
            const v = p + a[i];
            if (c[v] === VIDE) { if (!vu[v]) { vu[v] = 1; pile.push(v); } }
            else if (c[v] === NOIR) tN = true;
            else if (c[v] === BLANC) tB = true;
          }
        }
        if (tN && !tB) { noir += region.length; for (const p of region) zone[p] = NOIR; }
        else if (tB && !tN) { blanc += region.length; for (const p of region) zone[p] = BLANC; }
      }
    }
    return { noir, blanc, zone };
  }

  return { Jeu, Situation, scoreZone };
});
