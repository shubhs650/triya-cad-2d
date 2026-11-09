# Testing and Fidelity Strategy

Fidelity is the product. This document defines the corpus, the harnesses, the tolerances, and the gates. All of it runs from `pnpm` scripts; CI runs the public parts on every PR; the owner runs the private parts locally.

## 1. Test layers

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Unit | Vitest (Node) | `engine`, `io` adapters, `text`, `hatch`, `dims`, `constraints`, `library`, `compare`, `pdf` | every PR |
| Command | Vitest (Node) | commands driven by scripted `PromptAnswer` sequences on the `PromptBus`; assert resulting `ChangeSet` | every PR |
| Round-trip | Vitest (Node) + `testkit` | open → save → reopen → `structuralDiff` on every public corpus file | every PR |
| Fidelity | Playwright (Chromium headless) + `testkit` | render each public corpus file through the real `Canvas2DRenderer` to PNG; perceptual diff vs its reviewed Triya golden image (DEC-047) | every PR |
| Perf | Playwright | T1–T3, T5–T7 on the generated bench drawings | PRs touching `render`/`engine`/`io`; nightly |
| Offline/privacy | Playwright with network blocked | T8; assert zero requests | every PR |
| UI | Playwright | dialogs, ribbon breakpoints (T9), grips, keyboard | every PR |
| Cross-browser | Playwright WebKit + Firefox | degraded-mode paths | nightly |
| Private corpus | same harnesses | owner's real drawings | owner, locally |
| DXF audit | ezdxf (CI only, MIT) | `ezdxf.recover` + `audit` on every Triya-saved corpus DXF, 0 errors (M1-105, replaces AutoCAD AUDIT, DEC-047): `TRIYA_DXF_AUDIT_DIR=test-reports/dxf-audit pnpm test` writes the AC1032 save of each readable corpus file unedited (`testkit/src/dxf-audit`), edited (`export.corpus.test.ts`) and after a markup session (`export-markup-commands.corpus.test.ts`, M2-08: clouds, a wipeout, WIPEOUTFRAME and draw order) and after a multileader session (`export-mleader-commands.corpus.test.ts`, M2-09), then `python scripts/dxf-audit/audit.py test-reports/dxf-audit` (after `pip install -r scripts/dxf-audit/requirements.txt`) audits them, allowing only what ezdxf reports on the source too (`exceptions.json`), and first checks that a save with a dangling owner handle fails | every PR |

### 1.1 CI wiring (`.github/workflows/ci.yml`)

| Job (check name) | Runs | When |
|---|---|---|
| `lint · typecheck · unit · round-trip` | `pnpm lint`, `typecheck`, `test`, `corpus:validate`, `changelog:check` | every PR and push to `main` (**required**) |
| `fidelity · offline · ui` | `pnpm build`, `test:fidelity`, `test:offline`, `test:ui`, `test:io`; uploads `test-results/` + `playwright-report/` as `fidelity-diffs` on failure | every PR and push to `main` (**required**) |
| `performance budgets` | `pnpm test:perf` | `main`; PRs that change `packages/render`, `engine` or `io` (`detect hot-path changes` job); PRs labelled `perf` or titled `[perf]` |

Offline, UI and io suites still run after a fidelity failure, so one red run shows every broken gate. pnpm's store and Playwright's browsers (keyed on the Playwright version) are cached. `auto-merge.yml` enables squash auto-merge only after a CI run for the PR's current head succeeds, so a failing check never merges even without branch protection. `tests/ci/workflows.test.ts` pins all of this, including the two required check names.

## 2. Corpus

### 2.1 Public corpus (`corpus/public/`, committed)

- **Self-authored set** (DEC-047: threads author these as AC1032 DXF with acad-ts, a committed ezdxf script or by hand from the DXF reference, when the task that needs one starts; the owner is never asked for them. The names below say what each drawing must contain; DWG and multi-version items are post-launch):
  - `ga-vessel-a1.dwg` — horizontal vessel GA, 3 layouts, viewports at 1:10/1:20, title block with attributes, nozzle schedule table, ISO-25 dims, ROMANS text, ANSI31 sections
  - `nozzle-orientation.dwg` — polar array, angular dims, mleaders
  - `saddle-detail.dwg` — hatched sections, chamfers, fillets, ordinate dims
  - `title-block-attrs.dwg` — attributes incl. multiline, constant, invisible
  - `table-heavy.dwg` — merged cells, cell overrides, table style
  - `annotative-sheet.dwg` — annotative text/dims across two viewport scales
  - `xref-parent.dwg` + `xref-child-tb.dwg` + `logo.png` — attach + overlay, XCLIP, image
  - `pdf-underlay.dwg` + `vendor.pdf`
  - `linetypes.dwg` — all bundled linetypes incl. complex, LTSCALE/PSLTSCALE cases
  - `r12.dxf`, `r2000.dwg`, `r2007.dwg`, `r2013.dwg`, `r2018.dwg` — same drawing saved by AutoCAD in each version
  - `dynamic-block.dwg` — one dynamic block in two states (render-only test)
  - `constraints-acad.dwg` — AutoCAD constraints (passthrough test)
  - `viewport-overrides.dxf` — **committed** (M1-62, `scripts/corpus/viewport-overrides.py`): four viewports on one view, the second with VP colour, linetype, lineweight and transparency overrides on two layers, one clipped by a closed polyline and one by a circle
  - `traces.dxf` — **committed** (M1-75 close-out, `scripts/corpus/traces.py`): the one type Triya writes that no other public file has, TRACE: a mitred three-segment wide line, one with an elevation and thickness, one on a −Z extrusion, a triangle, and a block of a TRACE and a LINE inserted turned and scaled; `export.corpus.test.ts` checks every type with a writer is edited on some corpus file
  - `multileaders.dxf` — **committed** (M1-111, `scripts/corpus/multileaders.py`, LEADER_LINE overrides written by hand where ezdxf cannot): two block multileaders of a balloon with attribute values (one turned 15° at 1.5×), an MTEXT multileader with three leader lines (as the multileader, overriding colour/linetype/lineweight/arrowhead/size, overriding path type and colour only), the underline attachments 5, 6 and 8 from the left and right, and the vertical overline and underline (10); `multileaders.corpus.test.ts` checks each case
  - `transparency.dxf` — **committed** (M1-108, `scripts/corpus/transparency.py`): hatches at 0–90 % of their own over an opaque band, ByLayer objects on a 50 % layer, a block with a ByBlock hatch and a layer-0 circle inserted at 70 % and opaque, and Layout1's second viewport overriding the band's layer to 60 % and the 50 % layer to opaque
- **Generated benchmark drawings** (DEC-045): `bench-100k` (100k entities, 50 blocks, 5 layouts) and `bench-ga` (25k entities, 30 blocks, 2 layouts) are built in the test from a seeded generator (`packages/testkit/src/bench/drawing.ts`), not committed or owner-provided. The mix is 40 % LINE, 15 % LWPOLYLINE, 10 % each CIRCLE, ARC, INSERT and TEXT, 5 % MTEXT; dimensions and hatches join it once Triya generates their geometry.
- **Third-party samples** with redistributable licenses: ezdxf test files (MIT), ACadSharp samples (MIT). Record source + license per file in `corpus.json`.
- **References (DEC-047):** for each file, golden PNGs rendered by Triya itself (M1-24) per layout and for model extents, committed after review in the PR that adds them. AutoCAD reference plots are not required; if one is ever contributed, `pnpm corpus:ref` rasterises it and it takes precedence for that file.

### 2.2 Private corpus (`corpus/private/`, gitignored)

Owner's real vessel GAs and vendor drawings. Same `corpus.json` schema, same harness (`pnpm test:private`, M1-106): the round-trip suite (`vitest.private.config.ts`, `corpus-roundtrip.private.ts`) and the golden-image suite with `TRIYA_CORPUS=private`. Without `corpus/private/corpus.json` it says so and exits 0. Every readable private file must come back clean, or, once `TRIYA_UPDATE_BASELINE=1 pnpm test:private` has written `corpus/private/roundtrip-baseline.json`, no worse than that baseline. Golden images are kept beside the drawings in `corpus/private/refs/golden/` (written with `TRIYA_UPDATE_GOLDEN=1 pnpm test:private`). Everything stays in the gitignored `corpus/private/` and `test-reports/`: the private fidelity report (`test-reports/fidelity-private/fidelity-latest.md`) has the type table and the number of failing spaces but no file names or handles, so it can be summarised into `docs/reports/` as it is.

### 2.3 `corpus.json` schema

The public manifest is `corpus/corpus.json`; the private one is `corpus/private/corpus.json` (same schema, never committed). `corpus/corpus.schema.json` describes the shape for editors; `packages/testkit/src/corpus/manifest.ts` enforces it in `pnpm corpus:validate` and in `pnpm test`. All paths are relative to `corpus/` and start with `public/` or `private/`.

```json
{
  "$schema": "./corpus.schema.json",
  "schemaVersion": 1,
  "sources": {
    "self-authored": { "name": "Triya CAD 2D owner-authored drawings", "url": "https://github.com/shubhs650/triya-cad-2d", "license": "MIT", "licenseFile": "../LICENSE" },
    "ezdxf": { "name": "ezdxf example and integration-test drawings", "url": "https://github.com/mozman/ezdxf", "commit": "5265e6e…", "license": "MIT", "licenseFile": "public/LICENSES/ezdxf-MIT.txt" }
  },
  "files": [{
    "path": "public/ga-vessel-a1.dwg",
    "version": "AC1032",
    "format": "dwg",
    "source": "self-authored",
    "license": "MIT",
    "sha256": "<64 hex digits>",
    "tags": ["layouts","tables","dims","hatch","shx"],
    "references": [{ "space": "Layout1", "pdf": "public/refs/ga-vessel-a1-Layout1.pdf", "png": "public/refs/ga-vessel-a1-Layout1.png", "ctb": "monochrome" }],
    "tolerance": { "pixelMismatch": 0.5, "ssim": 0.985 },
    "fonts": ["romans.shx"],
    "knownIssues": []
  }]
}
```

- `version` is the `$ACADVER` code and must match the file's own header (DWG magic or DXF `$ACADVER`). A DXF without a HEADER section is declared `AC1009` (what readers assume) and tagged `no-header`.
- `format` is `dwg`, `dxf-ascii` or `dxf-binary`, checked against the file content.
- `license` (per file and per source) must be MIT, BSD-2/3-Clause, Apache-2.0, ISC, CC0-1.0 or Unlicense.
- `sha256` pins the exact bytes; `.gitattributes` keeps git from rewriting corpus line endings.
- `upstreamPath` (optional) is the file's path in the third-party repository named by `sources.<key>.commit`.
- `tolerance.pixelMismatch` is a percentage, at most 2 (the starting value for a new file, §4); it is only ever tightened.
- Every `.dwg`/`.dxf` under a scope the manifest covers must be listed; an unlisted drawing fails validation.

## 3. Round-trip structural diff

`structuralDiff(original: CadDocument, reopened: CadDocument): DiffReport` walks both acad-ts object graphs by handle and compares type, every serialisable property, xdata, extension dictionaries, reactors, owner links, and table membership. **Expected result: zero differences.**

Allowed exceptions (and only these): `$TDUPDATE` and its UTC twin `$TDUUPDATE` (DEC-034), `$TDUSRTIMER`, `$TDINDWG`, `$VERSIONGUID`, `$FINGERPRINTGUID`, `$LASTSAVEDBY` and `$ACADMAINTVER` (DEC-041), `$HANDSEED` (new ≥ old), `$DWGCODEPAGE` when writing to a Unicode version, and the ordering of entries within unordered dictionaries. Anything else is a failure. Adding an exception requires a DECISIONS entry.

After an *editing* session, the diff excludes handles in the session's touched set and asserts zero differences elsewhere.

**Harness** (`packages/testkit/src/roundtrip`, M0-05):
- `roundTrip(bytes)` reads the file twice (one copy to write, one pristine copy to compare), writes it in the same version and format (DWG, ASCII DXF or binary DXF) with `@triya/io` `writeCadDocument`, reopens the output and runs `structuralDiff`. Status per file: `clean`, `diff`, `read-error`, `write-error`, `reread-error`.
- `structuralDiff` matches every registered object by handle (`missing`/`added`/`type`), then compares its instance fields recursively. A field holding another object is compared as a reference (type + handle), so one changed object only reports on itself. Map-backed collections (dictionary and table entries, xdata by application) are unordered; lists and sets are ordered, and a pure reordering of references is reported as `order`. A null field equals an empty container, and an empty string equals a missing one, because the file formats cannot tell them apart. Header fields are reported by `$NAME`.
- acad-ts stamps `new Date()` into header variables a file does not state, so the harness pins the clock while it reads and writes; two runs on the same bytes produce the same report.
- Objects acad-ts cannot map are kept raw by `readCadDocument` (M1-30), so `structuralDiff` sees them like any other object. `rawObjectSurvival` also checks that each one comes back under its handle with the same payload (DXF group codes or DWG record); the corpus test requires zero losses, and the report prints the count.
- `pnpm corpus:roundtrip` (also part of `pnpm test`) runs every public corpus file, writes `test-reports/roundtrip/report.md` and `report.json`, and fails if any file is worse than `corpus/roundtrip-baseline.json` (worse status or more differences) or loses a declared handle not in `corpus/handle-coverage-baseline.json` (§3.2). After an improvement, `TRIYA_UPDATE_BASELINE=1 pnpm corpus:roundtrip` locks it in. Since M1-05 the save under test is Triya's own (`exportDocument` from the retained original, after mapping the drawing into a `DocumentModel`), and a separate test fails unless every readable file is `clean`. `packages/testkit/src/export/export.corpus.test.ts` edits every entity Triya can write in every corpus file (move, scale, rotate), saves, and checks that the edits map back and that `structuralDiff` ignoring only the edited handles is empty.

### 3.2 Handle-coverage gate (M1-27)

`structuralDiff` cannot see an object acad-ts never loads: it is missing before and after the save. `roundTrip` therefore also lists every handle the file itself declares and requires each one in the reopened document (`roundtrip/handle-coverage.ts`):
- **Scanners**, independent of the acad-ts object graph: the DWG handle map, each entry typed from its object record's header (object type, or the DXF class name for custom objects); ASCII DXF and binary DXF (R12 one-byte and R13+ two-byte group codes) `5`, and `105` for `DIMSTYLE`, outside HEADER and CLASSES. A `5` after the subclass marker of a `SORTENTSTABLE` is a sort handle (a draw-order key paired with a `331`), not an object, and is not counted. A stream the scanner cannot list fails the gate instead of reporting zero handles.
- **Present** means in `getCadObjects()` or held by its owner: acad-ts keeps polyline vertices, polyface-mesh faces, attributes and their `SEQEND` inside the owning entity under their file handles, and those children's extension dictionaries (with what the dictionaries hold) inside the child; child fields are held inside their parent field (`documentObjects`). `structuralDiff` compares held children by handle like every other object (M1-68), so a change inside an attribute, vertex or face is reported. No other exception and no allow-list (DEC-038).
- Objects no reference reaches (an owner the file lacks, a nameless block with no record) are present too: `fidelity*ReaderConfiguration` sets acad-ts' `keepUnreachableObjects`, which keeps them raw in `CadDocument.unreachableObjects` (M1-33 part 5). Since then no readable corpus file loses a handle.
- Each missing handle is reported with its type and stage: `read` (acad-ts never loaded it) or `save` (loaded, then dropped by the writer). The report prints the totals by type.
- **Ratchet:** `corpus/handle-coverage-baseline.json` lists, per file and type, the handles lost today. `pnpm test` fails on any lost handle not listed there (a new loss fails even when the count stays the same), when a scanned file stops being scanned, and when a corpus file has no entry. `TRIYA_UPDATE_BASELINE=1 pnpm corpus:roundtrip` rewrites it together with the round-trip baseline. Only files that cannot be read (`recover02.dxf`) are unscanned. At M1-27: 4,902 of 46,712 declared handles lost in 118 files (919 at read, 3,983 at save); M1-31 and M1-33 take every list to empty.

### 3.1 Mapping oracle (M1-03)

The round-trip diff compares acad-ts with itself, so a value acad-ts never reads is invisible to it. `packages/testkit/src/mapping/tables.corpus.test.ts` reads the HEADER and TABLES sections, and the MLEADERSTYLE/TABLESTYLE objects, of every ASCII DXF in the public corpus with an independent group-code reader (`mapping/dxf-oracle.ts`) and compares each table record field and each header variable with what `mapTables`/`mapHeader` produce, by handle (by name for R12 records without one). Losses that come from acad-ts itself are listed in `ACAD_TS_GAPS` with the reason; the test fails on a new kind of mismatch and on a listed kind that no longer occurs, so the list only shrinks (M1-32). A second test checks that every table entry acad-ts reads from every readable file, DWG included, is mapped. `entities.corpus.test.ts` does the same for entities: each entity of the ENTITIES and BLOCKS sections (POLYLINE with its VERTEXes, INSERT with its ATTRIBs; TEXT frames and INSERT placements are checked by where probe points land; DIMENSION points per subclass in their DXF frames; HATCH loops read group by group and edges compared by points along them; MULTILEADER context data, branches and leader lines read block by block; ACAD_TABLE cells split at each 171 outside their CELL_VALUE blocks, and DWG tables checked against the DXF save of the same drawing; IMAGE, WIPEOUT and PDFUNDERLAY placement, display settings and clip boundaries; MLINE vertices with their element parameters; VIEWPORT frames and views, including the R12 view kept in MVIEW xdata; REGION boundaries against the SAT text deciphered and read independently, and the SAB regions of DWG and R2013+ files against the SAT region of the same drawing). OLE2FRAME and ACAD_PROXY_ENTITY have no public corpus file, so only `packages/io/test/map-ole-proxy.test.ts` checks them (M1-40) is compared by handle with `mapEntities`, taken to plan view with the arbitrary-axis algorithm written out in the test, and every entity of every block record must be mapped or reported unmapped.

## 4. Fidelity harness

The references are Triya golden images (DEC-047): the first run of a file renders its PNGs, a person or the PR's reviewer looks at them, and they are committed under `corpus/public/refs/golden/`. Later runs compare against them. A change that is meant to alter the picture updates the golden image in the same PR and says why; anything else that differs fails.

**Harness (M1-24):** `tests/e2e/fidelity/golden.spec.ts`, one Playwright test per public corpus file, run by `pnpm test:fidelity` in the required `fidelity · offline · ui` job.

1. Headless Chromium loads the app (its Vite dev server, as the ui suite does) in a 1100 × 760 window, pins the canvas area to 960 × 600 (the chrome around it is set in the system UI font, so left to fill the window its size differs between machines), and opens the corpus file through the Open button's file picker, as a user would.
2. Each space is shown in tab order: model space at its extents (ZOOM E, the navigation bar's Zoom Extents), each layout in the paper view it opens in. A shot is taken once the canvas has settled: the network is idle and three shots 300 ms apart are the same bytes. Model space is zoomed only after it has settled, because text extents need their fonts. The navigation bar, which floats over the canvas in the system UI font, is hidden from the shots. Shots are of the screen canvas; plot-preview mode with a CTB comes with M2-18.
3. Compare with `pixelmatch` (threshold 0.1, its anti-aliasing detection on) and mean SSIM over 8 × 8 windows (`packages/testkit/src/fidelity/compare.ts`); pass if mismatch ≤ `tolerance.pixelMismatch` % **and** SSIM ≥ `tolerance.ssim`, both from the file's `corpus.json` entry.
4. On failure the test names each failing space with its numbers and the boxes (pixels, merged 32-pixel cells) where it differs, and writes `<space>-actual.png`, `-golden.png` and `-diff.png` to its `test-results/` folder, which CI uploads as `fidelity-diffs`. Each region names the entities the app draws there, by type and handle (`TEXT 2F, INSERT 31`), from the renderer's R-tree in the view shot (`Renderer.entitiesIn`, reached through the dev server's `triyaDev` hook; M1-106). A region that names no entity (`no entity drawn there`) is drawn by the golden image only: something moved away or disappeared.

Golden images are `corpus/public/refs/golden/<path below public/third-party>/<space>.png`, where `<space>` is `model` or `layout-<name>` (characters outside `[A-Za-z0-9.-]` spelled `_` for a space, otherwise `~` and the code point in hex). A missing golden image fails, as does a golden image for a space the file no longer has. `TRIYA_UPDATE_GOLDEN=1 pnpm test:fidelity` writes the missing and the out-of-tolerance ones and deletes stale ones; look at every image it changed before committing. A file the app cannot open is listed in the spec's `UNREADABLE` with its reason (today only `recover02.dxf`), and the test checks it still fails to open.

Thread-authored test drawings whose content lives in files beside them, kept under `packages/testkit/fixtures/` with their generators, have their golden images in a `golden/` folder beside them (`tests/e2e/fidelity/fixtures.spec.ts`): the test opens the drawing, drops its files on the window as a user supplies them, and shoots each space as above, at the new-file tolerance. Today that is the raster image drawing (`fixtures/raster/`, M1-19: `raster-images.dxf` with `checker.png`, `bars.bmp` and `scan.tif`, written by `pnpm fixtures:raster`, plus `site-photo.jpg`, which is never supplied) and the PDF underlay drawing (`fixtures/underlay/`, M1-20: `pdf-underlay.dxf` with `pdf-underlay.pdf`, written by `pnpm fixtures:underlay`), whose unclipped page 1 counts in ZOOM Extents once its PDF is read. The title-block drawing (`fixtures/attributes/title-block.dxf`, M2-12, written by `pnpm fixtures:attributes`) has no golden image: it is the revision-table scenario's drawing (`packages/testkit/src/attributes/scenario.test.ts`) and the attribute dialogs' (`tests/e2e/ui/attributes.spec.ts`).

Tolerances start loose (2 %, SSIM 0.95) for a new file and are tightened to 0.5 % as features land; a PR may not loosen a tolerance.

Entity-level results are reported per type into `docs/reports/fidelity-latest.md` (M1-106) by the fidelity reporter (`tests/e2e/fidelity/report.ts`) after a run: for each entity type, how many entities are in view summed over the corpus's spaces, in how many spaces, how many are drawn in a region that differs from its golden image, and in how many failing spaces; then each failing space with its regions and their entities. The report is sorted, so a run that matches every golden image rewrites the same bytes. Every run writes `test-reports/fidelity/fidelity-latest.md`; only a run that covered every public corpus file also rewrites the committed `docs/reports/fidelity-latest.md`. (Rendering each entity in isolation against a crop of its golden image, the earlier plan here, was dropped: the goldens are Triya's own renders, so the region lookup already says which entities to look at.)

## 5. Performance harness

Runs on the CI runner with fixed CPU class; thresholds carry a 20 % margin over PRD §12 to absorb runner variance; local runs report raw numbers.

- T1: Lighthouse + custom timing for "canvas interactive".
- T2: `performance.mark` around open → first full frame.
- T3: scripted pan/zoom for 5 s; count frames; measure input→prompt latency; osnap query timing at 1000 random cursor positions.
- T5: in-place save timing; autosave timing after last edit.

`tests/e2e/perf/render.spec.ts` runs the render side of T2 and T3 on a synthetic 100k-entity drawing built in the page (`tests/e2e/render-harness`); `tests/e2e/io/responsiveness.spec.ts` parses the generated `bench-100k` DWG (M1-42). It asserts the T2 first frame in the render worker and, since M1-44, T3: pan/zoom paced by animation frames (one view change and frame per frame, as the app draws) at ≥ 48 fps (60 less the runner margin) on the synthetic 100k drawing and on the generated `bench-100k` drawing mapped through `documentInit`; fps and the slowest frame are reported as test annotations.

`tests/e2e/perf/app.spec.ts` (M1-60) runs T3 in the app: it opens the generated `bench-ga` drawing with the Open button in `apps/web` at 1366 × 768, waits for its first frame, then zooms with the wheel at the cursor and pans by dragging with the middle button for 5 s each. The mouse sends 125 events a second straight to Chromium's input pipeline (CDP `Input.dispatchMouseEvent`, not awaited one by one: Playwright's `mouse.wheel`/`mouse.move` wait for each event and top out near 30 and 60 a second). A frame counts when the render worker has drawn it: `CanvasController` keeps one frame in flight and fires `framedrawn` on its canvas when the renderer acknowledges it. It asserts ≥ 48 fps for each gesture and that the mouse sent more events than frames; fps, the slowest frame and open → first frame are reported as annotations.
- T6: PLOT A1 timing.
- T7: `performance.measureUserAgentSpecificMemory` across 20 open/close cycles.

## 6. Offline/privacy harness

Load app → go offline (Playwright route abort) → run a scripted session covering open, font drop, pattern drop, CTB drop, edit, save, PDF → assert zero network requests besides SW. A second test asserts the error-report payload contains no drawing content for a drawing with known marker strings.

## 7. Command tests

Each command has a test file that drives it through the `PromptBus` with typed answers and asserts the `ChangeSet` (entity types, geometry within tolerance, properties, handles allocated). Tests encode AutoCAD behaviour; when behaviour is ambiguous, the test documents the chosen interpretation with a comment linking the AutoCAD reference.

### 7.1 Geometry kernel tests

`engine/geom` is tested with table tests for documented cases and fast-check property tests at drafting scales (coordinates to ±1000, radii 0.01–500, NURBS of degree 1–3 with non-uniform knots and optional weights): derivatives against finite differences, flattening deviation, bounds containment and tightness, transformed curves tracing the transformed points, and intersections (a secant through two points of any curve, a circle through a point of it, and a copy rotated about one of its points must all find those points; every reported point lies on both curves), closest point (on the curve and no farther than any of 200 samples), tangent points (a line drawn from a point along the tangent touches there), and offsets (every point at the offset distance). Generators keep splines free of coincident or folded-back control points, whose cusps get dedicated tests. `pnpm test` enforces ≥ 95 % branch, line, function and statement coverage of `packages/engine/src/geom` (the `coverage.thresholds` glob in `vitest.config.ts`; add a glob when another package's task sets a gate).

## 8. Owner-only gates

Since DEC-047 no gate needs the owner or AutoCAD. The AutoCAD AUDIT sweep is replaced by the ezdxf audit in CI (M1-105) and AutoCAD reference plots by Triya golden images (§4). What remains with the owner is optional:
- **Private corpus:** `pnpm test:private` on the owner's own drawings, whenever convenient.
- **Drafter sessions:** PRD §11.3 at M10.

## 9. Scripts

```
pnpm test               # unit + command + round-trip (public), with coverage gates (test-reports/coverage/)
pnpm test:fidelity      # Playwright fidelity on public corpus (TRIYA_UPDATE_GOLDEN=1 rewrites golden images)
pnpm test:perf          # perf targets
pnpm test:offline       # offline/privacy
pnpm test:ui            # dialogs, ribbon, grips
pnpm test:io            # @triya/io worker in Chromium via a Vite dev server (M0-03; responsiveness, progress, cancel M1-06)
pnpm test:private       # round-trip + golden images on corpus/private (local only; exits 0 without it)
pnpm corpus:list        # print corpus manifest
pnpm corpus:ref <file>  # rasterise reference PDFs → PNGs
pnpm corpus:validate    # schema + license fields + reference presence
pnpm changelog          # print CHANGELOG.md with the changes/*.md fragments under Unreleased
pnpm changelog:check    # validate changelog fragments (CI)
pnpm corpus:roundtrip   # round-trip every public corpus file; per-file report in test-reports/roundtrip/
pnpm spike:read         # M0-06: read status, unmapped types, handle coverage → test-reports/spike/read.md
pnpm spike:roundtrip    # M0-06: round-trip failure taxonomy → test-reports/spike/roundtrip.md; written files → docs/reports/M0-written/
```

File conventions: `*.test.ts` is Vitest (Node), found in `packages/*/{src,test}/`, `apps/*/{src,test}/` and `tests/`; `*.spec.ts` is Playwright, one folder per suite under `tests/e2e/<fidelity|offline|ui|perf|io>/` (`playwright.config.ts` maps each suite to a project). Until a suite's roadmap task lands, its script passes with no tests; scripts whose implementation does not exist yet (`corpus:*`, `test:private`, `planegcs:build`) print the owning task id and exit 0. `pnpm lint` runs ESLint (including the module-boundary and no-DOM rules) and `prettier --check`; Husky runs `pnpm lint && pnpm typecheck` before each commit.
