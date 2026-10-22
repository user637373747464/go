/* nn.c — calcul du réseau de neurones KataGo (version 8, ex. g170e-b10c128) pour le navigateur.
 * Compilé en WebAssembly (SIMD) par outils/compiler_nn.sh. Pas de bibliothèque C : tout est ici.
 *
 * Les poids viennent de reseau.bin (fabriqué par outils/convertir_reseau.js) :
 *   - un en-tête de 64 entiers (architecture),
 *   - puis les poids en float32, dans l'ordre exact où ce fichier les relit (voir « prendre »).
 * Les convolutions sont rangées « par panneaux de 8 sorties » : [panneau][case du filtre][entrée k][8].
 *
 * Mise en mémoire des activations : [position (avec bord de 1 case)][canal]. Une convolution 3x3 est la somme de
 * 9 produits de matrices décalés. Les positions « bord » sont remises à zéro après chaque normalisation.
 */
#ifdef SANS_SIMD
#include "simd_scalaire.h"      /* version de secours, sans SIMD (nn_scalaire.wasm) */
#else
#include <wasm_simd128.h>
#endif

typedef unsigned int u32;
typedef unsigned char u8;
typedef unsigned int size_t;

#define NR 8
#define MAXN 19
#define MAXP ((MAXN + 2) * (MAXN + 2))
#define MAXP2 ((MAXN + 4) * (MAXN + 4))
#define MAXC 128
#define MAXBLOCKS 32

extern u8 __heap_base;
static u32 tas = 0;

__attribute__((export_name("gw_alloc"))) void* gw_alloc(u32 n) {
  if (!tas) tas = (u32)&__heap_base;
  tas = (tas + 15u) & ~15u;
  u32 p = tas;
  tas += n;
  u32 besoin = (tas + 65535u) >> 16;
  u32 dispo = __builtin_wasm_memory_size(0);
  if (besoin > dispo) __builtin_wasm_memory_grow(0, besoin - dispo);
  return (void*)p;
}

/* ---------- réseau ---------- */
typedef struct { const float *s, *b; } BN;
typedef struct { const float* w; int K, N, taps; } Conv;          /* poids rangés par panneaux */
typedef struct { const float* w; int I, O; } Mat;                 /* [entrée][sortie] */
typedef struct {
  int gpool;
  BN preBN, midBN, gBN;
  Conv c1, cg, c2;     /* ord : c1 = conv1, c2 = conv2 ; gpool : c1 = regular, cg = gpool, c2 = finale */
  Mat gToBias;
} Bloc;

static struct {
  int pret;
  int nbBlocs, C, mid, reg, gp, nIn, nGlobal, pC, vC, v2n, initK;
  Conv init; Mat initMat;
  Bloc blocs[MAXBLOCKS];
  BN tipBN;
  Conv p1, g1; BN g1BN; Mat pGToBias; BN p1BN; const float* p2w; const float* pPassW;
  Conv v1; BN v1BN; Mat v2; const float* v2b; Mat v3; const float* v3b; Mat sv3; const float* sv3b; const float* ownW;
} R;

static const float* curseur;
static const float* prendre(int n) { const float* p = curseur; curseur += n; return p; }
static BN prendreBN(int n) { BN r; r.s = prendre(n); r.b = prendre(n); return r; }
static Conv prendreConv(int K, int N, int taps) {
  Conv c; c.K = K; c.N = N; c.taps = taps;
  int Np = (N + NR - 1) / NR * NR;
  c.w = prendre(Np * K * taps);
  return c;
}
static Mat prendreMat(int I, int O) { Mat m; m.I = I; m.O = O; m.w = prendre(I * O); return m; }

__attribute__((export_name("gw_charger"))) int gw_charger(const float* blob) {
  const int* h = (const int*)blob;
  if (h[0] != 0x47574e31 || h[1] != 1) return -1;
  R.nbBlocs = h[2]; R.C = h[3]; R.mid = h[4]; R.reg = h[5]; R.gp = h[6]; R.nIn = h[7]; R.nGlobal = h[8];
  R.pC = h[9]; R.vC = h[10]; R.v2n = h[11]; R.initK = h[12];
  if (R.nbBlocs > MAXBLOCKS || R.C > MAXC || R.mid > MAXC || R.reg > MAXC) return -2;
  curseur = blob + 64;
  R.init = prendreConv(R.nIn, R.C, R.initK * R.initK);
  R.initMat = prendreMat(R.nGlobal, R.C);
  for (int i = 0; i < R.nbBlocs; i++) {
    Bloc* b = &R.blocs[i];
    b->gpool = h[16 + i];
    b->preBN = prendreBN(R.C);
    if (!b->gpool) {
      b->c1 = prendreConv(R.C, R.mid, 9);
      b->midBN = prendreBN(R.mid);
      b->c2 = prendreConv(R.mid, R.C, 9);
    } else {
      b->c1 = prendreConv(R.C, R.reg, 9);
      b->cg = prendreConv(R.C, R.gp, 9);
      b->gBN = prendreBN(R.gp);
      b->gToBias = prendreMat(3 * R.gp, R.reg);
      b->midBN = prendreBN(R.reg);
      b->c2 = prendreConv(R.reg, R.C, 9);
    }
  }
  R.tipBN = prendreBN(R.C);
  R.p1 = prendreConv(R.C, R.pC, 1);
  R.g1 = prendreConv(R.C, R.pC, 1);
  R.g1BN = prendreBN(R.pC);
  R.pGToBias = prendreMat(3 * R.pC, R.pC);
  R.p1BN = prendreBN(R.pC);
  R.p2w = prendre(R.pC);
  R.pPassW = prendre(3 * R.pC);
  R.v1 = prendreConv(R.C, R.vC, 1);
  R.v1BN = prendreBN(R.vC);
  R.v2 = prendreMat(3 * R.vC, R.v2n);
  R.v2b = prendre(R.v2n);
  R.v3 = prendreMat(R.v2n, 3);
  R.v3b = prendre(3);
  R.sv3 = prendreMat(R.v2n, 4);
  R.sv3b = prendre(4);
  R.ownW = prendre(R.vC);
  R.pret = 1;
  return (int)(curseur - blob);   /* nombre de flottants lus, pour vérification */
}

/* ---------- tampons ---------- */
static float tIn[MAXP2 * 32];            /* entrée, bord de 2 cases : 22 canaux */
static float tTmp[MAXP2 * MAXC];         /* sortie de la convolution 5x5 avant recopie */
static float tTrunk[MAXP * MAXC];
static float tScr[MAXP * MAXC];
static float tMid[MAXP * MAXC];
static float tReg[MAXP * MAXC];
static float tG[MAXP * 32];
static float tG2[MAXP * 32];
static float tP1[MAXP * 32];
static float tP2[MAXP * 32];
static float tGlob[32];
static float gConcat[3 * 64];
static float gBiasV[MAXC];
static float tV1[MAXP * 32];
static float sortie[MAXP + 64 + 4 + MAXP];
static float masque[MAXP];
static int offs3[9], offs5[25], offs1[1] = {0};
static int N_, W_, P_, Q0, M_;           /* taille du plateau, largeur avec bord, nb de positions, début et longueur de la plage utile */
static int W2_, Q02, M2_;

__attribute__((export_name("gw_entree_spatiale"))) float* gw_entree_spatiale(void) { return tIn; }
__attribute__((export_name("gw_entree_globale"))) float* gw_entree_globale(void) { return tGlob; }
__attribute__((export_name("gw_sortie"))) float* gw_sortie(void) { return sortie; }

__attribute__((export_name("gw_plateau"))) int gw_plateau(int n) {
  if (n < 2 || n > MAXN) return -1;
  N_ = n; W_ = n + 2; P_ = W_ * W_; Q0 = W_ + 1; M_ = (n - 1) * W_ + n;
  W2_ = n + 4; Q02 = 2 * W2_ + 2; M2_ = (n - 1) * W2_ + n;
  for (int q = 0; q < P_; q++) masque[q] = 0.f;
  for (int y = 0; y < n; y++) for (int x = 0; x < n; x++) masque[(y + 1) * W_ + (x + 1)] = 1.f;
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) offs3[(dy + 1) * 3 + (dx + 1)] = dy * W_ + dx;
  for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) offs5[(dy + 2) * 5 + (dx + 2)] = dy * W2_ + dx;
  /* les tampons de travail repartent de zéro (le bord doit être nul) */
  for (int i = 0; i < MAXP * MAXC; i++) { tTrunk[i] = 0; tScr[i] = 0; tMid[i] = 0; tReg[i] = 0; }
  for (int i = 0; i < MAXP * 32; i++) { tG[i] = 0; tG2[i] = 0; tP1[i] = 0; tP2[i] = 0; tV1[i] = 0; }
  return 0;
}

/* ---------- produit de matrices avec décalages ----------
 * Pour chaque ligne r de la plage (0..M-1), chaque panneau p de 8 sorties :
 *   out[r][8p..8p+7] (+)= somme sur cases t et entrées k de  in[(r + offs[t]) * K + k] * w[p][t][k][0..7]
 */
static void gemm(const float* in, const Conv* c, const int* offs, float* out, int M, int accumule) {
  const int K = c->K, N = c->N, taps = c->taps;
  const int panneaux = (N + NR - 1) / NR;
  for (int p = 0; p < panneaux; p++) {
    const float* wp = c->w + (size_t)p * taps * K * NR;
    const int colonnes = (N - p * NR) < NR ? (N - p * NR) : NR;       /* colonnes réellement utiles */
    int m = 0;
    for (; m + 4 <= M; m += 4) {
      v128_t c00, c01, c10, c11, c20, c21, c30, c31;
      if (accumule && colonnes == NR) {
        const float* o = out + (size_t)m * N + p * NR;
        c00 = wasm_v128_load(o);            c01 = wasm_v128_load(o + 4);
        c10 = wasm_v128_load(o + N);        c11 = wasm_v128_load(o + N + 4);
        c20 = wasm_v128_load(o + 2 * N);    c21 = wasm_v128_load(o + 2 * N + 4);
        c30 = wasm_v128_load(o + 3 * N);    c31 = wasm_v128_load(o + 3 * N + 4);
      } else {
        c00 = c01 = c10 = c11 = c20 = c21 = c30 = c31 = wasm_f32x4_splat(0.f);
      }
      for (int t = 0; t < taps; t++) {
        const float* a0 = in + (size_t)(m + offs[t]) * K;
        const float* a1 = a0 + K;
        const float* a2 = a1 + K;
        const float* a3 = a2 + K;
        const float* b = wp + (size_t)t * K * NR;
        for (int k = 0; k < K; k++, b += NR) {
          v128_t b0 = wasm_v128_load(b), b1 = wasm_v128_load(b + 4);
          v128_t x;
          x = wasm_v128_load32_splat(a0 + k); c00 = wasm_f32x4_add(c00, wasm_f32x4_mul(x, b0)); c01 = wasm_f32x4_add(c01, wasm_f32x4_mul(x, b1));
          x = wasm_v128_load32_splat(a1 + k); c10 = wasm_f32x4_add(c10, wasm_f32x4_mul(x, b0)); c11 = wasm_f32x4_add(c11, wasm_f32x4_mul(x, b1));
          x = wasm_v128_load32_splat(a2 + k); c20 = wasm_f32x4_add(c20, wasm_f32x4_mul(x, b0)); c21 = wasm_f32x4_add(c21, wasm_f32x4_mul(x, b1));
          x = wasm_v128_load32_splat(a3 + k); c30 = wasm_f32x4_add(c30, wasm_f32x4_mul(x, b0)); c31 = wasm_f32x4_add(c31, wasm_f32x4_mul(x, b1));
        }
      }
      if (colonnes == NR) {
        float* o = out + (size_t)m * N + p * NR;
        wasm_v128_store(o, c00);            wasm_v128_store(o + 4, c01);
        wasm_v128_store(o + N, c10);        wasm_v128_store(o + N + 4, c11);
        wasm_v128_store(o + 2 * N, c20);    wasm_v128_store(o + 2 * N + 4, c21);
        wasm_v128_store(o + 3 * N, c30);    wasm_v128_store(o + 3 * N + 4, c31);
      } else {                                                           /* panneau incomplet (sortie < 8) : copie lente, rare */
        float tmp[8 * 4];
        wasm_v128_store(tmp, c00); wasm_v128_store(tmp + 4, c01); wasm_v128_store(tmp + 8, c10); wasm_v128_store(tmp + 12, c11);
        wasm_v128_store(tmp + 16, c20); wasm_v128_store(tmp + 20, c21); wasm_v128_store(tmp + 24, c30); wasm_v128_store(tmp + 28, c31);
        for (int r = 0; r < 4; r++) for (int j = 0; j < colonnes; j++) {
          float* o = out + (size_t)(m + r) * N + p * NR + j;
          *o = (accumule ? *o : 0.f) + tmp[r * 8 + j];   /* si accumule, c** valait 0 : on ajoute à l'existant */
        }
      }
    }
    for (; m < M; m++) {                                                  /* lignes restantes, une par une */
      v128_t c0, c1;
      if (accumule && colonnes == NR) { c0 = wasm_v128_load(out + (size_t)m * N + p * NR); c1 = wasm_v128_load(out + (size_t)m * N + p * NR + 4); }
      else c0 = c1 = wasm_f32x4_splat(0.f);
      for (int t = 0; t < taps; t++) {
        const float* a0 = in + (size_t)(m + offs[t]) * K;
        const float* b = wp + (size_t)t * K * NR;
        for (int k = 0; k < K; k++, b += NR) {
          v128_t x = wasm_v128_load32_splat(a0 + k);
          c0 = wasm_f32x4_add(c0, wasm_f32x4_mul(x, wasm_v128_load(b)));
          c1 = wasm_f32x4_add(c1, wasm_f32x4_mul(x, wasm_v128_load(b + 4)));
        }
      }
      if (colonnes == NR) { wasm_v128_store(out + (size_t)m * N + p * NR, c0); wasm_v128_store(out + (size_t)m * N + p * NR + 4, c1); }
      else {
        float tmp[8]; wasm_v128_store(tmp, c0); wasm_v128_store(tmp + 4, c1);
        for (int j = 0; j < colonnes; j++) { float* o = out + (size_t)m * N + p * NR + j; *o = (accumule ? *o : 0.f) + tmp[j]; }
      }
    }
  }
}

/* normalisation (échelle, biais) + ReLU, bord remis à zéro. in et out peuvent être le même tampon. */
static void bn_relu(const float* in, float* out, int C, BN bn) {
  for (int q = 0; q < P_; q++) {
    float* o = out + (size_t)q * C;
    if (masque[q] == 0.f) { for (int c = 0; c < C; c++) o[c] = 0.f; continue; }
    const float* x = in + (size_t)q * C;
    int c = 0;
    const v128_t zero = wasm_f32x4_splat(0.f);
    for (; c + 4 <= C; c += 4) {
      v128_t v = wasm_f32x4_add(wasm_f32x4_mul(wasm_v128_load(x + c), wasm_v128_load(bn.s + c)), wasm_v128_load(bn.b + c));
      wasm_v128_store(o + c, wasm_f32x4_max(v, zero));
    }
    for (; c < C; c++) { float v = x[c] * bn.s[c] + bn.b[c]; o[c] = v > 0.f ? v : 0.f; }
  }
}

/* « pooling global » sur les positions valides : moyenne, moyenne mise à l'échelle, max (ou 3e variante pour la tête de valeur) */
static void pool_global(const float* in, int C, float* out, int variante_valeur) {
  const float n2 = (float)(N_ * N_);
  const float sq = (float)N_;                                 /* racine de l'aire du plateau */
  for (int c = 0; c < C; c++) {
    float s = 0.f, m = -1.f;
    for (int y = 0; y < N_; y++) {
      const float* row = in + (size_t)((y + 1) * W_ + 1) * C + c;
      for (int x = 0; x < N_; x++) { float v = row[(size_t)x * C]; s += v; if (v > m) m = v; }
    }
    float mean = s / n2;
    out[c] = mean;
    out[c + C] = mean * (sq - 14.f) * 0.1f;
    out[c + 2 * C] = variante_valeur ? mean * ((sq - 14.f) * (sq - 14.f) * 0.01f - 0.1f) : m;
  }
}

/* sortie[o] = somme_i in[i] * w[i*O + o] */
static void matmul(const float* in, const Mat* m, float* out) {
  for (int o = 0; o < m->O; o++) out[o] = 0.f;
  for (int i = 0; i < m->I; i++) {
    const float x = in[i];
    const float* w = m->w + (size_t)i * m->O;
    for (int o = 0; o < m->O; o++) out[o] += x * w[o];
  }
}

static void ajoute_biais_positions(float* t, int C, const float* biais) {
  for (int y = 0; y < N_; y++) for (int x = 0; x < N_; x++) {
    float* v = t + (size_t)((y + 1) * W_ + x + 1) * C;
    for (int c = 0; c < C; c++) v[c] += biais[c];
  }
}

__attribute__((export_name("gw_calculer"))) int gw_calculer(void) {
  if (!R.pret || N_ == 0) return -1;
  const int C = R.C;
  /* 1. convolution d'entrée 5x5 (entrée avec bord de 2) puis recopie dans la disposition à bord de 1 */
  gemm(tIn + (size_t)Q02 * R.nIn, &R.init, offs5, tTmp, M2_, 0);
  for (int q = 0; q < P_; q++) { float* o = tTrunk + (size_t)q * C; for (int c = 0; c < C; c++) o[c] = 0.f; }
  for (int y = 0; y < N_; y++) for (int x = 0; x < N_; x++) {
    const float* s = tTmp + (size_t)(y * W2_ + x) * C;
    float* o = tTrunk + (size_t)((y + 1) * W_ + x + 1) * C;
    for (int c = 0; c < C; c++) o[c] = s[c];
  }
  /* + biais venant des entrées globales */
  { float gb[MAXC]; matmul(tGlob, &R.initMat, gb); ajoute_biais_positions(tTrunk, C, gb); }

  /* 2. blocs résiduels */
  for (int i = 0; i < R.nbBlocs; i++) {
    Bloc* b = &R.blocs[i];
    bn_relu(tTrunk, tScr, C, b->preBN);
    if (!b->gpool) {
      gemm(tScr + (size_t)Q0 * C, &b->c1, offs3, tMid + (size_t)Q0 * R.mid, M_, 0);
      bn_relu(tMid, tMid, R.mid, b->midBN);
      gemm(tMid + (size_t)Q0 * R.mid, &b->c2, offs3, tTrunk + (size_t)Q0 * C, M_, 1);
    } else {
      gemm(tScr + (size_t)Q0 * C, &b->c1, offs3, tReg + (size_t)Q0 * R.reg, M_, 0);
      gemm(tScr + (size_t)Q0 * C, &b->cg, offs3, tG + (size_t)Q0 * R.gp, M_, 0);
      bn_relu(tG, tG2, R.gp, b->gBN);
      pool_global(tG2, R.gp, gConcat, 0);
      matmul(gConcat, &b->gToBias, gBiasV);
      ajoute_biais_positions(tReg, R.reg, gBiasV);
      bn_relu(tReg, tMid, R.reg, b->midBN);
      gemm(tMid + (size_t)Q0 * R.reg, &b->c2, offs3, tTrunk + (size_t)Q0 * C, M_, 1);
    }
  }
  bn_relu(tTrunk, tTrunk, C, R.tipBN);            /* « tronc » final : même tampon, pas de recouvrement entre positions */

  const int Cq = C;
  const float* T = tTrunk + (size_t)Q0 * Cq;
  float* out = sortie;
  const int NN = N_ * N_;

  /* 3. tête de politique */
  {
    const int pC = R.pC;
    gemm(T, &R.p1, offs1, tP1 + (size_t)Q0 * pC, M_, 0);
    gemm(T, &R.g1, offs1, tG + (size_t)Q0 * pC, M_, 0);
    bn_relu(tG, tG2, pC, R.g1BN);
    pool_global(tG2, pC, gConcat, 0);
    matmul(gConcat, &R.pGToBias, gBiasV);
    ajoute_biais_positions(tP1, pC, gBiasV);
    bn_relu(tP1, tP2, pC, R.p1BN);
    for (int y = 0; y < N_; y++) for (int x = 0; x < N_; x++) {
      const float* v = tP2 + (size_t)((y + 1) * W_ + x + 1) * pC;
      float s = 0.f;
      for (int c = 0; c < pC; c++) s += v[c] * R.p2w[c];
      out[y * N_ + x] = s;
    }
    float s = 0.f;
    for (int i = 0; i < 3 * pC; i++) s += gConcat[i] * R.pPassW[i];
    out[NN] = s;
  }

  /* 4. tête de valeur */
  {
    const int vC = R.vC;
    float v1m[3 * 64], v2o[128], val[4];
    gemm(T, &R.v1, offs1, tV1 + (size_t)Q0 * vC, M_, 0);
    bn_relu(tV1, tV1, vC, R.v1BN);
    pool_global(tV1, vC, v1m, 1);
    matmul(v1m, &R.v2, v2o);
    for (int i = 0; i < R.v2n; i++) { float t = v2o[i] + R.v2b[i]; v2o[i] = t > 0.f ? t : 0.f; }
    matmul(v2o, &R.v3, val);
    for (int i = 0; i < 3; i++) out[NN + 1 + i] = val[i] + R.v3b[i];
    matmul(v2o, &R.sv3, val);
    for (int i = 0; i < 4; i++) out[NN + 4 + i] = val[i] + R.sv3b[i];
    for (int y = 0; y < N_; y++) for (int x = 0; x < N_; x++) {
      const float* v = tV1 + (size_t)((y + 1) * W_ + x + 1) * vC;
      float s = 0.f;
      for (int c = 0; c < vC; c++) s += v[c] * R.ownW[c];
      out[NN + 8 + y * N_ + x] = s;
    }
  }
  return 0;
}
