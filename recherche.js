// recherche.js — recherche arborescente (type MCTS / PUCT) guidée par le réseau, comme KataGo en plus simple.
// Chaque « visite » descend l'arbre, évalue une feuille avec le réseau, puis remonte la valeur.
(function (racine, usine) {
  if (typeof module === 'object' && module.exports) module.exports = usine(require('./goban.js'), require('./situation.js'));
  else racine.GoRecherche = usine(racine.GoGoban, racine.GoSituation);
})(typeof self !== 'undefined' ? self : this, function (GG, SIT) {
  'use strict';
  const { PASSE, NOIR, BLANC } = GG;
  const { scoreZone } = SIT;

  class Noeud {
    constructor(sit) {
      this.sit = sit;
      this.etendu = false;
      this.visites = 0;            // nombre de visites passées par ce nœud
      this.ev = null;              // évaluation du réseau (du point de vue du joueur au trait ici)
      this.termine = false;
      // arêtes (une par coup légal) :
      this.locs = null;            // Int16Array : case (ou PASSE)
      this.prior = null;           // Float32Array
      this.n = null;               // Int32Array : visites de l'arête
      this.w = null;               // Float64Array : somme des utilités (du point de vue du joueur au trait ICI)
      this.wl = null;              // somme (gain - perte)
      this.ld = null;              // somme des « lead »
      this.enfants = null;         // Array : Noeud ou undefined
      this.uTerm = 0; this.wlTerm = 0; this.ldTerm = 0;
    }
  }

  class Recherche {
    constructor(reseau, opts) {
      opts = opts || {};
      this.reseau = reseau;
      this.cpuct = opts.cpuct || 1.1;
      this.fpu = opts.fpu === undefined ? 0.2 : opts.fpu;
      this.facteurScore = opts.facteurScore === undefined ? 0.25 : opts.facteurScore;
      this.tempPolitiqueRacine = opts.tempPolitiqueRacine || 1.0;
      this.racine = null;
      this.evalsTotal = 0;
    }

    utilite(wl, lead, n) { return wl + this.facteurScore * Math.tanh(lead / n); }

    // Fixe la racine. Si la situation suit de quelques coups l'ancienne racine, on garde le sous-arbre déjà exploré.
    definirRacine(sit) {
      if (this.racine) {
        if (this.racine.sit === sit) return this.racine;
        const coups = [];
        let s = sit;
        for (let k = 0; s && k < 6 && s !== this.racine.sit; k++) { coups.unshift(s.coup); s = s.parent; }
        if (s === this.racine.sit) {
          let nd = this.racine, ok = true;
          for (const c of coups) {
            if (!nd.etendu || nd.termine) { ok = false; break; }
            let found = null;
            for (let i = 0; i < nd.locs.length; i++) if (nd.locs[i] === c[1]) { found = nd.enfants[i]; break; }
            if (!found) { ok = false; break; }
            nd = found;
          }
          if (ok) { nd.sit = sit; this.racine = nd; return nd; }
        }
      }
      this.racine = new Noeud(sit);
      return this.racine;
    }

    _etendre(noeud, estRacine) {
      const sit = noeud.sit;
      if (sit.termine) {
        noeud.etendu = true; noeud.termine = true;
        const s = scoreZone(sit.g, null);
        // avance de Blanc (komi compris) ; du point de vue du joueur au trait
        const diffBlanc = s.blanc + sit.jeu.komi - s.noir;
        const lead = sit.trait === BLANC ? diffBlanc : -diffBlanc;
        noeud.wlTerm = lead > 0 ? 1 : -1;
        noeud.ldTerm = lead;
        noeud.uTerm = this.utilite(noeud.wlTerm, lead, sit.g.n);
        noeud.ev = { gain: lead > 0 ? 1 : 0, perte: lead > 0 ? 0 : 1, lead, scoreMoy: lead, poss: null, pol: null, n: sit.g.n };
        return;
      }
      const ev = this.reseau.evaluer(sit, estRacine ? this.tempPolitiqueRacine : 1);
      this.evalsTotal++;
      noeud.ev = ev;
      noeud.etendu = true;
      const n = sit.g.n, NN = n * n;
      const locs = [], pri = [];
      for (let k = 0; k < NN; k++) {
        if (ev.pol[k] > 0) {
          const x = k % n, y = (k / n) | 0;
          locs.push(sit.g.loc(x, y)); pri.push(ev.pol[k]);
        }
      }
      locs.push(PASSE); pri.push(ev.pol[NN]);
      const m = locs.length;
      noeud.locs = Int16Array.from(locs);
      noeud.prior = Float32Array.from(pri);
      noeud.n = new Int32Array(m);
      noeud.w = new Float64Array(m);
      noeud.wl = new Float64Array(m);
      noeud.ld = new Float64Array(m);
      noeud.enfants = new Array(m);
    }

    // une visite complète ; renvoie la valeur de feuille (utilité du joueur au trait de la racine) pour information
    // force : (facultatif) numéro de l'arête à suivre obligatoirement à la racine (pour examiner un coup précis)
    visiter(force) {
      let noeud = this.racine;
      if (!noeud.etendu) {
        this._etendre(noeud, true);
        noeud.visites++;
        return;
      }
      const chemin = [], aretes = [];
      const nBoard = noeud.sit.g.n;
      while (true) {
        if (noeud.termine) break;
        if (!noeud.etendu) { this._etendre(noeud, false); break; }
        // choisir l'arête
        const m = noeud.locs.length;
        const N = noeud.visites;
        const sq = Math.sqrt(N + 0.01);
        let explore = 0;
        for (let i = 0; i < m; i++) if (noeud.n[i] > 0) explore += noeud.prior[i];
        let totW = 0, totN = 0;
        for (let i = 0; i < m; i++) { totW += noeud.w[i]; totN += noeud.n[i]; }
        const brut = noeud.ev.gain - noeud.ev.perte;
        const parentU = totN > 0 ? totW / totN : this.utilite(brut, noeud.ev.lead, nBoard);
        const fpuVal = parentU - this.fpu * Math.sqrt(explore);
        let meilleur = -1, meilleurScore = -1e30;
        for (let i = 0; i < m; i++) {
          const ni = noeud.n[i];
          const q = ni > 0 ? noeud.w[i] / ni : fpuVal;
          const sc = q + this.cpuct * noeud.prior[i] * sq / (1 + ni);
          if (sc > meilleurScore) { meilleurScore = sc; meilleur = i; }
        }
        if (force !== undefined && chemin.length === 0) meilleur = force;
        const i = meilleur;
        chemin.push(noeud); aretes.push(i);
        let enf = noeud.enfants[i];
        if (!enf) {
          const loc = noeud.locs[i];
          const sit2 = noeud.sit.jouer(loc, noeud.sit.trait, false);
          enf = new Noeud(sit2);
          noeud.enfants[i] = enf;
        }
        noeud = enf;
      }
      // valeur de la feuille (du point de vue du joueur au trait à la feuille)
      let wl, ld, u;
      if (noeud.termine) { wl = noeud.wlTerm; ld = noeud.ldTerm; u = noeud.uTerm; }
      else {
        wl = noeud.ev.gain - noeud.ev.perte; ld = noeud.ev.lead; u = this.utilite(wl, ld, nBoard);
      }
      noeud.visites++;
      let s = -1;
      for (let k = chemin.length - 1; k >= 0; k--) {
        const p = chemin[k], i = aretes[k];
        p.n[i]++; p.w[i] += s * u; p.wl[i] += s * wl; p.ld[i] += s * ld;
        p.visites++;
        s = -s;
      }
    }

    // exécute des visites jusqu'à la limite ; arrêt anticipé si 'arreter()' renvoie vrai
    executer(visitesMax, tempsMaxMs, arreter) {
      const t0 = Date.now();
      const r = this.racine;
      let fait = 0;
      while (r.visites < visitesMax) {
        this.visiter();
        fait++;
        if ((fait & 1) === 0) {
          if (tempsMaxMs && Date.now() - t0 > tempsMaxMs) break;
          if (arreter && arreter()) break;
        }
      }
      return fait;
    }

    // oblige la recherche à visiter au moins nVisites fois le coup 'loc' (utile pour juger un coup qui n'est pas celui du réseau)
    forcer(loc, nVisites) {
      const r = this.racine;
      if (!r.etendu || r.termine) return;
      let idx = -1;
      for (let i = 0; i < r.locs.length; i++) if (r.locs[i] === loc) { idx = i; break; }
      if (idx < 0) return;
      for (let essais = 0; r.n[idx] < nVisites && essais < 4 * nVisites; essais++) this.visiter(idx);
    }

    // statistiques des coups à la racine (triées par visites décroissantes)
    stats() {
      const r = this.racine;
      if (!r.etendu) return [];
      const res = [];
      for (let i = 0; i < r.locs.length; i++) {
        const ni = r.n[i];
        res.push({
          loc: r.locs[i], prior: r.prior[i], visites: ni,
          q: ni ? r.w[i] / ni : null, wl: ni ? r.wl[i] / ni : null, lead: ni ? r.ld[i] / ni : null,
        });
      }
      res.sort((a, b) => (b.visites - a.visites) || (b.prior - a.prior));
      return res;
    }

    // résumé de la racine : valeur moyenne vue par la recherche (point de vue du joueur au trait)
    resume() {
      const r = this.racine;
      let n = 0, w = 0, wl = 0, ld = 0;
      for (let i = 0; i < r.locs.length; i++) { n += r.n[i]; w += r.w[i]; wl += r.wl[i]; ld += r.ld[i]; }
      if (n === 0) {
        const e = r.ev;
        return { visites: 0, wl: e.gain - e.perte, gain: e.gain, lead: e.lead, q: e.gain - e.perte };
      }
      const wlm = wl / n;
      return { visites: n, wl: wlm, gain: (wlm + 1) / 2, lead: ld / n, q: w / n };
    }
  }

  return { Recherche, Noeud };
});
