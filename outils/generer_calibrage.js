// Fabrique calibrage.md : notes Elo mesurées en faisant jouer le bot contre lui-même (modèle de Bradley-Terry).
// usage : node outils/generer_calibrage.js   (lit calib/K*.jsonl, M*.jsonl, W*.jsonl)
const fs = require('fs');
const path = require('path');
const dossier = path.join(__dirname, '..', 'calib');
const fichiers = fs.readdirSync(dossier).filter(f => /^(K9|W9|M9|K13|V48)\.jsonl$/.test(f));
const parties = [];
for (const f of fichiers) for (const l of fs.readFileSync(path.join(dossier, f), 'utf8').split('\n')) if (l.trim()) parties.push(JSON.parse(l));

const NOM = { K30: '30 kyu', K27: '27 kyu', K24: '24 kyu', K21: '21 kyu', K20: '20 kyu', K18: '18 kyu', K15: '15 kyu', K12: '12 kyu', K10: '10 kyu', K9: '9 kyu',
  K6: '6 kyu', K3: '3 kyu', K0: '1 dan', M25: '2 dan', M50: '3 dan', M75: '4 dan', 'K-3': '(formule, rang −3)', V1: '5 dan', V2: '6 dan', V4: '7 dan', V8: '8 dan', V16: '9 dan', V48: '9 dan +' };
const ORDRE = ['K30', 'K27', 'K24', 'K21', 'K20', 'K18', 'K15', 'K12', 'K10', 'K9', 'K6', 'K3', 'K0', 'M25', 'M50', 'M75', 'K-3', 'V1', 'V2', 'V4', 'V8', 'V16', 'V48'];

function ajuster(ps) {
  const ks = [...new Set(ps.flatMap(p => [p.kN, p.kB]))];
  const idx = new Map(ks.map((k, i) => [k, i]));
  const r = new Float64Array(ks.length), L = Math.log(10) / 400;
  for (let it = 0; it < 4000; it++) {
    const g = new Float64Array(ks.length), h = new Float64Array(ks.length);
    for (const p of ps) {
      const a = idx.get(p.kN), b = idx.get(p.kB), s = p.gagnant === 'N' ? 1 : 0;
      const pa = 1 / (1 + Math.exp(-L * (r[a] - r[b])));
      g[a] += L * (s - pa); g[b] -= L * (s - pa);
      const w = L * L * pa * (1 - pa); h[a] += w; h[b] += w;
    }
    for (let i = 0; i < ks.length; i++) { g[i] -= 1e-5 * r[i]; h[i] += 1e-5; r[i] += g[i] / (h[i] + 1e-9) * 0.7; }
    const m = r.reduce((s, v) => s + v, 0) / r.length;
    for (let i = 0; i < r.length; i++) r[i] -= m;
  }
  const nb = new Map();
  for (const p of ps) for (const k of [p.kN, p.kB]) nb.set(k, (nb.get(k) || 0) + 1);
  // incertitude approximative (1 écart-type) à partir de la courbure de la vraisemblance
  const hh = new Float64Array(ks.length);
  for (const p of ps) {
    const a = idx.get(p.kN), b = idx.get(p.kB);
    const pa = 1 / (1 + Math.exp(-L * (r[a] - r[b])));
    const w = L * L * Math.max(pa * (1 - pa), 0.02);
    hh[a] += w; hh[b] += w;
  }
  return ks.map((k, i) => ({ id: k, elo: r[i], parties: nb.get(k), se: 1 / Math.sqrt(hh[i]) }));
}

let md = `# Calibrage des niveaux

Pour vérifier que chaque niveau est plus fort que le précédent, j'ai fait jouer le bot **contre lui-même** (un niveau contre un autre, couleurs alternées, ouvertures légèrement variées) et j'ai calculé des notes **Elo** à partir des résultats (modèle de Bradley-Terry).
Une différence de 100 points Elo ≈ 64 % de victoires pour le plus fort.

**Ce que ça prouve** : l'ordre des niveaux et l'écart entre eux *dans ce bot*.
**Ce que ça ne prouve pas** : le lien avec de vrais rangs de club. Les noms (« 12 kyu »…) viennent de la formule de KaTrain pour les niveaux faibles, et d'un nombre d'explorations qui double à chaque rang pour les niveaux forts : ce sont des repères.
La note de chaque niveau est donnée **par rapport au plus faible mesuré** (0 = 30 kyu).

`;
for (const n of [9, 13]) {
  const ps = parties.filter(p => p.n === n);
  if (!ps.length) continue;
  const res = ajuster(ps);
  const base = res.find(x => x.id === 'K30');
  const z = base ? base.elo : Math.min(...res.map(x => x.elo));
  res.sort((a, b) => ORDRE.indexOf(a.id) - ORDRE.indexOf(b.id));
  md += `## Plateau ${n}×${n} (${ps.length} parties)\n\n| Niveau | Réglage | Note Elo | ± | Parties |\n|---|---|---|---|---|\n`;
  for (const x of res) md += `| ${NOM[x.id] || x.id} | ${x.id} | ${Math.round(x.elo - z)} | ${Math.round(x.se)} | ${x.parties} |\n`;
  md += '\n';
}
md += `Réglages : \`K<n>\` = rang n de la formule (30 kyu = K30, 1 dan = K0) ; \`M<p>\` = entre 1 dan et le meilleur coup du réseau (p % du chemin) ; \`V<n>\` = le meilleur coup après n explorations de l'arbre (V1 = le réseau seul).

Comment lire ce tableau :
- « ± » est l'incertitude approximative (un écart-type). Deux niveaux dont les notes diffèrent de moins de 2 fois ce « ± » ne se distinguent pas vraiment.
- **Ce qui est solide** : de 30 kyu à 9 kyu, chaque palier de 3 rangs bat nettement le précédent (environ +65 à +140 Elo par palier). Au total, le niveau « 9 dan » bat le « 30 kyu » d'environ 1 300 Elo, et de « 5 dan » à « 9 dan » on gagne encore environ 260 Elo (7 dan et 8 dan montent bien dans l'ordre).
- **Ce qui est flou** : 6 kyu et 3 kyu sont à égalité, et le palier 3 kyu → 1 dan est petit (+50) ; 2, 3 et 4 dan se valent presque (en 9×9, entre « 1 dan » et « le meilleur coup du réseau » il n'y a pas beaucoup de place) ; 5 dan et 6 dan aussi. Sur ces niveaux, le curseur change moins la force que ce que son nom laisse croire.
- **9 dan +** (48 explorations, jusqu'à 12 s par coup) n'est **pas mesuré** : c'est le même principe que 9 dan en plus poussé, trop lent pour faire jouer des centaines de parties ici.
- **13×13** : seulement un contrôle léger (peu de parties, voir le nombre dans le tableau) ; il confirme l'ordre grossier 30 kyu < 20 kyu < 10 kyu < 1 dan < 5 dan. **19×19 n'est pas mesuré** (parties trop longues pour cette machine). Les niveaux y sont ceux de la même formule, mais je n'ai pas de chiffres.
- Les parties bot contre bot n'utilisent pas la limite de temps de l'appli (12 s au plus par coup) : sur un téléphone lent, les niveaux forts peuvent donc être un peu plus faibles.
`;
fs.writeFileSync(path.join(__dirname, '..', 'calibrage.md'), md);
console.log(md);
