// moteur_nn.js — appelle le réseau (nn.wasm + reseau.bin) et transforme ses sorties en probabilités lisibles.
// Utilisable dans Node (tests) et dans un Web Worker (l'app).
(function (racine, usine) {
  if (typeof module === 'object' && module.exports) module.exports = usine(require('./features.js'), require('./goban.js'));
  else racine.GoNN = usine(racine.GoFeatures, racine.GoGoban);
})(typeof self !== 'undefined' ? self : this, function (FEAT, GG) {
  'use strict';
  const { VIDE, PASSE } = GG;

  const softplus = (x) => (x > 20 ? x : Math.log(1 + Math.exp(x)));

  // wasmOctets : ArrayBuffer de nn.wasm ; poids : ArrayBuffer de reseau.bin
  async function creer(wasmOctets, poids) {
    const { instance } = await WebAssembly.instantiate(wasmOctets, {});
    const e = instance.exports;
    const mem = e.memory;
    const taille = poids.byteLength;
    const ptr = e.gw_alloc(taille);
    new Uint8Array(mem.buffer, ptr, taille).set(new Uint8Array(poids));
    const lu = e.gw_charger(ptr);
    if (lu < 0) throw new Error('réseau illisible (code ' + lu + ')');
    if (lu * 4 !== taille) throw new Error("taille inattendue du réseau : " + (lu * 4) + " vs " + taille);
    const ptrIn = e.gw_entree_spatiale(), ptrGlob = e.gw_entree_globale(), ptrOut = e.gw_sortie();
    let courant = 0;
    let vIn = null, vGlob = null, vOut = null;
    const vues = () => {
      vIn = new Float32Array(mem.buffer, ptrIn, 23 * 23 * FEAT.NB_PLANS);
      vGlob = new Float32Array(mem.buffer, ptrGlob, 32);
      vOut = new Float32Array(mem.buffer, ptrOut, 2 * 441 + 64);
    };
    vues();

    // Sorties brutes du réseau pour une situation (du point de vue du joueur au trait)
    function brut(sit) {
      const n = sit.g.n;
      if (n !== courant) { if (e.gw_plateau(n) !== 0) throw new Error('taille de plateau non gérée'); courant = n; }
      if (vIn.buffer !== mem.buffer) vues();
      FEAT.remplir(sit, vIn, vGlob);
      e.gw_calculer();
      const NN = n * n;
      return {
        n,
        politique: vOut.slice(0, NN), passe: vOut[NN],
        valeur: [vOut[NN + 1], vOut[NN + 2], vOut[NN + 3]],
        score: [vOut[NN + 4], vOut[NN + 5], vOut[NN + 6], vOut[NN + 7]],
        possession: vOut.slice(NN + 8, NN + 8 + NN),
      };
    }

    // Évaluation lisible. temperature : 1 = normal. Les coups illégaux ont une probabilité 0.
    // Résultat : { pol: Float32Array(n*n+1) (la dernière valeur = passe), gain, perte, nulle, scoreMoy, lead, poss: Float32Array(n*n) }
    function evaluer(sit, temperature) {
      const r = brut(sit);
      const n = r.n, NN = n * n, g = sit.g, pla = sit.trait;
      const T = temperature || 1;
      const pol = new Float32Array(NN + 1);
      const legal = new Uint8Array(NN + 1);
      let max = -1e30;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const loc = (x + 1) + (y + 1) * g.l;
        if (g.c[loc] === VIDE && sit.estLegal(loc, pla)) {
          legal[y * n + x] = 1;
          const v = r.politique[y * n + x] / T;
          pol[y * n + x] = v;
          if (v > max) max = v;
        }
      }
      legal[NN] = 1; pol[NN] = r.passe / T; if (pol[NN] > max) max = pol[NN];
      let somme = 0;
      for (let i = 0; i <= NN; i++) if (legal[i]) { pol[i] = Math.exp(pol[i] - max); somme += pol[i]; }
      for (let i = 0; i <= NN; i++) pol[i] = legal[i] ? pol[i] / somme : 0;
      // valeur : positional ko => pas de « sans résultat »
      const lw = r.valeur[0], ll = r.valeur[1];
      const m = Math.max(lw, ll);
      const ew = Math.exp(lw - m), el = Math.exp(ll - m);
      const gain = ew / (ew + el), perte = el / (ew + el);
      const scoreMoy = r.score[0] * 20;
      const lead = r.score[2] * 20;
      const poss = new Float32Array(NN);
      for (let i = 0; i < NN; i++) poss[i] = Math.tanh(r.possession[i]);
      return { n, pol, gain, perte, nulle: 0, scoreMoy, ecart: softplus(r.score[1]) * 20, lead, poss };
    }

    return { brut, evaluer };
  }

  return { creer };
});
