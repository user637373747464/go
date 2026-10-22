// Lecture d'un réseau KataGo (.bin.gz, version 8) : renvoie la structure avec les poids (Float32Array).
// Format : jetons texte séparés par des espaces ; les poids sont des blocs « @BIN@ » + n flottants little-endian.
const fs = require('fs');
const zlib = require('zlib');

function lire(chemin) {
  let buf = fs.readFileSync(chemin);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  let p = 0;
  const blanc = c => c === 32 || c === 10 || c === 13 || c === 9;
  function jeton() {
    while (p < buf.length && blanc(buf[p])) p++;
    const d = p;
    while (p < buf.length && !blanc(buf[p])) p++;
    return buf.toString('latin1', d, p);
  }
  const entier = () => { const t = jeton(); const v = parseInt(t, 10); if (!Number.isFinite(v)) throw new Error('entier attendu, trouvé « ' + t + ' » à ' + p); return v; };
  const reel = () => { const v = parseFloat(jeton()); if (!Number.isFinite(v)) throw new Error('réel attendu'); return v; };
  function flottants(n) {
    // saute les blancs jusqu'à '@', vérifie BIN@, puis lit n float32
    let k = 0;
    while (buf[p] !== 0x40) { p++; if (++k > 100) throw new Error('bloc binaire introuvable'); }
    if (buf.toString('latin1', p, p + 5) !== '@BIN@') throw new Error('en-tête @BIN@ attendu');
    p += 5;
    const out = new Float32Array(n);
    const src = new DataView(buf.buffer, buf.byteOffset + p, n * 4);
    for (let i = 0; i < n; i++) out[i] = src.getFloat32(i * 4, true);
    p += n * 4;
    return out;
  }
  const conv = () => {
    const nom = jeton(), ky = entier(), kx = entier(), ci = entier(), co = entier(), dy = entier(), dx = entier();
    if (dy !== 1 || dx !== 1) throw new Error('dilatation non gérée');
    // ordre du fichier : [y][x][ic][oc]
    return { nom, ky, kx, ci, co, w: flottants(ky * kx * ci * co) };
  };
  const bn = () => {
    const nom = jeton(), n = entier(), eps = reel(), hasScale = entier(), hasBias = entier();
    const mean = flottants(n), variance = flottants(n);
    const scale = hasScale ? flottants(n) : new Float32Array(n).fill(1);
    const bias = hasBias ? flottants(n) : new Float32Array(n);
    const s = new Float32Array(n), b = new Float32Array(n);
    for (let c = 0; c < n; c++) { s[c] = scale[c] / Math.sqrt(variance[c] + eps); b[c] = bias[c] - s[c] * mean[c]; }
    return { nom, n, s, b };
  };
  const act = version => { const nom = jeton(); if (version >= 11) throw new Error('activation non gérée'); return { nom, kind: 'relu' }; };
  const matmul = () => { const nom = jeton(), ci = entier(), co = entier(); return { nom, ci, co, w: flottants(ci * co) }; };   // [ic][oc]
  const matbias = () => { const nom = jeton(), n = entier(); return { nom, n, w: flottants(n) }; };

  const m = {};
  m.nom = jeton(); m.version = entier(); m.nbIn = entier(); m.nbGlobal = entier();
  if (m.version !== 8) throw new Error('seule la version 8 est gérée (trouvé ' + m.version + ')');
  const t = {};
  t.nom = jeton(); t.nbBlocs = entier(); t.canaux = entier(); t.mid = entier(); t.regular = entier(); entier(); t.gpool = entier();
  t.initConv = conv();
  t.initMat = matmul();
  t.blocs = [];
  for (let i = 0; i < t.nbBlocs; i++) {
    const kind = jeton();
    if (kind === 'ordinary_block') {
      const nom = jeton();
      const preBN = bn(); act(8); const conv1 = conv(); const midBN = bn(); act(8); const conv2 = conv();
      t.blocs.push({ kind: 'ord', nom, preBN, conv1, midBN, conv2 });
    } else if (kind === 'gpool_block') {
      const nom = jeton();
      const preBN = bn(); act(8); const regConv = conv(); const gConv = conv(); const gBN = bn(); act(8);
      const gToBias = matmul(); const midBN = bn(); act(8); const conv2 = conv();
      t.blocs.push({ kind: 'gpool', nom, preBN, regConv, gConv, gBN, gToBias, midBN, conv2 });
    } else throw new Error('bloc inconnu : ' + kind);
  }
  t.tipBN = bn(); act(8);
  m.trunk = t;
  const ph = {};
  ph.nom = jeton();
  ph.p1 = conv(); ph.g1 = conv(); ph.g1BN = bn(); act(8); ph.gToBias = matmul(); ph.p1BN = bn(); act(8); ph.p2 = conv(); ph.gToPass = matmul();
  m.policy = ph;
  const vh = {};
  vh.nom = jeton();
  vh.v1 = conv(); vh.v1BN = bn(); act(8); vh.v2 = matmul(); vh.v2b = matbias(); act(8); vh.v3 = matmul(); vh.v3b = matbias();
  vh.sv3 = matmul(); vh.sv3b = matbias(); vh.own = conv();
  m.value = vh;
  if (p < buf.length && buf.toString('latin1', p).trim().length) throw new Error('octets en trop à la fin : ' + (buf.length - p));
  return m;
}
module.exports = { lire };

if (require.main === module) {
  const m = lire(process.argv[2]);
  console.log(m.nom, 'v' + m.version, 'in', m.nbIn, 'global', m.nbGlobal);
  const t = m.trunk;
  console.log('trunk', t.nbBlocs, 'blocs, canaux', t.canaux, 'mid', t.mid, 'regular', t.regular, 'gpool', t.gpool);
  console.log('initConv', t.initConv.ky + 'x' + t.initConv.kx, t.initConv.ci, '→', t.initConv.co, ' initMat', t.initMat.ci, '→', t.initMat.co);
  console.log(t.blocs.map(b => b.kind).join(' '));
  const c = x => x.ky + 'x' + x.kx + ':' + x.ci + '→' + x.co;
  const b0 = t.blocs.find(b => b.kind === 'gpool');
  console.log('gpool bloc', b0.nom, 'reg', c(b0.regConv), 'g', c(b0.gConv), 'gToBias', b0.gToBias.ci, '→', b0.gToBias.co, 'conv2', c(b0.conv2));
  const o0 = t.blocs.find(b => b.kind === 'ord');
  console.log('ord bloc', o0.nom, c(o0.conv1), c(o0.conv2));
  console.log('policy: p1', c(m.policy.p1), 'g1', c(m.policy.g1), 'gToBias', m.policy.gToBias.ci, m.policy.gToBias.co, 'p2', c(m.policy.p2), 'gToPass', m.policy.gToPass.ci, m.policy.gToPass.co);
  console.log('value: v1', c(m.value.v1), 'v2', m.value.v2.ci, m.value.v2.co, 'v3', m.value.v3.ci, m.value.v3.co, 'sv3', m.value.sv3.ci, m.value.sv3.co, 'own', c(m.value.own));
  let np = 0; const cnt = o => { for (const k in o) { const v = o[k]; if (v instanceof Float32Array) np += v.length; else if (v && typeof v === 'object') cnt(v); } };
  cnt(m); console.log('paramètres (flottants) :', np);
}
