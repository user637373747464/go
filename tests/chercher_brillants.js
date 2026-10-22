// Cherche des « pépites » : coups peu probables pour le réseau (< 4 %) mais aussi bons que le meilleur, puis vérifie que l'analyse les classe bien.
// usage : node tests/chercher_brillants.js <partie.json>
const fs = require('fs');
const GG = require('../goban.js');
const O = require('./oracle.js');
const { Situation } = require('../situation.js');
const { Recherche } = require('../recherche.js');
const { Analyse, NOMS } = require('../analyse.js');
(async () => {
  const reseau = await O.chargerMoi();
  const partie = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const n = partie.n, komi = partie.komi, coups = partie.coups;
  let sit = Situation.initiale(n, komi);
  const pepites = [];
  for (let i = 0; i < coups.length - 4 && pepites.length < 6; i++) {
    if (i >= 8 && i % 2 === 0) {
      const rec = new Recherche(reseau, {});
      rec.definirRacine(sit);
      rec.executer(24, 0, null);
      const res = rec.resume();
      if (res.gain > 0.1 && res.gain < 0.9) {
        const st = rec.stats();
        const best = st[0];
        const cands = st.filter(s => s.prior >= 0.004 && s.prior < 0.04 && s.loc !== GG.PASSE).sort((a, b) => b.prior - a.prior).slice(0, 8);
        for (const c of cands) {
          rec.forcer(c.loc, 8);
        }
        const st2 = rec.stats();
        for (const c of cands) {
          const e = st2.find(s => s.loc === c.loc);
          if (e && e.visites >= 6 && e.lead >= best.lead - 0.3 && e.wl >= best.wl - 0.02) { pepites.push({ i, loc: c.loc, prior: c.prior, lead: e.lead, bestLead: best.lead }); break; }
        }
      }
    }
    sit = sit.jouer(coups[i][1], coups[i][0], true);
  }
  console.log('pépites trouvées :', pepites.length);
  for (const t of pepites.slice(0, 5)) {
    const prefixe = coups.slice(0, t.i).map(c => [c[0], c[1]]);
    prefixe.push([coups[t.i][0], t.loc]);
    const a = new Analyse(reseau, n, komi, prefixe, { visites: 16, visitesFortes: 64 });
    while (!a.pas(1000)) { /* */ }
    const d = a.resultat.coups[t.i];
    console.log(`coup ${t.i + 1} prior ${t.prior.toFixed(3)} (lead ${t.lead.toFixed(1)} vs meilleur ${t.bestLead.toFixed(1)}) -> ${NOMS[d.classe]} (perte ${d.perte.toFixed(1)}, écart naturel ${d.ecartNaturel.toFixed(1)}, meilleur ${d.estMeilleur})`);
  }
})();
