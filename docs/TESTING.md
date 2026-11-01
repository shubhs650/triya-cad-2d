# Testing and Fidelity Strategy

Fidelity is the product. This document defines the corpus, the harnesses, the tolerances, and the gates. All of it runs from `pnpm` scripts; CI runs the public parts on every PR; the owner runs the private parts locally.

## 1. Test layers

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Unit | Vitest (Node) | `engine`, `io` adapters, `text`, `hatch`, `dims`, `constraints`, `library`, `compare`, `pdf` | every PR |
| Command | Vitest (Node) | commands driven by scripted `PromptAnswer` sequences on the `PromptBus`; assert resulting `ChangeSet` | every PR |
| Round-trip | Vitest (Node) + `testkit` | open → save → reopen → `structuralDiff` on every public corpus file | every PR |
| Fidelity | Playwright (Chromium headless) + `testkit` | render each public corpus file through the real `Canvas2DRenderer` to PNG; perceptual diff vs AutoCAD reference | every PR |
| Perf | Playwright | T1–T3, T5–T7 on `bench-*.dwg` | PRs touching `render`/`engine`/`io`; nightly |
| Offline/privacy | Playwright with network blocked | T8; assert zero requests | every PR |
| UI | Playwright | dialogs, ribbon breakpoints (T9), grips, keyboard | every PR |
| Cross-browser | Playwright WebKit + Firefox | degraded-mode paths | nightly |
| Private corpus | same harnesses | owner's real drawings | owner, locally |
| AUDIT | AutoCAD (owner) | AutoCAD `AUDIT`/`RECOVER` on Triya-saved files | milestone gates |

## 2. Corpus

### 2.1 Public corpus (`corpus/public/`, committed)

- **Self-authored set** (owner provides DWGs + AutoCAD reference PDFs; threads may author DXF test files with acad-ts for unit-level cases):
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
  - `bench-ga.dwg` (≈5 MB) and `bench-100k.dwg` (≈30 MB, 100k entities, 50 blocks, 5 layouts) — perf benchmarks
- **Third-party samples** with redistributable licenses: ezdxf test files (MIT), ACadSharp samples (MIT). Record source + license per file in `corpus.json`.
- **References:** for each file, a PDF plotted from AutoCAD (monochrome.ctb unless the file's own CTB is included) per layout and for model extents, plus PNGs rasterised from those PDFs at 150 dpi by `pnpm corpus:ref`.

### 2.2 Private corpus (`corpus/private/`, gitignored)

Owner's real vessel GAs and vendor drawings. Same `corpus.json` schema, same harness (`pnpm test:private`). Results are summarised into `docs/reports/` without file names or content.

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

Allowed exceptions (and only these): `$TDUPDATE` and its UTC twin `$TDUUPDATE` (DEC-034), `$TDUSRTIMER`, `$TDINDWG`, `$VERSIONGUID`, `$FINGERPRINTGUID`, `$HANDSEED` (new ≥ old), `$DWGCODEPAGE` when writing to a Unicode version, and the ordering of entries within unordered dictionaries. Anything else is a failure. Adding an exception requires a DECISIONS entry.

After an *editing* session, the diff excludes handles in the session's touched set and asserts zero differences elsewhere.

**Harness** (`packages/testkit/src/roundtrip`, M0-05):
- `roundTrip(bytes)` reads the file twice (one copy to write, one pristine copy to compare), writes it in the same version and format (DWG, ASCII DXF or binary DXF) with `@triya/io` `writeCadDocument`, reopens the output and runs `structuralDiff`. Status per file: `clean`, `diff`, `read-error`, `write-error`, `reread-error`.
- `structuralDiff` matches every registered object by handle (`missing`/`added`/`type`), then compares its instance fields recursively. A field holding another object is compared as a reference (type + handle), so one changed object only reports on itself. Map-backed collections (dictionary and table entries, xdata by application) are unordered; lists and sets are ordered, and a pure reordering of references is reported as `order`. A null field equals an empty container, and an empty string equals a missing one, because the file formats cannot tell them apart. Header fields are reported by `$NAME`.
- acad-ts stamps `new Date()` into header variables a file does not state, so the harness pins the clock while it reads and writes; two runs on the same bytes produce the same report.
- Objects acad-ts cannot map are kept raw by `readCadDocument` (M1-30), so `structuralDiff` sees them like any other object. `rawObjectSurvival` also checks that each one comes back under its handle with the same payload (DXF group codes or DWG record); the corpus test requires zero losses, and the report prints the count.
- `pnpm corpus:roundtrip` (also part of `pnpm test`) runs every public corpus file, writes `test-reports/roundtrip/report.md` and `report.json`, and fails if any file is worse than `corpus/roundtrip-baseline.json` (worse status or more differences) or loses a declared handle not in `corpus/handle-coverage-baseline.json` (§3.2). After an improvement, `TRIYA_UPDATE_BASELINE=1 pnpm corpus:roundtrip` locks it in. Until M1-05 the baseline holds the known differences; from M1-05 on every entry must be `clean`.

### 3.2 Handle-coverage gate (M1-27)

`structuralDiff` cannot see an object acad-ts never loads: it is missing before and after the save. `roundTrip` therefore also lists every handle the file itself declares and requires each one in the reopened document (`roundtrip/handle-coverage.ts`):
- **Scanners**, independent of the acad-ts object graph: the DWG handle map, each entry typed from its object record's header (object type, or the DXF class name for custom objects); ASCII DXF and binary DXF (R12 one-byte and R13+ two-byte group codes) `5`, and `105` for `DIMSTYLE`, outside HEADER and CLASSES. A stream the scanner cannot list fails the gate instead of reporting zero handles.
- **Present** means in `getCadObjects()` or held by its owner: acad-ts keeps polyline vertices, polyface-mesh faces, attributes and their `SEQEND` inside the owning entity under their file handles. No other exception and no allow-list (DEC-038).
- Each missing handle is reported with its type and stage: `read` (acad-ts never loaded it) or `save` (loaded, then dropped by the writer). The report prints the totals by type.
- **Ratchet:** `corpus/handle-coverage-baseline.json` lists, per file and type, the handles lost today. `pnpm test` fails on any lost handle not listed there (a new loss fails even when the count stays the same), when a scanned file stops being scanned, and when a corpus file has no entry. `TRIYA_UPDATE_BASELINE=1 pnpm corpus:roundtrip` rewrites it together with the round-trip baseline. Only files that cannot be read (`recover02.dxf`) are unscanned. At M1-27: 4,902 of 46,712 declared handles lost in 118 files (919 at read, 3,983 at save); M1-31 and M1-33 take every list to empty.

### 3.1 Mapping oracle (M1-03)

The round-trip diff compares acad-ts with itself, so a value acad-ts never reads is invisible to it. `packages/testkit/src/mapping/tables.corpus.test.ts` reads the HEADER and TABLES sections of every ASCII DXF in the public corpus with an independent group-code reader (`mapping/dxf-oracle.ts`) and compares each table record field and each header variable with what `mapTables`/`mapHeader` produce, by handle (by name for R12 records without one). Losses that come from acad-ts itself are listed in `ACAD_TS_GAPS` with the reason; the test fails on a new kind of mismatch and on a listed kind that no longer occurs, so the list only shrinks (M1-32). A second test checks that every table entry acad-ts reads from every readable file, DWG included, is mapped.

## 4. Fidelity harness

1. Headless Chromium loads the app in test mode and opens the corpus file.
2. For each reference: set the space/layout, zoom to the reference's plot area, render at the reference PNG's pixel size with the matching CTB in plot-preview mode.
3. Compare with `pixelmatch` (threshold 0.1) and SSIM; pass if mismatch ≤ `tolerance.pixelMismatch` % **and** SSIM ≥ `tolerance.ssim`.
4. On failure, upload original/actual/diff PNGs as CI artifacts and print the entity types in the differing regions (by R-tree lookup) to make triage fast.

Tolerances start loose (2 %) for a new file and are tightened to 0.5 % as features land; a PR may not loosen a tolerance.

Entity-level fidelity (T4's "≥99 % of entities") is measured by rendering each entity in isolation into its bounds and comparing with the reference crop; reported per type into `docs/reports/fidelity-latest.md`.

## 5. Performance harness

Runs on the CI runner with fixed CPU class; thresholds carry a 20 % margin over PRD §12 to absorb runner variance; local runs report raw numbers.

- T1: Lighthouse + custom timing for "canvas interactive".
- T2: `performance.mark` around open → first full frame.
- T3: scripted pan/zoom for 5 s; count frames; measure input→prompt latency; osnap query timing at 1000 random cursor positions.
- T5: in-place save timing; autosave timing after last edit.
- T6: PLOT A1 timing.
- T7: `performance.measureUserAgentSpecificMemory` across 20 open/close cycles.

## 6. Offline/privacy harness

Load app → go offline (Playwright route abort) → run a scripted session covering open, font drop, pattern drop, CTB drop, edit, save, PDF → assert zero network requests besides SW. A second test asserts the error-report payload contains no drawing content for a drawing with known marker strings.

## 7. Command tests

Each command has a test file that drives it through the `PromptBus` with typed answers and asserts the `ChangeSet` (entity types, geometry within tolerance, properties, handles allocated). Tests encode AutoCAD behaviour; when behaviour is ambiguous, the test documents the chosen interpretation with a comment linking the AutoCAD reference.

### 7.1 Geometry kernel tests

`engine/geom` is tested with table tests for documented cases and fast-check property tests at drafting scales (coordinates to ±1000, radii 0.01–500, NURBS of degree 1–3 with non-uniform knots and optional weights): derivatives against finite differences, flattening deviation, bounds containment and tightness, transformed curves tracing the transformed points, and intersections (a secant through two points of any curve, a circle through a point of it, and a copy rotated about one of its points must all find those points; every reported point lies on both curves), closest point (on the curve and no farther than any of 200 samples), tangent points (a line drawn from a point along the tangent touches there), and offsets (every point at the offset distance). Generators keep splines free of coincident or folded-back control points, whose cusps get dedicated tests. `pnpm test` enforces ≥ 95 % branch, line, function and statement coverage of `packages/engine/src/geom` (the `coverage.thresholds` glob in `vitest.config.ts`; add a glob when another package's task sets a gate).

## 8. Owner-only gates

- **AUDIT sweep:** open each Triya-saved corpus file in AutoCAD, run `AUDIT` (fix N), record error counts; required 0 at M0 (go/no-go), M2, M5, M10.
- **Reference regeneration:** when a corpus file changes, re-plot references from AutoCAD.
- **Drafter sessions:** PRD §11.3 at M10.

## 9. Scripts

```
pnpm test               # unit + command + round-trip (public), with coverage gates (test-reports/coverage/)
pnpm test:fidelity      # Playwright fidelity on public corpus
pnpm test:perf          # perf targets
pnpm test:offline       # offline/privacy
pnpm test:ui            # dialogs, ribbon, grips
pnpm test:io            # @triya/io worker in Chromium via a Vite dev server (M0-03)
pnpm test:private       # all of the above on corpus/private (local only)
pnpm corpus:list        # print corpus manifest
pnpm corpus:ref <file>  # rasterise reference PDFs → PNGs
pnpm corpus:validate    # schema + license fields + reference presence
pnpm corpus:roundtrip   # round-trip every public corpus file; per-file report in test-reports/roundtrip/
pnpm spike:read         # M0-06: read status, unmapped types, handle coverage → test-reports/spike/read.md
pnpm spike:roundtrip    # M0-06: round-trip failure taxonomy → test-reports/spike/roundtrip.md; written files → docs/reports/M0-written/
```

File conventions: `*.test.ts` is Vitest (Node), found in `packages/*/{src,test}/`, `apps/*/{src,test}/` and `tests/`; `*.spec.ts` is Playwright, one folder per suite under `tests/e2e/<fidelity|offline|ui|perf|io>/` (`playwright.config.ts` maps each suite to a project). Until a suite's roadmap task lands, its script passes with no tests; scripts whose implementation does not exist yet (`corpus:*`, `test:private`, `planegcs:build`) print the owning task id and exit 0. `pnpm lint` runs ESLint (including the module-boundary and no-DOM rules) and `prettier --check`; Husky runs `pnpm lint && pnpm typecheck` before each commit.
