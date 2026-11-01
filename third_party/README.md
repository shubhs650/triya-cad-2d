# Third-party code

- `acad-ts/` — filtered snapshot of github.com/node-projects/acad-ts (MIT) pinned to the commit recorded in `acad-ts/PATCHES.md` (DEC-033). Re-sync with `sync-acad-ts.sh <sha>`; local patches live in `acad-ts-patches/`, are re-applied by the script, and each carries an upstream PR draft.
- `planegcs/` — git submodule of FreeCAD's PlaneGCS (LGPL-2.1+) plus `build.sh` (Emscripten via Docker). The built artifact loads at runtime as a separate module; LGPL notice and source link ship in the app's About dialog and `ATTRIBUTION.md`.
