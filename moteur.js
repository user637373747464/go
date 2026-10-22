// moteur.js — côté écran : parle au « cerveau » (worker.js) et organise l'analyse de partie sur plusieurs workers.
(function (racine) {
  'use strict';
  const GG = racine.GoGoban, AN = racine.GoAnalyse;

  // le navigateur sait-il lire le WebAssembly « SIMD » ? (iPhone : iOS 16.4 ou plus)
  function wasmOk() { return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function'; }
  // adresse terminée par ?mode=compatible : force la version de secours (pour tester, ou si la version rapide pose problème)
  function modeForce() { try { return /[?&]mode=compatible/.test(racine.location.search); } catch (e) { return false; } }
  function simdOk() {
    try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); }
    catch (e) { return false; }
  }

  class Travailleur {
    constructor(scalaire) {
      this.pret = false; this.erreur = null; this.nextId = 1; this.mode = '';
      this.attente = new Map();            // id -> {ok, ko}
      this.surPos = null; this.finLot = null;
      this.promessePret = new Promise((ok, ko) => { this._ok = ok; this._ko = ko; });
      this.promessePret.catch(() => {});
      this.w = new Worker('worker.js');
      this.w.onmessage = (e) => this.recu(e.data);
      this.w.onerror = (e) => { this.echec('le cerveau n\'a pas démarré' + (e && e.message ? ' (' + e.message + ')' : '')); };
      this.w.postMessage({ type: 'init', scalaire: !!scalaire });
    }
    echec(texte) {
      if (!this.pret) { this.erreur = { msg: texte }; this._ko(this.erreur); }
      for (const a of this.attente.values()) a.ko(new Error(texte));
      this.attente.clear();
      if (this.finLot) { const f = this.finLot; this.finLot = null; f.ko(new Error(texte)); }
    }
    recu(m) {
      if (m.type === 'pret') { this.pret = true; this.mode = m.mode || ''; this._ok(); return; }
      if (m.type === 'erreur') {
        if (!this.pret) { this.echec(m.msg); return; }
        if (m.id && this.attente.has(m.id)) { const a = this.attente.get(m.id); this.attente.delete(m.id); a.ko(new Error(m.msg)); return; }
        if (m.job && this.finLot) { const f = this.finLot; this.finLot = null; f.ko(new Error(m.msg)); }
        return;
      }
      if (m.type === 'coup' || m.type === 'morts') {
        const a = this.attente.get(m.id);
        if (a) { this.attente.delete(m.id); a.ok(m); }
        return;
      }
      if (m.type === 'pos') { if (this.surPos) this.surPos(m); return; }
      if (m.type === 'lot') { if (this.finLot) { const f = this.finLot; this.finLot = null; f.ok(m); } }
    }
    appeler(msg) {
      return this.promessePret.then(() => new Promise((ok, ko) => {
        msg.id = this.nextId++;
        this.attente.set(msg.id, { ok, ko });
        this.w.postMessage(msg);
      }));
    }
    analyser(msg, surPos) {
      return this.promessePret.then(() => new Promise((ok, ko) => {
        this.surPos = surPos; this.finLot = { ok, ko };
        msg.type = 'analyser';
        this.w.postMessage(msg);
      }));
    }
    arreter() { try { this.w.terminate(); } catch (e) { /* rien */ } }
  }

  // combien de visites par position selon la taille du plateau : [première passe, positions suspectes]
  function visitesPour(n, rapide) {
    const v = n <= 9 ? [16, 64] : n <= 13 ? [12, 48] : [8, 32];
    return rapide === false ? [Math.max(4, v[0] >> 1), Math.max(16, v[1] >> 1)] : v;      // mode compatible : on réfléchit moitié moins pour que l'analyse reste raisonnable
  }

  class Moteur {
    constructor() {
      this.wasm = wasmOk();                       // le navigateur sait-il faire tourner du WebAssembly ?
      this.simd = simdOk() && !modeForce();       // sait-il faire le calcul rapide (SIMD) ? sinon : mode compatible, plus lent
      this.ts = [];
      this.an = [];
      this.job = 0;
      if (this.wasm) this.ts.push(new Travailleur(!this.simd));
    }
    // le cerveau n'a pas démarré (ou plus rien ne répond) : on repart de zéro
    redemarrer() {
      for (const t of this.ts) t.arreter();
      this.ts = [];
      while (this.an.length) this.an.pop().arreter();
      this.job++;
      if (this.wasm) this.ts.push(new Travailleur(!this.simd));
    }
    get principal() { return this.ts[0]; }
    get pret() { return !!(this.ts[0] && this.ts[0].pret); }
    attendre() { return this.wasm ? this.ts[0].promessePret : Promise.reject({ msg: 'wasm', wasm: true }); }
    jouer(msg) { msg.type = 'jouer'; return this.ts[0].appeler(msg); }
    fin(msg) { msg.type = 'fin'; return this.ts[0].appeler(msg); }

    // travailleurs réservés à l'analyse (le premier travailleur reste libre pour jouer le bot)
    async travailleurs(nb) {
      while (this.an.length < nb) this.an.push(new Travailleur(!this.simd));
      const liste = this.an.slice(0, nb);
      await Promise.all(liste.map(t => t.promessePret));
      return liste;
    }
    liberer() {          // l'analyse est finie : on rend la mémoire
      while (this.an.length) this.an.pop().arreter();
    }
    annulerAnalyse() {
      this.job++;
      this.liberer();
    }

    // analyse complète d'une partie. surProgres(0..1). Renvoie le résultat (voir analyse.js) ou null s'il n'y a rien à analyser.
    async analyser(partie, surProgres) {
      const { n, komi, coups } = partie;
      const T = coups.length;
      if (T < 1) return null;
      this.annulerAnalyse();
      const job = ++this.job;
      const nb = Math.min(3, Math.max(2, (racine.navigator && navigator.hardwareConcurrency || 2) - 1));
      const ts = await this.travailleurs(nb);
      const [v1, v2] = visitesPour(n, this.simd && !(this.ts[0] && this.ts[0].mode === 'compatible'));
      const pos = new Array(T + 1);
      let faits = 0, total = T + 1;
      const termine = (i) => i >= 2 && coups[i - 1][1] === GG.PASSE && coups[i - 2][1] === GG.PASSE;
      const surPos = (m) => {
        if (m.job !== job) return;
        pos[m.idx] = m.res;
        faits++;
        if (surProgres) surProgres(Math.min(0.99, faits / total));
      };
      const lancer = async (indices, visites, phase) => {
        const taille = Math.max(2, Math.ceil(indices.length / (ts.length * 4)));
        const lots = [];
        for (let i = 0; i < indices.length; i += taille) lots.push(indices.slice(i, i + taille));
        let suivant = 0;
        await Promise.all(ts.map(async (t) => {
          while (suivant < lots.length && this.job === job) {
            const lot = lots[suivant++];
            await t.analyser({ job, phase, n, komi, coups, indices: lot, visites }, surPos);
          }
        }));
      };
      const tous = []; for (let i = 0; i <= T; i++) tous.push(i);
      await lancer(tous, v1, 1);
      if (this.job !== job) return null;
      let infos = AN.classifierTout(n, komi, coups, pos);
      const cands = AN.candidatsApprofondir(infos, T).filter(i => !termine(i));
      total = T + 1 + cands.length;
      if (cands.length) {
        await lancer(cands, v2, 2);
        if (this.job !== job) return null;
        infos = AN.classifierTout(n, komi, coups, pos);
      }
      if (surProgres) surProgres(1);
      return AN.resumer(n, komi, coups, pos, infos);
    }
  }

  racine.GoMoteur = { Moteur, simdOk, wasmOk, visitesPour };
})(typeof self !== 'undefined' ? self : this);
