# M0-06 — acad-ts spike report

**Task:** M0-06 (`docs/SPIKE_M0_ACAD_TS.md`). **Library:** acad-ts at upstream `315f3d8` plus local patches 0001–0013 (`third_party/acad-ts/PATCHES.md`). **Corpus:** the 119 public files in `corpus/public` (ACadSharp and ezdxf samples, R2.6–R2018, DWG, ASCII DXF and binary DXF). **Date:** 2026-11-01.

Reproduce every number below with `pnpm spike:read`, `pnpm spike:roundtrip` (reports in `test-reports/spike/`) and `pnpm corpus:roundtrip` (the ratchet in `corpus/roundtrip-baseline.json`).

## 1. Summary and recommendation

**Recommendation: CONDITIONAL GO.**

- **Reading is sound.** 118 of 119 files open. The one failure, `ezdxf/integration_tests/recover02.dxf`, is a deliberately malformed file from ezdxf's RECOVER tests. No failure looks structural: no object-map, section or page decoding error on any DWG version from R14 to R2018.
- **Writing has enumerable defects.** Thirteen local patches took the round trip from 35,447 differences and 0 clean files to 26,728 differences and 11 clean files. Every remaining difference is listed in §4 with its root cause, and each root cause has a plausible fix. Most are DXF-writer omissions (objects and group codes acad-ts reads but does not write).
- **The GO gate is not met.** The gate needs a zero diff on at least 90 % of files. We have 11 of 119 (9 %), all of them R2018 DWG. AutoCAD AUDIT on the written files is still to run (owner, M0-07).
- **There is one critical passthrough gap.** acad-ts does not keep objects it cannot parse. 4,379 of the 36,911 objects declared by the files it can be checked on (12 %) never reach the acad-ts object graph, so a save silently drops them. `structuralDiff` cannot see this, because the objects are missing on both sides. `ARCHITECTURE.md` §6.2 rule 1 assumes acad-ts keeps these objects for the `PassthroughStore`. Until acad-ts keeps raw unknown objects, that rule cannot hold for any file containing them.
- **Performance is within budget on this hardware.** A synthetic 100k-entity DWG reads in about 2 s in Node, under the 3 s T2 budget. With patch 0013 it writes in about 1.9 s, under the 2 s T5 budget. The real `bench-100k.dwg` and `bench-ga.dwg` files do not exist yet (owner task M1-26).

What CONDITIONAL GO means, per the spike criteria:

- M1 read-only work (M1-01 to M1-04, M1-06, M1-07, rendering, text and app shell) can proceed on acad-ts.
- M1-05 (passthrough export) and M2-13 (Save) stay blocked until the round-trip gate passes.
- The writer fixes and the unknown-object retention are new M1 tasks (§8). One thread can run them in parallel with the read-only work.

## 2. Read results (question 1)

| Status | Files | Meaning |
|---|---:|---|
| ok | 13 | Read with no warning and nothing unmapped |
| warnings | 105 | Read, but acad-ts kept some objects only as unknown/proxy, or reported a problem |
| error | 1 | `recover02.dxf`: `DxfException: Unexpected token at the beginning of a table: BLOCK_RECORD` (intentionally broken) |

Unmapped types, by number of files. acad-ts keeps the type name, logs a notification and, for most of these, discards the object:

| Type | Objects | Files | Notes |
|---|---:|---:|---|
| `ACDBDETAILVIEWSTYLE`, `ACDBSECTIONVIEWSTYLE` | 93 each | 71 | In every R2013+ template drawing. Model-documentation styles. |
| `SUN` | 67 | 30 | Lighting. Not relevant to 2D, but must survive a save. |
| `ACDBASSOCPERSSUBENTMANAGER`, `ACDBPERSSUBENTMANAGER` | 21 each | 21 | Associativity bookkeeping. |
| `MENTALRAYRENDERSETTINGS`, `RAPIDRTRENDERSETTINGS` | 15 / 21 | 15 / 3 | Render settings. |
| `BLOCKLINEARPARAMETER` and other dynamic-block parameters, grips and actions | 14+ | 14 | Dynamic blocks. Their geometry still renders. |
| `ACDB_TEXTOBJECTCONTEXTDATA_CLASS` | 20 | 10 | Annotative text scales. |
| `TABLEGEOMETRY`, `CELLSTYLEMAP` (some), `ACAD_TABLE` (2 files) | 18 / 4 / 4 | 10 / 4 / 2 | Tables. |
| `ACSH_*` (solid history) | 36 | 9 | 3D, not relevant to 2D. |
| `ACAD_PROXY_OBJECT` | 98 | 2 | Kept as proxy objects; the DXF writer skips them. |
| `AEC_*` (about 40 types) | 1–24 each | 1 | AutoCAD Architecture objects (`AecObjects.dwg`). |

The full table, the per-file list and the normalised reader notifications are in `test-reports/spike/read.md`.

**Handle coverage.** `spike:read` lists every handle the file declares and checks which ones reach the acad-ts graph. It reads the DWG handle map, or the `5`/`105` codes in an ASCII DXF; binary DXF and R12 DWG are not scanned. Across 103 files, **4,379 of 36,911** declared objects are missing:

| Missing type | Objects | Files |
|---|---:|---:|
| DWG (handle map carries no type) | 1,983 | 21 |
| `VERTEX` / `SEQEND` (DXF) | 1,228 / 361 | 10 / 12 |
| `XRECORD` | 160 | 21 |
| `DICTIONARY` | 81 | 23 |
| `SORTENTSTABLE` | 70 | 13 |
| Unknown types above (`SUN`, view styles, render settings, dynamic-block parts) | ~400 | up to 44 |
| `ATTRIB` | 40 | 11 |

Some of these are harmless. acad-ts folds `VERTEX` and `SEQEND` into their `POLYLINE` and writes them again under new handles, and the DWG handle map also lists free handles. Unknown objects and the `XRECORD`/`DICTIONARY` entries that point at them are real losses.

Read-side defects that a round trip cannot detect, found while patching (not fixed yet, listed in §8):

- On DXF read, `PLOTSETTINGS` group 70 flags are overwritten by the `LAYOUT` map's group 70.
- `$CELWEIGHT` from DWG comes back as the raw lineweight index, not the lineweight value.

## 3. Round trip, before and after the patches (question 2)

Open, save in the same version and format with Triya's writer profile, reopen, then `structuralDiff` with the `TESTING.md` §3 exceptions. "Before" is acad-ts plus patch 0001 with acad-ts's default writer configuration, as `main` had it after M0-05.

| Format | Files | Clean before | Clean after | Differences before | Differences after |
|---|---:|---:|---:|---:|---:|
| DWG (R14–R2018) | 21 | 0 | **11** | 1,867 | 694 |
| ASCII DXF (R2.6–R2018) | 87 | 0 | 0 | 24,124 | 17,514 |
| Binary DXF (R12–R2018) | 11 | 0 | 0 | 9,456 | 8,520 |
| **All** | **119** | **0** | **11** | **35,447** | **26,728** |

No file got worse. `corpus/roundtrip-baseline.json` is ratcheted to the new numbers, so `pnpm test` fails on any regression.

The 11 clean files are all R2018 DWG: nine `acadsharp/dynamic-blocks/BLOCK*PARAMETER.dwg` files, `acadsharp/geolocation/geoloc.dwg` and `acadsharp/sample_base/empty.dwg`. The other ten DWGs differ only in a few roots:

- `ACAD_TABLE` cell content: 18–73 differences per file.
- `SORTENTSTABLE` order: 16 per file.
- `BLOCK_RECORD` owned handles: R14/R2000 only, 87 and 156.
- `BLOCK_RECORD` insert handles: 4 per file.
- One evaluation-graph node.
- AEC raw data.

DWG writing is close. The DXF writer is where the work is.

R2007 (AC1021) DWG is written in its own version and reads back; its 100 differences are the same as R2004's. The written file is larger than AutoCAD's because acad-ts does not LZ-compress R2007 pages.

## 4. Failure taxonomy and root causes (questions 2 and 3)

`pnpm spike:roundtrip` puts each problem in one category:

| Category | Count | Files |
|---|---:|---:|
| Parse error (file does not open, or its written copy does not reopen) | 1 | 1 |
| Entity/object not mapped (kept only as unknown/proxy) | 1,293 | 83 |
| Writer error (save throws) | 0 | 0 |
| Object dropped by the writer | 4,320 | 90 |
| Object added on reopen | 357 | 7 |
| Header variable lost or changed | 295 | 102 |
| Object property lost or changed | 21,756 | 105 |

There are no writer errors left. Patch 0002 removed the only crash, on dynamic blocks.

Remaining root causes, by files affected. "Fix" is the plausible fix; none of these is patched yet.

| # | Root cause | Files | Diffs | Fix |
|---:|---|---:|---:|---|
| R1 | `DICTIONARY` entries pointing at objects the DXF writer does not write (`MATERIAL`, `VISUALSTYLE`, unknowns) are lost, and colour-book `DBCOLOR` entry names change (`RAL CLASSIC$RAL 1006` becomes `RAL CLASSIC$RAL CLASSIC`) | 83 | 4,012 | Mostly follows from R2, R3 and R9; plus a `DBCOLOR` entry-name fix |
| R2 | DXF writer does not implement `MATERIAL` ("Object not implemented: Material") | 83 | 345 | Add a `MATERIAL` writer: the reader map already exists |
| R3 | DXF writer does not implement `VISUALSTYLE` | 62 | 1,493 | Add a `VISUALSTYLE` writer |
| R4 | `$LASTSAVEDBY` comes back as `ACadSharp`, and `$ACADMAINTVER` is not kept | 74 / 70 | 144 | Either keep them, or add them to the allowed exceptions (AutoCAD restamps both on save). **Owner decision**, see §9 |
| R5 | `TABLESTYLE` / `CELLSTYLEMAP` cell styles not written in DXF | 62 | 2,790 | Write the `AcDbTableStyle` cell-style blocks (DXF 2007+ table-style format) |
| R6 | `$TDCREATE` loses a millisecond (`…03.000Z` comes back as `…02.999Z`) in the Julian-date conversion | 42 | 42 | Round the Julian date conversion to the stored precision |
| R7 | `XRECORD` dropped (owned by unknown objects or entries the writer skipped) | 39 | 1,368 | Follows from R9 plus the DICTIONARY fix |
| R8 | `BLOCK_RECORD` flags and preview not written in DXF | 33 / 27 | 111 | Write group 70 on BLOCK_RECORD and the 310 preview chunks |
| R9 | Unknown objects not retained (see §2, handle coverage) | 83+ | not visible | Keep each unknown object's raw group codes (DXF) or raw bit stream (DWG) on `UnknownNonGraphicalObject`, and write them back. **The critical item** for `ARCHITECTURE.md` §6.2 |
| R10 | `RASTERVARIABLES` units not written | 30 | 30 | One group code |
| R11 | `SORTENTSTABLE` order changes | 28 | 870 | Write sorters in stored order; DWG and DXF |
| R12 | `VIEWPORT` entity fields (zoom percent, twist, UCS, lighting, grid) not written in DXF | ~20 | ~1,100 | Same shape as patch 0008, for the VIEWPORT entity |
| R13 | `MULTILEADER` context data and overrides lost in DXF | 13 | 3,889 | Write `MLEADER` context data in full |
| R14 | `MTEXT` column data not written | 14 | 757 | Write MTEXT column groups (R2018 `AcDbMText` columns) |
| R15 | `ACAD_TABLE` cell content and overrides | 12 | 246 | Write table content cell by cell, DWG and DXF |
| R16 | R12 DXF: acad-ts synthesises BLOCK_RECORD and other R13+ objects on read, with new handles on each read | 7 | 357 | Harness: treat synthesised objects in pre-R13 files as one exception class. Needs a DEC entry |
| R17 | `BLOCK_RECORD` owned/insert handles in R14/R2000 DWG | 16 | 1,438 | DWG writer for pre-R2004 entity lists |
| R18 | `DIMENSION`/`LINE`/`CIRCLE` reactors, `IMAGE` definition reactors | 15 | ~200 | Write reactors to objects that are written; they currently point at dropped objects |
| R19 | `ATTDEF` attribute type and version in DXF | 18 | 159 | Write the R2018 `AcDbAttributeDefinition` fields |
| R20 | `HATCH` pattern definition lines in DXF | 13 | 48 | Write pattern lines for predefined patterns |
| R21 | DXF writer drops xdata on `DICTIONARY` objects; some `TEXT`, `VPORT` and `DBCOLOR` objects gain or lose an xdata record | 17 / 14 / 11 / 8 | ~90 | Write xdata for every object type the writer emits |

Hard entities (question 3), from the same run:

- **Clean:** `SPLINE`, `ELLIPSE`, `ATTRIB`, PDF/DWF/DGN underlays. `LWPOLYLINE` is clean apart from 2 reactor differences.
- **Mostly clean:** `HATCH` (48 differences, pattern lines only; boundary paths with arcs, ellipses and splines survive). `DIMENSION` geometry and overrides survive; the differences are reactors (R18) and two files where dimensions' block, style and owner references changed.
- **Lossy in DXF:** `MTEXT` columns (R14), `MULTILEADER` (R13), `ACAD_TABLE` (R15), `VIEWPORT` (R12). In DWG all four are close to clean apart from table cell content.
- **Dynamic blocks:** their representation data and evaluation graphs round-trip in DWG (nine of the clean files are dynamic blocks). In DXF they are lost through R1/R9.
- **`ACDBASSOC*`:** not mapped (R9).
- **Xdata and extension dictionaries:** preserved on most mapped objects. The exceptions are dictionaries dropped with their owners (R1) and the xdata gaps in R21.

## 5. Patches applied (top root causes) and upstream status

The spike's brief was to patch the top five root causes. We patched twelve: after the first five, the next seven were each a few lines and together cleared most DWG differences. Each patch has a test that fails without it. `third_party/acad-ts/PATCHES.md` has the symptom, fix and drafted upstream PR text for each. None has been submitted upstream; threads have no write access to `node-projects/acad-ts`, so the owner submits.

| Patch | Fix | Main effect on the corpus |
|---|---|---|
| Writer profile (not a patch) | Write all header variables and dynamic-block data | Header differences on 90+ files gone |
| 0002 | DXF evaluation graph: null expression handle and owner | Removed the only writer crash |
| 0003 | DWG true colours were written with red and blue swapped | Every true colour in every DWG |
| 0004 | DWG header flag word decoded wrongly | `$PSTYLEMODE` on 100 files, `$LWDISPLAY`, `$XEDIT`, `$ENDCAPS`, `$JOINSTYLE` |
| 0005 | DWG writer dropped all-zero section pages | English drawings reopened as Metric |
| 0006 | DWG LAYOUT max limits | Every paper-space layout |
| 0007 | DWG BLOCK_RECORD previews | Block thumbnails |
| 0008 | DXF VPORT record written in full | `viewMode` and 30 other fields on 93 files |
| 0009 | DXF LAYER plot style | 83 files |
| 0010 | DXF LAYOUT flags, ortho type, last viewport | 81 files |
| 0011 | DXF empty dictionaries and `ACAD_MATERIAL` kept | Stable dictionary handles |
| 0012 | DXF 16-bit codes read as signed | ByBlock/ByLayer lineweights in binary DXF |
| 0013 | DWG block-header writing made linear | 100k-entity write from 84 s to 1.9 s |

The upstream acad-ts test suite was run with 0001 only. It could not be run with 0002–0013 in the spike thread, because upstream's dev dependencies could not be installed there. Run it before submitting the upstream PRs.

## 6. Performance and bundle (questions 5 and 6)

Node 22 and headless Chromium 153 on the sandbox runner (shared vCPU, so expect ±30 %). The median is of five runs unless noted.

| File | Size | Node read (cold / median) | Node write | Chromium worker read, including transfer (5 runs) |
|---|---:|---:|---:|---|
| `sample_AC1032.dwg` (~395 entities) | 1.08 MB | 161 / 72 ms | 119 ms | 258 / 81 / 59 / 55 / 81 ms |
| `sample_AC1018.dwg` | — | 59 ms | 131 ms | 165 / 73 / 100 / 67 / 153 ms |
| `sample_AC1014.dwg` | — | 48 ms | 141 ms | — |
| `AecObjects.dwg` | — | 41 ms | 37 ms | 56–71 ms |
| `sample_AC1032_ascii.dxf` | 2.57 MB | 182 / 131 ms | 19 ms | 498 / 210 / 170 / 172 / 177 ms |
| `sample_AC1032_binary.dxf` | — | 45 ms | 18 ms | 181 / 89 / 48 / 48 / 97 ms |
| `sample_AC1009_ascii.dxf` (3,994 entities) | — | 95 ms | — | 207 / 144 / 129 / 142 / 138 ms |
| Synthetic 100k-LINE DWG (R2018) | 1.7 MB | ~1.9–2.3 s | 1.9 s (84 s before 0013) | not measured |

`sample_AC1032.dwg` adds about 7 MB of heap. The synthetic 100k drawing retains about 98 MB after one read.

The synthetic drawing is 100,000 lines in model space, generated by acad-ts. It is a lower bound: `bench-100k.dwg` from M1-26 will have mixed entities, blocks and text. T2 (open in under 3 s) looks reachable. M1-06 must measure it in the worker on the real file.

Bundle, with a Vite library build and esbuild minify:

| Entry | Raw | gzip | brotli |
|---|---:|---:|---:|
| `io.worker` (readers and writers) | 1,287,296 B | 221,866 B | 168,620 B |
| `DxfReader` only | 928,414 B | 155,947 B | — |

Tree-shaking is partial. Dropping the writers saves about 28 %, but the object model is shared and large. The worker loads lazily on first open, so this does not touch first paint. It does count toward the PWA precache.

## 7. Limitations that matter to users (question 7)

| Limitation | Impact on the markup workflow | Mitigation |
|---|---|---|
| Unknown objects are dropped on save (R9) | **High.** Vendor drawings from Civil 3D, Architecture or Plant 3D carry AEC and other custom objects. A Triya save would silently strip them. | Patch acad-ts to keep raw unknown objects (new task M1-30). Until then, Save stays blocked (M2-13), as the CONDITIONAL GO implies. |
| DXF writer omissions (R2, R3, R5, R12–R15) | Medium. A DXF save loses materials, visual styles, table styles, MLEADER detail, MTEXT columns. | Writer tasks M1-28 and M1-29. DWG save is already much closer. |
| R2007 DWG pages are uncompressed | Low. R2007 files grow on save. | Accept. Saving to R2007 is rare. |
| R11/R12 | Low. R12 DXF reads and writes; acad-ts synthesises R13+ tables on read (R16). The corpus has no R12 DWG, so the separate pre-R13 DWG codec is untested here. | Add an R12 DWG to the corpus (M1-26). |
| Code pages and big fonts | Unknown. The corpus has few non-Latin drawings; `$DWGCODEPAGE` is honoured on read per the README. SHX big fonts are a `packages/text` concern, not acad-ts. | Add CJK and Cyrillic drawings to the private corpus. |
| Malformed files (`recover02.dxf`) | Low. acad-ts has no RECOVER mode; such files fail to open. | Show the reader error; RECOVER is out of scope for v1. |

## 8. Required work (added to `docs/ROADMAP.md`, M1)

- **M1-27** Harness: add a handle-coverage gate to the round trip, so that an object the file declares and acad-ts never loads fails the test instead of being invisible to `structuralDiff`.
- **M1-28** acad-ts DXF writer: `MATERIAL`, `VISUALSTYLE`, `TABLESTYLE`/`CELLSTYLEMAP` cell styles, `BLOCK_RECORD` flags and preview, `RASTERVARIABLES`, `DBCOLOR` names, xdata on every object, `$TDCREATE` precision (R1–R3, R5, R6, R8, R10, R21).
- **M1-29** acad-ts writer, entity detail: `VIEWPORT` entity, `MULTILEADER` context data, `MTEXT` columns, `ACAD_TABLE` content, `SORTENTSTABLE` order, `ATTDEF` R2018 fields, `HATCH` pattern lines, pre-R2004 DWG block entity lists (R11–R15, R17, R19, R20).
- **M1-30** acad-ts: keep unknown objects raw (DXF group codes, DWG bit stream with handle references) and write them back, plus the two read-side defects in §2 (R9). This is the prerequisite for M1-05.

M1-05 and M2-13 depend on M1-27 to M1-30. The fidelity gate in `TESTING.md` §3 does not change.

## 9. Open questions for the owner

1. **AUDIT (M0-07).** Run AutoCAD AUDIT on the written files (zip in the project Library, list in the needs-human issue). Start with the 11 clean DWGs: they are the GO criterion "AUDIT = 0 on files acad-ts round-trips cleanly".
2. **`$LASTSAVEDBY` and `$ACADMAINTVER`.** AutoCAD rewrites both on every save, so a Triya save could reasonably do the same. Should they become allowed exceptions (a DEC entry), or should acad-ts keep them? This thread did neither.
3. **R12 synthesised objects (R16).** Should objects acad-ts synthesises when reading a pre-R13 file be excluded from the diff? This needs a DEC entry.
4. **Bench files.** `bench-100k.dwg` and `bench-ga.dwg` (M1-26) are needed to confirm T2 and T5 on real drawings.
5. **Upstream.** Submit the 12 drafted PRs to `node-projects/acad-ts` (texts in `PATCHES.md`), or keep them local for now?
