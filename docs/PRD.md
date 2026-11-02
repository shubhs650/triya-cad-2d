# Triya CAD 2D — Product Requirements Document

**Status:** Accepted v1.0 (2026-11-01) · **Owner:** Shubham (shubhs650) · **Product:** Open Engineering Tools (OET)
**URL:** https://triya-cad-2d.openengtools.com · **Repo:** github.com/shubhs650/triya-cad-2d · **License:** MIT

This document is the source of truth for *what* Triya CAD 2D is and is not. `ARCHITECTURE.md` says *how*. `DECISIONS.md` records *why*. `ROADMAP.md` says *in what order*. When documents conflict, this PRD wins on scope, `DECISIONS.md` wins on rationale.

---

## 1. One-paragraph summary

Triya CAD 2D is a free, open-source, installable web app (PWA) that gives engineers an AutoCAD-grade 2D drafting environment that runs entirely in the browser — no login, no cookies, no server-side processing, fully offline-capable. It opens real-world DWG/DXF files faithfully (model + paper space, blocks, dimensions, tables, hatches, SHX fonts, xrefs), lets an experienced AutoCAD drafter work with their existing muscle memory (full command line with aliases, dynamic input, osnaps, grips, layers at AutoCAD depth), and prints vector PDFs with CTB plot styles. It is purpose-built for pressure-vessel and general mechanical drawings, with a parametric constraint solver and a pressure-vessel symbol library as differentiators.

## 2. Problem

- Engineers in EPC/mechanical practice constantly receive vendor DWGs and need to red-line, correct, or re-issue them. Doing so requires an AutoCAD seat (expensive), a DWG viewer (read-only), or uploading confidential drawings to an online converter (unacceptable).
- Students and independent engineers have no free 2D CAD that respects AutoCAD conventions; free alternatives either break on real files or have alien UIs.
- Existing browser CAD tools are either viewers, toys, or cloud services that require accounts and upload files.

## 3. Goals

| # | Goal | Measure |
|---|------|---------|
| G1 | Open any real-world DWG/DXF (R12–R2018) and display it as AutoCAD would | ≥99 % entity pixel-match on the public fidelity corpus; 100 % of private corpus opens without error |
| G2 | An experienced AutoCAD drafter can work for a full session without hitting a "major missing feature" | Command coverage in `COMMANDS.md` at 100 % "done" for tier-1 and tier-2 |
| G3 | What the user doesn't touch is never damaged | Round-trip structural diff = 0; AutoCAD `AUDIT` reports 0 errors on every Triya-saved file |
| G4 | Prints are deliverable-quality | Vector PDF with CTB lineweights verified in Acrobat and PDF-XChange |
| G5 | Native-app feel | Acceptance targets in §12 all pass |
| G6 | Privacy is absolute | Zero network requests after app load except user-initiated error reports; auditable "Clear all local data" |

## 4. Non-goals (explicitly out of scope for v1 "complete")

1. Any 3D: solids, surfaces, 3D views, Base/Projected/Section/Detail view generation from models.
2. Dynamic block evaluation or authoring (render current state + preserve only).
3. Annotative object *creation* (view-faithful rendering + preserve only).
4. Table formulas, Extract Data, Link Data.
5. Associative hatches and fully associative dimensions (DIMASSOC=2). Model leaves room; deferred.
6. Reading AutoCAD's own constraints (`AcDbAssoc*`); Triya constraints are Triya-only.
7. Isometric snap.
8. Sheet Set Manager, plot stamps, DWF/DWFx.
9. LISP/VBA/.NET scripting, Express Tools, CUI customisation (beyond alias file and keyboard shortcuts).
10. Collaboration, sync, cloud storage, accounts — reserved for the commercial Triya Labs fork.
11. Touch/tablet UI, mobile.
12. Raster-to-vector, OCR of PDF underlays.
13. Rendering/visual styles, materials, lights.
14. Mac/Linux-specific native integrations beyond the PWA.
15. Local MCP server and smart revision workflow — post-v1 roadmap.

Anything on this list that appears in a plan, issue, or PR is a defect in the plan.

## 5. Users and primary workflow

**Primary persona — the reviewer/marker-up:** a mechanical/static-equipment engineer who receives a vendor GA drawing (DWG, sometimes PDF), opens it privately, adds revision clouds, notes, corrected dimensions, edits the title-block revision table, and prints a PDF to return. Sessions are short; fidelity of what is opened matters most.

**Secondary persona — the drafter:** an experienced AutoCAD user producing vessel GAs, nozzle details, saddle/leg/skirt details and simple machine parts from scratch, who expects AutoCAD's command grammar, osnaps, layers, dim styles and layouts to just work.

**Tertiary — students/independents** with no company standard, served by bundled templates and the symbol library.

**Priority rule:** when a trade-off arises, the markup workflow wins over the from-scratch workflow.

## 6. Functional requirements

Each requirement has an ID for traceability from `ROADMAP.md` milestones and tests. "Must" = required for v1 complete.

### 6.1 File I/O (FR-F)

- **FR-F1** Open DWG (AC1009–AC1032) and DXF (ASCII + binary, all versions) via acad-ts in a Web Worker. Must.
- **FR-F2** Save DWG and DXF in the version the file was opened in by default; Save As to any supported version. Must.
- **FR-F3** Opaque passthrough: every object not mapped to Triya's model (xdata, xrecords, extension dictionaries, proxies, dynamic-block definitions, unknown entities, constraint objects, custom classes) is retained verbatim and written back unchanged. Must.
- **FR-F4** In-place save via File System Access API (Chromium); download fallback elsewhere. Must.
- **FR-F5** Silent crash-recovery autosave to OPFS ≤5 s after the last edit, never to the original file; "Recover unsaved drawing?" on next launch. Must.
- **FR-F6** Recent drawings list (cached file handles). Multi-document tabs with cross-document copy/paste. Must.
- **FR-F7** Export SVG, PNG (with DPI/scale/background options). Must.
- **FR-F8** New from template: bundled "Triya ISO (mm)" and "Triya ANSI (inch)"; user templates folder (.dwt/.dwg); user default template opens on one click. Must.
- **FR-F9** Units: honour `$INSUNITS`, `$MEASUREMENT`, `$LUNITS`, `$AUNITS`; never silently rescale; block/xref insert scales by unit ratio with prompt when unitless. Must.
- **FR-F10** PWA registered as `.dwg`/`.dxf` file handler; installable; fully offline after first load. Must.
- **FR-F11** "Clear all local data" in settings, removing OPFS, IndexedDB, caches. Must.

### 6.2 Spaces, layouts, viewports (FR-L)

- **FR-L1** Model space and unlimited paper-space layouts with tabs (new, rename, copy, delete, reorder). Must.
- **FR-L2** Page setup per layout: paper size (ISO A0–A4, ANSI A–E, custom), orientation, plot area, plot scale, plot offset, plot style table, lineweight scaling. Must.
- **FR-L3** Viewports: rectangular and polygonal; per-viewport scale (standard scale list + custom), lock, on/off, display lock; `MSPACE`/`PSPACE` toggle by double-click; per-viewport layer freeze and colour/linetype/lineweight overrides. Must.
- **FR-L4** `PSLTSCALE`/`MSLTSCALE` behaviour for linetypes. Must.

### 6.3 Drawing & editing commands (FR-D)

Full list with aliases and tiers in `COMMANDS.md`. Summary:

- **FR-D1 Draw:** LINE, PLINE (arcs, widths, halfwidth, close), CIRCLE (all modes incl. TTR, 3P), ARC (all modes), RECTANG (chamfer/fillet/rotation/dimensions), POLYGON, ELLIPSE (+ arc), SPLINE (fit/CV), XLINE, RAY, POINT (+ PDMODE/PDSIZE), DONUT, REGION (2D boundary), BOUNDARY, HATCH, GRADIENT, WIPEOUT, REVCLOUD (rectangular/polygonal/freehand, calligraphy), DIVIDE, MEASURE. Must.
- **FR-D2 Modify:** MOVE, COPY (+ array mode), ROTATE (+ copy/reference), SCALE (+ reference), STRETCH, MIRROR (+ MIRRTEXT), OFFSET (through/distance/erase/layer), TRIM, EXTEND (incl. Shift-toggle and fence/crossing), FILLET (+ polyline/multiple/trim modes), CHAMFER, BREAK, BREAKATPOINT, JOIN, EXPLODE, ARRAY (rectangular/polar/path, associative array objects preserved from files), ALIGN, LENGTHEN, PEDIT, SPLINEDIT, REVERSE, OVERKILL, ERASE, OOPS, UNDO/REDO (unlimited, with command-level grouping), MATCHPROP (with settings), CHANGE/CHPROP. Must.
- **FR-D3 Selection:** window, crossing, fence, WPolygon, CPolygon, lasso (free, window/crossing by direction), selection cycling (Ctrl+W), Shift-remove, Ctrl+A, Previous, Last, All, QSELECT, FILTER, SELECTSIMILAR, implied windowing, noun-verb with pre-selection, selection preview highlighting, `PICKBOX`/`PICKADD`/`PICKFIRST` behaviours. Must.
- **FR-D4 Grips:** standard grips with stretch/move/rotate/scale/mirror modes (Space/Enter cycling, Ctrl-copy); multi-functional grips on polylines (add/remove vertex, convert to arc), arcs, dimensions (text move, flip arrow), hatches (origin), tables (row/column resize), viewports. Must.
- **FR-D5 Precision input:** running osnaps (END, MID, CEN, GEOCEN, NOD, QUA, INT, EXT, INS, PER, TAN, NEA, APP, PAR), one-shot overrides (Shift+right-click menu, typed, `FROM`, `M2P`/`MTP`, point filters `.X .Y`), AutoSnap markers/magnet/tooltips, ORTHO, POLAR (increments + additional angles, relative/absolute), OTRACK (acquired points, tracking tooltips), GRID/SNAP (rectangular; isometric excluded), temporary overrides (Shift, F-keys). Must.
- **FR-D6 Inquiry:** DIST, ID, LIST, AREA, MEASUREGEOM (distance/radius/angle/area/volume-2D), PROPERTIES palette with full per-entity editing. Must.
- **FR-D7 Groups:** GROUP/UNGROUP, named/unnamed, selectable toggle (Ctrl+Shift+A), group edit. Must.

### 6.4 Annotation (FR-A)

- **FR-A1 Text:** TEXT/DTEXT, MTEXT with in-place editor (fonts, height, colour, bold/italic/underline, stacking, columns, paragraph alignment, line spacing, fields: date, filename, plot scale, layout name), text styles (SHX and TTF), FIND/REPLACE, SPELL (browser), TEXTEDIT, text justification modes. Must.
- **FR-A2 Dimensions:** DIMLINEAR, DIMALIGNED, DIMANGULAR, DIMRADIUS, DIMDIAMETER, DIMARC, DIMORDINATE, DIMJOGGED, DIMJOGLINE, DIMBASELINE, DIMCONTINUE, QDIM, DIMSPACE, DIMBREAK, DIMEDIT, DIMTEDIT, DIMOVERRIDE, DIMREASSOCIATE (defpoint re-pick), DIMINSPECT, text override with `<>`, tolerances, alternate units, DIMSTYLE manager at AutoCAD depth (all DIMVARS, compare, override, import from file). Imported dims render from stored block until edited, then regenerate (see DEC-011). DIMASSOC=1 semantics. Must.
- **FR-A3 Leaders:** MLEADER with styles (block/text/none content, spline/straight, dogleg, landing, attachment), MLEADERALIGN, MLEADERCOLLECT, MLEADEREDIT (add/remove leader), legacy LEADER/QLEADER read + edit. Must.
- **FR-A4 Centerlines:** CENTERMARK, CENTERLINE (associative to the picked lines/circles). Must.
- **FR-A5 Tables:** render all imported ACAD_TABLE; in-place cell editing; insert/delete rows/columns; merge/unmerge; borders/alignment; TABLE command from table style; TABLESTYLE manager (title/header/data); whole-table SCALE; table text-height rescale; grip resize of rows/columns; CSV/clipboard paste into table (fast-follow). Must (except CSV: Should).
- **FR-A6 Annotative:** render annotative objects at the correct representation per viewport and at `CANNOSCALE` in model space; preserve all representations. No creation. Must.
- **FR-A7 Hatch:** `acad.pat`-syntax pattern engine; bundled re-authored ANSI/ISO/other patterns; user `.pat` drop; pick-internal-point boundary detection with islands (normal/outer/ignore) and gap tolerance; associative hatch off at launch; gradient fills; hatch origin/angle/scale/annotative-scale; HATCHEDIT; hatch draw order (`HPDRAWORDER`). Must.
- **FR-A8 Markup:** REVCLOUD, WIPEOUT, drawing-order commands (DRAWORDER, TEXTTOFRONT, HATCHTOBACK). Must.

### 6.5 Blocks and references (FR-B)

- **FR-B1** INSERT (scale/rotation/explode/repeat, from file or drawing), BLOCK/-BLOCK, WBLOCK, BEDIT (Block Editor: in-place edit of definition, redefines inserts), REFEDIT/REFCLOSE, EXPLODE, nested blocks, `BYBLOCK` resolution. Must.
- **FR-B2** Attributes: ATTDEF, ATTEDIT, EATTEDIT (dialog), ATTSYNC, BATTMAN (manage), ATTDISP, constant/invisible/verify/preset/lock-position/multiline attribute flags. Must.
- **FR-B3** Dynamic blocks: render the stored current-state block; grips inert; badge "Dynamic — edit in AutoCAD"; preserve. Must.
- **FR-B4** Xrefs: "Missing references" panel; attach via file or folder drop; cached handles for silent resolve; overlay/attach semantics; nested xrefs; XCLIP; xref layer naming `name|layer`; read-only; BIND (bind/insert); DETACH/RELOAD/UNLOAD. Must.
- **FR-B5** Raster images: attach, scale, clip, fade/contrast, transparency, frame; PNG/JPEG/BMP/TIFF (via decoder). Must.
- **FR-B6** PDF underlay: attach page, scale calibration, clip, fade, osnap to underlay vectors (where pdf.js exposes paths). Must.
- **FR-B7** Design Center-lite: browse blocks/layers/dimstyles/textstyles of any open drawing or dropped file and drag into current. Should.

### 6.6 Layers and properties (FR-Y)

- **FR-Y1** Layer Properties Manager (dockable, searchable, inline-edit, multi-select apply): name, on/off, freeze, lock, colour (ACI/true/book), linetype, lineweight, transparency, plot style, plot/no-plot, VP freeze, VP overrides, description. Must.
- **FR-Y2** Layer tool row: LAYISO/LAYUNISO (with locked-fade), LAYOFF/LAYON, LAYFRZ/LAYTHW, LAYLCK/LAYULK, LAYMCUR, LAYMCH, LAYWALK, LAYERP, LAYDEL, LAYMRG, LAYCUR. Must.
- **FR-Y3** Layer states (save/restore/edit/export/import `.las`) and layer filters (property, group, invert). Must.
- **FR-Y4** Linetypes: `acad.lin` syntax incl. complex (text/shape) linetypes; bundled re-authored set; user `.lin` drop; LTSCALE/CELTSCALE/PSLTSCALE/MSLTSCALE. Must.
- **FR-Y5** Lineweights: display toggle (LWT), scale, defaults; LWDEFAULT. Must.
- **FR-Y6** Properties: ByLayer/ByBlock/explicit colour, linetype, lineweight, transparency, plot style; MATCHPROP; PURGE (all categories, nested, zero-length, empty text); AUDIT-lite (health report). Must.

### 6.7 Command line and input (FR-C)

- **FR-C1** AutoCAD command grammar: full standard `acad.pgp` alias set; option keywords `[Undo/Close]` with capital-letter shortcuts; coordinate entry (absolute, `@relative`, `@dist<angle`, polar/relative-polar, direct distance entry, point filters); Enter/Space repeat last; Esc cancel; Enter accepts default `<value>`; transparent commands `'ZOOM` `'PAN`; `MULTIPLE`; command history (Up/Down, F2 text window); `-COMMAND` dash variants where dialog-free input matters; system variables settable by name. Must.
- **FR-C2** Dynamic Input: prompt at cursor, numeric fields with Tab switching, pointer/dimension/dynamic prompts, DYNMODE/DYNPICOORDS semantics. Must.
- **FR-C3** Command palette (Ctrl+K): fuzzy search over commands, settings and recent files; discoverability only. Must.
- **FR-C4** User alias file (pgp-style) editable in-app and stored locally. Must.
- **FR-C5** Keyboard shortcuts matching AutoCAD defaults (F1–F12, Ctrl+1/2/3/8/9, Ctrl+Shift+S, etc.), remappable. Must.

### 6.8 Output (FR-P)

- **FR-P1** PLOT: vector PDF from any layout or model (window/extents/display/limits/view), paper size, scale, fit, centre, offset, orientation, lineweights, CTB/STB (user `.ctb` drop + bundled monochrome/grayscale/default), screening, plot styles honoured, plot transparency, stroke-font glyphs as paths, TTF embedded as text, PDF page size exact. Must.
- **FR-P2** PUBLISH: multi-layout to one PDF, one page per layout, page labels = layout names, bookmarks, ordering, include/exclude. Must.
- **FR-P3** Plot preview mode in-canvas (white background, CTB lineweights, monochrome). Must.
- **FR-P4** Preview sheet before plot; plot to PNG/SVG using the same pipeline. Must.

### 6.9 Parametric constraints (FR-X)

- **FR-X1** Geometric: coincident, collinear, concentric, fix, parallel, perpendicular, horizontal, vertical, tangent, smooth, symmetric, equal. Must.
- **FR-X2** Dimensional: linear (horizontal/vertical/aligned), angular, radial, diameter, with expressions and named parameters; Parameters Manager. Must.
- **FR-X3** Solver: PlaneGCS compiled to WASM (LGPL, separately loaded); DOF display; conflict/redundancy reporting; infer constraints toggle; constraint bar display/hide; CONSTRAINTSETTINGS. Must.
- **FR-X4** Interaction with modify commands: TRIM/EXTEND/FILLET/BREAK/EXPLODE drop affected constraints with a notification; MOVE/COPY/ROTATE/SCALE/MIRROR carry constraints within the moved set. Must.
- **FR-X5** Storage: Triya extension dictionary (`TRIYA_CONSTRAINTS` xrecords); invisible to AutoCAD. Must.

### 6.10 Differentiators (FR-Z)

- **FR-Z1 Pressure-vessel symbol & standards library:** parametric 2D blocks generated to scale for ASME B16.5 (NPS ½–24, classes 150–2500, WN/SO/BL/LJ/SW/TH) and B16.47 A/B flanges; nozzle details (set-in/set-on, with reinforcement pad outline); saddle, leg, bracket, skirt and anchor chair outlines with editable principal dimensions; weld symbols (AWS A2.4 / ISO 2553); surface-finish and GD&T feature-control frames; standard notes blocks. Library panel with search, preview, units-aware insertion. Must.
- **FR-Z2 PDF underlay red-lining:** promote FR-B6 to a headline: open PDF directly from the start screen, calibrate scale with two picks, mark up, print. Must.
- **FR-Z3 Drawing compare:** diff two drawings (or two revisions) on normalised geometry + handles; overlay (added green, removed red, modified amber); results list with click-to-zoom; export as marked-up DWG/PDF. Must.
- **FR-Z4 Drawing health report:** on open and on demand: unused layers/blocks/styles, empty text, zero-length, duplicate (OVERKILL candidates), non-standard dim styles, missing refs, missing fonts, units/scale sanity, file version; one-click fixes. Must.

### 6.11 UI shell (FR-U)

Detailed in `UI_SPEC.md`. Summary:

- **FR-U1** AutoCAD tab/panel structure (Home, Insert, Annotate, Parametric, View, Output, Layout, Tools) with AutoCAD panel names; modern execution (Fluent icons, micro-animations, light chrome). Must.
- **FR-U2** Responsive ribbon: at ≥1920 px full labelled multi-row ribbon with every panel open; at laptop widths a one-row icon ribbon where **every Draw/Modify/Annotate command on Home stays visible** (no overflow for those three panels); other panels compress first. Must.
- **FR-U3** Dockable right-hand palette stack (Properties, Layers, Blocks/Library, References, Constraints, Compare, Health) with slide-over behaviour <1366 px. Must.
- **FR-U4** Status bar: coordinates, SNAP/GRID/ORTHO/POLAR/OSNAP/OTRACK/DYN/LWT/TPY, MODEL/PAPER, annotation scale, workspace, with tooltips and F-key hints. Must.
- **FR-U5** Themes: light chrome + dark model canvas default; dark chrome; canvas colours configurable; plot preview mode. Must.
- **FR-U6** Title bar: OET home button, Report issue (GitHub), version/beta badge, settings. Must.
- **FR-U7** Dialogs: AutoCAD-equivalent for DIMSTYLE, TEXTSTYLE, TABLESTYLE, MLEADERSTYLE, LAYER, PAGESETUP, PLOT, OPTIONS, ATTEDIT, INSERT, HATCH (contextual ribbon tab + dialog), XREF manager, BLOCK, LINETYPE, UNITS, DRAFTINGSETTINGS. Must.

## 7. Privacy & security requirements

- No cookies, no accounts, no analytics in the app. Only a cookie-less visit count on the OET website.
- After first load, the app makes **zero** network requests except: (a) service-worker update checks, (b) user-initiated "Send error report". Verified by a CI test with network blocked.
- Error reports are opt-in, reviewed by the user before sending, contain anonymised stack, browser, app version and file *statistics* (entity counts, version, feature flags used) — never drawing content, file names, or paths. Sent via a Cloudflare Worker that creates a GitHub issue.
- All user-supplied fonts, patterns, CTBs, templates, file handles and autosaves live in OPFS/IndexedDB on the device; "Clear all local data" wipes them.
- Passwords on DWG files: not supported (AutoCAD dropped them); report clearly.

## 8. Platform requirements

- Chromium (Chrome/Edge ≥ last 2 versions): full feature set.
- Firefox, Safari (last 2 versions): documented degraded mode — download instead of in-place save, pick files instead of folders for references; first-run compatibility notice.
- Desktop/laptop only: minimum 1280×720; designed breakpoints 1280 / 1366 / 1600 / 1920+.
- Installable PWA, offline after first load, file-handler for `.dwg`/`.dxf`.

## 9. Licensing

- App: MIT. PlaneGCS: LGPL-2.1+, built as a separate WASM module loaded at runtime, source and build script published. Fonts: the public-domain Hershey set, converted (attributed; LibreCAD fonts are GPL and excluded, DEC-044). Hatch patterns and linetypes: re-authored, not copied from Autodesk files. Icons: Microsoft Fluent UI System Icons (MIT). `ATTRIBUTION.md` lists everything.
- No Autodesk-copyrighted assets (SHX files, `acad.pat`, `acad.lin`, `acad.dwt`, `acad.ctb`) are ever committed. Users may drop their own; they stay on the user's device.

## 10. Dependencies and their risk

| Dependency | Role | Risk | Mitigation |
|---|---|---|---|
| acad-ts (MIT) | DWG/DXF read/write | Young; AI-ported; writer fidelity unproven | Milestone M0 spike (`SPIKE_M0_ACAD_TS.md`) is a go/no-go gate; vendored fork with patches upstreamed |
| PlaneGCS (LGPL) | constraint solver | Build to WASM; LGPL boundary | Separate module; build script in repo; dynamically loaded |
| pdf.js | PDF underlay rendering | Large; path extraction limited | Lazy-loaded; osnap to underlay best-effort |
| pdf-lib or custom writer | PDF output | Font embedding, size | Stroke fonts as paths; TTF subset embedding |
| React 19 + Vite + TS | UI | none | — |

## 11. Success criteria (v1 complete)

1. All "Must" requirements implemented and traced to passing tests.
2. All acceptance targets in §12 pass in CI on the public corpus and locally on the private corpus.
3. Two experienced AutoCAD drafters complete a scripted 2-hour drafting session and a 30-minute markup session each without a blocking missing feature (logged issues only "nice to have").
4. AutoCAD `AUDIT` = 0 errors on every Triya-saved corpus file; AutoCAD opens them without "proxy" or "unknown object" warnings beyond those in the source.
5. Lighthouse PWA: installable, offline, performance ≥ 90 on desktop.

## 12. Quantitative acceptance targets

Measured on a mid-range laptop (i5-class, integrated GPU, 16 GB) in headless Chromium in CI, and on the reference corpus files `corpus/public/bench-*.dwg`.

| ID | Target |
|---|---|
| T1 | Cold start (installed, offline): canvas interactive < 1.5 s; first-ever load ≤ 10 MB before usable, remainder streamed with "Ready offline" indicator |
| T2 | Open: `bench-100k.dwg` (≈30 MB, 100k entities, 50 blocks, 5 layouts) renders < 3 s; `bench-ga.dwg` (5 MB) < 0.5 s |
| T3 | Pan/zoom ≥ 60 fps with 100k entities visible; input latency ≤ 16 ms on command prompts; osnap marker response < 50 ms at 100k entities |
| T4 | Fidelity: ≥ 99 % of entities in public corpus pixel-match AutoCAD reference plots within tolerance; 100 % of private corpus opens without error; AUDIT = 0 on all Triya-saved files; round-trip structural diff = 0 |
| T5 | In-place save of `bench-100k.dwg` < 2 s; autosave within 5 s of last edit, never to the original |
| T6 | A1 sheet with CTB to vector PDF < 2 s; lineweights verified in Acrobat and PDF-XChange at 100 % |
| T7 | Memory < 1 GB for `bench-100k.dwg`; no growth across 20 open/close cycles (±5 %) |
| T8 | Every feature works with the network disabled, including SHX/pattern/CTB drops and PDF export |
| T9 | Home-tab Draw/Modify/Annotate commands all visible at 1366×768; no horizontal scroll at 1280; full ribbon at ≥ 1920 |

If T2/T3 fail on the real corpus after Canvas 2D optimisation, that is the trigger for the WebGL renderer path (DEC-006), not a reason to lower the target.

## 13. Release

- No public beta. Ships on OET when §11 is met.
- Repo private during development; made public (MIT) at a milestone of the owner's choosing.
- Versioning: semver; `v1.0.0` = complete. Changelog maintained in `CHANGELOG.md`.

## 14. Open items tracked outside this PRD

- M0 go/no-go on acad-ts (see `SPIKE_M0_ACAD_TS.md`).
- Private corpus assembly (owner task).
- Two drafter test sessions (owner task, §11.3).
