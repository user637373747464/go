const O = require('./oracle.js');
const GG = require('../goban.js');
const { Situation } = require('../situation.js');
(async () => {
  const reseau = await O.chargerMoi();
  for (const n of [9, 13, 19]) {
    let sit = Situation.initiale(n, 7.5);
    // quelques coups pour avoir une position vivante
    const rnd = (() => { let s = 7; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
    for (let i = 0; i < 30; i++) {
      const l = sit.coupsLegaux();
      sit = sit.jouer(l[(rnd() * l.length) | 0], sit.trait, true);
    }
    // évaluation complète (entrées + réseau)
    reseau.brut(sit);
    let t0 = performance.now(), N = n === 19 ? 20 : 40;
    for (let i = 0; i < N; i++) reseau.brut(sit);
    const t = (performance.now() - t0) / N;
    // seulement les entrées
    const FEAT = require('../features.js');
    const a = new Float32Array(23 * 23 * 22), b = new Float32Array(32);
    t0 = performance.now();
    for (let i = 0; i < 200; i++) { sit.g._ech = null; sit.parent && (sit.parent.g._ech = null); FEAT.remplir(sit, a, b); }
    const tf = (performance.now() - t0) / 200;
    console.log(`n=${n}: ${t.toFixed(1)} ms par évaluation (entrées ${tf.toFixed(2)} ms)`);
  }
})();
