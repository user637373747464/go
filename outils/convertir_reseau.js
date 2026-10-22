// Convertit un réseau KataGo (.bin.gz, version 8) en « reseau.bin », le fichier que nn.c (WebAssembly) sait relire.
// Usage : node outils/convertir_reseau.js net.bin.gz reseau.bin
// Disposition : 64 entiers d'en-tête, puis les poids en float32 dans l'ordre exact de gw_charger (nn.c).
// Les convolutions sont rangées par « panneaux » de 8 sorties : [panneau][case du filtre][entrée][8].
const fs = require('fs');
const { lire } = require('./lire_katago');

function convertir(chemin) {
  const m = lire(chemin);
  const t = m.trunk, ph = m.policy, vh = m.value;
  const morceaux = [];
  const pousse = a => morceaux.push(a instanceof Float32Array ? a : Float32Array.from(a));
  const conv = c => {
    const K = c.ci, N = c.co, taps = c.ky * c.kx, Np = Math.ceil(N / 8) * 8;
    const out = new Float32Array(Np * K * taps);
    for (let p = 0; p < Np / 8; p++) for (let tp = 0; tp < taps; tp++) for (let k = 0; k < K; k++) for (let j = 0; j < 8; j++) {
      const o = p * 8 + j;
      out[((p * taps + tp) * K + k) * 8 + j] = o < N ? c.w[(tp * K + k) * N + o] : 0;
    }
    pousse(out);
  };
  const bn = b => { pousse(b.s); pousse(b.b); };
  const mat = x => pousse(x.w);

  const entete = new Int32Array(64);
  entete[0] = 0x47574e31; entete[1] = 1;
  entete[2] = t.nbBlocs; entete[3] = t.canaux; entete[4] = t.mid; entete[5] = t.regular; entete[6] = t.gpool;
  entete[7] = m.nbIn; entete[8] = m.nbGlobal; entete[9] = ph.p1.co; entete[10] = vh.v1.co; entete[11] = vh.v2.co; entete[12] = t.initConv.ky;
  if (t.initConv.ky !== t.initConv.kx) throw new Error('conv initiale non carrée');
  if (ph.p2.co !== 1 || ph.p2.ci !== ph.p1.co || vh.own.co !== 1) throw new Error('têtes inattendues');
  t.blocs.forEach((b, i) => { entete[16 + i] = b.kind === 'gpool' ? 1 : 0; });

  conv(t.initConv); mat(t.initMat);
  for (const b of t.blocs) {
    if (b.kind === 'ord') { bn(b.preBN); conv(b.conv1); bn(b.midBN); conv(b.conv2); }
    else { bn(b.preBN); conv(b.regConv); conv(b.gConv); bn(b.gBN); mat(b.gToBias); bn(b.midBN); conv(b.conv2); }
  }
  bn(t.tipBN);
  conv(ph.p1); conv(ph.g1); bn(ph.g1BN); mat(ph.gToBias); bn(ph.p1BN); pousse(ph.p2.w); pousse(ph.gToPass.w);
  conv(vh.v1); bn(vh.v1BN); mat(vh.v2); pousse(vh.v2b.w); mat(vh.v3); pousse(vh.v3b.w); mat(vh.sv3); pousse(vh.sv3b.w); pousse(vh.own.w);

  let n = 0; for (const a of morceaux) n += a.length;
  const sortie = Buffer.alloc(256 + n * 4);
  Buffer.from(entete.buffer).copy(sortie, 0);
  let o = 256;
  for (const a of morceaux) { Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(sortie, o); o += a.byteLength; }
  return { buffer: sortie, nbFlottants: n, modele: m };
}
module.exports = { convertir };

if (require.main === module) {
  const r = convertir(process.argv[2]);
  fs.writeFileSync(process.argv[3], r.buffer);
  console.log('écrit', process.argv[3], r.buffer.length, 'octets,', r.nbFlottants, 'flottants');
}
