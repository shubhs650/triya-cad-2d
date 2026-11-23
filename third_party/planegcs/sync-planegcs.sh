#!/usr/bin/env bash
# Re-vendors PlaneGCS into third_party/planegcs/src as a snapshot of one FreeCAD commit:
# src/Mod/Sketcher/App/planegcs/* and FreeCAD's LICENSE (LGPL-2.1), byte-identical, plus
# UPSTREAM.sha256, which tests/third-party/planegcs-build.test.ts checks the files against.
# Local changes are never made to src/: they are patches/*.patch, applied by build.sh.
#
# Why a snapshot and not the git submodule ARCHITECTURE.md first planned: FreeCAD's history is
# well over a gigabyte, and every CI checkout uses `submodules: recursive`. The snapshot is
# 450 KB (the same reasoning as acad-ts's, DEC-033).
#
# Usage: third_party/planegcs/sync-planegcs.sh <FreeCAD tag or commit>, then `pnpm
# planegcs:build`, then update the pinned commit in README.md.
set -euo pipefail

UPSTREAM_URL="https://github.com/FreeCAD/FreeCAD"
REF="${1:?usage: sync-planegcs.sh <FreeCAD tag or commit>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git -C "$WORK" init -q upstream
git -C "$WORK/upstream" remote add origin "$UPSTREAM_URL"
git -C "$WORK/upstream" config core.sparseCheckout true
printf '/src/Mod/Sketcher/App/planegcs/\n/LICENSE\n' > "$WORK/upstream/.git/info/sparse-checkout"
git -C "$WORK/upstream" fetch -q --depth 1 --filter=blob:none origin "$REF"
git -C "$WORK/upstream" checkout -q FETCH_HEAD

rm -rf "$HERE/src"
mkdir -p "$HERE/src"
cp "$WORK"/upstream/src/Mod/Sketcher/App/planegcs/* "$HERE/src/"
cp "$WORK/upstream/LICENSE" "$HERE/LICENSE"
(cd "$HERE" && sha256sum src/* LICENSE > UPSTREAM.sha256)
echo "Vendored PlaneGCS at $(git -C "$WORK/upstream" rev-parse HEAD); update README.md."
