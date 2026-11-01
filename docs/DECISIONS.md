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

**DEC-033 — acad-ts is vendored as a filtered snapshot with a sync script, not a literal `git subtree`** · Accepted · 2026-11-01
Context: DEC-004 says "vendored as a subtree". The upstream tree at the pinned commit ships an Autodesk-copyrighted DXF reference PDF and the ODA DWG spec (`reference/`) plus `.shx`/`.shp`/`.pat` sample files (`samples/`), which CLAUDE.md forbids committing in any commit; and PRs here are squash-merged, which discards the merge metadata `git subtree pull` depends on. Decision: keep DEC-004's intent (pinned upstream commit, in-repo copy, minimal logged patches, upstream PR drafts) but vendor only `src/`, `LICENSE`, `README.md`, `package.json`, `tsconfig.json` via `third_party/sync-acad-ts.sh <sha>`, which refuses forbidden asset types and re-applies `third_party/acad-ts-patches/*.patch`. Consequences: `third_party/acad-ts/PATCHES.md` records the pin and every patch; the vendored tree is `-text` in `.gitattributes` and excluded from lint/format; DEC-004 is otherwise unchanged. (M0-03)

**DEC-034 — `$TDUUPDATE` is an allowed round-trip difference, as the UTC twin of `$TDUPDATE`** · Accepted · 2026-11-01
Context: `TESTING.md` §3 allows `$TDUPDATE` (last-update time) to change on save. AutoCAD stores the same instant twice, local (`$TDUPDATE`) and UTC (`$TDUUPDATE`), and updates both when it saves; the M0-05 harness found `$TDUUPDATE` differing in 33 of 119 corpus files for exactly that reason. Decision (M0-05): `$TDUUPDATE` is allowed on the same terms as `$TDUPDATE`. `$TDCREATE`/`$TDUCREATE` are not: the creation date must survive a save. Consequences: `TESTING.md` §3; `packages/testkit/src/roundtrip/diff.ts`.

**DEC-035 — The document model is a mutable container of frozen values; `ChangeSet`s carry before/after by reference and block positions; handles only grow** · Accepted · 2026-11-01
Context: ARCHITECTURE.md §4.1 says entities are replaced, never mutated, but does not say where entities live or what a `ChangeSet` holds. Copying immutable maps on every edit is O(n) per command at 100k entities, which breaks T3 (< 16 ms input round trip); a change set without positions cannot restore block entity order (file order is draw order without SORTENTS) on undo. Decision: `DocumentModel` owns mutable maps of frozen entities/records/objects plus an ordered `EntityId[]` per block; it changes only through `apply(changeSet)`, which validates everything (current "before" by reference, free handles, in-range indices) before committing. `ChangeSet` = entities `{added, updated, removed}` with block indices (removal: before the change; addition: after it), keyed `{added, updated, removed}` for each table and for objects, and header `{name, before, after}`; inversion swaps them. `HandleAllocator` starts at `$HANDSEED`, raised past every present handle (including passthrough) if stale, and is monotonic: undo never returns a handle, matching AutoCAD. `EntityIdMap` bindings are permanent for the session. Consequences: undo records are two change sets; render/R-tree caches key on `EntityId` safely; block definitions and layouts are added to `ChangeSet` by the tasks that first edit them (M5 BLOCK, M6 LAYOUT). (M1-01)

**DEC-036 — Geometry tolerance is 1e-10 relative to the drawing's magnitude, floored at 1 unit; full-turn arcs are recognised to rounding** · Accepted · 2026-11-01
Context: ARCHITECTURE.md §4.1 requires an extents-derived epsilon but does not give the rule. A double resolves ~1e-16 relative to the coordinate, so a drawing far from the origin cannot meet an absolute 1e-10, while a fixed relative epsilon on tiny drawings asks for sub-ULP precision. Decision: `toleranceFromExtents(min, max)` gives linear = 1e-10 × max(1, |coordinates|, width, height) and angular = 1e-10 rad; empty extents (AutoCAD's 1e20/−1e20) give the unit tolerance. 1e-10 leaves ~5 digits of headroom over double precision for error accumulated in a few operations and matches AutoCAD's default equal-point tolerance at unit scale. Separately, an ARC or ELLIPSE whose end − start equals 2π to within floating-point rounding of the operands is a full curve (`ccwSweep`), so start + 2π never collapses to a zero sweep. Consequences: kernel functions take a `Tolerance` argument and never hold their own; the M1-02 property tests run at ±1000-unit scale with `toleranceForSize(1000)`. (M1-02)

**DEC-037 — Curve intersections are analytic where a closed form exists and numeric (flatten, seed, Newton) elsewhere; only isolated points are reported** · Accepted · 2026-11-01
Context: M1-02 asks for intersections of all curve pairs, "incl. spline via flattening", but not how exact they must be or what overlap returns; INT/APPINT osnap, TRIM, EXTEND, BREAK and FILLET all build on it. Decision: `intersect(a, b, tol)` splits each curve into linear, circular, elliptic and spline pieces (polylines per segment). Line–line, line–circle/arc, circle–circle and line–ellipse are solved in closed form (the ellipse in its unit-circle frame). Every other pair is flattened, each piece within 1e-3 of its own extent (so a small fillet against a large circle is still sampled finely); chord pairs that cross or come within the sum of both deviations seed Newton's method on the true curves, confined to that chord pair. A pair whose Newton fails, or which might hold a second crossing (the curves turn by more than their crossing angle, the cone test of Bézier clipping), is halved and retried, up to five levels. Results are sorted along `a`, and points closer than `tol.linear` merge. Overlapping stretches (collinear lines, coincident circles or arcs) have no single point to report and return nothing; commands that care about overlap (TRIM, EXTEND, OVERKILL) detect it themselves. Consequences: crossings are exact to `tol.linear`; numeric pairs can miss a crossing only inside a feature smaller than about 1e-3 of a piece's extent that also turns back on itself, which the property tests keep out of their generators (near-cusp splines) and dedicated tests cover. (M1-02)

**DEC-038 — The handle-coverage gate scans each file independently of acad-ts, has no allow-list, and ratchets lost handles by handle** · Accepted · 2026-11-01
Context: M1-27 asks that every handle a corpus file declares be in the reopened document "or on a documented allow-list (folded `VERTEX`/`SEQEND`, free DWG handles)". Measuring it showed neither exception is real: acad-ts keeps vertices, polyface faces, attributes and their `SEQEND` under their file handles inside the owning entity (they are only absent from `getCadObjects()`), and every handle-map entry in the corpus DWGs is a live object record (dynamic-block parameters, solid history, XRECORDs that the reader never reaches). The M0-06 count also skipped binary DXF and DWG types. Decision: (1) the declared list comes from the file alone: the DWG handle map typed from each record header, and ASCII/binary DXF `5` (`105` for `DIMSTYLE`, whose `5` is DIMBLK) outside HEADER and CLASSES; (2) "present" includes objects held by their owner, and there is no other exception, so any future allowance needs its own DEC entry; (3) until M1-31/M1-33 land, `corpus/handle-coverage-baseline.json` lists today's losses per file by handle, and any handle not listed fails, so a new loss cannot hide behind a fixed one. DWG record types are read through acad-ts reader internals (`_readHandles`, `DwgObjectReader._getEntityType`) because acad-ts has no public API for either; the scanner fails loudly if they change.
Consequences: `TESTING.md` §3.2; M1-31 (writer drops) and M1-33 (never loaded) empty the baseline.

**DEC-039 — Entity geometry is the plan view in WCS XY; ±Z extrusions convert exactly, tilted planes stay unmapped** · Accepted · 2026-11-01
Context: `ARCHITECTURE.md` §4.1 left open how M1-04 presents OCS entities and 3D input. Kernel functions (intersections, osnaps, offsets) need every entity in one 2D frame, and the corpus has 314 SOLIDs, 62 TEXTs and 34 MTEXTs with extrusion (0, 0, −1), the usual result of MIRROR in AutoCAD, but no circle or arc on a tilted plane. Decision: `AcadToTriya` gives every entity its plan view in WCS XY. OCS entities with an extrusion along ±Z are converted exactly with AutoCAD's arbitrary-axis algorithm: for −Z, OCS (x, y, z) is WCS (−x, y, −z), so arc angles become π − θ with start and end swapped, ellipse parameters negate and swap, and bulges change sign. WCS entities (LINE, POINT, SPLINE, 3DFACE, 3D POLYLINE, XLINE, RAY) drop Z, which is the exact plan view even when they are not planar. `elevation`, `thickness` and a non-+Z `normal` are carried on the geometry. An OCS entity on a tilted plane, and an XLINE or RAY along Z, has no faithful 2D shape of its kind, so it is reported in `mapEntities(...).unmapped` with its reason and keeps only its retained original (drawn later from proxy data or not at all). Consequences: Triya never edits Z; a save writes an unedited entity from its original (§6.2 rule 2), and an edited one from its plan view at its elevation. VERTEX, SEQEND and ATTRIB entities fold into their POLYLINE or INSERT. Text and blocks (M1-04 part 2): a text frame is its WCS baseline angle with the mirror flags applied in the text's own axes, so a −Z TEXT, ATTDEF or ATTRIB becomes baseline π − θ with upside-down toggled; MTEXT keeps its WCS insertion point and X direction and records `upsideDown` because its Y axis (normal × X) is reversed; an MTEXT that states neither 11 nor 50 runs along the OCS X axis; an INSERT folds −Z into its placement exactly (mirrored position, rotation −θ, scale (−sx, sy, −sz), MINSERT column spacing negated). Annotations (M1-04 part 3): a DIMENSION keeps the DXF reference's frames, so its WCS points 10 and 13–15 drop Z, its OCS points 11, 12 and 16 are mirrored under −Z and its OCS angles 50–53 become π − θ; LEADER vertices are WCS; TOLERANCE converts like MTEXT. A HATCH's boundary edges and pattern lines are OCS: under −Z points mirror, pattern angles become π − θ, and each edge reverses, so `ccw` flips, stored arc angles gain π and ellipse parameters stay (AutoCAD stores a clockwise edge's angles negated). A MULTILEADER's points are all WCS, so they drop Z; it is unmapped when its leader plane (context 111 × 112) is tilted, and its text records `upsideDown` when the text normal is −Z, as MTEXT does. An ACAD_TABLE's insertion point is OCS, as for INSERT, and its horizontal direction (11) WCS, as for MTEXT; its cells carry spans whether the file states them per cell (DXF 175/176, 173) or as merged ranges (DWG). IMAGE and WIPEOUT points and pixel vectors are WCS and drop Z (unmapped when u × v is tilted); a PDFUNDERLAY's insertion point is WCS and its rotation is about its normal, so under −Z it becomes π − θ with `upsideDown`. MLINE points and vectors are WCS and drop Z (unmapped when its normal is tilted). A VIEWPORT is a paper-space frame: its centre drops Z, and the view it shows (target, direction, twist, centre, height) is kept as stated, in model-space terms, with no plan-view conversion. A REGION has no plan-view data of its own in any corpus file (no proxy graphics), so its boundary is read from its ACIS body (`packages/io/src/acis`): points and curves are moved by the body transform (a 3 × 3 matrix applied to row vectors, then translation, then scale; the corpus has only translations, so the matrix order is the ACIS documentation's, untested), and a face whose plane is not ±Z is unmapped. OLE2FRAME corners are WCS and drop Z. An ACAD_PROXY_ENTITY is drawn from its proxy graphics, which are WCS: polylines and polygons drop Z; circles and arcs are kept when their plane is ±Z under the current model transform (read as AcGeMatrix3d rows with the translation in the last column, untested on the corpus), and an arc's plan direction comes from its mapped start vector and normal × start vector, so a mirroring transform reverses it; text, meshes and shells are counted, not drawn. (M1-04)

**DEC-040 — Passthrough-only objects that acad-ts cannot write to DXF from their fields are kept as read and written back raw** · Accepted · 2026-11-01
Context: M1-28 R2/R3 proposed adding `MATERIAL` and `VISUALSTYLE` field writers to the acad-ts DXF writer. The acad-ts DXF reader assigns no `VISUALSTYLE` field at all, so a field writer would have written defaults; the round-trip diff would not notice, because acad-ts would read the same defaults back, but the drawing's visual styles would be gone. Both types are passthrough-only in `FILE_FIDELITY.md`. Decision: with `keepRawDxfPassthroughObjects` (set by `@triya/io`), the DXF reader records the group codes of these objects as read (patch 0021, the M1-30 recorder) and the DXF writer emits them unchanged, rewriting only the handle and owner as for unknown objects. The typed object is still built, and DWG reads and writes are unchanged. An object with no recorded codes (built in memory, or read from DWG and saved to DXF) is still skipped with a notification. Another type joins the list only when its DXF read is lossy and Triya does not edit it.
Consequences: `fidelityDxfReaderConfiguration`; `third_party/acad-ts/PATCHES.md` 0021; a Triya edit to one of these objects would need a field writer first.
