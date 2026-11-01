# M0 Spike — acad-ts go/no-go

**Purpose:** acad-ts is the keystone dependency (DEC-004). Before any editor code exists, prove it can read and write real drawings at the fidelity the PRD requires, or fail fast so the file-layer decision can be revisited.

**Owner of the decision:** Shubham. **Executed by:** Claude Code thread(s) for the automated part; owner for the AutoCAD AUDIT part.

## Questions the spike must answer

1. Does acad-ts **read** every public corpus file (DXF ASCII/binary, DWG R12–R2018) without throwing? Which entities/objects come back as unknown/proxy/skipped?
2. Does it **write** each file back (same version) such that acad-ts can re-read it and `structuralDiff` = 0 (with the allowed exceptions in `TESTING.md` §3)?
3. For the hard entities — MTEXT with formatting codes, HATCH with arc/spline/ellipse edges and islands, DIMENSION subclasses with overrides, TABLE with merged cells, MLEADER, LWPOLYLINE with bulges/widths, SPLINE, IMAGE/PDF underlay definitions, VIEWPORT with VP layer overrides, dynamic-block `*U` blocks and their representation data, `ACDBASSOC*` objects, xdata, extension dictionaries — are **all properties** preserved through read → write → read?
4. Does **AutoCAD** open the written files with `AUDIT` reporting 0 errors and no "unknown object"/"proxy" warnings beyond those in the source? (owner)
5. What is the **performance** in a Web Worker: parse and write time, peak memory for `bench-ga.dwg` and `bench-100k.dwg`?
6. What is the **bundle size** of acad-ts in the worker and does it tree-shake?
7. Which of its known limitations (from the README: R2007 uncompressed pages, R12 limitations, bigfont/codepage handling) affect the target users?

## Procedure

1. Vendor acad-ts at a pinned commit (`third_party/acad-ts`), build into the I/O worker (M0-03).
2. Run `pnpm spike:read` → table of file × (ok | error | warnings), list of unmapped types with counts.
3. Run `pnpm spike:roundtrip` → `structuralDiff` report per file; group failures by property path.
4. Write targeted unit tests for the top 20 failures; patch acad-ts for the top 5 root causes (minimal diffs, logged in `PATCHES.md` with upstream PR drafts).
5. Re-run; produce before/after.
6. Perf: parse/write timings and memory in Node and in Chromium worker; bundle analysis.
7. Hand the written files to the owner (`docs/reports/M0-written/`, gitignored, zipped in the Library tab of the project) for the AutoCAD AUDIT sweep; owner records results in the issue.
8. Write `docs/reports/M0-acad-ts-spike.md` with the recommendation.

## Go / no-go criteria

**GO** if all of: every corpus file reads; round-trip diff = 0 on ≥ 90 % of files after patches and the remaining failures are enumerated with plausible fixes; AUDIT = 0 on all written files that acad-ts round-trips cleanly; parse of `bench-100k.dwg` < 3 s in a worker; no limitation that blocks the markup workflow.

**CONDITIONAL GO** if reading is clean but writing has enumerable defects: proceed with M1 *read-only* work while a dedicated thread fixes the writer; M2-13 (Save) is blocked until the round-trip gate passes.

**NO-GO** if reading fails on real-world files in ways that look structural (e.g. object-map or section parsing), or AUDIT reports corruption on cleanly round-tripped files. Fallback options to present: (a) DXF-only via a smaller, better-tested reader/writer plus a separate GPL DWG↔DXF converter tool (the original option D); (b) deeper investment in patching acad-ts/ACadSharp with upstream collaboration.

## Report template (`docs/reports/M0-acad-ts-spike.md`)

- Summary and recommendation (GO / CONDITIONAL / NO-GO)
- Read results table · Round-trip results table (before/after patches)
- Failure taxonomy with counts and root causes
- Patches applied and upstream status
- Performance and bundle numbers
- Limitations that matter to users, with mitigation
- Open questions for the owner
