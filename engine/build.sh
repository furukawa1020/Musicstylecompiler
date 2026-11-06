#!/bin/sh
set -eu
cd "$(dirname "$0")"
moon build --target wasm --release --strip --deny-warn
cp _build/wasm/release/build/compiler.wasm ../dist/music-compiler.wasm
