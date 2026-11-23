# Third-party code

- `acad-ts/` — filtered snapshot of github.com/node-projects/acad-ts (MIT) pinned to the commit recorded in `acad-ts/PATCHES.md` (DEC-033). Re-sync with `sync-acad-ts.sh <sha>`; local patches live in `acad-ts-patches/`, are re-applied by the script, and each carries an upstream PR draft.
- `planegcs/` — byte-identical snapshot of FreeCAD's PlaneGCS (LGPL-2.1+) at a pinned commit, plus patches, header stand-ins, Triya's embind binding and `build.sh` (Emscripten via Docker; Eigen, MPL-2.0, downloaded at build time, DEC-080). The built module (`packages/constraints/wasm`) loads at runtime as a separate module; its LGPL notice and source link are in `NOTICE.md` there and `ATTRIBUTION.md`. See `planegcs/README.md`.
