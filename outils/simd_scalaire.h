/* simd_scalaire.h — remplace <wasm_simd128.h> pour fabriquer nn_scalaire.wasm : le même calcul, sans instructions SIMD.
 * Sert aux téléphones qui ne savent pas faire le calcul rapide (iPhone avant iOS 16.4). Environ 3 à 4 fois plus lent. */
typedef struct { float f[4]; } v128_t;

static inline v128_t wasm_f32x4_splat(float x) { v128_t r = {{x, x, x, x}}; return r; }
static inline v128_t wasm_v128_load(const void* p) { const float* q = (const float*)p; v128_t r = {{q[0], q[1], q[2], q[3]}}; return r; }
static inline v128_t wasm_v128_load32_splat(const void* p) { return wasm_f32x4_splat(*(const float*)p); }
static inline void wasm_v128_store(void* p, v128_t v) { float* q = (float*)p; q[0] = v.f[0]; q[1] = v.f[1]; q[2] = v.f[2]; q[3] = v.f[3]; }
static inline v128_t wasm_f32x4_add(v128_t a, v128_t b) { v128_t r = {{a.f[0] + b.f[0], a.f[1] + b.f[1], a.f[2] + b.f[2], a.f[3] + b.f[3]}}; return r; }
static inline v128_t wasm_f32x4_mul(v128_t a, v128_t b) { v128_t r = {{a.f[0] * b.f[0], a.f[1] * b.f[1], a.f[2] * b.f[2], a.f[3] * b.f[3]}}; return r; }
static inline v128_t wasm_f32x4_max(v128_t a, v128_t b) {
  v128_t r;
  for (int i = 0; i < 4; i++) r.f[i] = (a.f[i] != a.f[i] || b.f[i] != b.f[i]) ? (a.f[i] != a.f[i] ? a.f[i] : b.f[i]) : (a.f[i] > b.f[i] ? a.f[i] : b.f[i]);
  return r;
}
