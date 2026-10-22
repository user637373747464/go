// Fabrique une partie bot contre bot (pour les tests de l'écran) : node tests/exporter_partie.js <n> <idNoir> <idBlanc> <fichier.json>
const fs = require('fs');
const GG = require('../goban.js');
const O = require('./oracle.js');
const { jouerPartie } = require('./partie_bot.js');
(async () => {
  const reseau = await O.chargerMoi();
  const n = +process.argv[2] || 9, a = process.argv[3] || 'L60', b = process.argv[4] || 'L60', f = process.argv[5] || 'partie.json';
  const r = jouerPartie(reseau, a, b, n, n === 9 ? 6.5 : 7.5, +process.argv[6] || 3, { ouverture: 2 });
  const coups = [];
  for (let s = r.sit; s.parent; s = s.parent) coups.unshift(s.coup);
  fs.writeFileSync(f, JSON.stringify({ n, komi: n === 9 ? 6.5 : 7.5, coups, diff: r.diff }));
  console.log('ok', coups.length, 'coups, diff', r.diff);
})();
