// Tests des règles du go (plateau, captures, suicide, ko, super-ko, passes, comptage par zone) et de la classification des coups.
// Lancer :  node tests/test_regles.js
const assert = require('assert');
const GG = require('../goban.js');
const { Situation, scoreZone } = require('../situation.js');
const FIN = require('../fin.js');
const AN = require('../analyse.js');
const BOT = require('../bot.js');
const { NOIR, BLANC, PASSE, VIDE } = GG;

let nb = 0;
function test(nom, f) { try { f(); nb++; console.log('  ok -', nom); } catch (e) { console.log('ECHEC :', nom, '\n', e.stack); process.exit(1); } }

const LET = 'ABCDEFGHJKLMNOPQRST';
const loc = (g, s) => g.loc(LET.indexOf(s[0]), g.n - parseInt(s.slice(1), 10));
function jouer(sit, pla, s) {
  const l = s === 'pass' ? PASSE : loc(sit.g, s);
  assert.ok(sit.estLegal(l, pla), `coup illégal : ${pla === NOIR ? 'N' : 'B'} ${s}`);
  return sit.jouer(l, pla, true);
}
function suite(n, coups) {          // 'b:E5 w:D4 ...'
  let sit = Situation.initiale(n, 7.5);
  for (const c of coups.split(/\s+/).filter(Boolean)) { const [p, s] = c.split(':'); sit = jouer(sit, p === 'b' ? NOIR : BLANC, s); }
  return sit;
}

console.log('Règles du go');

test('capture d\'une pierre dans le coin', () => {
  const s = suite(9, 'w:A1 b:B1 w:E5 b:A2');
  assert.strictEqual(s.g.c[loc(s.g, 'A1')], VIDE);
  assert.strictEqual(s.g.prisesBlanc, 1);
  assert.strictEqual(s.g.prisesNoir, 0);
});

test('capture d\'un groupe de deux pierres', () => {
  const s = suite(9, 'b:D4 w:D5 b:E4 w:E5 b:A9 w:C5 b:A8 w:F5 b:A7 w:D3 b:A6 w:E3');
  // les deux pierres noires D4 E4 sont entourées : C4 et F4 restent libres -> pas encore prises
  assert.strictEqual(s.g.c[loc(s.g, 'D4')], NOIR);
  const t = jouer(jouer(s, NOIR, 'A5'), BLANC, 'C4');
  const u = jouer(jouer(t, NOIR, 'A4'), BLANC, 'F4');
  assert.strictEqual(u.g.c[loc(u.g, 'D4')], VIDE);
  assert.strictEqual(u.g.c[loc(u.g, 'E4')], VIDE);
  assert.strictEqual(u.g.prisesNoir, 2);
});

test('le suicide est interdit', () => {
  const s = suite(9, 'b:A2 w:E5 b:B1');
  assert.strictEqual(s.estLegal(loc(s.g, 'A1'), BLANC), false);
  assert.strictEqual(s.estLegal(loc(s.g, 'A1'), NOIR), true);
});

test('un coup qui prend n\'est pas un suicide', () => {
  // Noir B1 n'a plus qu'une liberté (A1) ; Blanc y joue : il prend B1, donc le coup est permis
  const s = suite(9, 'b:B1 w:C1 b:A2 w:B2');
  assert.strictEqual(s.estLegal(loc(s.g, 'A1'), BLANC), true);
  const t = jouer(s, BLANC, 'A1');
  assert.strictEqual(t.g.c[loc(t.g, 'B1')], VIDE);
  assert.strictEqual(t.g.c[loc(t.g, 'A1')], BLANC);
});

function ko() {
  //  . N B .
  //  N B . B      Noir joue E5 : il prend D5, et Blanc ne peut pas reprendre tout de suite
  //  . N B .
  return suite(9, 'b:D6 w:E6 b:C5 w:F5 b:D4 w:E4 b:A9 w:D5');
}
test('ko : reprise immédiate interdite, puis permise après un coup ailleurs', () => {
  const s = ko();
  const t = jouer(s, NOIR, 'E5');
  assert.strictEqual(t.g.c[loc(t.g, 'D5')], VIDE);
  assert.strictEqual(t.g.ko, loc(t.g, 'D5'));
  assert.strictEqual(t.estLegal(loc(t.g, 'D5'), BLANC), false);
  const u = jouer(jouer(t, BLANC, 'A1'), NOIR, 'J9');
  assert.strictEqual(u.estLegal(loc(u.g, 'D5'), BLANC), true);
});

test('super-ko positionnel : on ne peut pas refaire une position déjà vue', () => {
  // même schéma, mais la position d'avant la première prise réapparaîtrait
  const s = ko();
  const t = jouer(s, NOIR, 'E5');
  const u = jouer(jouer(t, BLANC, 'A1'), NOIR, 'J9');
  const v = jouer(u, BLANC, 'D5');                        // Blanc reprend (permis), Noir ne peut pas reprendre aussitôt
  assert.strictEqual(v.estLegal(loc(v.g, 'E5'), NOIR), false);
  // et la liste des coups bannis par le super-ko est utilisée pour le réseau
  assert.ok(Array.isArray(v.bannisSuperko()));
});

test('super-ko positionnel : même après des passes, la position d\'avant ne revient pas', () => {
  const t = jouer(ko(), NOIR, 'E5');
  const v = jouer(jouer(t, BLANC, 'pass'), NOIR, 'pass');
  assert.strictEqual(v.g.ko, 0);                                   // le « ko simple » a disparu avec les passes
  assert.strictEqual(v.estLegal(loc(v.g, 'D5'), BLANC), false);   // mais la position reviendrait : interdit
});

test('deux passes de suite : la partie est finie', () => {
  let s = suite(9, 'b:E5');
  assert.strictEqual(s.termine, false);
  s = jouer(s, BLANC, 'pass');
  assert.strictEqual(s.termine, false);
  s = jouer(s, NOIR, 'pass');
  assert.strictEqual(s.termine, true);
  const s2 = jouer(jouer(jouer(suite(9, 'b:E5'), BLANC, 'pass'), NOIR, 'D4'), BLANC, 'pass');
  assert.strictEqual(s2.termine, false);                    // la passe doit être consécutive
});

test('comptage par zone', () => {
  // Noir tient la colonne E (mur) : tout ce qui est à gauche est à Noir, à droite à Blanc
  let s = Situation.initiale(9, 6.5);
  const mur = [], mur2 = [];
  for (let y = 1; y <= 9; y++) { mur.push('D' + y); mur2.push('F' + y); }
  const ordre = [];
  for (let i = 0; i < 9; i++) { ordre.push(['b', mur[i]]); ordre.push(['w', mur2[i]]); }
  for (const [p, c] of ordre) s = jouer(s, p === 'b' ? NOIR : BLANC, c);
  // colonne E vide : voisine des deux murs -> neutre
  const r = scoreZone(s.g, null);
  assert.strictEqual(r.noir, 9 + 27);                       // 9 pierres + 3 colonnes à gauche
  assert.strictEqual(r.blanc, 9 + 27);
  const f = FIN.scoreFinal(s, []);
  assert.strictEqual(f.diff, 6.5);
  assert.strictEqual(f.gagnant, BLANC);
});

test('pierres mortes retirées avant le comptage', () => {
  let s = suite(9, 'b:D4 w:E5 b:A1 w:J9');
  const sans = scoreZone(s.g, null);
  const avec = scoreZone(s.g, [loc(s.g, 'A1'), loc(s.g, 'D4')]);
  assert.ok(avec.noir < sans.noir || avec.blanc >= sans.blanc);
  assert.strictEqual(avec.noir, 0);
});

test('parties aléatoires : le plateau reste cohérent (chaînes, libertés)', () => {
  let graine = 12345;
  const alea = () => { graine = (graine * 1664525 + 1013904223) >>> 0; return graine / 4294967296; };
  for (const n of [9, 13, 19]) {
    for (let partie = 0; partie < 12; partie++) {
      let s = Situation.initiale(n, 7.5), passes = 0;
      for (let t = 0; t < n * n * 2 && !s.termine; t++) {
        const legaux = s.coupsLegaux();
        let l = PASSE;
        if (legaux.length && alea() > 0.02) l = legaux[(alea() * legaux.length) | 0];
        s = s.jouer(l, s.trait, true);
        if (t % 7 === 0) s.g.verifier();
      }
      s.g.verifier();
    }
  }
});

console.log('Niveaux du bot');
test('le nombre de coups tirés augmente avec la force', () => {
  for (const [N, L] of [[361, 361], [169, 169], [81, 81], [81, 40]]) {
    let prev = 0;
    for (let k = 30; k >= -3; k--) {
      const m = BOT.nCoupsRang(k, N, L);
      assert.ok(m >= prev, `plateau ${N}, k=${k} : ${m} < ${prev}`);
      assert.ok(m >= 1 && m <= L);
      prev = m;
    }
  }
});
test('noms des niveaux', () => {
  assert.strictEqual(BOT.nomNiveau(30), '30 kyu');
  assert.strictEqual(BOT.nomNiveau(1), '1 kyu');
  assert.strictEqual(BOT.nomNiveau(0), '1 dan');
  assert.strictEqual(BOT.nomNiveau(-8), '9 dan');
  assert.strictEqual(BOT.nomNiveau(-9), '9 dan +');
  assert.strictEqual(BOT.listeNiveaux().length, 40);
});

console.log('Classification des coups');
function coup(o) {
  return Object.assign({ i: 40, n: 19, prior: 0.3, perte: 0, pertePct: 0, estMeilleur: false, estTopPolitique: true, gainAvant: 0.5, gainApres: 0.5,
    ecartNaturel: 0, ecartNaturelPct: 0, secondePerte: 0, visitesJouee: 10, perteAdv: 0 }, o);
}
test('gaffe, erreur, coup manqué', () => {
  assert.strictEqual(AN.classer(coup({ perte: 12, pertePct: 0.25 })), 'gaffe');
  assert.strictEqual(AN.classer(coup({ perte: 4, pertePct: 0.06 })), 'erreur');
  assert.strictEqual(AN.classer(coup({ perte: 4, pertePct: 0.06, perteAdv: 6 })), 'manque');
  assert.strictEqual(AN.classer(coup({ perte: 0.2, pertePct: 0.0 })), 'bon');
});
test('meilleur coup, bon coup', () => {
  assert.strictEqual(AN.classer(coup({ estMeilleur: true })), 'meilleur');
  assert.strictEqual(AN.classer(coup({ perte: 0.08 })), 'meilleur');
  assert.strictEqual(AN.classer(coup({ perte: 0.9, pertePct: 0.01 })), 'bon');
});
test('théorique en début de partie seulement', () => {
  assert.strictEqual(AN.classer(coup({ i: 3, perte: 0.3, prior: 0.2 })), 'theorique');
  assert.notStrictEqual(AN.classer(coup({ i: 60, perte: 0.3, prior: 0.2 })), 'theorique');
  assert.notStrictEqual(AN.classer(coup({ i: 3, perte: 4, pertePct: 0.06, prior: 0.2 })), 'theorique');
});
test('brillant et très bon coup : coups surprenants mais justes', () => {
  assert.strictEqual(AN.classer(coup({ perte: 0.1, prior: 0.01, estTopPolitique: false, ecartNaturel: 4, estMeilleur: true })), 'brillant');
  assert.strictEqual(AN.classer(coup({ perte: 0.2, prior: 0.1, estTopPolitique: false, ecartNaturel: 1.5, estMeilleur: false })), 'tres_bon');
  // le seul bon coup, peu évident (le réseau ne le met pas à 100 %) : très bon coup ; s'il est évident : simple meilleur coup
  assert.strictEqual(AN.classer(coup({ perte: 0, estMeilleur: true, prior: 0.3, secondePerte: 8 })), 'tres_bon');
  assert.strictEqual(AN.classer(coup({ perte: 0, estMeilleur: true, prior: 0.9, secondePerte: 8 })), 'meilleur');
  // partie déjà décidée : pas de brillant
  assert.notStrictEqual(AN.classer(coup({ perte: 0.1, prior: 0.01, estTopPolitique: false, ecartNaturel: 4, gainAvant: 0.99, gainApres: 0.99 })), 'brillant');
});
test('petit plateau : un point pèse plus lourd', () => {
  const m19 = AN.classer(coup({ n: 19, perte: 2.0, pertePct: 0.03 }));
  const m9 = AN.classer(coup({ n: 9, perte: 2.0, pertePct: 0.03 }));
  assert.ok(['bon', 'meilleur'].includes(m19), m19);
  assert.ok(['erreur', 'manque', 'bon'].includes(m9), m9);
});
test('précision décroît avec la perte de probabilité', () => {
  assert.ok(AN.precisionCoup(0) > 99);
  assert.ok(AN.precisionCoup(0.1) < AN.precisionCoup(0.02));
  assert.ok(AN.precisionCoup(1) >= 0);
});

console.log(`\n${nb} tests réussis`);
