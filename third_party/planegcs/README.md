# PlaneGCS — vendored snapshot and WASM build

| | |
|---|---|
| Upstream | FreeCAD, `src/Mod/Sketcher/App/planegcs` (LGPL-2.1+, `LICENSE` here is FreeCAD's) |
| Pinned commit | `4fd3bf320d9566a27e60069fc8387448aaa3a094` (tag `1.1.4`) |
| Vendored | `src/` (the solver's 11 files) and `LICENSE`, byte-identical; `UPSTREAM.sha256` lists their hashes |
| Re-sync | `third_party/planegcs/sync-planegcs.sh <tag or commit>`, then `pnpm planegcs:build`, then update this table |
| Built module | `packages/constraints/wasm/planegcs.wasm` + `planegcs.mjs` (Emscripten glue), committed, with `build-stamp.json` |
| Build | `pnpm planegcs:build` (`build.sh`): Emscripten 3.1.74 in its pinned Docker image, `-O3`, no exceptions, no filesystem, no eval |
| Decisions | DEC-018 (PlaneGCS), DEC-029 (LGPL as a separate module), DEC-080 (Eigen MPL-2.0 inside the module; no Boost) |

## Layout

- `src/` — PlaneGCS as FreeCAD ships it. Never edited: a local change is a patch.
- `patches/` — applied in order to a staged copy by `build.sh`.
  - `0001-deferred-async.patch`: `System::diagnose` runs its two QR decompositions through `std::async` with the default policy, which tries a thread first. The module has no threads (no SharedArrayBuffer, so no cross-origin isolation), and without C++ exceptions libc++'s fallback to deferred execution cannot catch the failed thread start, so the module would abort. The patch asks for `std::launch::deferred`, which is what the default policy falls back to anyway. Local only: upstream builds with threads.
- `shim/` — Triya's own stand-ins (MIT) for the headers PlaneGCS includes from FreeCAD (`SketcherGlobal.h`, `FCConfig.h`, `Base/Console.h`, whose logging becomes no-ops) and from Boost (`boost/graph/connected_components.hpp` and `boost_graph_adjacency_list.hpp`: a union-find numbering components as Boost's DFS does; `graph_concepts.hpp` and `math/constants/constants.hpp`, included but unused). Boost (BSL-1.0) is not on Triya's license list, so none of it is built in.
- `bindings/sketch.cpp` — Triya's embind interface (MIT): a `Sketch` of parameters, points, lines, circles, arcs, ellipses and elliptical arcs (M9-02 part 3), constraints by numeric code with tags, `solve`, `diagnose`. Each solve and diagnosis declares the parameters not fixed as unknowns and redoes PlaneGCS's diagnosis (M9-02): PlaneGCS keeps it until a constraint changes, so a constraint left without unknowns while values were held fixed would otherwise stay set aside after they are freed. It also defines two constraints of Triya's own on PlaneGCS's `Constraint` interface (M9-02 part 2): a spline end's curvature equal to an arc's, and two spline ends' curvatures matched, for Smooth's G2 continuity, which PlaneGCS has no constraint for. `packages/constraints/src/planegcs.ts` is its typed front.
- `.cache/` — Eigen's download (gitignored).

## Eigen

PlaneGCS needs Eigen (MPL-2.0) for its linear algebra. `build.sh` downloads Eigen 3.4.0 from its GitLab release and checks its SHA-256 (`8586084f…1c72`); it is compiled unmodified, with `EIGEN_MPL2_ONLY`, into the PlaneGCS module only, never into the MIT app code, and is never committed (DEC-080). Source: https://gitlab.com/libeigen/eigen/-/tree/3.4.0.

## Checks

- `tests/third-party/planegcs-build.test.ts`: `src/` and `LICENSE` match `UPSTREAM.sha256`; the patches apply; the stand-ins are Triya's; the committed module matches the hashes of its inputs (`scripts/planegcs-stamp.mjs --check`).
- CI's `lint · typecheck` job rebuilds the module with `pnpm planegcs:build` and fails on any difference from the committed files, unless the same input and output hashes were verified before (an `actions/cache` key).
- `packages/constraints/test/planegcs.test.ts` (Node) and `tests/e2e/perf/constraints.spec.ts` (Chromium): solving, diagnosis and the 50-constraint < 20 ms budget.

## Rebuilding

Docker must be running (in a cloud sandbox: `sudo dockerd &`). `pnpm planegcs:build` writes the module and its stamp; commit all three files. The build is reproducible: the same inputs give the same bytes. Without Docker, `PLANEGCS_NO_DOCKER=1 pnpm planegcs:build` uses an `em++` 3.1.74 on `PATH`.
