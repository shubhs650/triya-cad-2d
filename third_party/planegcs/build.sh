#!/usr/bin/env bash
# Builds PlaneGCS (FreeCAD's 2D constraint solver, LGPL-2.1+) to WebAssembly for
# @triya/constraints: packages/constraints/wasm/planegcs.mjs (ES module glue) and
# planegcs.wasm, plus build-stamp.json, which records the hash of every input so that
# tests/third-party/planegcs-build.test.ts fails when an input changes without a rebuild.
#
# Run as `pnpm planegcs:build`. It uses the pinned Emscripten Docker image, so the output is
# the same on any machine; with PLANEGCS_NO_DOCKER=1 it uses the `em++` on PATH instead (CI's
# cache restore path and machines without Docker), which must be the same Emscripten version.
#
# Inputs: src/ (PlaneGCS at the FreeCAD commit in README.md, byte-identical to upstream),
# patches/ (applied to a staged copy), shim/ (stand-ins for the FreeCAD and Boost headers
# PlaneGCS includes), bindings/ (Triya's embind interface), and Eigen, fetched below at a
# pinned version and checksum into .cache/ (never committed; MPL-2.0, see README.md).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$ROOT/packages/constraints/wasm"

EMSDK_VERSION="3.1.74"
EMSDK_IMAGE="emscripten/emsdk:${EMSDK_VERSION}@sha256:af45409f3199d88db4b1b03af0098532c8fb33a375ac257463eeb0a622870d06"
EIGEN_VERSION="3.4.0"
EIGEN_URL="https://gitlab.com/libeigen/eigen/-/archive/${EIGEN_VERSION}/eigen-${EIGEN_VERSION}.tar.gz"
EIGEN_SHA256="8586084f71f9bde545ee7fa6d00288b264a2b7ac3607b974e54d13e7162c1c72"

CACHE="$HERE/.cache"
EIGEN_DIR="$CACHE/eigen-${EIGEN_VERSION}"
mkdir -p "$CACHE" "$OUT"

if [[ ! -f "$EIGEN_DIR/Eigen/Dense" ]]; then
  tarball="$CACHE/eigen-${EIGEN_VERSION}.tar.gz"
  curl -fsSL --retry 4 -o "$tarball" "$EIGEN_URL"
  echo "${EIGEN_SHA256}  $tarball" | sha256sum -c --quiet -
  rm -rf "$EIGEN_DIR"
  tar -xzf "$tarball" -C "$CACHE"
  rm "$tarball"
fi

compile() {
  local root="$1" # the repository root as the compiler sees it
  local here="$root/third_party/planegcs"
  local stage
  stage="$(mktemp -d)"
  # GCS.h and Geo.h include "../../SketcherGlobal.h", so the sources sit two levels below it.
  mkdir -p "$stage/Mod/planegcs"
  cp "$here"/src/*.cpp "$here"/src/*.h "$stage/Mod/planegcs/"
  cp "$here/shim/SketcherGlobal.h" "$stage/"
  for p in "$here"/patches/*.patch; do
    patch -s -d "$stage/Mod/planegcs" -p1 < "$p"
  done
  # -DEIGEN_MPL2_ONLY: refuse any Eigen code that is not MPL-2.0 (README.md, License).
  # No exceptions, no filesystem, no eval (the app's CSP), memory grows with big sketches.
  # The caller always passes the .wasm bytes (wasmBinary), so the glue never fetches.
  em++ -std=c++20 -O3 -DNDEBUG -DEIGEN_MPL2_ONLY \
    -I "$here/shim" -I "$here/.cache/eigen-${EIGEN_VERSION}" -I "$stage/Mod/planegcs" \
    "$stage"/Mod/planegcs/*.cpp "$here/bindings/sketch.cpp" \
    -lembind \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPlaneGcs \
    -sENVIRONMENT=web,worker -sFILESYSTEM=0 -sDYNAMIC_EXECUTION=0 \
    -sALLOW_MEMORY_GROWTH=1 -sINCOMING_MODULE_JS_API=wasmBinary,instantiateWasm \
    -o "$root/packages/constraints/wasm/planegcs.mjs"
  rm -rf "$stage"
}

if [[ "${PLANEGCS_NO_DOCKER:-}" == "1" ]]; then
  em++ --version | head -1 | grep -q " ${EMSDK_VERSION} " \
    || { echo "em++ ${EMSDK_VERSION} required (got: $(em++ --version | head -1))" >&2; exit 1; }
  compile "$ROOT"
else
  docker run --rm -v "$ROOT:/repo" -w /repo -u "$(id -u):$(id -g)" \
    -e HOME=/tmp -e EM_CACHE=/tmp/em-cache "$EMSDK_IMAGE" \
    bash -c "set -euo pipefail; $(declare -f compile); EIGEN_VERSION=${EIGEN_VERSION}; compile /repo"
fi

node "$ROOT/scripts/planegcs-stamp.mjs" --write
echo "planegcs: wrote $(cd "$ROOT" && ls packages/constraints/wasm | tr '\n' ' ')"
