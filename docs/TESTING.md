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

### 1.1 CI wiring (`.github/workflows/ci.yml`)

| Job (check name) | Runs | When |
|---|---|---|
| `lint · typecheck · unit · round-trip` | `pnpm lint`, `typecheck`, `test`, `corpus:validate` | every PR and push to `main` (**required**) |
| `fidelity · offline · ui` | `pnpm build`, `test:fidelity`, `test:offline`, `test:ui`; uploads `test-results/` + `playwright-report/` as `fidelity-diffs` on failure | every PR and push to `main` (**required**) |
| `performance budgets` | `pnpm test:perf` | `main`; PRs that change `packages/render`, `engine` or `io` (`detect hot-path changes` job); PRs labelled `perf` or titled `[perf]` |

Offline and UI suites still run after a fidelity failure, so one red run shows every broken gate. pnpm's store and Playwright's browsers (keyed on the Playwright version) are cached. `auto-merge.yml` enables squash auto-merge only after a CI run for the PR's current head succeeds, so a failing check never merges even without branch protection. `tests/ci/workflows.test.ts` pins all of this, including the two required check names.

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

Allowed exceptions (and only these): `$TDUPDATE`, `$TDUSRTIMER`, `$TDINDWG`, `$VERSIONGUID`, `$FINGERPRINTGUID`, `$HANDSEED` (new ≥ old), `$DWGCODEPAGE` when writing to a Unicode version, and the ordering of entries within unordered dictionaries. Anything else is a failure. Adding an exception requires a DECISIONS entry.

After an *editing* session, the diff excludes handles in the session's touched set and asserts zero differences elsewhere.

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

## 8. Owner-only gates

- **AUDIT sweep:** open each Triya-saved corpus file in AutoCAD, run `AUDIT` (fix N), record error counts; required 0 at M0 (go/no-go), M2, M5, M10.
- **Reference regeneration:** when a corpus file changes, re-plot references from AutoCAD.
- **Drafter sessions:** PRD §11.3 at M10.

## 9. Scripts

```
pnpm test               # unit + command + round-trip (public)
pnpm test:fidelity      # Playwright fidelity on public corpus
pnpm test:perf          # perf targets
pnpm test:offline       # offline/privacy
pnpm test:ui            # dialogs, ribbon, grips
pnpm test:private       # all of the above on corpus/private (local only)
pnpm corpus:list        # print corpus manifest
pnpm corpus:ref <file>  # rasterise reference PDFs → PNGs
pnpm corpus:validate    # schema + license fields + reference presence
```

File conventions: `*.test.ts` is Vitest (Node), found in `packages/*/{src,test}/`, `apps/*/{src,test}/` and `tests/`; `*.spec.ts` is Playwright, one folder per suite under `tests/e2e/<fidelity|offline|ui|perf>/` (`playwright.config.ts` maps each suite to a project). Until a suite's roadmap task lands, its script passes with no tests; scripts whose implementation does not exist yet (`corpus:*`, `test:private`, `planegcs:build`) print the owning task id and exit 0. `pnpm lint` runs ESLint (including the module-boundary and no-DOM rules) and `prettier --check`; Husky runs `pnpm lint && pnpm typecheck` before each commit.
