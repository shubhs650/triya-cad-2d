# Decision Register (ADRs)

Decisions made in the product interview of 2026-11-01 and during development. Each entry: context → decision → consequences. A decision is changed only by a new entry that supersedes it; never edit history. Threads that believe a decision is wrong open an issue labelled `adr-proposal` and continue with other work.

Format: **DEC-NNN — Title** · *Status* · *Date*

---

**DEC-001 — Scope is 2D only; the Layout tab's 3D-derived view tools are excluded** · Accepted · 2026-11-01
Context: AutoCAD's Layout tab mixes paper-space tooling with Base/Projected/Section/Detail views generated from 3D models. Decision: full model + paper space support; no 3D, no model-derived views. Consequences: PRD non-goal #1; `VIEWBASE` family not in `COMMANDS.md`.

**DEC-002 — Full paper space (layouts, page setup, viewports with scale/lock/VP overrides) is in v1** · Accepted · 2026-11-01
Context: vessel GA drawings are structured as model geometry + paper-space sheets; DXF/DWG round-trip of real files requires paper-space support or sheets are silently destroyed. Decision: option A (full). Consequences: M1-18, M6.

**DEC-003 — Primary workflow is import-and-markup; drafting-from-scratch is secondary** · Accepted · 2026-11-01
Context: adoption path for an OET tool is "open the vendor DWG privately and red-line it", and markup is the strictest test of fidelity. Decision: markup first. Consequences: build order M1→M2 before M3+; trade-offs resolve in favour of fidelity.

**DEC-004 — DWG read and write via acad-ts (MIT), in-browser, no licensing split** · Accepted · 2026-11-01
Context: LibreDWG is GPL; ODA is closed/paid; acad-ts is an MIT TypeScript port of ACadSharp claiming R12–R2018 read/write. Decision: adopt acad-ts as the file layer, vendored as a subtree with upstreamed patches; gate on the M0 spike. Consequences: supersedes the earlier "DXF now + GPL converter micro-tool" option; M0-06 go/no-go; `third_party/acad-ts/PATCHES.md`.

**DEC-005 — Own document model with opaque passthrough; acad-ts object graph retained as export base** · Accepted · 2026-11-01
Context: using `CadDocument` directly couples the editor to a young dependency; own model without passthrough loses unknown objects on round-trip. Decision: own model; every unmapped object preserved verbatim; export starts from the retained original and applies changes by handle. Consequences: `ARCHITECTURE.md` §6; round-trip diff = 0 is a hard CI gate.

**DEC-006 — Canvas 2D behind a `Renderer` interface, with measured performance budgets; WebGL only if budgets fail** · Accepted · 2026-11-01
Context: fidelity of text, linetypes and hatches matters more than raw throughput for markup; typical vessel GA is 5–30k entities. Decision: Canvas 2D with culling/LOD/OffscreenCanvas worker; budgets T2/T3 at 100k entities in CI; WebGL path is a swap behind the interface, triggered only by a budget failure (needs-human). Consequences: no Canvas2D API outside `packages/render`.

**DEC-007 — Native SHX stroke renderer + user font drop + bundled open stroke fonts** · Accepted · 2026-11-01
Context: Autodesk SHX files are copyrighted and cannot be bundled; TTF substitution shifts text widths and breaks dimension/title-block layout. Decision: implement the SHX format; users drop their own fonts (OPFS, private); bundle Hershey/LibreCAD-derived stroke fonts as fallback with a name map. Consequences: M1-08/09; health panel reports substitutions.

**DEC-008 — Vector PDF plotting with CTB/STB support and multi-layout PUBLISH** · Accepted · 2026-11-01
Context: EPC drawings plot correctly only with the vendor's CTB; PDF is the markup deliverable. Decision: own vector PDF writer; CTB/STB parser with user drop + bundled open equivalents; PUBLISH with bookmarks; stroke fonts as paths; TTF embedded. Consequences: M2-15..17, M6-04/05; no rasterised-page PDFs.

**DEC-009 — Full AutoCAD command grammar and alias set, plus Dynamic Input and a Ctrl+K palette** · Accepted · 2026-11-01
Context: drafters' muscle memory is the command line. Decision: acad.pgp aliases, option syntax, coordinate entry, repeat/cancel/default, transparent commands, user alias file; Dynamic Input as a second front-end on the same bus; palette for discoverability. Consequences: `COMMANDS.md` is normative; commands are generators (`ARCHITECTURE.md` §5).

**DEC-010 — Disk + OPFS crash recovery + recent files + multi-document tabs; fully offline PWA** · Accepted · 2026-11-01
Context: no login means disk and browser storage are the only homes for a drawing; losing an hour of red-lines is fatal to adoption. Decision: option C. Consequences: M2-13/14/19/20; "Clear all local data" required.

**DEC-011 — Dimensions render from the stored block until touched, then regenerate; DIMASSOC=1 at launch** · Accepted · 2026-11-01
Context: AutoCAD stores a pre-rendered `*D` block per dimension; regenerating on import risks visual drift; full associativity touches every modify command. Decision: stored-block-until-touched; defpoint grips; data model leaves `DIMASSOC=2` slots. Consequences: M2-10, M4-01; health check surfaces engine/stored mismatches.

**DEC-012 — Static blocks with attributes and Block Editor; dynamic blocks render-and-preserve only** · Accepted · 2026-11-01
Context: dynamic-block evaluation is an undocumented sub-format with poor cost/benefit; markup users need to *see* them. Decision: option A. Consequences: PRD non-goal #2; `*U` blocks static with badge.

**DEC-013 — Annotative objects: view-faithful rendering and preservation; no creation** · Accepted · 2026-11-01
Context: multi-representation editing is a large surface; most vessel GAs are single-scale. Decision: option A. Consequences: PRD non-goal #3; M1-18, M6-03.

**DEC-014 — Tables: render, in-place cell edit, simple creation, whole-table scaling; no formulas/data links** · Accepted · 2026-11-01
Context: editing a revision row or nozzle size is a markup task; Extract/Link Data depend on desktop file linkage. Decision: option B plus owner's addition: SCALE on tables, table text-height rescale, grip resize. CSV/clipboard paste as fast-follow (Should). Consequences: M4-05/06.

**DEC-015 — Full HATCH with pick-point island detection and user .pat; non-associative at launch** · Accepted · 2026-11-01
Decision: option C. Consequences: M1-16, M4-07; bundled patterns are re-authored, never copied.

**DEC-016 — Xrefs/images/PDF underlays resolved via file/folder drop with cached handles; BIND supported** · Accepted · 2026-11-01
Decision: option C. Consequences: M1-21, M5-04; PDF underlay becomes a headline red-line feature (DEC-022).

**DEC-017 — UI: AutoCAD tab/panel structure with modern execution; Home Draw/Modify/Annotate never overflow on laptops; full labelled ribbon at ≥1920** · Accepted · 2026-11-01
Context: owner requirement that professional drafters on large screens get the full ribbon and that laptops keep all popular Draw/Modify/Annotate commands one click away. Decision: option B with those two constraints. Consequences: `UI_SPEC.md` §3; T9.

**DEC-018 — Full parametric constraints (geometric + dimensional) in v1, using PlaneGCS (LGPL) as WASM; AutoCAD constraints are passthrough only; Triya constraints stored in a Triya dictionary** · Accepted · 2026-11-01
Context: owner judged constraints important for experienced drafters; solver is a product-sized feature; SolveSpace is GPL; AutoCAD's `AcDbAssoc*` is undocumented. Decision: option C scope, solver A (PlaneGCS), interop limits accepted; built last (M9). Consequences: FR-X; `third_party/planegcs`.

**DEC-019 — Ship when complete; no public beta on the OET launch** · Accepted · 2026-11-01
Context: owner prefers a complete tool over a phased beta. Decision: option A; build order still M1→M10. Consequences: PRD §13.

**DEC-020 — Stack: React 19 + TypeScript + Vite, Fluent UI System Icons, Zustand; engine in plain TS modules with zero DOM; shared UI kit with PDFTools** · Accepted · 2026-11-01
Consequences: `ARCHITECTURE.md` §2, §15; headless engine required for CI fidelity tests.

**DEC-021 — Fidelity defined by automated visual regression against AutoCAD reference plots, round-trip structural diff = 0, and AutoCAD AUDIT = 0 as a release gate; public corpus in repo (self-authored + ezdxf/ACadSharp samples), private corpus local-only** · Accepted · 2026-11-01
Consequences: `TESTING.md`; `corpus/`.

**DEC-022 — v1 differentiators: pressure-vessel symbol/standards library, PDF underlay red-lining, drawing compare, drawing health report. Deferred: smart revision workflow, local MCP server** · Accepted · 2026-11-01
Consequences: M8; compare is a geometry/handle diff, not pixel-based.

**DEC-023 — Chromium-first full feature set; Firefox/Safari documented degraded mode; desktop/laptop only; no touch UI** · Accepted · 2026-11-01
Consequences: PRD §8; M7-09.

**DEC-024 — New drawings: bundled ISO (mm) and ANSI (inch) templates, user template folder, user default template opens with one click; INSUNITS honoured, never silent rescale** · Accepted · 2026-11-01
Consequences: M5-10; M3-09.

**DEC-025 — Layers at AutoCAD depth: manager + VP overrides + tool row + layer states + filters** · Accepted · 2026-11-01
Consequences: M5-05..07.

**DEC-026 — Precision input and selection AutoCAD-complete, minus isometric snap** · Accepted · 2026-11-01
Consequences: M2-03/04, M3-04..06; PRD non-goal #7.

**DEC-027 — Theme: light chrome + dark model canvas default, white paper space, plot-preview mode, ACI 7/0 background rules** · Accepted · 2026-11-01
Consequences: `UI_SPEC.md` §6.

**DEC-028 — Quantitative acceptance targets T1–T9 adopted as CI gates** · Accepted · 2026-11-01
Consequences: PRD §12; `pnpm test:perf`, `test:offline`.

**DEC-029 — MIT app license; LGPL PlaneGCS as separate WASM module; no telemetry; opt-in reviewed error reports via Cloudflare Worker → GitHub; `triya-cad-2d.openengtools.com` (lowercase); English UI, translation-ready; repo private until owner chooses** · Accepted · 2026-11-01
Consequences: `ATTRIBUTION.md`; M7-08; M10-05.

**DEC-030 — Fifteen explicit non-goals** · Accepted · 2026-11-01
See `PRD.md` §4. A plan or PR that includes one is defective.

**DEC-031 — Development is driven autonomously by Claude Code Projects threads from the repo docs; CI is the reviewer; PRs auto-merge on green; humans are consulted only for the six listed stop conditions** · Accepted · 2026-11-01
Consequences: `CLAUDE.md`; branch protection requires CI; `docs/SETUP.md`.

**DEC-032 — `testkit` is a test-only package with its own boundary edges; workspace packages are consumed from source** · Accepted · 2026-11-01
Context: `ARCHITECTURE.md` §2 lists `packages/testkit` but gives it no edges, and the round-trip, fidelity and perf harnesses need the file layer and renderer. Decision (M0-01): `testkit → engine, io, render, text, hatch, dims, pdf`; no production file may import `testkit`, any `*.test.ts`/`*.spec.ts` may. Packages export `./src/index.ts` and resolve through `tsconfig.base.json` `paths` (and the matching Vitest alias), so there is no per-package build before tests or typecheck. Consequences: `eslint.config.js`, `tests/lint/boundaries.test.ts`; `ARCHITECTURE.md` §2.
