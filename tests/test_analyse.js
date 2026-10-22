// Analyse d'une partie bot contre bot : node tests/test_analyse.js <n> <idNoir> <idBlanc> <visites> [graine] [détail]
const GG = require('../goban.js');
const O = require('./oracle.js');
const { jouerPartie } = require('./partie_bot.js');
const { Analyse, NOMS, CLASSES } = require('../analyse.js');
(async () => {
  const reseau = await O.chargerMoi();
  const n = +process.argv[2] || 9, kN = process.argv[3] || 'K3', kB = process.argv[4] || 'K30', vis = +(process.argv[5] || 16), graine = +(process.argv[6] || 5);
  const detail = process.argv[7] === 'detail';
  const komi = n === 9 ? 6.5 : 7.5;
  const r = jouerPartie(reseau, kN, kB, n, komi, graine, { ouverture: 2 });
  console.log('partie', r.coups, 'coups, diff', r.diff);
  const coups = [];
  for (let s = r.sit; s.parent; s = s.parent) coups.unshift(s.coup);
  const t0 = Date.now();
  const a = new Analyse(reseau, n, komi, coups, { visites: vis, visitesFortes: vis * 4 });
  while (!a.pas(500)) { /* calcul */ }
  console.log('analyse en', Date.now() - t0, 'ms');
  const res = a.resultat;
  if (detail) for (const d of res.coups) {
    const gtp = d.loc === GG.PASSE ? 'pass' : O.locVersGtp(n, (d.loc % (n + 1)) - 1, ((d.loc / (n + 1)) | 0) - 1);
    console.log(String(d.i + 1).padStart(3), d.joueur === GG.NOIR ? 'N' : 'B', gtp.padEnd(4), NOMS[d.classe].padEnd(14), 'perte', d.perte.toFixed(1).padStart(5), 'pct', (d.pertePct * 100).toFixed(1).padStart(5), 'prior', d.prior.toFixed(3), 'gain', d.gainAvant.toFixed(2), '->', d.gainApres.toFixed(2));
  }
  for (const [nom, j] of Object.entries(res.joueurs)) {
    console.log(nom.padEnd(6), 'coups', j.coups, 'perte moy', j.perteMoyenne.toFixed(2), 'précision', j.precision.toFixed(0), CLASSES.map(c => `${c}:${j.classes[c]}`).join(' '));
  }
})().catch(e => { console.error(e); process.exit(1); });
