# Triya CAD 2D — Architecture

**Status:** Accepted v1.0 (2026-11-01). Changes to module boundaries, the document model, the renderer contract, the command engine contract, or the passthrough rules require a new entry in `DECISIONS.md` and an update here in the same PR.

This document describes the system as it must be built. It is deliberately prescriptive where a wrong choice would be expensive to reverse, and deliberately silent where any reasonable choice will do.

---

## 1. Principles (in priority order)

1. **Fidelity before features.** The file layer and renderer must reproduce AutoCAD's output before any editing command is written on top. Tests on real drawings gate every milestone.
2. **What we don't understand, we don't touch.** Opaque passthrough of every unmapped object is a hard invariant enforced by round-trip tests.
3. **The engine has no DOM.** `@triya/engine` runs in Node for tests and in a Web Worker in the browser. Any `window`/`document` reference in the engine is a build error.
4. **React owns chrome, never the canvas loop.** Pan/zoom/draw never passes through React state.
5. **One document model, many views.** Model space, each layout, the plot preview, the SVG/PDF exporters and the compare overlay all render the same model through the same `Renderer` interface.
6. **Measured, not assumed.** Performance budgets (`PRD.md` §12) run in CI on corpus files. A budget regression fails the build.
7. **Boring technology.** TypeScript everywhere, plain modules, explicit dependencies, no magic.

## 2. Repository layout (pnpm monorepo)

```
triya-cad-2d/
├─ apps/
│  └─ web/                     # Vite + React PWA shell (the only package with a DOM)
├─ packages/
│  ├─ engine/                  # Document model, geometry, spatial index, undo, selection, commands
│  ├─ io/                      # acad-ts adapter, passthrough, DXF/DWG/SVG/PNG/PDF import/export
│  ├─ render/                  # Renderer interface + Canvas2D implementation + plot pipeline
│  ├─ text/                    # SHX parser/renderer, TTF shaping, MTEXT formatting engine
│  ├─ hatch/                   # .pat parser, pattern generation, boundary detection
│  ├─ dims/                    # Dimension geometry engine (all DIMVARS)
│  ├─ constraints/             # PlaneGCS WASM wrapper + constraint model
│  ├─ library/                 # Pressure-vessel symbol generators (B16.5/B16.47, nozzles, supports, welds)
│  ├─ compare/                 # Drawing diff
│  ├─ pdf/                     # Vector PDF writer (CTB-aware), PDF underlay via pdf.js
│  ├─ ui/                      # Shared React components (ribbon, palettes, dialogs) — shared with PDFTools where possible
│  └─ testkit/                 # Corpus loader, reference-plot diff, round-trip diff, perf harness
├─ corpus/
│  ├─ public/                  # Committed drawings + AutoCAD reference PDFs/PNGs (see TESTING.md)
│  └─ private/                 # .gitignored; owner's real drawings, run locally only
├─ third_party/
│  ├─ planegcs/                # Git submodule + Emscripten build script → packages/constraints/wasm
│  └─ acad-ts/                 # Vendored filtered snapshot (DEC-033) with local patches; upstream PRs tracked
├─ assets/
│  ├─ fonts/                   # Open stroke fonts (Hershey, LibreCAD-derived), compiled to .shx-equivalent JSON
│  ├─ patterns/                # Re-authored .pat set
│  ├─ linetypes/               # Re-authored .lin set
│  ├─ plotstyles/              # Open monochrome/grayscale/default CTB equivalents
│  └─ templates/               # Triya ISO (mm) / Triya ANSI (inch) .dwt
├─ docs/                       # This folder
├─ .claude/rules/              # Path-scoped rules for Claude Code threads
├─ CLAUDE.md
└─ package.json / pnpm-workspace.yaml / turbo.json
```

Dependency direction is enforced with `eslint-plugin-boundaries`:

```
apps/web → ui, render, engine, io, text, hatch, dims, constraints, library, compare, pdf
ui       → engine (types only)
render   → engine, text, hatch, dims
io       → engine, text, hatch, dims, pdf
dims     → engine, text
hatch    → engine
text     → (nothing)
constraints → engine
library  → engine
compare  → engine
pdf      → render, engine
engine   → (nothing)
testkit  → engine, io, render, text, hatch, dims, pdf   (test-only; only *.test.ts / *.spec.ts files may import testkit — DEC-032)
```

Anything pointing the other way is a lint error. The graph is encoded in `eslint.config.js` (`DEPENDENCY_GRAPH`) and proven edge by edge in `tests/lint/boundaries.test.ts`; change all three together. Packages are consumed from source: each `package.json` exports `./src/index.ts` and `tsconfig.base.json` maps `@triya/*` to it, so there is no internal build step. The no-DOM packages (`engine`, `io`, `text`, `hatch`, `dims`, `constraints`, `library`, `compare`, `pdf`) compile without the DOM lib and lint browser globals as errors (`tests/lint/no-dom.test.ts`).

## 3. Threading model

```
┌─────────────────────────── Main thread ────────────────────────────┐
│  React chrome · input capture · Canvas2D present · OffscreenCanvas │
│  transfer · command line UI · dialogs · File System Access         │
└──────────────┬──────────────────────────────┬──────────────────────┘
               │ postMessage (structured)     │ Comlink RPC
┌──────────────▼──────────────┐  ┌────────────▼──────────────────────┐
│  Render worker               │  │  Engine worker                    │
│  OffscreenCanvas owner       │  │  Document model (authoritative)   │
│  Scene cache, R-tree, LOD    │  │  Command engine, undo, selection  │
│  Draws from a RenderSnapshot │  │  Emits change-sets → render worker│
└──────────────────────────────┘  └───────┬───────────────────────────┘
                                          │ on demand
                             ┌────────────▼──────────────┐
                             │  I/O worker(s)            │
                             │  acad-ts parse/write,     │
                             │  PDF write, pdf.js, PNG   │
                             └───────────────────────────┘
```

- **Engine worker** owns the document. The main thread holds a lightweight mirror (entity ids, bounds, selection state) for hit-testing of UI affordances only.
- **Render worker** owns the `OffscreenCanvas`. It never touches the document; it receives `ChangeSet`s (added/updated/removed entity ids + their `RenderPrimitive`s) and keeps a scene cache.
- **I/O worker** is spawned per heavy job and terminated after, so a 30 MB parse never blocks interaction and memory is reclaimed. `readInWorker(bytes, { createWorker, onProgress, signal })` in `@triya/io` is the main-thread side; the worker entry `@triya/io/worker` exposes `ioApi` over Comlink. The bytes are transferred, not copied. acad-ts parses in one synchronous call, so progress is reported per stage (`parse`, `summarize`, `done`), not per byte. Aborting the signal terminates the worker at once and rejects with `AbortError`; the worker is terminated however the job ends, which discards its heap. Only the client may be imported on the main thread: the package index pulls in acad-ts.
- Input → command engine round trip must be < 16 ms (T3). Rubber-banding during a command is drawn by the render worker from a `TransientLayer` fed by the engine's preview output, not by re-running the command.
- On Firefox/Safari without `OffscreenCanvas` transfer, the render worker's code runs on the main thread behind the same interface (`RendererHost`), so no second code path exists.

## 4. Document model (`packages/engine`)

### 4.1 Core shapes

```ts
type Handle = string;                // AutoCAD hex handle, preserved from file; new objects get fresh handles above $HANDSEED
type EntityId = number;              // dense runtime id for hot paths; Handle ⇄ EntityId map maintained

interface Document {
  header: HeaderVars;                // typed subset of $DWG vars actually used + opaque map for the rest
  tables: { layers, linetypes, textStyles, dimStyles, mleaderStyles, tableStyles, appIds, views, ucs, vports, blockRecords };
  blocks: Map<Handle, BlockDefinition>;      // includes *Model_Space, *Paper_Space, *Paper_SpaceN, *D (dims), *U (dyn blocks), *X (hatch) …
  layouts: Layout[];                         // ordered; Model is index 0
  objects: Map<Handle, NonGraphicalObject>;  // dictionaries, xrecords, layer states/filters, plot settings, scale list, images defs, …
  passthrough: PassthroughStore;             // see §6
  meta: { sourceVersion, sourcePath?, codePage, insUnits, measurement, handSeed };
}

interface Entity {
  id: EntityId; handle: Handle; type: EntityType;
  owner: Handle;                     // block record
  layer: Handle; color: Color; linetype: Handle | 'ByLayer' | 'ByBlock'; lineweight: Lineweight; transparency: Transparency;
  ltScale: number; visible: boolean; plotStyle?: Handle; material?: Handle;
  xdata?: Xdata; reactors?: Handle[]; extDict?: Handle;   // carried verbatim
  annotative?: AnnotativeData;       // representations per scale
  geom: EntityGeometry;              // discriminated union per type
  raw?: PassthroughRef;              // link to the untouched acad-ts object (see §6)
}
```

- **Immutable updates.** Entities are replaced, never mutated in place; the engine computes a `ChangeSet` per command for undo and for the renderer.
- **Container vs values (DEC-035).** `DocumentModel` (`engine/src/model/document.ts`) is the mutable container of frozen values: entities live in one `EntityId → Entity` map, each block definition keeps its ordered `EntityId[]` (file order), and table records, objects and header vars are handle- or name-keyed maps. The only way to change it is `apply(changeSet)`, which validates the whole change set first (current "before" versions by reference, free handles, in-range positions) and then commits, so a rejected change set changes nothing. Applying costs O(change), never a copy of the drawing.
- **`ChangeSet` shape.** `{ entities?: { added, updated, removed }, tables?: { [table]: { added, updated, removed } }, objects?: { added, updated, removed }, header?: { name, before, after }[] }`. Updates carry `{ before, after }` by reference; entity additions and removals carry their index in the owner block (removal index before the change, addition index after it), so `invertChangeSet` is a swap and undo restores draw order exactly. Moving an entity between blocks is a removal plus an addition with the same handle and id. Commands build change sets with `ChangeSetBuilder`, which folds repeated edits to one object and fills in "before" versions and positions. Block definitions and layouts join the change set when BLOCK (M5) and LAYOUT (M6) need them.
- **EntityId map.** `EntityIdMap` binds each entity handle to a dense id from 1 (0 = no entity) for the session; the binding survives removal so undo restores the same id, and an id is never reused.
- **Spatial index (M1-07).** `SpatialIndex` (`engine/src/spatial/`) keeps one R-tree per block record, keyed on bounds in that block's own coordinates: model space is WCS, each paper-space layout queries its own block record (`queryLayout`), and block definitions are indexed too so INSERT bounds come from block extents (base point, scale, rotation and MINSERT cells applied to the extents box; nested references and `*D` dimension blocks included, reference cycles are "unknown"). Each tree is a static packed Hilbert R-tree (flatbush layout, our own code) plus an overlay of entries edited since packing; dead items are skipped and the tree is repacked once edits pass 1/16 of the block (at least 256). `apply(changeSet)` runs right after `DocumentModel.apply` with the same change set and re-bounds the touched entities, then every reference whose block's extents changed, up through nesting. Bounds are `box` (always contains what the entity draws), `infinite` (XLINE/RAY, clipped against the query exactly; HATCH by the union of its boundary loops), `empty`, or `unknown` (text and annotations until exact metrics are injected through `annotationBounds`, M1-35): queries always return unknown entities, so they are a superset and callers test candidates' geometry.
- **Geometry library.** All intersection/offset/fillet/trim math lives in `engine/geom` with exhaustive unit tests. Tolerance is a document-level epsilon derived from extents (never a hard-coded 1e-6). Arcs are stored as centre/radius/start/end (CCW), bulges for polylines, splines as NURBS (degree, knots, control points, weights, fit points retained). The kernel's curve shapes (`geom/curves.ts`) are the planar part of the model's entity geometry, so `entity.geom` is passed to kernel functions as is; each curve has a documented parameter domain. `Tolerance { linear, angular }` comes from `toleranceFromExtents` (DEC-036): linear = 1e-10 × max(1, largest extents coordinate or size), angular = 1e-10 rad; every kernel function that compares takes it as an argument. Intersections (`geom/intersect.ts`) work on a curve's pieces (`geom/pieces.ts`): closed forms for line, circle and line–ellipse pairs, flatten-seed-Newton for the rest, isolated points only (DEC-037). `closestPoint` is exact for lines and circular pieces and a branch-and-bound over chords (golden-section polish) for ellipses and splines; `tangentPointsFrom` gives TAN osnap points. `offset(c, d)` offsets to the left of travel for d > 0 (inward for CCW circles and arcs; `sideOf` turns the user's side point into the sign), joins polyline segments as OFFSETGAPTYPE 0 does (extend to the carriers' intersection, else bridge with a line; collapsed arcs dropped), and returns ellipse and spline offsets as sampled polylines within a deviation.
- **Handles are sacred.** Imported handles are never renumbered; new handles are allocated above `$HANDSEED` and `$HANDSEED` is written back. This is what makes round-trip diff = 0 possible. `HandleAllocator` starts at `$HANDSEED` (raised past the largest handle in the file, passthrough included, if the file's seed is stale) and only grows: undoing an addition does not give its handle back, as in AutoCAD.

### 4.2 Undo

- Command-level grouping; each command produces one `UndoRecord { forward: ChangeSet, inverse: ChangeSet, label }`.
- Unlimited by count, bounded by memory (configurable, default 256 MB); oldest records drop with a warning.
- `UNDO` options: Back, Mark, Begin/End groups, number; `REDO`; `OOPS` (restores last erased set without undoing the command).

### 4.3 Selection

- `SelectionSet` is an ordered `Set<EntityId>` plus the pick history needed for `Previous`.
- Selection modes implement AutoCAD's exact rules (crossing vs window by drag direction, fence intersection semantics, polygon modes, lasso direction, `PICKADD`, Shift-remove, cycling order by draw order then handle).
- Pre-selection (`PICKFIRST`) feeds the next command's first "Select objects:" prompt.

## 5. Command engine (`packages/engine/commands`)

### 5.1 Contract

Every command is a generator-based state machine so that prompts, option keywords, transparent commands and cancellation are uniform:

```ts
interface CommandDef {
  name: string;                          // 'LINE'
  aliases: string[];                     // ['L']
  dashVariant?: boolean;                 // supports '-NAME'
  transparent?: boolean;                 // can run inside another ('ZOOM)
  usesSelection?: 'before' | 'during' | 'none';
  run(ctx: CommandContext): CommandGenerator;
}

type CommandGenerator = AsyncGenerator<Prompt, CommandResult, PromptAnswer>;

// A command yields prompts and receives answers:
const p1 = yield ctx.prompt.point({ message: 'Specify first point', options: [] });
const p2 = yield ctx.prompt.point({ message: 'Specify next point or', options: ['Undo'], rubberBand: { from: p1 } });
```

- `PromptAnswer` is a discriminated union: point, distance, angle, keyword, selection, string, number, cancel, enter-default.
- The parser turns command-line text into `PromptAnswer`s: coordinates (`10,20`, `@5<45`, `.x`), direct-distance (number while rubber-banding), keywords by capital-letter prefix, `FROM`/`M2P` snap modifiers, and numeric expressions (`'cal`-lite: `+ - * / ( )`).
- Dynamic Input and the command line are two front-ends to the same `PromptBus`. The Ctrl+K palette and the future MCP server are also front-ends. **No command ever reads the DOM.**
- Commands may call `ctx.preview(primitives)` to update the transient layer at any time without committing.
- Every command declares the `ChangeSet` it produces; the engine wraps it in an undo record and dispatches to the render worker.

### 5.2 System variables

A typed registry (`SysVarRegistry`) with AutoCAD names, types, defaults, scope (drawing vs user), and change events. Commands read `ctx.sysvar('OSMODE')`, never module globals. Drawing-scoped variables are read from and written to `$`-header vars so they round-trip.

### 5.3 Precision input (`engine/input`)

- `OsnapEngine`: given cursor world point, aperture, active modes and the visible entity set from the R-tree, returns ranked candidates (AutoCAD priority order: endpoint > midpoint > … with `OSNAPCOORD`/`OSNAPZ` ignored for 2D). Computes INT/APP/EXT/PAR/TAN/PER against all entity pairs within the aperture. Must respond < 50 ms at 100k entities (T3): aperture query hits the R-tree, candidates computed only for hit entities.
- `TrackingEngine`: acquired points for OTRACK and `TK`; alignment paths; polar angles.
- `OrthoPolar`: constrains the cursor point; `POLARANG`, `POLARADDANG`, `POLARMODE`.

## 6. File layer and passthrough (`packages/io`)

### 6.1 Adapter

- `importDocument(bytes, { format }) → Document`: runs acad-ts `DwgReader`/`DxfReader` in the I/O worker, then `AcadToTriya` maps every supported object into the Triya model. The acad-ts `CadDocument` is **retained in the worker** for the session (serialised to OPFS for recovery) as the passthrough source.
- `AcadToTriya` lives in `packages/io/src/map/`. `mapTables(doc)` turns each symbol-table entry and style object into a Triya table record keyed by its upper-case hex handle, carrying xdata (per application, handles as hex), reactors, the extension dictionary and a `raw` link to the original; references between records (a layer's linetype, a linetype element's text style) are handles. Dimension styles carry every DIMVAR by name (`vars.DIMSCALE`); multileader and table styles come from the `ACAD_MLEADERSTYLE`/`ACAD_TABLESTYLE` dictionaries. `mapEntities(doc)` maps every entity of every block record (model space, layouts, block definitions) in draw order to an `EntityInit` in plan view (DEC-039), with VERTEX/SEQEND folded into their POLYLINE and ATTRIBs (each with its own handle and properties) into their INSERT, and lists what it does not map yet, or cannot show in 2D, in `unmapped` with a reason. `mapHeader(doc)` carries every header variable acad-ts knows under its DXF name with the value its DXF writer would emit (points as `Vec2`/`Vec3`, colours as ACI numbers, true colours as the nearest ACI) and derives `DocumentMeta` and `$HANDSEED`. Fields Triya does not model stay on the retained original.
- `exportDocument(doc, { format, version }) → bytes`: `TriyaToAcad` rebuilds a `CadDocument` by **starting from the retained original**, applying Triya's changes object-by-object (by handle), adding new objects, deleting removed ones — then runs `DwgWriter`/`DxfWriter`. For a new drawing, it starts from an empty `CadDocument` seeded from the template.

### 6.2 Passthrough rules (hard invariants)

1. Every acad-ts object that `AcadToTriya` does not map is kept, with its handle, in `PassthroughStore` and written back byte-for-byte at the model level (acad-ts object graph), including xdata, reactors, extension dictionaries, and owner links.
2. Entities Triya **does** map keep a `raw` reference. On export, properties Triya didn't model (unknown xdata app ids, proxy graphics, custom flags) are copied from `raw` onto the rebuilt object.
3. Deleting an entity in Triya deletes its passthrough twin and any objects solely owned by it (its extension dictionary) — never shared objects.
4. Block definitions containing only unmapped entities are kept whole. `*U` (dynamic) blocks are mapped as static block definitions **for rendering only**; their `AcDbBlockRepresentationData`/evaluation graphs are passthrough.
5. Unknown header variables, classes (`CLASSES` section), and the `OBJECTS` section are passthrough by default; Triya only claims what it models.
6. The round-trip test (open → save → reopen → structural diff) must report **zero** differences for every corpus file, with the sole allowed exceptions listed in `TESTING.md` (`$TDUPDATE`, `$TDUSRTIMER`, `$HANDSEED` ≥, `$VERSIONGUID`, `$FINGERPRINTGUID`).

### 6.3 Entity support matrix

Maintained in `docs/FILE_FIDELITY.md` with one row per DXF entity/object type and columns: Read · Render · Edit · Write · Test file. A type is not "done" until all five are ticked.

### 6.4 Other formats

- **SVG export:** from the `Renderer` pipeline (same primitives), with layers as `<g id>`, lineweights in px at chosen scale, text as `<path>` for SHX and `<text>` for TTF.
- **PNG export:** `OffscreenCanvas` at requested DPI; transparent or coloured background.
- **PDF output:** `packages/pdf` — own vector writer (content streams, page tree, bookmarks, embedded subset TTF, lineweight/colour/screening from the resolved plot style). Stroke fonts emit path operators. See §9.
- **PDF underlay:** pdf.js lazy-loaded; page rendered to a bitmap at viewport resolution + path extraction (where available) for osnaps.

## 7. Rendering (`packages/render`)

### 7.1 Renderer interface (the WebGL escape hatch)

```ts
interface Renderer {
  resize(w: number, h: number, dpr: number): void;
  setView(view: ViewTransform): void;                // world→screen
  apply(change: ChangeSet): void;                    // incremental scene update
  setTransient(primitives: RenderPrimitive[]): void; // rubber-band, grips, osnap markers
  setStyle(style: RenderStyle): void;                // theme, plot-preview, selection colours, LWT on/off
  frame(): void;                                     // draw one frame
  hitTest(screenPt, aperture): EntityId[];           // delegated to engine's R-tree via mirror
}
```

`Canvas2DRenderer` is the v1 implementation. A `WebGLRenderer` may replace it behind the same interface if T2/T3 fail; nothing outside `packages/render` may depend on Canvas2D APIs.

### 7.2 Canvas2D implementation

- **Scene cache:** entities are pre-tessellated into `RenderPrimitive`s (polylines in world coords, text glyph paths, hatch line sets, image refs) once per change, not per frame.
- **Primitives (M1-12):** `tessellate(geom, paint)` turns an entity into packed world-coordinate path commands (`M L A E Z`). Circles, arcs, ellipses and bulge segments stay exact as canvas arcs and ellipses, so zooming never re-tessellates; only splines are flattened (deviation = size × 1e-4). XLINE/RAY become `infinite` primitives clipped to the view at draw time, and solid hatches and SOLID/TRACE become fills (odd parity, except hatch style 2). `paint.ts` resolves ByLayer colour and lineweight at cache time and keeps ACI 7, 0 and ByBlock as a `'foreground'` token resolved per frame from `RenderStyle`, so a theme switch needs no re-tessellation. Kinds owned by later tasks (INSERT, DIMENSION, text, pattern hatches, polyline widths) produce no primitives yet.
- **Culling:** R-tree query of the view rect; **LOD:** text below 3 px height → skip or box; hatch below density threshold → fill with average tint; dashed linetypes below 1 px per pattern unit → solid.
- **Linetypes:** fitted once per change by `dashPath`/`dashPolyline` (`render/src/style/`) into explicit dashes, dots and text/shape placements in world units, which the renderer strokes solid; the scale is `LTSCALE × object scale`, divided by the viewport scale under `PSLTSCALE` 1 and multiplied by the annotation scale under `MSLTSCALE` 1 (`linetypeScale`). AutoCAD A-type alignment: half of the first dash (or more, lengthened by half the leftover) starts and ends each open path, a path shorter than one pattern is continuous, `PLINEGEN` off fits each polyline segment on its own, and a closed path is fitted from its start point with the end and start dashes joined there. A text or shape belongs to the element before it and sits at that element's end, offset `X` along and `Y` across the path (`R`/`A`/`U` rotation). `.lin` files are read by `parseLin`; the bundled set is `assets/linetypes/triya-iso.lin` (ISO 128-20 types 02–15, authored for Triya).
- **Lineweights:** `LWDISPLAY` off → 1 px. On: lineweight 0 is 1 px; on the Model tab widths are pixels proportional to the plotted width (96 px per inch, rounded, times the display scale) that do not change with zoom; in a layout they are real paper millimetres at the current zoom, at least 1 px (`lineweightPixels`), as AutoCAD displays them. Default is `$LWDEFAULT`.
- **Colour:** the ACI palette is computed (`aciRgb`: 24 hues 15° apart × 5 values × 2 saturations, plus the named colours and greys), true colour and colour-book colours are their RGB; ACI 7 and ByBlock outside a block resolve to `foreground`, which the renderer turns black or white per frame from the background. ByLayer/ByBlock resolution (`resolveColor`, `resolveLinetype`, `resolveLineweight`, with `blockContext` per INSERT, objects on layer 0 taking the INSERT's layer) runs at cache time with invalidation on layer/block changes.
- **Draw order:** `SORTENTS`/`DRAWORDER` honoured via per-block sorted lists.
- **Layouts:** paper background, printable-area dashes, each viewport rendered by recursive `frame()` with its own view transform and clip, layer VP overrides applied, `MSPACE` active viewport outlined.
- **Transient layer:** separate `OffscreenCanvas` composited on top, so rubber-banding never invalidates the scene cache.
- **Budget:** the frame loop targets 60 fps; if the previous frame exceeded 16 ms, the next frame renders at reduced LOD and schedules a full-quality frame when idle.

## 8. Text (`packages/text`)

- **SHX:** parser for shape/font files (unifont and bigfont handled; bigfont minimal); stroke interpreter produces glyph polylines; caches per font/char. `parseShx(bytes)` (`text/src/shx/`) returns an `ShxFont`. Its `glyph(code)` gives pen-down paths in font units with arcs kept exact as bulges (split at ≤ 90°), plus the pen's end position as the exact advance; `scaleFor(height)` is height / `above`. Where AutoCAD's shape documentation is silent, a subshape continues with the caller's pen and scale, restoring a pushed location moves without drawing, a clockwise fractional arc mirrors the counter-clockwise offsets, and a subshape cycle draws nothing. Font resolution order: text style's font → user font store (OPFS) → bundled open equivalent by name map (`romans → oet-romans`, `txt → oet-txt`, `simplex → oet-simplex`, `isocp → oet-isocp`) → `oet-simplex`. A missing font is reported in the health panel.
- **TTF:** browser/`opentype.js` for glyph paths (needed for consistent SVG/PDF and width measurement across platforms); same shaping on main thread and workers. `parseTtf(bytes)` (`text/src/ttf/`) returns a `TtfFont`: outlines in font units (y up, M/L/Q/C/Z kept as the font stores them), advances summed by code point (missing characters take .notdef), kerning only on request (AutoCAD does not kern TEXT), and `scaleFor(height)` = height / cap height (OS/2 `sCapHeight`, else the 'H' outline). `TtfRegistry` resolves a style's family through injected `FontSource`s in order, then a fallback list, caching per family and style and flagging substitutions for the health report. opentype.js is imported through `ttf/lib.ts`, which picks its ESM or UMD build so Node, workers and Vite share one code path.
- **MTEXT engine:** full formatting-code parser (`\P \A \C \F \H \W \Q \T \L \O \K \S` stacking, `\pxi` paragraph props, columns, `%%` codes, fields), line breaking by width with word wrap, justification, background mask; produces glyph runs for the renderer and the editor. `parseMText(contents, base, options)` (`text/src/mtext/`) gives paragraphs of styled items (text, field, big-font character, stack, tab); `mode: 'text'` reads TEXT/ATTRIB contents, and fields show `evaluateField(code)` or `----`. `layoutMText(doc, measure, box)` positions runs in the MTEXT's own frame (origin at the insertion point, y up): single spacing 5/3 × height ("at least" grows for taller characters), `\p` indents and tabs in multiples of the MTEXT height with default stops every 4, attachment top at the first cap line and bottom at the last baseline, stacks at 70 %, columns filled to their height or broken by `\N`, and the mask (scale − 1) × height beyond the box. Widths come from an injected `MTextMeasure`, so the engine runs on any font source. Where AutoCAD documents no rule, the choice is commented in the code: `\c` is red-low-byte (COLORREF), an x suffix makes `\H`, `\W` and `\T` relative, paragraph properties carry into later paragraphs, and an unknown code shows literally.
- **Width measurement** is exact (not estimated) because dimension text fit rules depend on it.

## 9. Dimensions (`packages/dims`)

- `DimensionEngine.generate(dim, style, scale) → BlockContent` implements AutoCAD's rules for every dimension type: extension lines (`DIMEXO/EXE/SE1/SE2`), dim lines, arrowheads (standard set as generated shapes + user blocks), text placement (`DIMTAD/TIH/TOH/JUST/TMOVE/ATFIT/TIX`), fit logic (text/arrows inside/outside, leader when moved), units/precision/zero suppression/prefix-suffix (`DIMLUNIT/DEC/ZIN/RND/DSEP/POST`), tolerances and limits, alternate units, `DIMSCALE`, annotative scale, `DIMTXSTY`, text override with `<>`.
- **Stored-block policy (DEC-011):** an imported dimension renders from its `*D` block until any of its properties, defpoints or style changes; the first change regenerates with the engine and sets `regenerated: true`. A health check lists dims whose regenerated output differs from the stored block beyond tolerance (surfaces engine bugs on real files).
- `DIMASSOC=1`: defpoints are grip points; STRETCH/MOVE/SCALE/ROTATE/MIRROR of defpoints regenerates. Data model keeps `associativity?: { entity: Handle, subentity, param }` slots unused in v1 so `DIMASSOC=2` is additive.

## 10. Hatch (`packages/hatch`)

- `.pat` parser (angle, origin, delta, dash spec) — exactly AutoCAD's semantics including the "offset along angle" quirk.
- Pattern generation clipped to boundary loops in world space, cached per hatch; dense patterns thinned for LOD.
- Boundary detection: `BoundaryTracer` builds a planar graph from visible entities within the pick region (lines, arcs, circles, polylines, ellipses, splines flattened), finds the smallest enclosing loop around the pick point, then islands by containment; gap tolerance (`HPGAPTOL`); island modes. Result is a `HATCH` with edge-typed loops (line/arc/ellipse/spline), preserving source entity references for a future associative mode.
- Solid and gradient (`GRADIENT` two-colour, nine styles) via canvas fills.

## 11. Constraints (`packages/constraints`)

- PlaneGCS built with Emscripten to `planegcs.wasm` + ES module glue (`third_party/planegcs/build.sh`, pinned commit, LGPL notice and source link shipped).
- `ConstraintModel`: Triya entities ↔ GCS primitives (points, lines, arcs, circles, ellipses); geometric and dimensional constraint objects with handles; expressions evaluated by a small safe parser (`+ - * / ^ ()`, named params, functions `sin cos tan sqrt abs`).
- Solve on each affected edit; DOF and conflict reports surfaced in the Constraints palette and as glyph bars on canvas.
- Storage: `ACAD_DICTIONARY` entry `TRIYA_CONSTRAINTS` → xrecords keyed by constraint handle, referencing entity handles. Loaded only if the dictionary exists; ignored by AutoCAD; passthrough-safe.
- Modify-command interaction per `PRD.md` FR-X4: a `ConstraintAwareness` hook on the command engine inspects each `ChangeSet` and decides keep/drop/re-solve.

## 12. Plot pipeline (`packages/render/plot` + `packages/pdf`)

`PlotJob { source: layout|model, area, paper, scale, offset, plotStyleTable, lineweightScale, monochrome, options }` → `PlotResolver` resolves every primitive's final colour/lineweight/screening/linetype through the CTB/STB (parsed from user drops or bundled) → emitted to a `PlotSink`:
- `PdfSink` (vector), `SvgSink`, `PngSink` (raster via Canvas2D at DPI), and the in-canvas **plot-preview** sink.
PUBLISH loops layouts into a multi-page `PdfSink` with bookmarks and page labels. Same resolver drives the on-screen plot preview so what you see is what prints.

## 13. Persistence (`apps/web/src/storage`)

- **OPFS** for: autosave snapshots (`recovery/<docId>.triya` = acad-ts document + Triya change log), user fonts/patterns/linetypes/CTBs/templates, library cache.
- **IndexedDB** for: recent file handles, settings, alias file, keyboard map, UI layout, scale list defaults.
- **Autosave:** engine worker serialises every 5 s after the last change (debounced) to OPFS; recovery offered on launch if a snapshot is newer than the file's last save.
- **"Clear all local data"** wipes all of the above and unregisters the service worker.

## 14. PWA and offline

- Vite PWA plugin (Workbox). Precache the app shell and core engine; lazy routes for `constraints` WASM, `pdf.js`, library data, bundled fonts/patterns. "Ready offline" indicator when everything is cached.
- `file_handlers` manifest entry for `.dwg`/`.dxf`; `launch_queue` consumer.
- Service-worker update: prompt-to-reload, never silent reload mid-session.

## 15. UI layer (`apps/web`, `packages/ui`)

- React 19 + TypeScript + Vite; Zustand for UI state; Radix primitives for a11y; Fluent UI System Icons; CSS variables for theming; no CSS-in-JS runtime.
- The canvas element is a leaf component with a ref handed to `RendererHost`; React never re-renders because of canvas state.
- Ribbon is data-driven (`ribbon.config.ts`: tabs → panels → items with size rules), so responsive collapse (`UI_SPEC.md`) is a layout algorithm, not per-component CSS.
- All dialogs are AutoCAD-equivalent in structure (same groupings/labels) so a drafter's mental map transfers; implementation shared with PDFTools' component kit where identical.

## 16. Testing architecture (summary; details in `TESTING.md`)

- `packages/engine` unit tests (Vitest): geometry, parser, commands via scripted `PromptAnswer` sequences — no browser.
- `packages/io` round-trip tests on `corpus/public/*` (Node): open → save → reopen → structural diff.
- Fidelity tests: headless Chromium (Playwright) renders each corpus file via the real renderer to PNG at the reference's resolution; perceptual diff vs AutoCAD reference with per-file tolerance.
- Perf tests: Playwright + `performance.now()` around open/pan/zoom/osnap on `bench-*.dwg`; thresholds from `PRD.md` §12.
- Offline test: Playwright with network blocked after load.
- Private corpus: same harness, run locally with `pnpm test:private`, never in CI.

## 17. Observability (local only)

- `DEBUG=triya:*` namespaces; an in-app diagnostics panel (frame time, entity counts, cache sizes, worker status, last command timing).
- Error reports: assembled client-side, shown to the user, sent only on confirmation to `report.openengtools.com` (Cloudflare Worker → GitHub issue in a private triage repo).

## 18. Build and release

- `pnpm` workspaces + `turbo`; Node 22; TypeScript strict; ESLint + boundaries; Prettier.
- `pnpm build` produces `apps/web/dist`; Cloudflare Pages deploys `main` to production and PR previews to `*.pages.dev`.
- Release = tag `vX.Y.Z` → GitHub Release with changelog → Pages deploy.
- `third_party/planegcs` builds in CI (Emscripten docker) and the artifact is cached; `third_party/acad-ts` is a filtered snapshot of a pinned upstream commit (DEC-033, `third_party/sync-acad-ts.sh`) with a `PATCHES.md` listing every local change and its upstream PR.

## 19. Things that look optional but are not

- Handles preserved verbatim (round-trip diff depends on it).
- Exact text width measurement (dimension fit depends on it).
- Epsilon derived from extents (trim/extend on inch drawings depends on it).
- Engine with zero DOM (CI fidelity tests depend on it).
- `ChangeSet`-based rendering (60 fps at 100k entities depends on it).
- Commands as generators (Dynamic Input, scripting, MCP later, and command tests all depend on it).
