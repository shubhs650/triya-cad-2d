# Third-party code

- `acad-ts/` — git subtree of github.com/node-projects/acad-ts (MIT) pinned to the commit recorded in `acad-ts/PATCHES.md`. Local patches are minimal and each carries an upstream PR draft.
- `planegcs/` — git submodule of FreeCAD's PlaneGCS (LGPL-2.1+) plus `build.sh` (Emscripten via Docker). The built artifact loads at runtime as a separate module; LGPL notice and source link ship in the app's About dialog and `ATTRIBUTION.md`.
