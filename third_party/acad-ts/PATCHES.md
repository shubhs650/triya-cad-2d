# acad-ts — vendored copy and local patches

| | |
|---|---|
| Upstream | https://github.com/node-projects/acad-ts (MIT) |
| Pinned commit | `315f3d8db7c9c6f2d5f6755165ec1feef6d47c06` (2026, "Audit ACadSharp through 25b5348") |
| Upstream version | `@node-projects/acad-ts` 3.5.0 |
| ACadSharp parity | audited through DomCR/ACadSharp `25b534813c1e5beb19ce78dd8f671781fd4d052f` |
| Vendored paths | `src/`, `LICENSE`, `README.md`, `package.json`, `tsconfig.json` |
| Not vendored | `reference/` (Autodesk DXF reference PDF, ODA spec), `samples/` (`.shx`/`.shp`/`.pat` files and sample drawings), `tests/`, `docs/`, `tools/`, `.github/`, lockfile |
| Re-sync | `third_party/sync-acad-ts.sh <sha>` then update this table |

Upstream test suite at the pinned commit, run in the upstream checkout: 717 passed, 16 skipped (61 files). With patch 0001 applied: same. Patches 0002–0013 (M0-06) were not run against the upstream suite: the spike thread could not install upstream's dev dependencies. They are covered by our own tests and the corpus round trip; run the upstream suite before submitting them.

## Rules

- This directory is a filtered snapshot, not a git subtree (DEC-033). Never hand-edit a file here without a patch in `third_party/acad-ts-patches/` that `sync-acad-ts.sh` re-applies.
- Each patch is minimal, has a unit test that fails on the unpatched code, and carries the upstream PR text below. Tests that can build their drawing in memory live in `packages/io/test/acad-ts-patches.test.ts`; tests that need a real drawing (paper-space layouts, a full named-object dictionary) live in `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts`, because `@triya/io` has no Node file APIs.
- Line endings are kept exactly as upstream ships them (mixed CRLF/LF); `.gitattributes` marks this tree `-text` and formatters ignore it.

## Patches

### 0001 — `createExtendedDictionary()` calls `require` inside an ES module

- **File:** `third_party/acad-ts-patches/0001-esm-safe-create-extended-dictionary.patch`
- **Touches:** `src/CadObject.ts`, `src/Objects/CadDictionary.ts`
- **Symptom:** `CadObject.createExtendedDictionary()` throws `ReferenceError: require is not defined` in every ESM runtime (Node ESM, browsers, Web Workers). The package is `"type": "module"`, so `require` never exists. Any caller that adds an extension dictionary (including `Mesh` subdivision data) fails. Under Vitest a `require` shim exists and loads a second copy of the module, so the call "works" but returns a dictionary that fails `instanceof CadDictionary`; the test asserts `instanceof` to catch both failure modes.
- **Fix:** `CadDictionary.ts` registers a factory on `CadObject` when it is evaluated, the same pattern `DwgFileHeader.registerFactory` already uses to break an import cycle.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0001 createExtendedDictionary works under ESM".
- **Upstream status:** PR text drafted below, not yet submitted (threads have no write access to upstream; owner submits).

<details><summary>Upstream PR text</summary>

**Title:** Fix `createExtendedDictionary` throwing `require is not defined` under ESM

`CadObject.createExtendedDictionary()` lazily loads `CadDictionary` with `require('./Objects/CadDictionary')` to avoid the `CadObject` ⇄ `CadDictionary` import cycle. The package is published as `"type": "module"`, so `require` is undefined in Node ESM, browsers and workers, and the call always throws `ReferenceError: require is not defined`. Under Vitest a `require` shim loads a second copy of `CadDictionary`, so the call appears to work but returns an object that fails `instanceof CadDictionary`.

This change replaces the `require` with a constructor factory that `CadDictionary.ts` registers on `CadObject` at module evaluation, mirroring the existing `DwgFileHeader.registerFactory` pattern. No public API changes beyond the internal `CadObject.registerDictionaryFactory`. Repro:

```js
import { Line } from '@node-projects/acad-ts';
new Line().createExtendedDictionary(); // ReferenceError before, CadDictionary after
```

The full test suite passes unchanged (717 passed, 16 skipped).

</details>

### 0002 — DXF writer crashes on, and then loses, a dynamic block's evaluation graph

- **File:** `third_party/acad-ts-patches/0002-dxf-evaluation-graph-expression-owner-and-null-handle.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** With `writeDynamicBlockData` on (Triya's writer profile), saving a drawing whose `ACAD_ENHANCEDBLOCK` graph has a node whose expression acad-ts did not read throws on `null.owner`; a node expression with no owner throws too. When it does not throw, the node's `360` is omitted, so the reader mis-indexes the remaining nodes and drops the graph.
- **Fix:** Write `360` as handle 0 when the node has no expression, and set the expression's owner to the graph before queueing it.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0002 DXF writer saves an evaluation graph with an unresolved node".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Fix DXF writer crash and graph loss for evaluation graphs with unresolved nodes

`DxfObjectsSectionWriter` writes each `ACAD_EVALUATION_GRAPH` node's expression as `360` and pushes the expression to the object queue. When the reader could not resolve a node's expression (any expression type acad-ts does not implement), `node.expression` is null: the writer throws on `expression.owner`, and when guarded it skips the `360` code, which shifts every later node on reread. Expressions created in code have no owner and also throw.

This writes `360 0` for a null expression (as AutoCAD does for an empty slot) and sets `expression.owner ??= graph`. Repro: read any dynamic-block DXF from `samples/` with an unsupported parameter, write it with `writeDynamicBlockData = true`, reread.

</details>

### 0003 — DWG writer swaps red and blue in every true colour

- **File:** `third_party/acad-ts-patches/0003-dwg-true-color-byte-order.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgStreamWriterAC18.ts`, `src/IO/DWG/DwgStreamWriters/DwgMergedStreamWriter.ts`
- **Symptom:** R2004+ DWG stores a CMC/EnColor RGB value as a little-endian long `0xC2RRGGBB`. The writer emitted the bytes R, G, B, so every true colour on an entity, layer or colour book came back with red and blue swapped (the reader is correct).
- **Fix:** Write the bytes as B, G, R, 0xC2 in `writeCmColor`, `writeEnColor`, `writeEnColorBook` and `writeMergedCmColor`.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0003 DWG %s writer keeps true-colour channel order (AC1018, AC1024, AC1032)".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Fix red/blue swap when writing true colours to DWG

DWG R2004+ encodes a true colour as the bit-long `0xC2RRGGBB` (ODA spec, CMC colour), i.e. bytes `BB GG RR C2` on disk. `DwgStreamWriterAC18.writeCmColor/writeEnColor/writeEnColorBook` and `DwgMergedStreamWriter.writeMergedCmColor` wrote `RR GG BB`, so a `Color.fromTrueColor(0x34C918)` reads back as `0x18C934`. The reader already decodes the spec order; this aligns the writer. Repro: set a true colour on a line, `DwgWriter.writeToBuffer`, `DwgReader.readFromStream`, compare `color.trueColor`.

</details>

### 0004 — DWG reader decodes the R2000+ header flag word wrongly

- **File:** `third_party/acad-ts-patches/0004-dwg-header-flags-decoding.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgHeaderReader.ts`
- **Symptom:** `$PSTYLEMODE` reads as 8192 (the raw `0x2000` bit) instead of 0/1, `$ENDCAPS`/`$JOINSTYLE` are not shifted, and `$LWDISPLAY`/`$XEDIT` are never true. Every DWG save then rewrote these variables. Before this patch `$PSTYLEMODE` differed on 100 corpus files.
- **Fix:** Decode the flag word as the writer encodes it (ODA spec §9.4): `endCaps = (f & 0x60) >> 5`, `joinStyle = (f & 0x180) >> 7`, `displayLineWeight = (f & 0x200) === 0`, `xEdit = (f & 0x400) === 0`, `extendedNames`/`loadOLEObject` as booleans, `plotStyleMode = (f & 0x2000) ? 1 : 0`.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0004 DWG header reader decodes the R2000+ flag word as the writer encodes it".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Fix decoding of the R2000+ DWG header flag word

`DwgHeaderReader` reads the packed `CELWEIGHT/ENDCAPS/JOINSTYLE/LWDISPLAY/XEDIT/EXTNAMES/PSTYLEMODE/OLESTARTUP` flags without shifting or inverting the bits, while `DwgHeaderWriter` encodes them per the ODA spec. Round-tripping any R2000+ DWG changes `PSTYLEMODE` to 8192 and loses `LWDISPLAY`, `XEDIT`, `ENDCAPS` and `JOINSTYLE`. This decodes each field as the writer encodes it.

</details>

### 0005 — DWG writer drops an all-zero section page, so English drawings reopen as Metric

- **File:** `third_party/acad-ts-patches/0005-dwg-keep-all-zero-section-page.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgFileHeaderWriterAC18.ts`
- **Symptom:** `addSection` skips any page whose bytes are all zero. `AcDb:Template` holds only `$MEASUREMENT`, which is 0 for English drawings, so the section vanished and the reader defaulted to Metric. Same risk for any small section whose content is all zero.
- **Fix:** Keep the first page of a section even when it is empty: `if (spearBytes > 0 && (nlocalSections === 0 || !this.checkEmptyBytes(...)))`.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0005 DWG %s writer keeps an all-zero AcDb:Template page ($MEASUREMENT = English) (AC1018, AC1032)".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep the first page of an all-zero DWG section

`DwgFileHeaderWriterAC18.addSection` skips pages whose bytes are all zero, to save space for sparse sections. When a whole section is zero (e.g. `AcDb:Template` with `MEASUREMENT = 0`, English), no page is written and the section is missing from the section map, so readers fall back to their defaults (acad-ts treats a missing template as Metric). This always writes a section's first page.

</details>

### 0006 — DWG writer stores a layout's minimum limits twice

- **File:** `third_party/acad-ts-patches/0006-dwg-layout-max-limits.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** The LAYOUT object writer wrote `minLimits` where `maxLimits` belongs, so every paper-space layout's `LIMMAX` was lost on save.
- **Fix:** Write `layout.maxLimits` in the second slot.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0006 DWG writer stores a layout's maximum limits, not its minimum twice".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Fix DWG LAYOUT writing minLimits instead of maxLimits

In `DwgObjectWriter.writeLayout` the limits block writes `write2RawDouble(layout.minLimits)` twice. The second call must write `layout.maxLimits` (ODA spec, LAYOUT object). One-line fix.

</details>

### 0007 — DWG writer drops block-record preview images

- **File:** `third_party/acad-ts-patches/0007-dwg-block-record-preview.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** `BLOCK_RECORD` previews (R2000+) were written as length 0, so block thumbnails shown by DesignCenter and the Insert dialog were lost on every save.
- **Fix:** Write `preview.length` and then the bytes.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0007 DWG writer keeps block-record preview images".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write BLOCK_RECORD preview data to DWG

`DwgObjectWriter` writes `writeBitLong(0)` for the block record's preview size, discarding `BlockRecord.preview` (which the reader fills). This writes the length followed by the bytes, as the reader expects.

</details>

### 0008 — DXF writer writes only 12 of ~40 VPORT codes

- **File:** `third_party/acad-ts-patches/0008-dxf-write-full-vport-record.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`
- **Symptom:** View mode, twist, lens length, zoom percent, grid/snap details, UCS, elevation, render mode, visual style and lighting reset on every DXF save; `viewMode` came back as 16 (FrontClippingZ) on 93 corpus files.
- **Fix:** Write the full AcDbViewportTableRecord: always 10–17, 40–44, 50, 51 and 71–78; from R2000 also 281, 110–112, 345, 346, 79, 146; from R2007 also 348, 60, 61, 292, 282, 141, 142, 63/421.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0008 DXF writer writes the whole VPORT record".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the complete VPORT table record to DXF

`DxfTablesSectionWriter.writeVPort` writes the view centre, corners, snap/grid and height only. Everything else in the record (DXF reference, VPORT group codes) is lost, and the reader's defaults then differ from the original. This writes every code the reader maps, gated by version as in the DXF reference.

</details>

### 0009 — DXF writer loses a layer's plot style

- **File:** `third_party/acad-ts-patches/0009-dxf-layer-plot-style-handle.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`
- **Symptom:** Group 390 was always written as 0, so every layer's plot-style name reset to Normal in named-plot-style drawings (83 corpus files).
- **Fix:** Write `layer.plotStyleName` through the handle map.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0009 DXF writer keeps a layer's plot-style handle (group 390)".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write LAYER plot-style handle (390) to DXF

`writeLayer` writes `390 0` unconditionally. This writes `layer.plotStyleName` (mapped through the handle map like other references).

</details>

### 0010 — DXF writer drops LAYOUT flags, UCS orthographic type and last-active viewport

- **File:** `third_party/acad-ts-patches/0010-dxf-layout-flags-ucs-last-viewport.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** `AcDbLayout` group 70 (PSLTSCALE, LIMCHECK flags), 76, 331, 345 and 346 were not written, so paper-space layouts lost limits checking, linetype scaling and their last-active viewport (81 corpus files).
- **Fix:** Write 70 after the layout name, 76, and the 331/345/346 handles.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0010 DXF writer writes AcDbLayout flags, UCS orthographic type and last viewport".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write LAYOUT flags, ortho type and viewport/UCS handles to DXF

`writeLayout` omits several AcDbLayout group codes the reader maps: 70 (layout flags), 76 (UCS orthographic type), 331 (last active viewport), 345 (named UCS) and 346 (base UCS). This adds them in DXF-reference order.

</details>

### 0011 — DXF writer drops empty dictionaries and ACAD_MATERIAL

- **File:** `third_party/acad-ts-patches/0011-dxf-keep-empty-and-material-dictionaries.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** Empty dictionaries and the root `ACAD_MATERIAL` entry were skipped. AutoCAD and acad-ts recreated them on reopen under new handles, so handle-based references broke and a passthrough export could not match the original.
- **Fix:** Remove both skips: every dictionary is written under its own handle.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0011 DXF writer keeps empty dictionaries and ACAD_MATERIAL under their handles".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep empty dictionaries and ACAD_MATERIAL when writing DXF

The DXF writer skips dictionaries with no entries and the `ACAD_MATERIAL` entry of the named-object dictionary. Readers then recreate the standard ones with new handles, so the round trip is not stable. AutoCAD writes empty dictionaries; this does the same. (MATERIAL objects themselves are still not written by the DXF writer.)

</details>

### 0012 — DXF reader reads 16-bit group codes as unsigned

- **File:** `third_party/acad-ts-patches/0012-dxf-signed-short-group-codes.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfStreamReaderBase.ts`
- **Symptom:** Binary DXF 16-bit values such as lineweight -2 (ByBlock) read back as 65534, so dimension-style and entity lineweights changed on every binary round trip.
- **Fix:** `valueAsShort` sign-extends: `(Number(this.value) << 16) >> 16`.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0012 DXF reader reads 16-bit group codes as signed (ByBlock lineweights)".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read 16-bit DXF group codes as signed

Group codes 60–79, 170–179, 270–289, 370–389, 400–409 and 1060–1070 are 16-bit signed integers (DXF reference, group code value types). `DxfStreamReaderBase.valueAsShort` returned the unsigned value for binary DXF, so `-1`/`-2` lineweights read as 65535/65534. This sign-extends.

</details>

### 0013 — DWG writer is quadratic in the number of entities in a block

- **File:** `third_party/acad-ts-patches/0013-dwg-block-header-linear-time.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** `_writeBlockHeader` deduplicated owned handles with `Array.includes` and found entities with `Array.find`. A 100k-entity model space took about 84 s to write to DWG (PRD T5 budget: 2 s); 60k took about 18 s.
- **Fix:** Use a `Set` for owned and insert handles and a `Map` from handle to entity; drop a redundant insert loop. Corpus round-trip results are unchanged. 100k entities now write in about 1.9 s.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0013 DWG writer saves a large block in linear time".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Make DWG block-header writing linear time

`DwgObjectWriter._writeBlockHeader` builds the owned-object list with `includes` and looks entities up with `find` inside a loop over the block's entities, which is O(n²). Writing a model space of 100,000 lines takes ~84 s. This switches to a `Set` and a `Map`; the public-corpus round-trip results are unchanged, and the same drawing writes in ~1.9 s.

</details>
