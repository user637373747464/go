// Tournoi bot contre bot pour calibrer les niveaux. Résultats ajoutés à calib/<nom>.jsonl (on peut reprendre).
// usage : node tests/tournoi.js <nom> <n> <ks séparés par des virgules> <parties par paire> <écarts séparés par des virgules>
const fs = require('fs');
const GG = require('../goban.js');
const O = require('./oracle.js');
const { jouerPartie } = require('./partie_bot.js');

(async () => {
  const [nom, nS, ksS, gS, ecS] = process.argv.slice(2);
  const n = +nS, ks = ksS.split(','), G = +gS, ecarts = ecS.split(',').map(Number);
  const komi = n === 9 ? 6.5 : 7.5;
  const fichier = `calib/${nom}.jsonl`;
  const faits = new Map();
  if (fs.existsSync(fichier)) for (const l of fs.readFileSync(fichier, 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); faits.set(`${r.kN}|${r.kB}|${r.graine}`, r); }
  const reseau = await O.chargerMoi();
  const paires = [];
  for (const e of ecarts) for (let i = 0; i + e < ks.length; i++) paires.push([ks[i], ks[i + e]]);
  let total = paires.length * G, fait = 0;
  for (let g = 0; g < G; g++) {
    for (const [a, b] of paires) {
      const noirEstA = g % 2 === 0;
      const kN = noirEstA ? a : b, kB = noirEstA ? b : a;
      const hh = (t) => { let h = 7; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 100003; };
      const graine = 1000 * (g + 1) + hh(a) * 7 + hh(b) * 13 + n;
      const cle = `${kN}|${kB}|${graine}`;
      fait++;
      if (faits.has(cle)) continue;
      const r = jouerPartie(reseau, kN, kB, n, komi, graine, { ouverture: 2 });
      const rec = { n, kN, kB, graine, gagnant: r.gagnant === GG.NOIR ? 'N' : 'B', diff: r.diff, coups: r.coups, ms: r.ms };
      fs.appendFileSync(fichier, JSON.stringify(rec) + '\n');
      if (fait % 20 === 0) console.log(`${nom} ${fait}/${total}`);
    }
  }
  console.log('terminé', nom);
})().catch(e => { console.error(e); process.exit(1); });
