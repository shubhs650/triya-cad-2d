#!/usr/bin/env bash
# Re-vendor acad-ts into third_party/acad-ts as a filtered snapshot of one upstream commit,
# then re-apply our local patches from third_party/acad-ts-patches/*.patch in order.
#
# Why a filtered snapshot and not `git subtree add`: the upstream tree ships an Autodesk-
# copyrighted DXF reference PDF (reference/), the ODA DWG spec, and .shx/.pat sample files
# (samples/). CLAUDE.md forbids committing any of those, in any commit, and PRs here are
# squash-merged, which drops the subtree merge metadata anyway. See DEC-022.
#
# Usage: third_party/sync-acad-ts.sh <upstream-commit-sha>
# Afterwards update the pinned commit in third_party/acad-ts/PATCHES.md.
set -euo pipefail

UPSTREAM_URL="https://github.com/node-projects/acad-ts"
COMMIT="${1:?usage: sync-acad-ts.sh <upstream-commit-sha>}"

# Only these upstream paths are vendored. Everything else (reference/, samples/, tests/,
# docs/, tools/, .github/, memory/, lockfile, solution file) stays upstream.
INCLUDE=(src LICENSE README.md tsconfig.json package.json)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/third_party/acad-ts"
PATCH_DIR="$ROOT/third_party/acad-ts-patches"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git -C "$WORK" init -q upstream
git -C "$WORK/upstream" remote add origin "$UPSTREAM_URL"
git -C "$WORK/upstream" fetch -q --depth 1 origin "$COMMIT"
git -C "$WORK/upstream" checkout -q FETCH_HEAD

# Keep our own files (PATCHES.md) across a re-sync; replace everything upstream-owned.
for p in "${INCLUDE[@]}"; do
  rm -rf "${DEST:?}/$p"
  cp -R "$WORK/upstream/$p" "$DEST/$p"
done

# Belt and braces: refuse to vendor any file type the project rules forbid.
if find "$DEST" -type f \( -iname '*.shx' -o -iname '*.shp' -o -iname '*.pat' -o -iname '*.lin' \
     -o -iname '*.ctb' -o -iname '*.stb' -o -iname '*.dwt' -o -iname '*.pdf' \) | grep -q .; then
  echo "error: forbidden asset type found under $DEST" >&2
  exit 1
fi

shopt -s nullglob
for patch in "$PATCH_DIR"/*.patch; do
  echo "applying $(basename "$patch")"
  git -C "$ROOT" apply --directory=third_party/acad-ts "$patch"
done

echo "vendored $UPSTREAM_URL@$COMMIT into third_party/acad-ts"
