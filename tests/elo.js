// Ajuste des notes Elo (modèle de Bradley-Terry) à partir de calib/<nom>.jsonl
// usage : node tests/elo.js <nom> [<nom2> ...]
const fs = require('fs');
const noms = process.argv.slice(2);
const parties = [];
for (const nom of noms) for (const l of fs.readFileSync(`calib/${nom}.jsonl`, 'utf8').split('\n')) if (l.trim()) parties.push(JSON.parse(l));
const ks = [...new Set(parties.flatMap(p => [p.kN, p.kB]))];
const idx = new Map(ks.map((k, i) => [k, i]));
const r = new Float64Array(ks.length);
const L = Math.log(10) / 400;
for (let it = 0; it < 3000; it++) {
  const g = new Float64Array(ks.length), h = new Float64Array(ks.length);
  for (const p of parties) {
    const a = idx.get(p.kN), b = idx.get(p.kB);
    const s = p.gagnant === 'N' ? 1 : 0;
    const pa = 1 / (1 + Math.exp(-L * (r[a] - r[b])));
    g[a] += L * (s - pa); g[b] -= L * (s - pa);
    const w = L * L * pa * (1 - pa);
    h[a] += w; h[b] += w;
  }
  // petit a priori pour éviter les valeurs infinies
  for (let i = 0; i < ks.length; i++) { g[i] -= 1e-5 * r[i]; h[i] += 1e-5; r[i] += g[i] / (h[i] + 1e-9) * 0.7; }
  const m = r.reduce((s, v) => s + v, 0) / r.length;
  for (let i = 0; i < r.length; i++) r[i] -= m;
}
const nb = new Map();
for (const p of parties) for (const k of [p.kN, p.kB]) nb.set(k, (nb.get(k) || 0) + 1);
console.log(`${parties.length} parties`);
const ordre = ks.map((k, i) => i).sort((a, b) => r[a] - r[b]);
for (const i of ordre) console.log(String(ks[i]).padStart(5), r[i].toFixed(0).padStart(6), ' parties:', nb.get(ks[i]));
module.exports = { ks, r };
