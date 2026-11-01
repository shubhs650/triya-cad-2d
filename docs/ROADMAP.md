# Triya CAD 2D — Roadmap and Task Board

This file is the **work queue** for Claude Code threads (see `CLAUDE.md` → Autodrive protocol). Milestones run in order; tasks within a milestone can run in parallel unless a `blocked-by` is listed. Threads claim tasks by editing the checkbox and append the PR number on completion.

Legend: `[ ]` open · `[~] (thread: name)` claimed · `[x] (#PR)` done · `[-]` dropped (reason in DECISIONS.md)

Every task has: **ID**, **title**, **acceptance** (what the test proves), optional **blocked-by**. Add new tasks you discover to the right milestone with a one-line *why*.

---

## M0 — Foundation and the acad-ts gate (go/no-go)

**Exit criteria:** monorepo builds and tests in CI; acad-ts spike report written; **owner decides go/no-go on acad-ts** (needs-human). No feature work beyond M0 starts until `M0-GO` is checked.

- [x] (#1) **M0-01** Monorepo scaffold — pnpm workspaces, turbo, TS strict, ESLint + `eslint-plugin-boundaries` with the dependency graph from `ARCHITECTURE.md` §2, Prettier, Vitest, Playwright, Husky pre-commit (lint+typecheck). **Acceptance:** `pnpm lint typecheck test` green on an empty engine package; boundary violation test fails lint.
- [ ] **M0-02** CI workflow — `.github/workflows/ci.yml` runs lint/typecheck/unit/fidelity/perf/offline on PR and main; caches pnpm and Playwright; uploads fidelity diff images as artifacts. **Acceptance:** PR to main shows all jobs; a deliberately failing fidelity test blocks merge.
- [x] (#3) **M0-03** Vendor acad-ts as `third_party/acad-ts` git subtree at a pinned commit; build it into `packages/io` worker bundle; `PATCHES.md` created. **Acceptance:** `DwgReader` runs in Node test and in a Web Worker in a Vite dev build.
- [x] (#2) **M0-04** Corpus skeleton — `corpus/public/` with README, manifest schema (`corpus.json`: file, version, source, license, reference plot, tolerance, tags), `corpus/private/` gitignored; import the ezdxf and ACadSharp sample files that are redistributable with their licenses noted. **Acceptance:** `pnpm corpus:list` prints ≥ 40 files with versions R12–R2018.
- [x] (#5) **M0-05** Round-trip harness in `packages/testkit` — open → save (same version) → reopen → `structuralDiff(a, b)` over acad-ts object graphs (handles, types, properties, xdata, dictionaries, owners), with the allowed-exception list from `TESTING.md`. **Acceptance:** harness runs on all M0-04 files and emits a per-file diff report (failures allowed at this stage, they are the spike's data).
- [x] (#6) **M0-06** acad-ts spike per `docs/SPIKE_M0_ACAD_TS.md`: read + write every corpus file, DXF and DWG, all versions; categorise failures (parse error, entity not mapped, property loss, writer error); patch the top 5 defects; produce `docs/reports/M0-acad-ts-spike.md` with the go/no-go recommendation and a list of required patches. **Acceptance:** report committed; `needs-human` issue opened with the recommendation.
- [ ] **M0-07** Owner-only: run AutoCAD `AUDIT`/`RECOVER` on the spike's written files and attach results to the needs-human issue (#7). (needs-human; threads skip.) *Deferred:* on 2026-11-01 the owner accepted the M0-06 findings without waiting for AUDIT; it is still owed before M2-13 (Save) ships.
- [x] **M0-GO** Owner checks this box to release M1+. (needs-human) Checked 2026-11-01: owner accepted the M0-06 CONDITIONAL GO (#7). M1 read-only work is released; M1-05 and M2-13 stay blocked on M1-27 to M1-30.

---

## M1 — Fidelity core (open any drawing and display it as AutoCAD would)

**Exit criteria:** every public-corpus file opens in the app, renders within tolerance of the AutoCAD reference, and round-trips with diff = 0. No editing yet.

### Document model and I/O
- [x] (#10) **M1-01** Document model per `ARCHITECTURE.md` §4: types, immutable update helpers, handle allocator above `$HANDSEED`, `ChangeSet`, EntityId map. **Acceptance:** unit tests for allocation, change-set application/inversion, id mapping.
- [x] (#11, #12, #13) **M1-02** Geometry kernel `engine/geom`: points/vectors, lines, arcs (CCW), circles, ellipses, polylines with bulges, NURBS splines (evaluate/flatten), bounds, transforms, intersections (all pairs incl. spline via flattening), closest-point, tangents, offsets, tolerance model from extents. **Acceptance:** property-based + table tests; ≥ 95 % branch coverage.
- [~] (thread: Map drawing tables and header) **M1-03** `AcadToTriya` mapping for tables (layers, linetypes, textstyles, dimstyles, mleaderstyles, tablestyles, appids, vports, views, ucs, blockrecords) and header vars. **Acceptance:** corpus tables compare equal to acad-ts values.
- [ ] **M1-04** `AcadToTriya` entities: LINE, XLINE, RAY, CIRCLE, ARC, ELLIPSE, POINT, LWPOLYLINE, POLYLINE(2D/3D-as-2D)+VERTEX, SPLINE, SOLID, TRACE, 3DFACE(as polyline), TEXT, MTEXT, ATTDEF, ATTRIB, INSERT (+MINSERT), DIMENSION (all subclasses), LEADER, MLEADER, HATCH, IMAGE, WIPEOUT, TABLE, VIEWPORT, TOLERANCE, MLINE, REGION(2D proxy graphics), PDFUNDERLAY/DWFUNDERLAY/DGNUNDERLAY, OLE2FRAME(bounds), PROXY_ENTITY(graphics). **Acceptance:** `FILE_FIDELITY.md` Read column ticked per type with a corpus file.
- [ ] **M1-05** Passthrough store and `TriyaToAcad` export starting from the retained original (`ARCHITECTURE.md` §6). **Acceptance:** round-trip diff = 0 on all corpus files (blocked-by M0-GO, M1-27, M1-28, M1-29, M1-30).
- [ ] **M1-06** I/O worker + Comlink RPC; progress events; cancellation; memory release after job. **Acceptance:** `bench-100k.dwg` parses without blocking main thread (Playwright measures input responsiveness during load).
- [ ] **M1-07** Spatial index (R-tree) per block record and per layout; incremental updates from `ChangeSet`. **Acceptance:** query 100k entities < 2 ms; invalidation tests.

### Text
- [ ] **M1-08** SHX parser + stroke interpreter (shapes, unifont; bigfont minimal), glyph cache; user font store in OPFS with "Add fonts" drop. **Acceptance:** renders all glyphs of a user-dropped `romans.shx` identically to the reference (owner-provided reference PNG, private corpus) and the bundled fonts in CI.
- [ ] **M1-09** Bundled open stroke fonts: convert Hershey + LibreCAD `.lff` to Triya font JSON; name map for common SHX names; attribution. **Acceptance:** text in corpus files with missing SHX renders with bundled fallback and the health panel lists the substitution.
- [ ] **M1-10** TTF pipeline via `opentype.js`: glyph paths, exact advance widths, style flags; system-font fallback in browser. **Acceptance:** width tests vs `opentype.js` reference.
- [ ] **M1-11** MTEXT formatting engine (full code set, columns, fields, `%%`, background mask), line breaking, justification. **Acceptance:** corpus MTEXT files render within tolerance; unit tests per code.

### Rendering
- [ ] **M1-12** `Renderer` interface + `Canvas2DRenderer` with scene cache, culling, LOD, transient layer, DPR handling, `RendererHost` main-thread fallback. **Acceptance:** interface tests; fallback renders identically (pixel test).
- [ ] **M1-13** Linetype engine (`.lin` parser incl. complex text/shape types; re-authored bundled set; LTSCALE/CELTSCALE/PSLTSCALE/MSLTSCALE), lineweight display, ACI/true-colour/colour-book resolution with ACI 7/0 rules, ByLayer/ByBlock, draw order. **Acceptance:** fidelity tests on linetype corpus files; colour-7 on light/dark canvas.
- [ ] **M1-14** Block rendering: nested inserts, scale/rotation/mirror, ByBlock resolution, attributes, `*U` dynamic blocks as static with badge metadata, MINSERT. **Acceptance:** block corpus files within tolerance.
- [ ] **M1-15** Dimension rendering from stored `*D` blocks (no engine yet) incl. annotative representations. **Acceptance:** dim corpus files within tolerance.
- [ ] **M1-16** Hatch rendering: `.pat` engine, bundled re-authored patterns, solid, gradient, user `.pat` drop, LOD thinning, hatch draw order. **Acceptance:** hatch corpus files within tolerance; ANSI31 at 1:1 pixel-matches reference.
- [ ] **M1-17** Table rendering from stored cell geometry. **Acceptance:** table corpus files within tolerance.
- [ ] **M1-18** Layouts and viewports rendering: paper, printable area, viewports with scale/clip/VP layer overrides, annotative scale selection per viewport, `CANNOSCALE` in model. **Acceptance:** layout corpus files within tolerance; multi-viewport annotative test.
- [ ] **M1-19** Images: PNG/JPEG/BMP/TIFF decode (TIFF via `utif`), clip, fade/contrast/transparency, frame. **Acceptance:** image corpus file within tolerance.
- [ ] **M1-20** PDF underlay via pdf.js (lazy): page render at viewport resolution, clip, fade; path extraction for osnap where available. **Acceptance:** underlay corpus file renders; page cached.
- [ ] **M1-21** Xref and reference resolution: "Missing references" panel, file/folder drop, cached handles (IndexedDB), silent re-resolve, nested xrefs, overlay/attach, XCLIP, `name|layer` layers. **Acceptance:** xref corpus set (parent + children) resolves and renders within tolerance.

### App shell (viewer-grade)
- [ ] **M1-22** Vite + React shell: open file (picker, drag-drop, file handler), document tabs, status bar, zoom/pan (wheel, middle-drag, Z/P transparent), ZOOM E/W/P/A/S/O, PAN, REGEN, VIEW save/restore; light chrome + dark canvas theme per `UI_SPEC.md`; OET home + Report issue buttons. **Acceptance:** Playwright opens corpus files via each route; pan/zoom perf ≥ 60 fps on `bench-ga.dwg`.
- [ ] **M1-23** Layers palette read-only + on/off/freeze/lock toggles with VP overrides display. **Acceptance:** toggles update canvas < 16 ms.
- [ ] **M1-24** Fidelity harness end-to-end in CI (headless render → PNG → perceptual diff vs reference; artifacts on failure; tolerance per file). **Acceptance:** CI job green across corpus.
- [ ] **M1-25** Drawing health report v1 (missing fonts/refs/patterns, unknown objects count, version, units). **Acceptance:** report content tests.
- [ ] **M1-26** Owner-only: add the self-authored corpus set from `TESTING.md` §2.1 (DWGs incl. `bench-ga.dwg`/`bench-100k.dwg`) and AutoCAD reference plots for them and for a chosen subset of the third-party files, with `corpus.json` entries. (needs-human; threads skip.) *Why:* M0-04 could only import third-party samples, which have no AutoCAD references, so M1-24 and every "within tolerance" acceptance has nothing to compare against until this lands; M1-06/M2-04 perf acceptance needs the bench files.
- [ ] **M1-27** Round-trip handle-coverage gate: every handle a corpus file declares (DWG handle map, DXF `5`/`105`) must be in the reopened document or on a documented allow-list (folded `VERTEX`/`SEQEND`, free DWG handles); generalise `packages/testkit/src/spike/read.ts` `handleCoverage` into the harness and ratchet it. **Acceptance:** the gate fails on today's acad-ts for files with unknown objects and passes once M1-30 lands. *Why:* M0-06 found 4,379 of 36,911 declared objects never reach the acad-ts graph, so `structuralDiff` cannot see them being dropped.
- [ ] **M1-28** acad-ts DXF writer gaps (spike report R1–R3, R5, R6, R8, R10, R21): `MATERIAL`, `VISUALSTYLE`, `TABLESTYLE`/`CELLSTYLEMAP` cell styles, `BLOCK_RECORD` flags and preview, `RASTERVARIABLES`, `DBCOLOR` entry names, xdata on every object, `$TDCREATE` precision, each as a patch with a failing-first test. **Acceptance:** those roots at 0 in `pnpm spike:roundtrip`; baseline ratcheted. *Why:* they account for most DXF differences in 60–83 corpus files.
- [ ] **M1-29** acad-ts writer entity detail (spike report R11–R15, R17–R20): `VIEWPORT` entity fields, `MULTILEADER` context data, `MTEXT` columns, `ACAD_TABLE` cell content, `SORTENTSTABLE` order, pre-R2004 DWG block entity lists, reactors, `ATTDEF` R2018 fields, `HATCH` pattern lines. **Acceptance:** those roots at 0; baseline ratcheted. *Why:* the remaining DWG and DXF differences after M1-28.
- [x] (#9) **M1-30** acad-ts keeps unknown objects raw (DXF group codes, DWG object bit stream with its handle references) and writes them back under their handles; also fix the two read-side defects in the spike report §2 (`PLOTSETTINGS` flags on DXF read, DWG `$CELWEIGHT` index). **Acceptance:** M1-27 gate green on every public file. *Why:* `ARCHITECTURE.md` §6.2 rule 1 assumes acad-ts retains unmapped objects; today it drops them, so passthrough is impossible for drawings with AEC, view styles, SUN or associativity objects. *Done:* acad-ts patches 0014–0020; all 1,329 unknown objects in the public corpus survive a save under their handles with unchanged payloads (`corpus-roundtrip.test.ts`), and declared handles lost by a save fell from 4,942 to 2,972. The literal acceptance (M1-27 gate green everywhere) is not met: the gate does not exist yet, and the remaining losses are mapped objects the writers do not write, moved to M1-31.
- [ ] **M1-31** Declared-handle residue after M1-30: DXF writer for `DIMASSOC` and `TABLECONTENT`/`TABLEGEOMETRY` (it skips them with a notification), `IMAGEDEF_REACTOR`, `BLOCK`/`ENDBLK` handles in nameless R12 integration files, pre-R2007 DWG `3DSOLID` history objects (`ACSH_*`), plus the `VISUALSTYLE`/`MATERIAL` DXF writer gap (M1-28) and their dictionaries. **Acceptance:** M1-27 gate green on every public file. *Why:* M1-30 keeps every unknown object, but these mapped or unreached objects still drop on save (2,972 declared handles), so the M1-27 gate cannot go green on M1-30 alone.

---

## M2 — Markup workflow end-to-end (open · red-line · save · print)

**Exit criteria:** an engineer can open a vendor DWG, add clouds/notes/leaders/dims, edit title-block attributes, save in place (round-trip clean), and print a CTB-correct PDF — entirely offline.

- [ ] **M2-01** Command engine: `PromptBus`, generator contract, parser (coordinates, keywords, direct distance, `FROM`/`M2P`, filters, expressions), alias table from `COMMANDS.md`, repeat/cancel/default/transparent, history, F2 window. **Acceptance:** scripted command tests; parser table tests.
- [ ] **M2-02** Command line UI + Dynamic Input (cursor prompt, numeric fields, Tab) + Ctrl+K palette. **Acceptance:** Playwright: `L ↵ 0,0 ↵ @100<45 ↵ ↵` draws the line; DYN fields accept input.
- [ ] **M2-03** Selection core: pick, window/crossing, implied windowing, Shift-remove, Ctrl+A, Previous/Last/All, selection highlight, `PICKFIRST` pre-selection. **Acceptance:** rule tests mirror AutoCAD semantics.
- [ ] **M2-04** Precision input v1: running osnaps (END/MID/CEN/INT/PER/TAN/NEA/NOD/QUA/INS/APP/EXT/PAR/GEOCEN), AutoSnap markers, Shift+right-click overrides, ORTHO, POLAR, OTRACK, GRID/SNAP, status-bar toggles, F-keys. **Acceptance:** osnap response < 50 ms on `bench-100k.dwg`; per-mode tests.
- [ ] **M2-05** Undo/redo infrastructure with command grouping, `OOPS`. **Acceptance:** 1000-step undo/redo property test.
- [ ] **M2-06** Core edit for markup: ERASE, MOVE, COPY, ROTATE, SCALE, MIRROR, STRETCH, standard grips (stretch/move/rotate/scale/mirror modes). **Acceptance:** command tests + Playwright grip tests.
- [ ] **M2-07** TEXT/MTEXT creation and in-place MTEXT editor (formatting toolbar, stacking, fields). **Acceptance:** editor produces MTEXT codes that round-trip through acad-ts.
- [ ] **M2-08** REVCLOUD (rect/poly/freehand, arc length, style), WIPEOUT, DRAWORDER/TEXTTOFRONT/HATCHTOBACK. **Acceptance:** entity output matches AutoCAD structure (polyline with bulges / WIPEOUT).
- [ ] **M2-09** MLEADER with styles (read existing styles; create with current style), add/remove leader, text/block content. **Acceptance:** MLEADER written is opened by acad-ts and renders identically.
- [ ] **M2-10** Dimension engine v1 (`packages/dims`): linear/aligned/radius/diameter/angular with the full DIMVAR set for text/arrows/extension/units; stored-block policy (regenerate on touch) with health comparison. **Acceptance:** regenerated dims of corpus files match stored blocks within tolerance for ≥ 95 % of dims; failures listed.
- [ ] **M2-11** DIMLINEAR/DIMALIGNED/DIMRADIUS/DIMDIAMETER/DIMANGULAR/DIMCONTINUE/DIMBASELINE commands with DIMASSOC=1 grips. **Acceptance:** command + grip tests.
- [ ] **M2-12** Attribute editing: EATTEDIT dialog, ATTEDIT, double-click; multiline attributes. **Acceptance:** title-block revision-table scenario test.
- [ ] **M2-13** Save/Save As (DWG/DXF, version picker, in-place via File System Access, download fallback), dirty state, close prompts. **Acceptance:** round-trip diff = 0 after a markup session on every corpus file (edited entities excluded from diff by handle list) (blocked-by M1-05 and M0-07; M0-06 CONDITIONAL GO).
- [ ] **M2-14** Autosave to OPFS and recovery flow; recent files; multi-document copy/paste (CLIPBOARD with handles remapped). **Acceptance:** kill-tab recovery Playwright test; cross-doc paste test.
- [ ] **M2-15** CTB/STB parser (+ bundled open equivalents) and `PlotResolver`. **Acceptance:** resolver table tests vs documented CTB semantics.
- [ ] **M2-16** Vector PDF writer: pages, paths, lineweights, screening, colour/monochrome, stroke-font paths, TTF subset embedding, bookmarks, page labels. **Acceptance:** PDF validated with `pdfcpu`/`qpdf` in CI; visual diff vs reference plot.
- [ ] **M2-17** PLOT dialog (layout/model, area, paper, scale/fit, offset, orientation, plot style, options, preview) and PUBLISH multi-layout. **Acceptance:** Playwright generates A1 CTB PDF < 2 s; Acrobat/PDF-XChange verification checklist in PR (owner confirms once).
- [ ] **M2-18** Plot-preview canvas mode and SVG/PNG export. **Acceptance:** preview pixel-matches PDF rasterised; SVG opens in Inkscape with layers.
- [ ] **M2-19** PWA: manifest, service worker precache/lazy, "Ready offline", update prompt, `.dwg/.dxf` file handler, install prompt; offline CI test. **Acceptance:** T8 passes; Lighthouse PWA installable.
- [ ] **M2-20** Settings: theme, canvas colours, units display, osnap settings, "Clear all local data", user font/pattern/CTB/linetype/template stores UI. **Acceptance:** clear-data test leaves OPFS/IDB empty.
- [ ] **M2-21** Properties palette v1 (read/edit common + per-type properties). **Acceptance:** edits produce correct change-sets; undoable.

---

## M3 — Full drafting command set and precision

**Exit criteria:** every tier-1 and tier-2 Draw/Modify/Selection/Inquiry command in `COMMANDS.md` is done with tests; full grips; full selection; full precision input.

- [ ] **M3-01** LINE (all options), PLINE (arc/width/halfwidth/close/undo/length), CIRCLE (2P/3P/TTR/TTT), ARC (all 11 methods incl. continue), RECTANG (C/E/F/T/W/A/D/R), POLYGON, ELLIPSE (+arc), XLINE/RAY (all), POINT + PDMODE/PDSIZE, DONUT, SPLINE (fit/CV, knots), DIVIDE/MEASURE (+block). **Acceptance:** per-command scripted tests.
- [ ] **M3-02** OFFSET (through/distance/erase/layer/multiple, polylines, splines, ellipses; on top of the M1-02 kernel `offset`, this task adds removal of the self-intersecting loops an inward polyline offset can make, and fits a SPLINE through the sampled ellipse/spline offset as AutoCAD returns), TRIM/EXTEND (fence/crossing/edge/projection, Shift toggle, implied boundary), FILLET/CHAMFER (radius/trim/multiple/polyline/undo), BREAK/BREAKATPOINT, JOIN, EXPLODE, LENGTHEN, ALIGN, REVERSE, PEDIT (all), SPLINEDIT, OVERKILL, CHANGE/CHPROP, MATCHPROP (settings dialog). **Acceptance:** per-command tests incl. tolerance-sensitive cases on inch drawings.
- [ ] **M3-03** ARRAY (rectangular/polar/path; associative array objects preserved from file; ARRAYEDIT basic), COPY array mode. **Acceptance:** output structure tests.
- [ ] **M3-04** Selection complete: fence, WPolygon, CPolygon, lasso (direction), selection cycling (Ctrl+W, list), QSELECT, FILTER, SELECTSIMILAR, `PICKBOX`/`PICKADD`/`PICKAUTO` sysvars. **Acceptance:** rule tests.
- [ ] **M3-05** Multi-functional grips (polyline vertex add/remove/convert, arc radius, dimension text/arrow, hatch origin, table resize, viewport), Ctrl-cycling, grip copy. **Acceptance:** Playwright grip matrix.
- [ ] **M3-06** Precision complete: `FROM`, `M2P`, `TK`, point filters, temporary overrides, POLAR additional angles/relative, OTRACK settings, aperture/marker settings (DRAFTINGSETTINGS dialog), snap/grid dialog. **Acceptance:** per-mode tests.
- [ ] **M3-07** Inquiry: DIST, ID, LIST, AREA (add/subtract), MEASUREGEOM (quick mode), units formatting (`LUNITS`/`LUPREC`/`AUNITS`/`AUPREC`). **Acceptance:** output text tests.
- [ ] **M3-08** GROUP/UNGROUP, group selection toggle, named groups panel. **Acceptance:** group selection tests.
- [ ] **M3-09** UNITS dialog + insertion scale behaviour (`INSUNITS` ratio, unitless prompt). **Acceptance:** insert scale tests.
- [ ] **M3-10** Keyboard map (AutoCAD defaults) + remapping UI; user alias file (pgp syntax) editor. **Acceptance:** alias override test.

---

## M4 — Annotation at AutoCAD depth

**Exit criteria:** DIMSTYLE/TEXTSTYLE/MLEADERSTYLE/TABLESTYLE managers at parity; all dimension commands; hatch creation; tables editing; centerlines.

- [ ] **M4-01** Dimension engine complete: ordinate, arc length, jogged, jog line, tolerances/limits, alternate units, `DIMTMOVE`/`DIMATFIT`/`DIMTIX`/`DIMSOXD`, user arrow blocks, `DIMTXSTY`, text override, annotative scale. **Acceptance:** regenerated vs stored match ≥ 99 % on corpus dims.
- [ ] **M4-02** DIMORDINATE, DIMARC, DIMJOGGED, DIMJOGLINE, QDIM, DIMSPACE, DIMBREAK, DIMEDIT, DIMTEDIT, DIMOVERRIDE, DIMREASSOCIATE (defpoint re-pick), DIMINSPECT. **Acceptance:** command tests.
- [ ] **M4-03** DIMSTYLE manager dialog (all tabs: Lines, Symbols & Arrows, Text, Fit, Primary/Alternate Units, Tolerances), compare, override, set current, import from file. **Acceptance:** every DIMVAR round-trips through dialog.
- [ ] **M4-04** TEXTSTYLE manager; MLEADERSTYLE manager (leader/structure/content tabs); MLEADERALIGN/COLLECT/EDIT. **Acceptance:** style round-trip tests.
- [ ] **M4-05** TABLE command + TABLESTYLE manager; cell editing (double-click, Tab/arrow navigation), insert/delete rows/cols, merge, borders/alignment/text height, whole-table SCALE, table text-height rescale, grips. **Acceptance:** nozzle-schedule scenario test; round-trip through acad-ts.
- [ ] **M4-06** CSV/clipboard paste into table (Should). **Acceptance:** paste test.
- [ ] **M4-07** HATCH command: contextual ribbon tab + dialog, pick-point boundary detection with islands and gap tolerance, select objects mode, pattern/solid/gradient, scale/angle/origin, annotative scale, HATCHEDIT, `HPDRAWORDER`, `HPSEPARATE`. **Acceptance:** boundary detection test suite (nested islands, gaps, arcs, splines); output HATCH loops typed correctly.
- [ ] **M4-08** CENTERMARK/CENTERLINE (associative to picked objects; `CENTEREXE` etc. sysvars). **Acceptance:** association updates on move.
- [ ] **M4-09** FIND/REPLACE (incl. attributes, dims, tables), TEXTEDIT, SPELL (browser API), TEXTALIGN, SCALETEXT, JUSTIFYTEXT. **Acceptance:** find/replace scenario tests.
- [ ] **M4-10** Fields: date/time, filename, plot scale/date, layout name, object properties; FIELD dialog; update on plot/save. **Acceptance:** field evaluation tests.
- [ ] **M4-11** TOLERANCE (GD&T frame) dialog and entity. **Acceptance:** renders like reference.

---

## M5 — Blocks, references and layers at depth

**Exit criteria:** block authoring, attribute management, xref/image management, layer manager with states/filters/VP overrides, linetype loading, purge, templates.

- [ ] **M5-01** BLOCK/-BLOCK/WBLOCK dialogs, INSERT dialog (file/drawing block list, scale/rotation/explode/repeat, unit scaling), base point, nested insert. **Acceptance:** block scenario tests.
- [ ] **M5-02** BEDIT block editor (in-place edit of definition with attribute defs), REFEDIT/REFCLOSE for blocks and xrefs (xref as save-to-file), ATTSYNC. **Acceptance:** redefinition propagates to all inserts; round-trip clean.
- [ ] **M5-03** ATTDEF dialog, BATTMAN, ATTDISP, attribute flags; EATTEDIT complete. **Acceptance:** attribute matrix tests.
- [ ] **M5-04** XREF manager palette: attach/overlay/detach/reload/unload/bind (bind/insert), path display, nested tree, XCLIP command, image attach (IMAGEATTACH, IMAGECLIP, IMAGEADJUST, IMAGEFRAME), PDF underlay attach (PDFATTACH, scale calibration, clip). **Acceptance:** bind produces self-contained DWG that round-trips; owner AUDIT check.
- [ ] **M5-05** Layer Properties Manager complete: inline edit, multi-select, search, columns, VP freeze/overrides, transparency, plot, description, new/delete/merge, current. **Acceptance:** Playwright on 200-layer corpus file; performance < 100 ms filter.
- [ ] **M5-06** Layer tool row commands (LAYISO w/ fade, LAYUNISO, LAYOFF/ON, LAYFRZ/THW, LAYLCK/ULK, LAYMCUR, LAYMCH, LAYWALK, LAYERP, LAYDEL, LAYMRG, LAYCUR). **Acceptance:** command tests.
- [ ] **M5-07** Layer states (save/restore/edit/export/import `.las`) and filters (property/group/invert) stored in AutoCAD dictionaries. **Acceptance:** round-trip of states/filters through acad-ts.
- [ ] **M5-08** LINETYPE dialog + loader (user `.lin` drop, bundled set), LWEIGHT dialog, `LTSCALE` commands. **Acceptance:** complex linetype load test.
- [ ] **M5-09** PURGE (all categories, nested, zero-length, empty text, orphaned data), AUDIT-lite fixes in health panel. **Acceptance:** purge results equal AutoCAD's on corpus file (owner-verified once).
- [ ] **M5-10** Templates: bundled Triya ISO (mm) and ANSI (inch) `.dwt` authored per `UI_SPEC.md` §9 (layers, styles, A4–A0 layouts, title block with attributes); New dialog; user templates folder; default template one-click. **Acceptance:** templates open in acad-ts and AutoCAD (owner check).
- [ ] **M5-11** Design-Center-lite palette (Should): browse blocks/layers/styles of open docs or dropped files, drag to insert/copy. **Acceptance:** cross-doc insert test.

---

## M6 — Layouts and plotting at depth

**Exit criteria:** page setup manager, full viewport tooling, annotative viewing parity, plot options parity.

- [ ] **M6-01** LAYOUT commands (new/copy/delete/rename/reorder/template), PAGESETUP manager (named setups, import), per-layout settings persisted in `PLOTSETTINGS`. **Acceptance:** round-trip of page setups.
- [ ] **M6-02** VPORTS/MVIEW (rectangular, polygonal, object), VPCLIP, VPMAX/VPMIN, viewport scale list (SCALELISTEDIT), lock, on/off, MSPACE/PSPACE, double-click activate, VP layer overrides UI, `VPLAYER`. **Acceptance:** viewport scenario tests; layout corpus fidelity unchanged.
- [ ] **M6-03** Annotation scale UI: current scale display/selector, `ANNOALLVISIBLE`/`ANNOAUTOSCALE` display behaviours (view only), representation picking per viewport. **Acceptance:** annotative corpus tests.
- [ ] **M6-04** Plot options parity: plot transparency, plot with plot styles, plot object lineweights, plot upside-down, plot stamp (off; non-goal), scale lineweights, paper-space last, hide paper-space objects, plot area window/view/limits, custom paper sizes, plot offset centre. **Acceptance:** option matrix PDF tests.
- [ ] **M6-05** PUBLISH dialog: sheet list, ordering, include/exclude, bookmarks, single/multi file, page labels. **Acceptance:** multi-layout PDF structure test.

---

## M7 — UI completion and polish

**Exit criteria:** `UI_SPEC.md` fully implemented; T9 passes; all dialogs listed in PRD FR-U7 exist; theme/keyboard/settings complete; a11y baseline.

- [ ] **M7-01** Ribbon data model + responsive layout algorithm (labelled 3-row at ≥1920, collapse rules, Home Draw/Modify/Annotate never overflow). **Acceptance:** T9 Playwright at 1280/1366/1600/1920/2560.
- [ ] **M7-02** All tabs/panels per `UI_SPEC.md` with Fluent icons, tooltips with command names/aliases/F-keys, hover/press animations, contextual tabs (Hatch, MText, Table, Block Editor, Xref). **Acceptance:** snapshot tests per breakpoint.
- [ ] **M7-03** Dockable palette stack: Properties, Layers, Blocks/Library, References, Constraints, Compare, Health, Command history; docking/floating/auto-hide; slide-over < 1366. **Acceptance:** layout persistence test.
- [ ] **M7-04** Dialog parity set: OPTIONS (display/open-save/plot/user prefs/drafting/selection), DRAFTINGSETTINGS, all style managers, INSERT, BLOCK, XREF, LINETYPE, UNITS, PAGESETUP, PLOT, PUBLISH. **Acceptance:** each dialog has a Playwright smoke test.
- [ ] **M7-05** Themes (light/dark chrome, canvas colours, plot preview), high-contrast mode; reduced-motion respect. **Acceptance:** theme snapshot tests.
- [ ] **M7-06** Keyboard: full AutoCAD default map, Ctrl+K palette polish, F2 history window, shortcut editor. **Acceptance:** keymap tests.
- [ ] **M7-07** Start screen: recent, templates, open, open PDF (red-line flow), samples from public corpus, learn links. **Acceptance:** smoke test.
- [ ] **M7-08** Error-report flow (opt-in, reviewed, Cloudflare Worker → GitHub issue), diagnostics panel. **Acceptance:** report payload never contains drawing content (test).
- [ ] **M7-09** Firefox/Safari degraded-mode paths and first-run notice. **Acceptance:** Playwright on WebKit/Firefox: open, edit, download-save, PDF.
- [ ] **M7-10** Accessibility baseline: focus order, ARIA on ribbon/palettes/dialogs, keyboard-only operation of every dialog. **Acceptance:** axe checks zero critical.

---

## M8 — Differentiators

**Exit criteria:** FR-Z1–Z4 complete with tests.

- [ ] **M8-01** Library data: ASME B16.5 (NPS ½–24, all classes, WN/SO/BL/LJ/SW/TH; dimensions tables with source citation) and B16.47 A/B; generators produce 2D blocks (front/side/section) at drawing units. **Acceptance:** dimension tables unit-tested against published values (owner validates a sample).
- [ ] **M8-02** Library: nozzle details (set-in/set-on, pad), saddle/leg/bracket/skirt/anchor-chair outlines with editable principal dims, weld symbols (AWS A2.4 / ISO 2553 builder), surface finish, standard notes. **Acceptance:** each generator snapshot-tested.
- [ ] **M8-03** Library palette: search, preview, units-aware insert, favourites, user library folders (OPFS) with drop. **Acceptance:** insert scenario tests.
- [ ] **M8-04** PDF red-line flow: open PDF from start screen → underlay on a new sheet → two-pick calibration → markup → plot with underlay. **Acceptance:** end-to-end Playwright.
- [ ] **M8-05** Compare engine: normalised geometry + handle diff; added/removed/modified classification; tolerance settings. **Acceptance:** diff tests on revised corpus pairs.
- [ ] **M8-06** Compare UI: overlay colours, results list with zoom-to, filters by layer/type, export marked-up DWG/PDF. **Acceptance:** Playwright scenario.
- [ ] **M8-07** Health report complete: unused layers/blocks/styles, empty text, zero-length, duplicates (OVERKILL candidates), non-standard dim styles, missing refs/fonts/patterns, units/scale sanity, version, dynamic blocks present, constraints present; one-click fixes. **Acceptance:** report + fix tests.

---

## M9 — Parametric constraints

**Exit criteria:** FR-X complete; geometric + dimensional constraints with solver, UI, storage, and modify-command interaction.

- [ ] **M9-01** PlaneGCS WASM build (Emscripten, pinned commit, LGPL notices, CI build cache, lazy load). **Acceptance:** solve a 50-constraint sketch in < 20 ms in Node and browser.
- [ ] **M9-02** `ConstraintModel`: entity ↔ GCS primitive mapping, geometric constraints (all 12), solve on edit, DOF, conflict/redundancy reporting. **Acceptance:** solver scenario tests incl. over-constrained detection.
- [ ] **M9-03** Dimensional constraints with expressions and Parameters Manager; dynamic vs annotational display. **Acceptance:** expression evaluation tests.
- [ ] **M9-04** Constraint storage (`TRIYA_CONSTRAINTS` dictionary) and round-trip; AutoCAD ignores it (owner AUDIT check). **Acceptance:** round-trip diff = 0 with constraints present.
- [ ] **M9-05** UI: Parametric ribbon tab, constraint bars, infer toggle, CONSTRAINTSETTINGS, show/hide, delete. **Acceptance:** Playwright.
- [ ] **M9-06** Modify-command interaction per FR-X4 (`ConstraintAwareness` hook). **Acceptance:** per-command tests.

---

## M10 — Hardening and release

**Exit criteria:** all PRD §11 success criteria and §12 targets pass; drafter sessions done; docs complete; v1.0.0 tagged.

- [ ] **M10-01** Performance pass to T1–T3, T5–T7 on `bench-*.dwg`; memory leak check; decide WebGL trigger if needed (needs-human if triggered). **Acceptance:** perf CI job green with margins recorded.
- [ ] **M10-02** Fidelity sweep: T4 on public corpus; private corpus run by owner; AUDIT sweep by owner (needs-human). **Acceptance:** report in `docs/reports/`.
- [ ] **M10-03** Drafter test sessions script (2 h drafting, 30 min markup) and issue triage (needs-human). **Acceptance:** zero blocking findings open.
- [ ] **M10-04** User docs: in-app help, command reference generated from `COMMANDS.md`, keyboard card, "Coming from AutoCAD" guide, privacy page. **Acceptance:** docs build in site.
- [ ] **M10-05** Security/privacy review: CSP, no third-party scripts, SRI, offline test, data-clear test; license audit (`ATTRIBUTION.md` complete). **Acceptance:** checklist in PR.
- [ ] **M10-06** Release: changelog, version, tag, Pages production deploy, OET site tile and links, GitHub release notes. **Acceptance:** `v1.0.0` live at `triya-cad-2d.openengtools.com`.

---

## Post-v1 (not scheduled; do not start)

- Smart title-block/revision workflow · Local MCP server · Associative hatch · DIMASSOC=2 · Annotative creation · Table formulas · Dynamic block evaluation · Geometric-constraint UX refinements · WebGL renderer (only if triggered).
