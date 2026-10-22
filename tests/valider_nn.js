// Valide, sur des parties réelles (jouées par le réseau lui-même), que mon moteur donne les mêmes chiffres que KataGo.
const GG = require('../goban.js');
const { Situation } = require('../situation.js');
const O = require('./oracle.js');

function alea(graine) { let s = graine >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

(async () => {
  const reseau = await O.chargerMoi();
  const args = process.argv.slice(2);
  const tailles = args.length ? args.map(Number) : [19, 13, 9];
  let pire = { win: 0, lead: 0, score: 0, pol: 0, passe: 0, own: 0 }, nb = 0, nbDiffMeilleur = 0;
  const couv = { echelle: 0, echelle2: 0, ko: 0, superko: 0, passe: 0, atari: 0 };
  for (const n of tailles) {
    for (let graine = 1; graine <= 3; graine++) {
      const rnd = alea(n * 100 + graine);
      const komi = n === 9 ? 6.5 : 7.5;
      let sit = Situation.initiale(n, komi);
      const coups = [];
      const NMAX = n === 19 ? 200 : n === 13 ? 130 : 80;
      for (let i = 0; i < NMAX && !sit.termine; i++) {
        const r = reseau.evaluer(sit, 1);
        // tirage selon la politique (température 1), la passe seulement après un certain nombre de coups
        let tot = 0; const NN = n * n;
        for (let k = 0; k < NN; k++) tot += r.pol[k];
        const passeOK = i > NMAX * 0.8;
        if (passeOK) tot += r.pol[NN];
        let u = rnd() * tot, choix = -1;
        for (let k = 0; k < NN; k++) { u -= r.pol[k]; if (u <= 0) { choix = k; break; } }
        if (choix < 0 && passeOK) choix = NN;
        if (choix < 0) choix = r.pol.indexOf(Math.max(...r.pol.slice(0, NN)));
        const pla = sit.trait;
        let loc, gtp;
        if (choix === NN) { loc = GG.PASSE; gtp = 'pass'; }
        else { const x = choix % n, y = (choix / n) | 0; loc = sit.g.loc(x, y); gtp = O.locVersGtp(n, x, y); }
        coups.push([pla === GG.NOIR ? 'b' : 'w', gtp]);
        sit = sit.jouer(loc, pla, true);
        sit.g.verifier();
      }
      // points de contrôle
      const indices = [];
      for (let k = 1; k <= coups.length; k += (n === 19 ? 7 : 5)) indices.push(k);
      const sorties = O.oraclePartie(n, komi, coups, indices);
      // rejouer chez moi pour comparer
      let s2 = Situation.initiale(n, komi);
      let idx = 0, pireP = { win: 0, lead: 0, score: 0, pol: 0, passe: 0, own: 0 };
      for (let i = 0; i < coups.length; i++) {
        const [c, m] = coups[i];
        const pla = c === 'b' ? GG.NOIR : GG.BLANC;
        const loc = m === 'pass' ? GG.PASSE : (() => { const [x, y] = O.gtpVersLoc(n, m); return s2.g.loc(x, y); })();
        s2 = s2.jouer(loc, pla, true);
        if (indices[idx] === i + 1) {
          const d = O.comparer(n, s2, sorties[idx], reseau, false);
          idx++; nb++;
          { const e = s2.g.echelles(); if (e.length) couv.echelle++; if (e.some(v => v[1].length)) couv.echelle2++; if (s2.g.ko) couv.ko++; if (s2.bannisSuperko().length) couv.superko++;
            if (s2.passes) couv.passe++; if (s2.parent && s2.parent.g.echelles().length) couv.atari++; }
          if (!d.memeMeilleur) nbDiffMeilleur++;
          for (const k of Object.keys(pireP)) pireP[k] = Math.max(pireP[k], d[k]);
          for (const k of Object.keys(pire)) pire[k] = Math.max(pire[k], d[k]);
          if (d.win > 2e-3 || d.pol > 5e-3 || d.own > 1e-2 || d.lead > 0.3) console.log('  ÉCART n=' + n + ' graine=' + graine + ' après ' + (i + 1) + ' coups', JSON.stringify(d));
        }
      }
      console.log(`n=${n} graine=${graine} coups=${coups.length}  pire écart :`, JSON.stringify(pireP, (k, v) => typeof v === 'number' ? +v.toPrecision(3) : v));
    }
  }
  console.log('couverture (positions)', JSON.stringify(couv));
  console.log('TOTAL', nb, 'positions comparées ; meilleur coup différent :', nbDiffMeilleur, '; pire écart global :', JSON.stringify(pire, (k, v) => typeof v === 'number' ? +v.toPrecision(3) : v));
})().catch(e => { console.error(e); process.exit(1); });
