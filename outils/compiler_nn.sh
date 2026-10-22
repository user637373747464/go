#!/bin/sh
# Compile nn.c en WebAssembly (SIMD) -> nn.wasm. Nécessite clang + lld.
set -e
cd "$(dirname "$0")"
clang --target=wasm32 -O3 -msimd128 -ffast-math -fno-builtin -nostdlib -fuse-ld=lld \
  -Wl,--no-entry -Wl,--export-dynamic -Wl,--initial-memory=33554432 -Wl,--max-memory=268435456 -Wl,--allow-undefined \
  -Wl,-z,stack-size=1048576 -o ../nn.wasm nn.c
ls -l ../nn.wasm
