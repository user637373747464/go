#!/bin/sh
# Compile nn.c en WebAssembly. Nécessite clang + lld.
#   nn.wasm           : version rapide (SIMD)                     -> iPhone iOS 16.4 ou plus, tous les navigateurs récents
#   nn_scalaire.wasm  : version de secours, sans SIMD (3-4x plus lente) -> iPhone plus anciens
set -e
cd "$(dirname "$0")"
COMMUN="--target=wasm32 -O3 -ffast-math -fno-builtin -nostdlib -fuse-ld=lld -Wl,--no-entry -Wl,--export-dynamic -Wl,--initial-memory=33554432 -Wl,--max-memory=268435456 -Wl,--allow-undefined -Wl,-z,stack-size=1048576"
clang $COMMUN -msimd128 -o ../nn.wasm nn.c
clang $COMMUN -DSANS_SIMD -o ../nn_scalaire.wasm nn.c
ls -l ../nn.wasm ../nn_scalaire.wasm
