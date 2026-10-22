// Outils de comparaison avec le vrai KataGo (programme « katago gtp » compilé sur cette machine).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const GG = require('../goban.js');
const { Situation } = require('../situation.js');
const NN = require('../moteur_nn.js');

const KATAGO = '/home/claude/kgbuild/katago';
const REF = '/home/claude/kgref';
const LETTRES = 'ABCDEFGHJKLMNOPQRST';

function gtpVersLoc(n, s) {   // "Q16" -> [x, y] avec y = 0 en haut
  const x = LETTRES.indexOf(s[0].toUpperCase());
  const y = n - parseInt(s.slice(1), 10);
  return [x, y];
}
function locVersGtp(n, x, y) { return LETTRES[x] + (n - y); }

function lireSortie(txt, n) {
  const lignes = txt.split('\n');
  const i0 = lignes.findIndex(l => l.startsWith('= symmetry'));
  const res = { };
  let i = i0 + 1;
  for (; i < lignes.length; i++) {
    const l = lignes[i];
    if (l.startsWith('whiteWin ')) res.whiteWin = parseFloat(l.split(' ')[1]);
    else if (l.startsWith('whiteLead ')) res.whiteLead = parseFloat(l.split(' ')[1]);
    else if (l.startsWith('whiteScoreSelfplay ')) res.whiteScore = parseFloat(l.split(' ')[1]);
    else if (l.startsWith('policy') && !l.startsWith('policyPass')) break;
  }
  res.policy = [];
  for (let k = 0; k < n; k++) res.policy.push(lignes[i + 1 + k].trim().split(/\s+/).map(v => v === 'NAN' ? NaN : parseFloat(v)));
  i = i + 1 + n;
  res.passe = parseFloat(lignes[i].split(' ')[1]);
  i++;
  if (!lignes[i].startsWith('whiteOwnership')) throw new Error('ownership attendu : ' + lignes[i]);
  res.own = [];
  for (let k = 0; k < n; k++) res.own.push(lignes[i + 1 + k].trim().split(/\s+/).map(parseFloat));
  return res;
}

// coups : tableau de ['b'|'w', 'Q16' | 'pass']
function oracle(n, komi, coups) {
  const cmds = [`boardsize ${n}`, `komi ${komi}`,
    'kata-set-rules {"ko":"POSITIONAL","scoring":"AREA","tax":"NONE","suicide":false,"hasButton":false,"whiteHandicapBonus":"0","friendlyPassOk":false}'];
  for (const [c, m] of coups) cmds.push(`play ${c} ${m}`);
  cmds.push('kata-raw-nn 0', 'quit');
  const out = execFileSync(KATAGO, ['gtp', '-model', path.join(REF, 'net.bin.gz'), '-config', path.join(REF, 'gtp.cfg')],
    { input: cmds.join('\n') + '\n', cwd: REF, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString();
  if (/\?\s/.test(out.split('= symmetry')[0].replace(/^\?.*$/m, m => m))) { /* erreurs éventuelles */ }
  const avant = out.split('= symmetry')[0];
  if (avant.includes('?')) throw new Error('KataGo a refusé une commande : ' + avant);
  return lireSortie(out, n);
}


// Une seule partie, plusieurs points de contrôle : renvoie un tableau de sorties (une par indice, indice = nombre de coups joués)
function oraclePartie(n, komi, coups, indices) {
  const cmds = [`boardsize ${n}`, `komi ${komi}`,
    'kata-set-rules {"ko":"POSITIONAL","scoring":"AREA","tax":"NONE","suicide":false,"hasButton":false,"whiteHandicapBonus":"0","friendlyPassOk":false}'];
  const set = new Set(indices);
  if (set.has(0)) cmds.push('kata-raw-nn 0');
  coups.forEach(([c, m], i) => { cmds.push(`play ${c} ${m}`); if (set.has(i + 1)) cmds.push('kata-raw-nn 0'); });
  cmds.push('quit');
  const out = execFileSync(KATAGO, ['gtp', '-model', path.join(REF, 'net.bin.gz'), '-config', path.join(REF, 'gtp.cfg')],
    { input: cmds.join('\n') + '\n', cwd: REF, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 1 << 28 }).toString();
  const morceaux = out.split('= symmetry');
  const avant = morceaux[0];
  if (avant.includes('?')) throw new Error('KataGo a refusé une commande : ' + avant.split('\n').filter(l => l.startsWith('?')).join(' | '));
  const res = [];
  for (let k = 1; k < morceaux.length; k++) res.push(lireSortie('= symmetry' + morceaux[k], n));
  return res;
}

async function chargerMoi() {
  const wasm = fs.readFileSync(path.join(__dirname, '..', 'nn.wasm'));
  const poids = fs.readFileSync(path.join(__dirname, '..', 'reseau.bin'));
  return NN.creer(wasm, poids.buffer.slice(poids.byteOffset, poids.byteOffset + poids.byteLength));
}

function jouerCoups(n, komi, coups) {
  let sit = Situation.initiale(n, komi);
  for (const [c, m] of coups) {
    const pla = c === 'b' ? GG.NOIR : GG.BLANC;
    let loc;
    if (m === 'pass') loc = GG.PASSE;
    else { const [x, y] = gtpVersLoc(n, m); loc = sit.g.loc(x, y); }
    if (pla !== sit.trait) throw new Error('mauvais joueur au trait');
    if (!sit.estLegal(loc, pla)) throw new Error('coup illégal ' + m);
    sit = sit.jouer(loc, pla, true);
  }
  return sit;
}

function comparer(n, sit, o, reseau, verbeux) {
  const r = reseau.evaluer(sit, 1);
  const blancAuTrait = sit.trait === GG.BLANC;
  const winB = blancAuTrait ? r.gain : r.perte;
  const leadB = blancAuTrait ? r.lead : -r.lead;
  const scoreB = blancAuTrait ? r.scoreMoy : -r.scoreMoy;
  let maxPol = 0, maxOwn = 0, argmaxMoi = -1, argmaxOr = -1, pm = -1, po = -1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const po_ = o.policy[y][x], pm_ = r.pol[y * n + x];
    if (!isNaN(po_)) {
      maxPol = Math.max(maxPol, Math.abs(po_ - pm_));
      if (po_ > po) { po = po_; argmaxOr = y * n + x; }
    } else if (pm_ !== 0) maxPol = Math.max(maxPol, 9);       // je crois légal ce que KataGo juge illégal
    if (pm_ > pm) { pm = pm_; argmaxMoi = y * n + x; }
    const oM = blancAuTrait ? r.poss[y * n + x] : -r.poss[y * n + x];
    maxOwn = Math.max(maxOwn, Math.abs(oM - o.own[y][x]));
  }
  const d = {
    win: Math.abs(winB - o.whiteWin), lead: Math.abs(leadB - o.whiteLead), score: Math.abs(scoreB - o.whiteScore),
    pol: maxPol, passe: Math.abs(r.pol[n * n] - o.passe), own: maxOwn, memeMeilleur: argmaxMoi === argmaxOr,
  };
  if (verbeux) console.log(JSON.stringify(d), 'moi: win', winB.toFixed(5), 'lead', leadB.toFixed(3), '| KataGo: win', o.whiteWin, 'lead', o.whiteLead);
  return d;
}
module.exports = { oraclePartie, oracle, chargerMoi, jouerCoups, comparer, gtpVersLoc, locVersGtp, LETTRES };

if (require.main === module) {
  (async () => {
    const reseau = await chargerMoi();
    const coups = [['b', 'Q16'], ['w', 'D4']];
    const o = oracle(19, 7.5, coups);
    const sit = jouerCoups(19, 7.5, coups);
    comparer(19, sit, o, reseau, true);
  })().catch(e => { console.error(e); process.exit(1); });
}
