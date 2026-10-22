// Compare la version rapide (nn.wasm, SIMD) et la version de secours (nn_scalaire.wasm) sur de vraies positions.
// usage : node tests/comparer_scalaire.js [partie.json ...]     (parties : { n, komi, coups:[[joueur, loc], ...] })
const fs = require('fs');
const path = require('path');
const { Situation } = require('../situation.js');
const NN = require('../moteur_nn.js');
const racine = path.join(__dirname, '..');
const lire = (f) => { const b = fs.readFileSync(path.join(racine, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

(async () => {
  const poids = lire('reseau.bin');
  const rapide = await NN.creer(lire('nn.wasm'), poids.slice(0));
  const lent = await NN.creer(lire('nn_scalaire.wasm'), poids.slice(0));
  const fichiers = process.argv.slice(2);
  if (!fichiers.length) fichiers.push(path.join(racine, 'tests', 'parties_exemple.json'));
  let maxDiff = 0, nb = 0, tR = 0, tL = 0, memeCoup = 0;
  for (const f of fichiers) {
    const partie = JSON.parse(fs.readFileSync(f, 'utf8'));
    let sit = Situation.initiale(partie.n, partie.komi);
    const pas = Math.max(1, Math.floor(partie.coups.length / 12));
    for (let i = 0; i <= partie.coups.length; i++) {
      if (i % pas === 0 && !sit.termine) {
        let t = process.hrtime.bigint(); const a = rapide.brut(sit); tR += Number(process.hrtime.bigint() - t) / 1e6;
        t = process.hrtime.bigint(); const b = lent.brut(sit); tL += Number(process.hrtime.bigint() - t) / 1e6;
        const NN2 = a.n * a.n;
        let d = 0;
        for (let k = 0; k < NN2; k++) { d = Math.max(d, Math.abs(a.politique[k] - b.politique[k]), Math.abs(a.possession[k] - b.possession[k])); }
        for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a.valeur[k] - b.valeur[k]));
        for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a.score[k] - b.score[k]));
        maxDiff = Math.max(maxDiff, d); nb++;
        const am = a.politique.indexOf(Math.max(...a.politique)), bm = b.politique.indexOf(Math.max(...b.politique));
        if (am === bm) memeCoup++;
      }
      if (i < partie.coups.length) sit = sit.jouer(partie.coups[i][1], partie.coups[i][0], true);
    }
  }
  console.log(`${nb} positions : écart maximal ${maxDiff.toExponential(2)} ; même meilleur coup ${memeCoup}/${nb} ; durée moyenne rapide ${(tR / nb).toFixed(1)} ms, secours ${(tL / nb).toFixed(1)} ms (×${(tL / tR).toFixed(1)})`);
  if (maxDiff > 1e-3 || memeCoup !== nb) { console.log('ECHEC'); process.exit(1); }
  console.log('ok');
})();
