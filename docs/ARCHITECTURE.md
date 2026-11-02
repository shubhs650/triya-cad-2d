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
│  ├─ fonts/                   # Bundled Hershey stroke fonts as Triya stroke-font JSON (`pnpm fonts:build`, DEC-044)
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
- **Render worker** owns the `OffscreenCanvas`. It never touches the document; it keeps a render replica (`RenderSession`): a `DocumentModel` built from the same `DocumentInit` as the engine's and fed the same `ChangeSet`s, with its own spatial index and scene cache, so tessellation, culling and hit testing all run off the main thread. Change sets cross `postMessage` as structured clones, so the session swaps each `before` side for its own object (matched by id or handle) before applying, and checks that new handles bind to the engine's entity ids. The protocol is plain messages (`packages/render/src/protocol.ts`); hit test and flush are the only requests with replies.
- **I/O worker** is spawned per heavy job and terminated after, so a 30 MB parse never blocks interaction and memory is reclaimed. `readInWorker(bytes, { createWorker, onProgress, signal })` in `@triya/io` is the main-thread side; the worker entry `@triya/io/worker` exposes `ioApi` over Comlink. The bytes are transferred, not copied. acad-ts parses in one synchronous call, so progress is reported per stage (`parse`, `summarize`, `done`), not per byte. Aborting the signal terminates the worker at once and rejects with `AbortError`; the worker is terminated however the job ends, which discards its heap. Only the client may be imported on the main thread: the package index pulls in acad-ts.
- Input → command engine round trip must be < 16 ms (T3). Rubber-banding during a command is drawn by the render worker from a `TransientLayer` fed by the engine's preview output, not by re-running the command.
- On Firefox/Safari without `OffscreenCanvas` transfer, the render worker's code runs on the main thread behind the same interface (`RendererHost`), so no second code path exists. Both paths composite OffscreenCanvas layers, and a Playwright test (`tests/e2e/fidelity/renderer-host.spec.ts`) checks that they render pixel for pixel alike on dark and light canvases.

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
- **Spatial index (M1-07).** `SpatialIndex` (`engine/src/spatial/`) keeps one R-tree per block record, keyed on bounds in that block's own coordinates: model space is WCS, each paper-space layout queries its own block record (`queryLayout`), and block definitions are indexed too so INSERT bounds come from block extents (base point, scale, rotation and MINSERT cells applied to the extents box; nested references and `*D` dimension blocks included, reference cycles are "unknown"). Each tree is a static packed Hilbert R-tree (flatbush layout, our own code) plus an overlay of entries edited since packing; dead items are skipped and the tree is repacked once edits pass 1/16 of the block (at least 256). `apply(changeSet)` runs right after `DocumentModel.apply` with the same change set and re-bounds the touched entities, then every reference whose block's extents changed, up through nesting. Bounds are `box` (always contains what the entity draws), `infinite` (XLINE/RAY, clipped against the query exactly; HATCH by the union of its boundary loops; ACAD_TABLE by its `*T` block's extents in the table's frame, or the disc of its grid's diagonal around the insertion point while those are unknown), `empty`, or `unknown` (annotations until exact metrics are injected through `annotationBounds`: `textBounds` in `@triya/render` gives TEXT, MTEXT, ATTDEF and ATTRIB the box of what the renderer draws once their font is loaded, and `reboundAnnotations()` re-bounds them when fonts load or a text style changes, M1-35 part 1; a LEADER or MULTILEADER is the union of its parts, M1-52; a TOLERANCE the union of its frames and text once `measureText` is given, M1-52 part 4; block-less dimensions stay unknown until the dimension engine; a spline stored only as fit points until the kernel interpolates it, M1-47): queries always return unknown entities, so they are a superset and callers test candidates' geometry.
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
- **Primitives (M1-12):** `tessellate(geom, paint)` turns an entity into packed world-coordinate path commands (`M L A E Z`, and the Bézier commands `Q C` for TrueType outlines, DEC-042). Circles, arcs, ellipses and bulge segments stay exact as canvas arcs and ellipses, so zooming never re-tessellates; only splines are flattened (deviation = size × 1e-4). XLINE/RAY become `infinite` primitives clipped to the view at draw time, and solid hatches and SOLID/TRACE become fills (odd parity, except hatch style 2). `paint.ts` (`createPaint`, M1-13) resolves colour, lineweight and linetype at cache time with the `style/` rules below (Default shows at `LWDEFAULT`, a registry setting passed as an option, 0.25 mm unless set) and keeps ACI 7, 0 and ByBlock as a `'foreground'` token resolved per frame from `RenderStyle`, so a theme switch needs no re-tessellation. A paint with a linetype gives a stroke of explicit dashes (dots as zero-length segments, which the round cap draws as wide as the line) that keeps its exact `continuous` path and `patternLength` beside it; fills, points and XLINE/RAY stay continuous. Kinds owned by later tasks (INSERT, DIMENSION, pattern hatches, polyline widths) produce no primitives yet; TEXT and MTEXT draw their glyphs when fonts are passed (`tessellate(geom, paint, { text })`, M1-41, §8) and nothing without them.
- **Renderer (M1-12):** `Canvas2DRenderer` keeps a per-entity primitive cache rebuilt only for the entities a `ChangeSet` touches (the whole block when a layer, a linetype or `$LTSCALE` changes, since that can restyle or hide anything), each entry holding the entity's world size and centre for the sub-pixel LOD, draws the scene into its own layer and composites the transient layer on top, so moving a rubber band is two bitmap copies. Paths are built relative to the view centre (canvas maths is float32), strokes of the same colour and width are batched into one path, setTransform runs only when switching between world and device space, and when most of the block is in view the frame walks the block's draw order over marked R-tree hits instead of sorting them (100k entities: about 250 ms of frame CPU down to about 25 ms). `hitTest` refines R-tree candidates by true distance to each primitive (inside counts for fills; a dashed entity is measured along its continuous path, so a click in a gap selects it). An entity with a linetype is cached continuous and its dashes are fitted the first time a frame shows them at a zoom where one pattern spans at least a pixel, then kept until the entity changes, so opening a drawing pays nothing for dashes.
- **Culling:** R-tree query of the view rect; **LOD:** text below 3 px cap height → a faint box per run (greeking, M1-41 part 2); hatch below density threshold → fill with average tint; dashed linetypes below 1 px per pattern unit → solid.
- **Linetypes:** fitted once per change (on first display, see Renderer) by `dashPath`/`dashPolyline` (`render/src/style/`) into explicit dashes, dots and text/shape placements in world units, which the renderer strokes solid; the scale is `LTSCALE × object scale`, divided by the viewport scale under `PSLTSCALE` 1 and multiplied by the annotation scale under `MSLTSCALE` 1 (`linetypeScale`). AutoCAD A-type alignment: half of the first dash (or more, lengthened by half the leftover) starts and ends each open path, a path shorter than one pattern is continuous, `PLINEGEN` off fits each polyline segment on its own, and a closed path is fitted from its start point with the end and start dashes joined there. A text or shape belongs to the element before it and sits at that element's end, offset `X` along and `Y` across the path (`R`/`A`/`U` rotation). Curves are flattened for fitting at the spline deviation (chord sagitta 1e-4 of the radius), and an entity holding more than 20 000 repetitions draws continuous, which keeps the cache bounded under a far-too-small LTSCALE (our limit; AutoCAD documents none). Text and shapes in complex linetypes leave their gap empty, and XLINE/RAY draw continuous, until M1-45. `.lin` files are read by `parseLin`; the bundled set is `assets/linetypes/triya-iso.lin` (ISO 128-20 types 02–15, authored for Triya).
- **Lineweights:** `LWDISPLAY` off → 1 px. On: lineweight 0 is 1 px; on the Model tab widths are pixels proportional to the plotted width (96 px per inch, rounded, times the display scale) that do not change with zoom; in a layout they are real paper millimetres at the current zoom, at least 1 px (`lineweightPixels`), as AutoCAD displays them. Default is `LWDEFAULT`. The renderer treats a layout's block as paper space, in its page setup's paper units and plot scale (M1-18), or millimetres for a metric drawing and inches for an imperial one when it has no page setup.
- **Colour:** the ACI palette is computed (`aciRgb`: 24 hues 15° apart × 5 values × 2 saturations, plus the named colours and greys), true colour and colour-book colours are their RGB; ACI 7 and ByBlock outside a block resolve to `foreground`, which the renderer turns black or white per frame from the background. ByLayer/ByBlock resolution (`resolveColor`, `resolveLinetype`, `resolveLineweight`, with `blockContext` per INSERT, objects on layer 0 taking the INSERT's layer) runs at cache time with invalidation on layer/block changes.
- **Block references (M1-14):** an INSERT is cached as one entry holding its block's primitives carried into drawing coordinates by `expandInsert` (`render/src/blocks.ts`): position · rotation · MINSERT cell offset (along the turned axes, unscaled) · scale about the block's base point, recursing through nested inserts up to 32 levels (which also ends a damaged self-referencing block). Arcs stay canvas arcs under rotation, uniform scale and mirroring (a mirror reverses their direction) and become exact ellipse arcs under non-uniform scale (conjugate half-diameters), so nothing is flattened. ByBlock and layer 0 inherit from the INSERT through `blockContext`; an invisible reference or one on a frozen layer draws nothing, and one on a layer that is only off still draws the contents on layers of their own. Linetypes inside a block are fitted in block units and scale with the reference, lineweights do not. Each block draws in its own SORTENTSTABLE order. The entry records every block it draws from, so a change to an entity of a block, or to its SORTENTSTABLE, re-caches every reference to it through nesting. Attributes, `*U` badge metadata and caching a block's tessellation once for all its references come in later parts. A DIMENSION (M1-15) draws its stored `*D` block the same way, untransformed (the block holds the dimension as last drawn, in drawing coordinates; DXF 12 is at the origin in every corpus file and is not applied), with the dimension handing down its properties as an INSERT does; a dimension without a block draws nothing until the dimension engine (M5) makes one. An ACAD_TABLE (M1-17) draws its stored `*T` block in the table's frame: the block's origin (less its base point) at the insertion point, which is the table's top-left corner, its x axis along the horizontal direction and its y axis along normal × direction, so a −Z table is mirrored; every corpus table's block spans x 0 → width and y −height → 0. A table without a block draws nothing until the table engine (M4-05) makes one from its cells.
- **Draw order:** `SORTENTS`/`DRAWORDER` honoured via per-block sorted lists: `mapSortEnts` reads each block record's `SORTENTSTABLE` into a `SortEntsTable` object, and `drawOrder` sorts the block by sort handle, an entity without an entry by its own handle, equal keys in block order; a block without a table keeps its order. The renderer rebuilds the order when entities are added, removed or moved, or a `SORTENTSTABLE` object changes.
- **Layouts:** paper background, printable-area dashes, each viewport rendered with its own view transform and clip, layer VP overrides applied, `MSPACE` active viewport outlined. *Built (M1-18 part 1):* a `Layout` carries its page setup (`LayoutPlot`, mapped by `mapLayouts`), and `layoutSheet(layout)` (`engine/src/layout/`) puts the paper-space origin at the printable area's lower-left corner moved by the plot offset, with the margins turned with a rotated plot (90°: the displayed left margin is the stated top one, the bottom the stated left; checked against AutoCAD's stored limits on 70 corpus layouts) and paper units of inches or millimetres times the plot scale. `viewportTransform(vp)` maps model XY onto the sheet: DCS axes by the arbitrary-axis algorithm on the view direction, turned counterclockwise by the twist, origin at the target, the view centre (DCS) at the frame centre and the view height across the frame height. The renderer draws a layout's block with the area around the sheet in `layoutBackground` (default: the background a third of the way to grey), the paper in `background`, the printable area dashed, then each viewport that shows model space (not id 1, DXF 68 > 0, not turned off) in stacking order, clipped to its frame and culled by the model-space index, then the paper-space entities, VIEWPORT frames among them, on top. Model-space entities share the one cache; a viewport only changes the transform they draw through, and the LOD measures them at the layout zoom times the viewport scale. A viewport whose layer is off or frozen still shows its view (AutoCAD documents off; frozen is taken the same way). *Part 2:* a viewport's frozen layers (DXF 341) hide the model-space entities on them in that viewport only; inside a block reference each part carries its own effective layer and every nested reference's (`RenderPrimitive.layers`, one shared array per chain), so a part on a frozen layer, or under a nested reference on one, is skipped, and a reference on a frozen layer goes whole. Under PSLTSCALE 1 (the layout's DXF 70 bit 1, AutoCAD's default) model-space linetypes in a viewport are scaled by 1 / the viewport scale, so dashes are the same length on the sheet in every viewport; each entry keeps its fitted dashes per multiplier. Lineweights in a layout, inside viewports too, are paper millimetres in the layout's plot paper units.
- **Transient layer:** separate `OffscreenCanvas` composited on top, so rubber-banding never invalidates the scene cache.
- **Budget:** the frame loop targets 60 fps; if the previous frame exceeded 16 ms, the next frame renders at reduced LOD and schedules a full-quality frame when idle.

## 8. Text (`packages/text`)

- **SHX:** parser for shape/font files (unifont and bigfont handled; bigfont minimal); stroke interpreter produces glyph polylines; caches per font/char. `parseShx(bytes)` (`text/src/shx/`) returns an `ShxFont`. Its `glyph(code)` gives pen-down paths in font units with arcs kept exact as bulges (split at ≤ 90°), plus the pen's end position as the exact advance; `scaleFor(height)` is height / `above`. Where AutoCAD's shape documentation is silent, a subshape continues with the caller's pen and scale, restoring a pushed location moves without drawing, a clockwise fractional arc mirrors the counter-clockwise offsets, and a subshape cycle draws nothing. Font resolution order: text style's font → user font store (OPFS) → bundled Hershey equivalent by name map (`SHX_EQUIVALENTS`: `romans`, `simplex`, `txt`, `monotxt` and the ISO fonts → `oet-simplex`; `romand`, `romanc`, `romant` → duplex, complex, triplex; `italic*` → `oet-italic`; `scripts`/`scriptc`, `gothice`/`gothicg`/`gothici` → their Hershey namesakes) → FONTALT (through the same map when not loaded) → `oet-simplex`. A missing font is reported in the health panel from `FontBook.substitutions`.
- **Bundled fonts (M1-09, DEC-044):** `assets/fonts/oet-*.json` are converted by `pnpm fonts:build` from the original Hershey occidental data (`assets/fonts/hershey/hershey.jhf`) with the catalog in `text/src/hershey/catalog.ts` (ASCII layouts of the Hershey distribution's mapped fonts, plus our Unicode Greek, symbols, Latin-1 accented letters and diameter sign). The format is `{ format: 'triya-stroke-font', version: 1, name, description, notice, above, below, glyphs }` (`notice` carries the acknowledgements the Hershey terms require), glyphs keyed by code point as `[advance, polylines]` in half Hershey units (cap height 42, y up); `loadStrokeFont` turns one into a Unicode `ShxFont` (code 8 moves), so FontBook, `fontMeasure` and the renderer use it like any SHX font. A testkit test fails when the committed files drift from the data.
- **TTF:** browser/`opentype.js` for glyph paths (needed for consistent SVG/PDF and width measurement across platforms); same shaping on main thread and workers. `parseTtf(bytes)` (`text/src/ttf/`) returns a `TtfFont`: outlines in font units (y up, M/L/Q/C/Z kept as the font stores them), advances summed by code point (missing characters take .notdef), kerning only on request (AutoCAD does not kern TEXT), and `scaleFor(height)` = height / cap height (OS/2 `sCapHeight`, else the 'H' outline). `TtfRegistry` resolves a style's family through injected `FontSource`s in order, then a fallback list, caching per family and style and flagging substitutions for the health report. opentype.js is imported through `ttf/lib.ts`, which picks its ESM or UMD build so Node, workers and Vite share one code path.
- **MTEXT engine:** full formatting-code parser (`\P \A \C \F \H \W \Q \T \L \O \K \S` stacking, `\pxi` paragraph props, columns, `%%` codes, fields), line breaking by width with word wrap, justification, background mask; produces glyph runs for the renderer and the editor. `parseMText(contents, base, options)` (`text/src/mtext/`) gives paragraphs of styled items (text, field, big-font character, stack, tab); `mode: 'text'` reads TEXT/ATTRIB contents, and fields show `evaluateField(code)` or `----`. `layoutMText(doc, measure, box)` positions runs in the MTEXT's own frame (origin at the insertion point, y up): single spacing 5/3 × height ("at least" grows for taller characters), `\p` indents and tabs in multiples of the MTEXT height with default stops every 4, attachment top at the first cap line and bottom at the last baseline, stacks at 70 %, columns filled to their height or broken by `\N`, and the mask (scale − 1) × height beyond the box. Widths come from an injected `MTextMeasure`, so the engine runs on any font source. Where AutoCAD documents no rule, the choice is commented in the code: `\c` is red-low-byte (COLORREF), an x suffix makes `\H`, `\W` and `\T` relative, paragraph properties carry into later paragraphs, and an unknown code shows literally.
- **Width measurement** is exact (not estimated) because dimension text fit rules depend on it.
- **Drawing text (M1-41 part 1):** `FontBook` (`text/src/draw/`) is the synchronous view of the fonts already loaded: SHX by file name (no folder, case or extension), TrueType by file name or family (best bold/italic match), then the alternate font (FONTALT), recording every font it could not serve in `missing`. `styleFont(style)` reads a STYLE's font kind from its file extension and bold/italic from its ACAD xdata flags. `fontMeasure(fonts, bigFont?)` is the `MTextMeasure` with exact advances (SHX pen ends, TrueType hmtx, no kerning; a font not loaded measures height-wide cells and draws nothing). `shxCode` maps `%%d`, `%%p`, `%%c` to 127/128/129 in a non-Unicode SHX font that lacks the Unicode code, and anything missing to `?`. The renderer's `textPrimitives` (`render/src/text.ts`) lays TEXT out with the same engine (`mode: 'text'`, so `%%u`/`%%o` decorate) and MTEXT with its box, then places each glyph through its run's height, width factor and obliquing and the entity frame (rotation, backward, upside down): SHX glyphs as strokes with exact arcs, TrueType glyphs as non-zero fills with exact Béziers, one primitive per colour, glyph paths cached per font and character. TEXT justification follows AutoCAD: left baseline on DXF 10, every other justification on DXF 11 (bottom at the descender line, middle at half the cap height, top at the cap height, Middle between descender and cap height), Aligned scaling and Fit stretching between 10 and 11. `Canvas2DRenderer` takes `fonts` (and `evaluateField`) as options, hands them to block contents, so dimension and table text draws, and re-tessellates the block when a text style changes. **Part 2:** an MTEXT background (DXF 90) fills its colour (bit 1) or the canvas background (bit 2, the `'background'` primitive colour, resolved per frame like `'foreground'`) under the glyphs, (scale − 1) × height beyond the text box and per column, and bit 16 strokes a frame on that edge over them (where the frame goes is undocumented; to be checked against plots). Each glyph primitive carries `text: { height, greek }`, its tallest cap height and one cap-height box per run; under 3 CSS px the renderer fills the boxes at 35 % instead of drawing glyphs (greeking; AutoCAD draws every glyph, so the alpha is ours). Not yet: vertical MTEXT, font loading into the worker renderer and the app (M1-37), and the reference-plot check (M1-24/M1-26).

## 9. Dimensions (`packages/dims`)

- `DimensionEngine.generate(dim, style, scale) → BlockContent` implements AutoCAD's rules for every dimension type: extension lines (`DIMEXO/EXE/SE1/SE2`), dim lines, arrowheads (standard set as generated shapes + user blocks), text placement (`DIMTAD/TIH/TOH/JUST/TMOVE/ATFIT/TIX`), fit logic (text/arrows inside/outside, leader when moved), units/precision/zero suppression/prefix-suffix (`DIMLUNIT/DEC/ZIN/RND/DSEP/POST`), tolerances and limits, alternate units, `DIMSCALE`, annotative scale, `DIMTXSTY`, text override with `<>`.
- **Leaders (M1-52).** `multiLeaderParts(mleader, model)` (`engine/src/annotation/`) splits a MULTILEADER into the entities AutoCAD draws for it: per branch, each leader line as an LWPOLYLINE from the arrowhead's back (or from the tip for the tick, oblique, small-dot, integral and none arrowheads) to the connection point, then one landing along the branch direction (horizontal attachment with the dogleg on; with it off the lines run to the landing's end, and vertical attachment has none); each arrowhead as a closed filled SOLID one drawn-arrowhead size long and a third of it wide, or an INSERT of its block (the entity's, else the style's) scaled by that size, +X pointing away from the line; then the MTEXT content, its frame as an MTEXT background frame a landing gap out. Leader parts carry the leader line colour, linetype and lineweight, the text its own colour, ByBlock meaning the MULTILEADER's (`partEntity`). The values stored on the entity are drawn whether or not DXF 90 flags them as overrides (what AutoCAD and BricsCAD files show). The renderer expands the parts like a block reference (`expands`, `expandInsert`), inside blocks too, and the spatial index bounds a MULTILEADER by the union of its parts' bounds (text through `annotationBounds`), re-bounding it when an arrowhead block changes. Spline leaders are fit-point SPLINEs that draw and bound once M1-47 interpolates them. Block content is an INSERT of its block (part 2). A LEADER (`leaderParts`, part 2) is its path and arrowhead, styled by `dimVars(style, xdata)`: the DIMSTYLE's DIMVARs with the entity's ACAD `DSTYLE` xdata overrides on top. The path ends with the hook line AutoCAD stored; with MTEXT annotation, a hook line and DIMTAD ≠ 0 it goes on under the text by DIMGAP × DIMSCALE + the text width (DXF 41), along the horizontal direction or against it when DXF 74 is 1 (as AutoCAD files show; the DXF reference describes 74 the other way). The arrowhead is DIMLDRBLK or closed filled, DIMASZ × DIMSCALE (0 taken as 1), with the line running to the tip; DIMCLRD, DIMLTYPE and DIMLWD style both. A TOLERANCE (`toleranceParts`, part 4) is one rectangle per non-empty compartment (rows split by `^J`, compartments by `%%v`) in DIMCLRD and DIMLWD and each compartment's text as an MTEXT (middle left, a gap in) in DIMTXSTY and DIMCLRT: rows are DIMTXT × DIMSCALE plus two gaps (DIMGAP × DIMSCALE) high and stack downwards from the insertion point, which is half way up the first row's left edge; a compartment is its text's width plus a gap either side. The engine has no fonts, so the widths come from an injected `TextMeasure` (`textMeasure` in `@triya/render`, the MTEXT layout's widest line), passed to the spatial index as `measureText` and taken from the block source's text context by the renderer; without it a TOLERANCE has no parts and is unknown. AutoCAD does not document this geometry; the rules are the common drafter expectation, to check against reference plots. Not yet: block-content attributes, per-line overrides, underline/overline attachments.
- **Stored-block policy (DEC-011):** an imported dimension renders from its `*D` block until any of its properties, defpoints or style changes; the first change regenerates with the engine and sets `regenerated: true`. A health check lists dims whose regenerated output differs from the stored block beyond tolerance (surfaces engine bugs on real files).
- `DIMASSOC=1`: defpoints are grip points; STRETCH/MOVE/SCALE/ROTATE/MIRROR of defpoints regenerates. Data model keeps `associativity?: { entity: Handle, subentity, param }` slots unused in v1 so `DIMASSOC=2` is additive.

## 10. Hatch (`packages/hatch`)

- `.pat` parser (angle, origin, delta, dash spec) — exactly AutoCAD's semantics including the "offset along angle" quirk.
- Pattern generation clipped to boundary loops in world space, cached per hatch; dense patterns thinned for LOD. **M1-16 part 1:** `hatchPattern(hatch)` takes the definition lines the HATCH stores (already scaled and rotated), each a family through base + n·offset whose dashes start at each line's own origin, and clips every line to the boundary loops (`loopSegments`, each curve flattened to 1e-4 of its own size) by sweeping its crossings and counting the loops around each stretch: normal hatches odd counts, outer exactly one, ignore any. It counts the lines first and returns `too-dense` past HPMAXLINES (1,000,000), which the renderer shows as the filled area. The renderer caches the result per change as one stroke primitive of segments and dots per definition line (family); the hatch's linetype does not apply to pattern lines. **M1-16 part 2:** each family's stroke carries the hatch area, its line spacing and its ink per dash repetition; once the spacing is under a CSS pixel the renderer fills the area instead at the alpha the lines would paint (line width over spacing across them, dashes plus round caps over the repetition along them), family by family, so a coarse family keeps its lines while a fine one turns to tint.
- `.pat` files (M1-16 part 3): `parsePat` reads AutoCAD's documented format (`*name, description`, then `angle, x-origin, y-origin, delta-x, delta-y, dashes…`; text after `;` ignored; lines over 80 characters warned). `patternLines(pattern, {angle, scale, origin})` gives the lines a HATCH stores (DXF 53–49): each line's angle plus the hatch angle, its origin scaled and turned about the hatch origin, its delta (along, across) scaled and turned into the line's own direction, its dashes scaled. `userDefinedLines` makes DXF 76 = 0 hatches (spacing in DXF 41, a second family at 90° when doubled). `PatternLibrary` matches names without regard to case and lets a later file win; `bundledPatterns()` is `assets/patterns/triya-iso.pat`, embedded as `bundled.ts` (a test keeps them equal), in millimetres and re-authored from ISO 128-50/128-20 and plain geometry with `TRIYA_` names. A hatch from a file draws from its stored lines; `hatchLines` falls back to the library only for one stored without them.
- Boundary detection: `BoundaryTracer` builds a planar graph from visible entities within the pick region (lines, arcs, circles, polylines, ellipses, splines flattened), finds the smallest enclosing loop around the pick point, then islands by containment; gap tolerance (`HPGAPTOL`); island modes. Result is a `HATCH` with edge-typed loops (line/arc/ellipse/spline), preserving source entity references for a future associative mode.
- Solid and gradient (`GRADIENT` two-colour, nine styles) via canvas fills. **M1-16 part 2:** `gradientRamp(hatch)` fits the named ramp to the boundary's extents in the gradient's frame (turned by DXF 460) and returns a linear or radial ramp as a unit frame plus stops weighted between colour 1 and colour 2: LINEAR left to right, CYLINDER colour 2 along the middle, SPHERICAL colour 2 at the centre out to colour 1 at the corners, HEMISPHERICAL the same about the middle of the bottom edge, CURVED parabolic from colour 2 at the bottom, INV* swapping the colours; a shifted gradient (DXF 461) moves a quarter of the extents left (and up for the radial and bottom-anchored ramps). AutoCAD documents none of the ramps beyond the dialog's swatches, so these are the common reading, to be checked against reference plots in the M1-16 acceptance. The renderer draws the fill with a canvas linear or radial gradient through world ∘ ramp frame, resolving the colours per frame (ACI 7 follows the background), and makes a one-colour gradient's second colour from the tint (DXF 462, GFCLRLUM: 0 black, 0.5 the colour, 1 white).

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
- Perf tests: Playwright + `performance.now()` around open/pan/zoom/osnap on the generated bench drawings (`packages/testkit/src/bench`, DEC-045); thresholds from `PRD.md` §12.
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
