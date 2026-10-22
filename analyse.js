// analyse.js — analyse de partie : pour chaque coup, on compare ce qui a été joué avec le meilleur coup du réseau,
// puis on classe le coup : Brillant, Très bon coup, Meilleur coup, Bon coup, Théorique, Erreur, Coup manqué, Gaffe.
(function (racine, usine) {
  if (typeof module === 'object' && module.exports) module.exports = usine(require('./goban.js'), require('./situation.js'), require('./recherche.js'), require('./fin.js'));
  else racine.GoAnalyse = usine(racine.GoGoban, racine.GoSituation, racine.GoRecherche, racine.GoFin);
})(typeof self !== 'undefined' ? self : this, function (GG, SIT, REC, FIN) {
  'use strict';
  const { NOIR, BLANC, PASSE } = GG;
  const Situation = SIT ? SIT.Situation : null;
  const Recherche = REC ? REC.Recherche : null;

  const CLASSES = ['brillant', 'tres_bon', 'meilleur', 'bon', 'theorique', 'erreur', 'manque', 'gaffe'];
  const NOMS = {
    brillant: 'Brillant', tres_bon: 'Très bon coup', meilleur: 'Meilleur coup', bon: 'Bon coup',
    theorique: 'Théorique', erreur: 'Erreur', manque: 'Coup manqué', gaffe: 'Gaffe',
  };
  const SYMBOLES = { brillant: '!!', tres_bon: '!', meilleur: '★', bon: '✓', theorique: '≡', erreur: '?', manque: '×', gaffe: '??' };

  // ---------- classification d'un coup (fonction pure) ----------
  // d : { i (numéro du coup, depuis 0), n (taille), prior (probabilité a priori du coup joué selon le réseau),
  //       perte (points perdus), pertePct (probabilité de gain perdue, 0..1), estMeilleur, estTopPolitique,
  //       gainAvant, gainApres (du joueur, 0..1), ecartNaturel (points gagnés par rapport au coup « naturel » du réseau),
  //       ecartNaturelPct, secondePerte (points que perdrait la meilleure alternative), visitesJouee, perteAdv (points perdus par le coup adverse précédent) }
  function classer(d) {
    const L = d.perte, W = d.pertePct;
    const s = Math.max(0.45, d.n / 19);                 // sur un petit plateau, un point pèse plus lourd
    const Ls = L / s;
    const limiteOuverture = d.n >= 19 ? 20 : d.n >= 13 ? 12 : 6;
    const decide = (d.gainAvant > 0.985 && d.gainApres > 0.95) || (d.gainAvant < 0.015 && d.gainApres < 0.05);
    if (decide) {
      // partie déjà jouée : on ne signale que les énormes pertes
      if (Ls >= 15) return 'erreur';
    } else {
      if ((Ls >= 8 && W >= 0.10) || (W >= 0.30 && Ls >= 3)) return 'gaffe';
      if ((Ls >= 3 && W >= 0.04) || (W >= 0.12 && Ls >= 1.5)) return d.perteAdv / s >= 3 ? 'manque' : 'erreur';
      if (Ls >= 1.5 && W >= 0.03 && d.perteAdv / s >= 3) return 'manque';
    }
    if (d.i < limiteOuverture && Ls <= 0.8 && d.prior >= 0.03) return 'theorique';
    const enJeu = d.gainAvant > 0.08 && d.gainAvant < 0.92;
    if (Ls <= 0.3 && !d.estTopPolitique && d.prior < 0.10 && d.visitesJouee >= 3 && (d.ecartNaturel / s >= 2.0 || d.ecartNaturelPct >= 0.10) && enJeu) return 'brillant';
    // « très bon coup » : coup juste et peu évident — soit une surprise pour le réseau, soit le seul bon coup (l'alternative coûte cher)
    if (Ls <= 0.5 && enJeu && !(d.estTopPolitique && d.prior >= 0.6)
      && ((!d.estTopPolitique && d.prior < 0.15 && (d.ecartNaturel / s >= 1.0 || d.ecartNaturelPct >= 0.06)) || d.secondePerte / s >= 3)) return 'tres_bon';
    if (d.estMeilleur || Ls <= 0.1) return 'meilleur';
    return 'bon';
  }

  // précision à la manière des sites d'échecs (0..100) à partir de la perte de probabilité de gain (0..1)
  // 'perte' (points) compte aussi, pour qu'un camp déjà perdu ne soit pas jugé « parfait » sur des coups sans importance
  function precisionCoup(pertePct, perte, n) {
    const s = Math.max(0.45, (n || 19) / 19);
    const p = Math.max(pertePct * 100, (perte || 0) / s * 1.2);
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * p) - 3.1668));
  }

  // ---------- à partir des positions analysées, fabrique les informations par coup ----------
  // pos[i] : { trait, wl, gain, lead, visites, stats:[{loc,prior,visites,wl,lead}], termine }
  function infoCoup(n, coups, pos, i, perteAdv) {
    const pa = pos[i], pb = pos[i + 1];
    const [pla, loc] = coups[i];
    const leadAvant = pa.lead, leadApres = -pb.lead;       // du point de vue du joueur qui a joué
    const gainAvant = pa.gain, gainApres = 1 - pb.gain;
    const st = pa.stats;
    const jouee = st.find(s => s.loc === loc) || null;
    const perte = Math.max(0, leadAvant - leadApres);
    const pertePct = Math.max(0, gainAvant - gainApres);
    const meilleur = st.length ? st[0] : null;       // le plus visité
    const estMeilleur = !!meilleur && meilleur.loc === loc;
    let topPol = null;
    for (const s of st) if (!topPol || s.prior > topPol.prior) topPol = s;
    const estTopPolitique = !!topPol && topPol.loc === loc;
    let ecartNaturel = 0, ecartNaturelPct = 0;
    if (topPol && !estTopPolitique && (topPol.vt || topPol.visites) >= 2 && jouee && (jouee.vt || jouee.visites) >= 2) {
      ecartNaturel = jouee.lead - topPol.lead;
      ecartNaturelPct = (jouee.wl - topPol.wl) / 2;
    }
    let secondePerte = 0;
    if (estMeilleur && st.length > 1 && st[0].visites >= 4) {
      for (let k = 1; k < st.length; k++) if (st[k].visites >= 2) { secondePerte = Math.max(0, st[0].lead - st[k].lead); break; }
    }
    const d = {
      i, n, joueur: pla, loc, prior: jouee ? jouee.prior : 0,
      perte, pertePct, estMeilleur, gainAvant, gainApres, leadAvant, leadApres,
      ecartNaturel, ecartNaturelPct, estTopPolitique, secondePerte, visitesJouee: jouee ? (jouee.vt || jouee.visites) : 0, perteAdv: perteAdv || 0,
      meilleurLoc: meilleur ? meilleur.loc : null, meilleurLead: meilleur ? meilleur.lead : null, topPolLoc: topPol ? topPol.loc : null,
    };
    d.classe = classer(d);
    return d;
  }

  function classifierTout(n, komi, coups, pos) {
    const T = coups.length, infos = [];
    for (let i = 0; i < T; i++) infos.push(infoCoup(n, coups, pos, i, i > 0 ? infos[i - 1].perte : 0));
    return infos;
  }

  // positions à regarder de plus près : avant et après chaque coup qui a l'air d'une erreur, ou d'un coup remarquable
  function candidatsApprofondir(infos, T, termine) {
    const set = new Set();
    const poids = new Map();
    const note = (idx, w) => poids.set(idx, Math.max(poids.get(idx) || 0, w));
    for (const d of infos) {
      const suspect = d.perte >= 1.2 || d.classe === 'brillant' || d.classe === 'tres_bon' || d.classe === 'gaffe' || d.classe === 'erreur' || d.classe === 'manque'
        || (!d.estTopPolitique && d.prior < 0.1 && d.perte < 0.8 && d.visitesJouee >= 1);
      if (suspect) { set.add(d.i); set.add(d.i + 1); const w = d.perte + (d.classe === 'brillant' || d.classe === 'tres_bon' ? 1 : 0); note(d.i, w); note(d.i + 1, w); }
    }
    let liste = [...set].sort((a, b) => a - b);
    const max = Math.max(6, Math.ceil(T * 0.3));
    if (liste.length > max) liste = liste.sort((a, b) => (poids.get(b) || 0) - (poids.get(a) || 0)).slice(0, max).sort((a, b) => a - b);
    return liste;
  }

  function resumer(n, komi, coups, pos, infos) {
    const par = {
      [NOIR]: { n: 0, pertes: 0, prec: 0, classes: {} },
      [BLANC]: { n: 0, pertes: 0, prec: 0, classes: {} },
    };
    for (const c of CLASSES) { par[NOIR].classes[c] = 0; par[BLANC].classes[c] = 0; }
    for (const d of infos) {
      const pj = par[d.joueur];
      pj.n++; pj.pertes += d.perte; pj.prec += precisionCoup(d.pertePct, d.perte, n); pj.classes[d.classe]++;
    }
    const courbe = [];
    for (let i = 0; i <= coups.length; i++) {
      const p = pos[i];
      courbe.push(p ? { gainNoir: p.trait === NOIR ? p.gain : 1 - p.gain, leadNoir: p.trait === NOIR ? p.lead : -p.lead } : null);
    }
    const resume = (j) => ({ coups: par[j].n, perteMoyenne: par[j].n ? par[j].pertes / par[j].n : 0, precision: par[j].n ? par[j].prec / par[j].n : 0, classes: par[j].classes });
    return { n, komi, coups: infos, courbe, joueurs: { noir: resume(NOIR), blanc: resume(BLANC) } };
  }

  // ---------- la partie analysée : recherches position par position ----------
  class Analyse {
    constructor(reseau, n, komi, coups, opts) {
      opts = opts || {};
      this.reseau = reseau; this.n = n; this.komi = komi; this.coups = coups;
      this.visites = opts.visites || 12;
      this.visitesFortes = opts.visitesFortes || this.visites * 4;
      this.T = coups.length;
      this.sits = [Situation.initiale(n, komi)];
      for (const [pla, loc] of coups) this.sits.push(this.sits[this.sits.length - 1].jouer(loc, pla, true));
      this.rech = new Recherche(reseau, { facteurScore: 0.25 });
      // avancement (mode mono-processus)
      this.pos = new Array(this.T + 1);
      this.etape = 0; this.i = 0; this.aApprofondir = null; this.resultat = null;
      this.travail = 0; this.travailTotal = this.T + 1;
    }

    // Cherche les positions demandées (liste d'indices croissants). Renvoie { idx: info } sérialisable.
    // 'neuf' : repartir d'un arbre vide ; sinon on réutilise l'arbre quand les positions se suivent.
    chercher(indices, visites, neuf) {
      const res = {};
      for (let k = 0; k < indices.length; k++) res[indices[k]] = this.chercherUne(indices[k], visites, neuf || k === 0);
      return res;
    }

    chercherUne(idx, visites, neuf) {
      const sit = this.sits[idx];
      const r = this.rech;
      if (neuf) r.racine = null;
      r.definirRacine(sit);
      if (sit.termine) {
        const evFin = this.reseau.evaluer(sit, 1);
        const mortes = FIN.mortesAuto(sit, evFin);
        const f = FIN.scoreFinal(sit, mortes);
        const leadTrait = sit.trait === BLANC ? f.diff : -f.diff;
        return { trait: sit.trait, wl: leadTrait > 0 ? 1 : -1, gain: leadTrait > 0 ? 1 : 0, lead: leadTrait, visites: 0, termine: true, stats: [] };
      }
      r.executer(visites, 0, null);
      const res = r.resume();
      const naturel = r.stats();                       // classement « naturel » du réseau (avant d'avoir examiné le coup joué)
      const joue = idx < this.T ? this.coups[idx][1] : null;
      if (joue !== null) r.forcer(joue, Math.max(4, Math.round(visites / 3)));
      const tout = r.stats();
      const nat = new Map(naturel.map(s => [s.loc, s.visites]));
      for (const s of tout) { s.visitesTotal = s.visites; s.visites = nat.has(s.loc) ? nat.get(s.loc) : 0; }
      tout.sort((a, b) => (b.visites - a.visites) || (b.prior - a.prior));
      const garde = tout.slice(0, 8);
      const present = new Set(garde.map(s => s.loc));
      let topPol = null;
      for (const s of tout) if (!topPol || s.prior > topPol.prior) topPol = s;
      for (const s of tout) if ((s.loc === joue || s === topPol) && !present.has(s.loc)) { garde.push(s); present.add(s.loc); }
      return {
        trait: sit.trait, wl: res.wl, gain: (res.wl + 1) / 2, lead: res.lead, visites: res.visites, termine: false,
        stats: garde.map(s => ({ loc: s.loc, prior: s.prior, visites: s.visites, vt: s.visitesTotal, wl: s.wl, lead: s.lead })),
      };
    }

    get fini() { return this.etape >= 2; }
    get avancement() { return Math.min(1, this.travail / Math.max(1, this.travailTotal)); }

    // un pas de travail borné (~ budgetMs) ; renvoie true si fini (mode mono-processus)
    pas(budgetMs) {
      const t0 = Date.now();
      budgetMs = budgetMs || 80;
      while (!this.fini && Date.now() - t0 < budgetMs) {
        if (this.etape === 0) {
          this.pos[this.i] = this.chercherUne(this.i, this.visites, this.i === 0);
          this.i++; this.travail++;
          if (this.i > this.T) {
            const infos = classifierTout(this.n, this.komi, this.coups, this.pos);
            this.aApprofondir = candidatsApprofondir(infos, this.T).filter(i => !this.sits[i].termine);
            this.travailTotal = this.T + 1 + this.aApprofondir.length;
            this.etape = 1; this.i = 0;
            if (!this.aApprofondir.length) this._finir();
          }
        } else if (this.etape === 1) {
          const idx = this.aApprofondir[this.i];
          this.pos[idx] = this.chercherUne(idx, this.visitesFortes, true);
          this.i++; this.travail++;
          if (this.i >= this.aApprofondir.length) this._finir();
        }
      }
      return this.fini;
    }

    _finir() {
      const infos = classifierTout(this.n, this.komi, this.coups, this.pos);
      this.resultat = resumer(this.n, this.komi, this.coups, this.pos, infos);
      this.etape = 2;
    }
  }

  return { Analyse, classer, precisionCoup, classifierTout, candidatsApprofondir, resumer, CLASSES, NOMS, SYMBOLES };
});
