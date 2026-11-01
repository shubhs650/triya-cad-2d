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

Upstream test suite at the pinned commit, run in the upstream checkout: 717 passed, 16 skipped (61 files). With patch 0001 applied: same. Patches 0002–0013 (M0-06), 0014–0020 (M1-30), 0021–0030 (M1-28), 0031–0060 (M1-29) and 0061–0070 (M1-31) were not run against the upstream suite: neither thread could install upstream's dev dependencies. They are covered by our own tests and the corpus round trip; run the upstream suite before submitting them.

## Rules

- This directory is a filtered snapshot, not a git subtree (DEC-033). Never hand-edit a file here without a patch in `third_party/acad-ts-patches/` that `sync-acad-ts.sh` re-applies.
- Each patch is minimal, has a unit test that fails on the unpatched code, and carries the upstream PR text below. Tests that can build their drawing in memory live in `packages/io/test/acad-ts-patches.test.ts`; tests that need a real drawing (paper-space layouts, a full named-object dictionary) live in `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts`, because `@triya/io` has no Node file APIs.
- Patches apply in number order and a later one may change lines an earlier one touched (0020 edits the header flag word that 0004 decodes). `tests/third-party/acad-ts-vendoring.test.ts` checks each patch against the tree as it was right after it, by undoing the patches newest first on a copy.
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

### 0014 — Readers discard objects they cannot map, and the writers could not write them anyway (model + DXF)

- **File:** `third_party/acad-ts-patches/0014-keep-unknown-objects-raw-dxf.patch`
- **Touches:** `src/Objects/RawObjectData.ts` (new), `src/Objects/UnknownNonGraphicalObject.ts`, `src/Entities/UnknownEntity.ts`, `src/IO/CadReaderConfiguration.ts`, `src/IO/CadDocumentBuilder.ts`, `src/IO/DXF/DxfStreamReader/{IDxfStreamReader,DxfStreamReaderBase,DxfObjectsSectionReader,DxfSectionReaderBase}.ts`, `src/IO/DXF/DxfStreamWriter/{IDxfStreamWriter,DxfStreamWriterBase,DxfSectionWriterBase,DxfObjectsSectionWriter}.ts`
- **Symptom:** About 12% of the objects in the public corpus (view styles, SUN, AEC objects, solid history, render settings, proxies) are not mapped by acad-ts. The readers created `UnknownEntity`/`UnknownNonGraphicalObject` only when `keepUnknown*` was set (the objects reader tested `keepUnknownEntities` instead of `keepUnknownNonGraphicalObjects`), kept no payload, and both writers skipped them, so every save dropped them. Objects they own (extension dictionaries, XRECORDs) were never registered and were dropped too.
- **Fix:** With `keepUnknownEntities`/`keepUnknownNonGraphicalObjects`, the DXF reader records every group code of an unknown object (`IDxfStreamReader.recorder`) into `rawDxfCodes`, and the DXF writer emits them with a new `writeRaw` (no escaping), substituting only the handle (5) and owner (330) before the first subclass marker. `CadDocumentBuilder` attaches objects whose owner is an unknown object to it (`rawOwnedObjects`), so they join the document and get written. `IRawCadObject` also carries the DWG record (filled by 0016). An object read from DWG has no DXF codes and is skipped with a notification when written to DXF.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0014 DXF keeps unknown objects raw and writes them back" (ASCII, binary, and an unknown entity in `uncommon.dxf`).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep unknown DXF objects and entities and write them back

With `keepUnknownEntities`/`keepUnknownNonGraphicalObjects` set, the DXF reader now keeps the group codes of objects and entities it cannot map (`rawDxfCodes`), and `DxfWriter` writes them back unchanged under their handle and owner. Objects they own (extension dictionaries, XRECORDs) are attached to them and written too. Without this, a read/write of any drawing with, for example, `ACDBDETAILVIEWSTYLE`, `SUN` or an AEC object silently loses those objects. The flags' `@deprecated` notes are replaced, since the payloads are now written. The objects reader also tested `keepUnknownEntities` where it meant `keepUnknownNonGraphicalObjects`.

</details>

### 0015 — DWG reader drops classes that share a DXF name, and the writer renumbers classes

- **File:** `third_party/acad-ts-patches/0015-dwg-same-name-classes.patch`
- **Touches:** `src/Classes/DxfClassCollection.ts`, `src/IO/DWG/DwgStreamReaders/DwgClassesReader.ts`
- **Symptom:** `AecObjects.dwg` has two `AEC_LIST_DEF` classes (808 and 809); `DxfClassCollection` is keyed by DXF name, so the reader dropped 809 and its 133 objects lost their class. `resetClassNumbers` renumbered every class from 500 on each save, so a raw object record (0016), which names its class by number, would point at the wrong class.
- **Fix:** Keep a class whose name is taken in a second list (`addSameName`), included in `count`, iteration and `getByClassNumber`. `resetClassNumbers` keeps every unique number of 500 or more and gives the next free number only to classes without one.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0015 class numbers a drawing was read with survive resetClassNumbers"; `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0015 DWG reader keeps classes that share a DXF name, under their own numbers" (also needs 0016).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep DWG classes with duplicate DXF names and their class numbers

Some AutoCAD Architecture drawings define two classes with the same DXF name and different class numbers, and objects of both. The collection keyed by name kept only the first, so objects of the second could not be resolved. `resetClassNumbers` also renumbered every class, which breaks any object stored by class number. This keeps same-name classes and preserves read class numbers; new classes still get numbers from 500.

</details>

### 0016 — DWG reader keeps no payload for unknown objects, and the writer skips them

- **File:** `third_party/acad-ts-patches/0016-dwg-keep-unknown-objects-raw.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** Unknown DWG objects and entities were created without their data and the writer skipped them (`_skipEntry`, `_isEntitySupported`), so a DWG save lost them, plus every object only they referenced (the reader never queued those handles).
- **Fix:** With the keep flags set, the reader stores the object record (`rawDwgData`: the bytes after the size MS and, R2010+, the handle-stream MC, plus version, type code and handle) and queues every handle left in its handle stream. The writer re-emits the record with a recomputed CRC when the file version, handle and class number still match (`_canWriteRaw`), and queues its extension dictionary and owned objects; otherwise it notifies and skips as before.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0016 DWG keeps unknown objects raw and writes their records back byte for byte".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep unknown DWG objects and write their records back

With `keepUnknownEntities`/`keepUnknownNonGraphicalObjects` set, `DwgObjectReader` now stores the raw object record of objects it cannot parse, and `DwgObjectWriter` writes it back unchanged (new CRC) when saving to the same version, under the same handle and class number. Handles in the object's handle stream are queued, so objects it owns are read. Without this, any DWG round trip drops these objects, for example 1,096 of the objects in an AutoCAD Architecture sample.

</details>

### 0017 — SUN objects and 3DSOLID history objects are not linked, so a save drops them

- **File:** `third_party/acad-ts-patches/0017-sun-and-solid-history.patch`
- **Touches:** `src/Tables/VPort.ts`, `src/Entities/Viewport.ts`, `src/Entities/Solid3D.ts`, `src/IO/Templates/{CadVPortTemplate,CadViewportTemplate,CadSolid3DTemplate}.ts`, `src/IO/DXF/DxfStreamReader/{DxfTablesSectionReader,DxfSectionReaderBase}.ts`, `src/IO/DXF/DxfStreamWriter/{DxfTablesSectionWriter,DxfSectionWriterBase}.ts`, `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** A VPORT's and a viewport's SUN (DXF 361, hard owner) and a 3DSOLID's history object (DXF 350, R2007+) were read as handles and thrown away; the writers wrote 0/null, so both objects vanished on save even when kept raw (0014/0016). The DWG reader also never queued the history handle.
- **Fix:** Add `VPort.sun`, `Viewport.sun` and `Solid3D.history`, resolved by the templates, registered with the document, and written (and queued) by both writers. `clone()` drops `sun`.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0017 SUN objects of VPORTs and viewports survive a DXF save", "0017 3DSOLID history objects survive DWG and DXF saves".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep SUN and 3DSOLID history references

`VPORT` and `VIEWPORT` hard-own a `SUN` object through group 361, and R2007+ `3DSOLID` owns its history object through 350. The readers discarded these handles and the writers wrote 0, so the owned objects were orphaned and dropped. This adds `sun`/`history` properties, resolves them on read and writes them back, in DXF and DWG.

</details>

### 0018 — Objects owned only through an XRECORD entry are never read or written

- **File:** `third_party/acad-ts-patches/0018-xrecord-owned-objects.patch`
- **Touches:** `src/IO/CadDocumentBuilder.ts`, `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** An XRECORD can own objects through 350–369 entries (an R2004 table's `DATATABLE`, for example). The DWG reader did not queue those handles, so the objects were never read; when read (DXF), nothing registered or wrote them.
- **Fix:** The DWG reader queues XRECORD handle entries; the builder registers objects owned through 350–369 entries once their XRECORD is in the document; both writers queue 350–369 entry objects. The DXF writer now skips `TableContent` (not implemented by its DXF writer) with a notification instead of throwing, because 0018 makes those objects reachable.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0018 objects owned only through an XRECORD entry are read and written".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write objects owned through XRECORD entries

XRECORD entries with group codes 350–369 are soft/hard owner references. Objects owned only that way were not read from DWG (their handles were never queued) and were not written by either writer, so a round trip dropped them. This queues and registers them. `DxfObjectsSectionWriter` lists `TableContent` among the objects it does not write, because reaching it used to throw.

</details>

### 0019 — DXF reader loses a layout's plot flags

- **File:** `third_party/acad-ts-patches/0019-dxf-plotsettings-flags-in-layout.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`
- **Symptom:** `AcDbPlotSettings` and `AcDbLayout` both use group 70. `_readLayout` tried the layout map first, so the plot flags went into `layoutFlags` (and were then overwritten by the real layout flags), and `PlotSettings.flags` kept its default 688. Model in `sample_AC1032_ascii.dxf` has 11952.
- **Fix:** In `_readLayout`, read codes inside the `AcDbPlotSettings` subclass with the plot-settings map.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0019 DXF reader keeps a layout's plot flags apart from its layout flags".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read LAYOUT plot-settings codes with the plot-settings map

A LAYOUT object has an `AcDbPlotSettings` subclass followed by `AcDbLayout`, and group 70 means plot flags in the first and layout flags in the second. The reader looked codes up in the layout map first, so plot flags were stored as layout flags and lost. This reads codes in the `AcDbPlotSettings` subclass with its own map.

</details>

### 0020 — DWG header `$CELWEIGHT` read and written as an index, not a lineweight

- **File:** `third_party/acad-ts-patches/0020-dwg-celweight-index.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgHeaderReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgHeaderWriter.ts`
- **Symptom:** The low 5 bits of the R2000+ header flag word are a lineweight index (as on entities). The reader stored the index as the value (ByLayer came back as 29) and the writer wrote the value masked to 5 bits (W50 became 18).
- **Fix:** Convert with `CadUtils.toValue` on read and `CadUtils.toIndex` on write.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0020 DWG header stores $CELWEIGHT as a lineweight index and reads it back as a value"; `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0020 DWG reader returns $CELWEIGHT as a lineweight, matching the DXF of the drawing".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Decode and encode $CELWEIGHT as a lineweight index

In the R2000+ DWG header, `CELWEIGHT` is stored as a lineweight index in the low 5 bits of the flags word (ODA spec §9.4), like entity lineweights. `DwgHeaderReader` returned the raw index and `DwgHeaderWriter` masked the value, so ByLayer read as 29 and W50 wrote as 18. This uses `CadUtils.toValue`/`toIndex`.

</details>

### 0021 — DXF writer drops every MATERIAL and VISUALSTYLE

- **File:** `third_party/acad-ts-patches/0021-dxf-raw-material-and-visualstyle.patch`
- **Touches:** `src/IO/CadReaderConfiguration.ts`, `src/Objects/Material.ts`, `src/Objects/VisualStyle.ts`, `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** `DxfObjectsSectionWriter` has no writer for `Material` or `VisualStyle` and skips them ("Object not implemented"). Their extension dictionaries, XRECORDs and named-object-dictionary entries went with them: 1,838 objects in 83 public files, 3,636 declared handles counting their dictionaries and XRECORDs. The DXF reader also assigns no `VisualStyle` field (`_readVisualStyle` consumes every code), so a field writer alone would write defaults.
- **Fix:** New reader option `keepRawDxfPassthroughObjects`. When it is set, `readObjectCodes` records the group codes of these two types with the M1-30 recorder (0014), and the writer emits them through `writeRawObject`, which rewrites only the handle and owner. Without recorded codes, the writer still skips the object with a notification. DEC-040.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0021 DXF writer writes MATERIAL and VISUALSTYLE back as read" (R2018 ASCII and binary, R2000 ASCII: every style keeps its handle, codes and extension dictionary, and `ACAD_MATERIAL`/`ACAD_VISUALSTYLE` list the same entries).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Optionally keep MATERIAL and VISUALSTYLE group codes so DXF saves do not drop them

The DXF writer has no MATERIAL or VISUALSTYLE writer, so every DXF save drops them, together with their extension dictionaries and the named-object dictionary entries that point at them. The DXF VISUALSTYLE reader also assigns no field, so a field writer would only write defaults. This adds `CadReaderConfiguration.keepRawDxfPassthroughObjects`. When it is set, the DXF reader records the group codes of these objects, using the same recorder as raw unknown objects, and the DXF writer writes them back unchanged under their handle and owner. The default behaviour is unchanged.

</details>

### 0022 — ASCII DXF writer masks negative xdata 1070 integers

- **File:** `third_party/acad-ts-patches/0022-dxf-ascii-signed-xdata-int16.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfAsciiWriter.ts`
- **Symptom:** `writeValue` wrote `ExtendedDataInt16` (1070) as `value & 0xFFFF`, so `-1` became `65535`. Ordinary 16-bit codes were already written signed. acad-ts reads the value back as signed, so the round-trip diff of typed xdata could not see it, but the file is wrong for other readers. It showed as raw-code differences once 0021 kept VISUALSTYLE xdata (`1070 -1`).
- **Fix:** Write negative 1070 values signed, as for `Int16`.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0022 ASCII DXF writer keeps the sign of xdata 1070 integers" (checks the written lines, then the reread values).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write negative xdata 1070 integers signed in ASCII DXF

`DxfAsciiWriter.writeValue` keeps the sign for `Int16` group codes but masks `ExtendedDataInt16` (1070) to 16 bits, so `-1` is written as `65535`. AutoCAD writes and expects 1070 as a signed 16-bit integer. This applies the same signed path to 1070.

</details>

### 0023 — DXF writer writes RASTERVARIABLES display quality as its units

- **File:** `third_party/acad-ts-patches/0023-dxf-rastervariables-units.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** `_writeRasterVariables` wrote `displayQuality` for both 71 and 72, so every DXF save replaced the image units (72) with the display quality: inches (5) came back as 1. Spike root R10, 30 files.
- **Fix:** Write `units` for 72.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0023 DXF writer writes RASTERVARIABLES units (72), not the display quality twice" (`images.dxf`, units 5).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write RASTERVARIABLES units (72) instead of repeating the display quality

`DxfObjectsSectionWriter._writeRasterVariables` writes `variables.displayQuality` for group 72, which is the image units. A save therefore changes the units of every raster image definition to the display-quality value. This writes `variables.units`.

</details>

### 0024 — Julian dates lose a millisecond on read

- **File:** `third_party/acad-ts-patches/0024-julian-date-milliseconds.patch`
- **Touches:** `src/CadUtils.ts`
- **Symptom:** `fromJulianCalendar` floored hours, minutes, seconds and milliseconds one after the other from a day fraction that is never exact, so a date stored at `…:03.000` read back as `…:02.999`. Every save then moved `$TDCREATE`, `$TDUPDATE` and the other dates by a millisecond. Spike root R6, 42 files.
- **Fix:** Round the day fraction to whole milliseconds once, then split it into fields.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0024 Julian dates read back to the millisecond they were written" (milliseconds 0, 1, 500 and 999 through a DXF save).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Round Julian dates to the millisecond before splitting them into fields

`CadUtils.fromJulianCalendar` floors each time field from the remaining day fraction. The fraction of a stored Julian date is a binary double, so `3.000 s` is usually `2.9999999 s` and reads back as `2.999 s`; each read and save cycle drifts a date back by a millisecond. This rounds the fraction to whole milliseconds once and derives hours, minutes, seconds and milliseconds from that integer.

</details>

### 0025 — DXF BLOCK_RECORD loses its insert units and its preview

- **File:** `third_party/acad-ts-patches/0025-dxf-block-record-units-and-preview.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfTablesSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`
- **Symptom:** In `AcDbBlockTableRecord`, group 70 is the insertion units, but the reader passed it to the common table-entry flags, so `units` stayed 0. Each 310 preview chunk replaced the previous one on read, and the writer wrote no 310 at all. A DXF save lost both. Spike root R8, 33 and 27 files; also the `BLOCK_RECORD 70` entry of the M1-32 oracle list.
- **Fix:** Read 70 into `units` and append every 310 chunk to `preview`; write `preview` back in chunks of at most 127 bytes after 340, where AutoCAD writes it.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0025 DXF BLOCK_RECORD keeps its insert units (70) and its whole preview (310)" (`BLOCKALIGNMENTPARAMETER.dxf`, handle 250, against the group codes in the file).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write BLOCK_RECORD insert units (70) and the whole preview bitmap (310)

The DXF tables reader treats group 70 of a BLOCK_RECORD as the table-entry flags, but in the `AcDbBlockTableRecord` subclass it is the insertion units (`INSUNITS` values). The reader also keeps only the last 310 chunk of the preview bitmap, and the writer writes no preview. This reads 70 into `BlockRecord.units`, concatenates all 310 chunks into `preview`, and writes the preview back in 127-byte chunks after group 340.

</details>

### 0026 — DXF writer drops xdata on dictionaries and five other object types

- **File:** `third_party/acad-ts-patches/0026-dxf-xdata-on-dictionaries-and-colors.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** `writeObject` returned straight after the body of `DICTIONARY`, `DBCOLOR`, `IMAGEDEF`, `IMAGEDEF_REACTOR` and `ACDBPLACEHOLDER`, before `writeExtendedData`, so their xdata was lost on every DXF save (45 differences in 16 files for dictionaries, 8 in 8 for colour-book colours). Part of spike root R21.
- **Fix:** Drop the early returns so these types reach the shared `writeExtendedData` call like every other object.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0026 DXF writer writes xdata on dictionaries" (ASCII and binary).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write xdata on DICTIONARY, DBCOLOR, IMAGEDEF, IMAGEDEF_REACTOR and ACDBPLACEHOLDER

`DxfObjectsSectionWriter.writeObject` returns early after these five object bodies, so it never reaches the `writeExtendedData` call at the end, and their xdata is dropped from every DXF file. None of the five writers emits xdata itself; this removes the early returns.

</details>

### 0027 — DXF writer doubles the book name of DBCOLOR objects

- **File:** `third_party/acad-ts-patches/0027-dxf-dbcolor-name.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** `writeBookColor` wrote 430 as `${name}$${bookName}`, but `BookColor.name` already is `BOOK$COLOR`, so `RAL CLASSIC$RAL 1006` was written as `RAL CLASSIC$RAL 1006$RAL CLASSIC` and read back with the colour name `RAL CLASSIC`. Spike root R1 (the DBCOLOR part), 12 files.
- **Fix:** Write `name` for 430.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0027 DXF writer writes DBCOLOR names as BOOK$COLOR once" (ASCII and binary).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the DBCOLOR name (430) once as BOOK$COLOR

`BookColor.name` returns `bookName$colorName`, and `writeBookColor` appends `$bookName` to it again, so the colour name read back is the book name. This writes `color.name` as is. Separately, `new BookColor(name, bookName)` loses its name because the class fields initialise after `super(name)`; that is not changed here.

</details>

### 0028 — DXF TABLESTYLE and CELLSTYLEMAP lose their cell styles on save

- **File:** `third_party/acad-ts-patches/0028-dxf-table-style-cell-styles.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`, `src/IO/Templates/CadTableStyleTemplate.ts`
- **Symptom:** A DXF TABLESTYLE lists its data, title and header cell styles without ids, so `CadTableStyleTemplate` (which assigns them by id) left `dataCellStyle`/`titleCellStyle`/`headerCellStyle` at their defaults and the writer wrote those defaults. The reader also took the 284–289 border visibility flags (1 = visible) as `isInvisible`, and the writer wrote 62 and 91 from other fields (`contentColor`, `valueDataType`) than the reader fills (`color`, `styleClass`). In CELLSTYLEMAP the writer wrote no MARGIN or GRIDFORMAT blocks, and the reader read each GRIDFORMAT into a border object it then dropped, along with its 90/91/40. Spike root R5: 2,790 differences in 62 files. It is also the `TABLESTYLE` 284–289 entry of the M1-32 oracle list.
- **Fix:** Assign id-less cell styles by position (data, title, header). Read 284–289 as visibility. Write 62 from `color` and 91 from `styleClass`. Keep each GRIDFORMAT border on its style by edge flag, reading 90/91/40 too. Write the MARGIN block and the six GRIDFORMAT blocks in the order AutoCAD writes them.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0028 DXF TABLESTYLE and CELLSTYLEMAP keep their cell styles through a save" (`BLOCKALIGNMENTPARAMETER.dxf`: values checked against the file, then compared after ASCII and binary saves).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Round-trip TABLESTYLE and CELLSTYLEMAP cell styles in DXF

Several DXF table-style defects compound so that a save resets every table style to defaults. The DXF TABLESTYLE body repeats its cell-style groups for data, title and header without ids, but the template assigns them by id, so the three named styles stay at their defaults, and those defaults are what the writer writes. Group codes 284–289 are visibility flags (1 = visible) but are read as `isInvisible`. The writer writes 62 and 91 from `contentColor` and `valueDataType`, while the reader fills `color` and `styleClass`. In CELLSTYLEMAP, the writer omits the MARGIN and GRIDFORMAT blocks, and the reader reads each GRIDFORMAT into a fresh `CellBorder` that it never stores. This patch fixes each of these, so a read-write-read cycle is lossless on AutoCAD-written files.

</details>

### 0029 — DXF writer corrupts xdata displacements and layer names, and zeroes dangling handles

- **File:** `third_party/acad-ts-patches/0029-dxf-xdata-vectors-layers-handles.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** `writeExtendedData` wrote a 1012 displacement as a single group holding an `XYZ`. That broke the record, and the next object's xdata ended up on the previous one: in every `acadsharp/sample_*` DXF, the TEXT after the `DISP_APP` one gained a record. A 1003 layer reference went out as a 1005 handle, and a 1005 naming no object in the drawing went out as 0. Spike root R21 (TEXT xdata): 30 differences in 14 files. It also explains the TEXT the writer drops at handle 917 (M1-31).
- **Fix:** Write 1012 with `writeVector`. Write 1003 as the layer name. Write 1005 values as read, which is what AutoCAD's save does.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0029 DXF writer writes xdata displacements, layer names and dangling handles as read" (ASCII and binary).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Fix DXF xdata writing of 1012 displacements, 1003 layer names and unresolved 1005 handles

`DxfSectionWriterBase.writeExtendedData` passes the `XYZ` of an `ExtendedDataDisplacement` to `write` instead of `writeVector`, which produces a malformed record. It also writes `ExtendedDataLayer` through the generic handle-reference branch, so 1003 layer names become 1005 handles. And it replaces any 1005 handle that does not resolve in the document with 0, although AutoCAD keeps such values on save. This writes displacements as vectors and layer references as their layer name, and keeps 1005 values unchanged.

</details>

### 0030 — DXF writer drops xdata on symbol tables

- **File:** `third_party/acad-ts-patches/0030-dxf-symbol-table-xdata.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`
- **Symptom:** `_writeTable` wrote the TABLE header without its xdata, so the `ACAD` `DbSaveVer` record AutoCAD puts on the VPORT table was lost. The rest of spike root R21 (VPORT xdata): 11 files.
- **Fix:** Write the table's xdata after its header groups, where AutoCAD writes it.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0030 DXF writer writes xdata on symbol tables" (ASCII and binary).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write xdata on DXF symbol table headers

`DxfTablesSectionWriter._writeTable` writes a table's common data, its `AcDbSymbolTable` count and subclass, but not its xdata, although the reader reads it. AutoCAD writes `1001 ACAD / 1000 DbSaveVer` on the VPORT table, and that record was lost on every save. This writes `table.extendedData` after the header groups.

</details>

### 0031 — DXF writer scrambles VIEWPORT group codes and drops the R2000+ settings

- **File:** `third_party/acad-ts-patches/0031-dxf-viewport-group-codes.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** `_writeViewport` wrote the viewport id as 68 (the status field), the twist angle as 50 (snap angle), the circle zoom as 51 (twist), the UCS-icon flag as 72 (circle zoom), and the UCS origin and axes as single groups holding an `XYZ`. It wrote no 69, 71, 74, 79, 146, 170, 61, 348, 292, 282, 141, 142, 63, 340 or 1. Reading the saved file back gave every paper-space viewport the wrong id, angles, zoom, UCS and plot style, and no clipping boundary or visual style. The reader also put the raw 63/421 numbers in `ambientLightColor`. Spike report: about 20 differences per VIEWPORT field across the AC1015–AC1032 samples.
- **Fix:** Write AcDbViewport in the order of the DXF reference, gating the R2000, R2004 and R2007 groups by version as AutoCAD does, and read 63/421 into a `Color`.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0031 DXF writer writes VIEWPORT entities with their own group codes" (AC1015, AC1018 and AC1032 samples, ASCII and binary saves: every viewport field matches after a read-write-read).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write DXF VIEWPORT entities with AutoCAD's group codes

`DxfSectionWriterBase._writeViewport` shifts several fields onto neighbouring group codes (id on 68, twist on 50, circle zoom on 51, UCS icon on 72), writes the UCS origin and axes with `write` instead of `writeVector`, and omits every group added in R2000 and later, including the clip boundary (340), plot style sheet (1), visual style (348) and lighting. A read-write-read cycle therefore changes every viewport in a layout. This rewrites the subclass in the order of the DXF reference, gated by version, and makes the reader parse the ambient light colour (63/421) into a `Color`.

</details>

### 0032 — DXF ATTDEF and ATTRIB lose their version, lock position and multiline text

- **File:** `third_party/acad-ts-patches/0032-dxf-attribute-version-lock-multiline.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** The reader treated every 280 in AcDbAttribute(Definition) as the lock flag, so the version (280 before the tag, R2010+) was lost, and it read the AcDbText 71 (mirror flags) and 72 as the multiline flag and alignment. The writer wrote the tag before the prompt, wrote 280 for every version, and never wrote the R2018 multiline block (71, 72, 11, 101 "Embedded Object" and the MTEXT groups), so multiline attributes came back as single-line text. Corpus: ATTDEF `attributeType` 19, `version` 12, `mText` 3 differences.
- **Fix:** Route AcDbText groups to the text reader; read 280 as the version before the tag and as the lock position after it; skip AutoCAD's literal 72 0. Write prompt then tag, the version from AC1024, the lock position from AC1021, and the multiline block from AC1032 (earlier versions keep multiline text in an XRECORD under the extension dictionary, which passes through).
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0032 DXF ATTDEF and ATTRIB keep version, lock position and multiline text through a save" (AC1015, AC1021, AC1024 and AC1032 samples, ASCII and binary).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Round-trip DXF attribute version, lock position and multiline attributes

AcDbAttribute and AcDbAttributeDefinition use group 280 twice: before the tag it is the class version (R2010+), after 74 it is the lock-position flag (R2007+). The reader stored both in `isReallyLocked`, and it parsed the AcDbText group 71 (text generation flags) as the multiline attribute type. The writer wrote the tag before the prompt, wrote 280 regardless of version, and dropped the R2018 multiline block, so a multiline attribute was saved as single-line text. This disambiguates the reader by position and subclass, and writes the groups in the order and versions of the DXF reference.

</details>

### 0033 — DXF writer moves angles by an ulp, wraps hatch edge angles and drops SOLID hatch patterns

- **File:** `third_party/acad-ts-patches/0033-dxf-hatch-patterns-and-exact-angles.patch`
- **Touches:** `src/Math/MathHelper.ts`, `src/IO/DXF/DxfStreamWriter/DxfStreamWriterBase.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** DXF stores angles in degrees and the reader converts them with `degToRad`. The writer converted back with `radToDeg`, which can land one ulp away from the degree value read, so `TEXT` rotation, `ARC` angles and `HATCH` pattern-line and edge angles moved on every save (42 pattern lines, 14 text rotations, 11 arc angles in the corpus). `_writeHatchBoundaryAngles` wrapped edge angles into [0, 360), so an ellipse edge from 348.7° to 472.9° came back ending at 112.9°. And `_writeHatch` skipped 52/41/77/78 and the pattern lines whenever the hatch was flagged solid, although AutoCAD writes them for SOLID too, so the pattern angle, scale and lines were lost.
- **Fix:** Add `MathHelper.radToDegRoundTrip`, which picks the neighbouring double of `radToDeg(r)` that `degToRad` maps back to `r`, and use it for every angle the DXF writer converts through the map, for pattern lines and for edge angles. Write edge angles as read, turning only -0 into 0. Write the pattern block whenever the pattern has lines.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0033 DXF writer keeps HATCH patterns and every angle exact through a save" (acadsharp AC1015/AC1018 samples and ezdxf `clockwise_arcs_hatch`, `hatches_2`, `text_fonts`; ASCII and binary saves: every hatch pattern, pattern-line and edge angle, arc angle and text rotation is unchanged).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep DXF angles and SOLID hatch patterns exact through a save

Readers turn DXF degrees into radians with `degToRad`, but `radToDeg` is not its exact inverse in floating point, so about one angle in a few dozen changes in its last digit on every read-write cycle. This adds `MathHelper.radToDegRoundTrip`, which returns the degree value that converts back to the same radians, and uses it in the DXF writer. It also stops `_writeHatchBoundaryAngles` from wrapping edge angles into [0, 360) (the stored end angle of an edge can exceed 360), and writes the hatch pattern block for SOLID hatches, as AutoCAD does, instead of dropping a pattern that was read.

</details>

### 0034 — DXF and DWG writers reorder SORTENTSTABLE entries

- **File:** `third_party/acad-ts-patches/0034-sortentstable-entry-order.patch`
- **Touches:** `src/Objects/SortEntitiesTable.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** `SortEntitiesTable` yields its entries sorted by sort handle, and both writers iterated it. So a save reordered every table whose entries were not stored in sort-handle order, and AutoCAD stores them in the order its draw-order commands left them. The draw order itself survived, because it comes from the sort handles, but the object did not round-trip. Corpus: 874 differences (`_sorters[].entity` and `.sortHandle`) in the acadsharp DWG and DXF samples.
- **Fix:** Add a read-only `entries` getter that returns the stored order, and use it in both writers. Iteration keeps its sorted order for callers that want draw order.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0034 DXF and DWG writers keep SORTENTSTABLE entries in the order read" (AC1015 DXF, ASCII and binary saves; AC1015, AC1018 and AC1032 DWG).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write SORTENTSTABLE entries in their stored order

`SortEntitiesTable[Symbol.iterator]` sorts the entries by sort handle, and the DXF and DWG writers iterate the table, so a read-write cycle reorders the entries of any table not already stored in sort-handle order. AutoCAD keeps them in the order its draw-order edits leave them. This adds an `entries` getter that returns the stored order and uses it in both writers. Iteration still yields entries in draw order.

</details>

### 0035 — DXF writer drops the R2018 MTEXT column data

- **File:** `third_party/acad-ts-patches/0035-dxf-mtext-r2018-columns.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** R2018 DXF keeps the column settings of an MTEXT in an "Embedded Object" block (101) after the background groups. The reader read the block into `columnData`, but the writer never wrote it, so every MTEXT came back with no columns. The reader also skipped the block's defined extents (42/43). Corpus: 749 differences (`_columnData.*`) across the R2018 DXF files.
- **Fix:** From AC1032, write the block for an MTEXT with columns, in the order AutoCAD writes it:
  - 70 (attachment), 10 (direction), 11 (insertion point), 40/41 (reference rectangle), 42/43 (extents).
  - 71–74 (column type, count, width, gutter, auto height, flow reversed).
  - The 46 heights.
  
  The reader now keeps 42/43 in `horizontalWidth`/`verticalHeight`, which the writer writes back.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0035 DXF writer writes the R2018 MTEXT column data". It runs on acadsharp `sample_AC1032_ascii` and ezdxf `columns_R2018` and `mtext_columns_R2018`, with ASCII and binary saves. It checks the column data and extents of every MTEXT, and the manual heights 20/30/0 of the ezdxf example.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the R2018 MTEXT embedded column object to DXF

The DXF reader parses the R2018 MTEXT "Embedded Object" (group 101) into `MText.columnData`, but `_writeMText` never writes it, so a read-write cycle removes the columns of every multi-column MTEXT. This writes the embedded object for R2018 files when the MTEXT has columns, in AutoCAD's order. It also makes the reader keep the defined extents (42/43), so that they can be written back.

</details>

### 0036 — DWG reader loses the R2018 MTEXT column count

- **File:** `third_party/acad-ts-patches/0036-dwg-mtext-column-count.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`
- **Symptom:** The R2018 MTEXT reader read the column count into a local and never stored it. The writer therefore wrote a count of 0, and the next read dropped the column heights that followed. Corpus: 8 differences (`_columnData.heights.length`) in `sample_AC1032.dwg` and `sample_base.dwg`.
- **Fix:** Store the count in `columnData.columnCount`.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0036 DWG reader keeps the R2018 MTEXT column count" (`sample_AC1032.dwg`: MTEXT 3EC has one column, and every column count and height survives a DWG save).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Store the MTEXT column count read from R2018 DWG

`DwgObjectReader` reads the R2018 MTEXT column count but does not assign it to `columnData.columnCount`. The writer then writes 0, and the column heights are lost on the next read. This assigns the count.

</details>

### 0037 — DXF MULTILEADER loses its settings, its text colour and its branches on save

- **File:** `third_party/acad-ts-patches/0037-dxf-multileader.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:**
  - `_writeMultiLeader` wrote a few AcDbMLeader groups on the wrong codes: the line colour as 171 and the attachment direction as 175 and 176. It left out the rest.
  - `_writeAnnotContext` wrote the content base point where the base point goes. It wrote none of the text, background, column or block settings, and no label.
  - Every multileader therefore came back with default styling and an empty label.
  - The reader decoded the context text colour (90, an AcCmColor) as plain RGB, so ByLayer became RGB 0,0,0.
  - The reader read no group of a branch (`LEADER{`), because `LeaderRoot` has no DXF class map.
  - Corpus: 3,889 differences (`MULTILEADER *`) in the twelve acadsharp sample DXFs and ezdxf `uncommon.dxf`. The entity oracle listed the read gaps under M1-32.
- **Fix:**
  - Write AcDbMLeader, its context data, branches and leader lines in AutoCAD's group order, checked against the acadsharp R2000–R2018 samples. 270, the context 272/273, the branch 271 and the trailing 271–273 are written from R2010; 295 from R2013.
  - Write colours as AcCmColor values. The ones the reader keeps as raw integers are written back unchanged.
  - Read the context text colour as an AcCmColor.
  - Read the branch groups 290, 291, 10, 11, 90, 40 and 271.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0037 DXF writer writes MULTILEADER entities with their own group codes".
  - Files: acadsharp AC1015–AC1032 and ezdxf `uncommon.dxf`, with ASCII and binary saves.
  - Every main, context and branch field, plus the leader points, must survive the round trip.
  - The first sample multileader is checked for its label, style, ByLayer text colour and branch connection point.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write and read DXF MULTILEADER entities completely

`DxfSectionWriterBase._writeMultiLeader` and `_writeAnnotContext` write only part of AcDbMLeader, and several groups go on the wrong codes. A read-write cycle therefore resets every multileader's style overrides, text, colours and background, and empties its label. This writes the entity, its `CONTEXT_DATA{`, `LEADER{` and `LEADER_LINE{` blocks in the order AutoCAD writes them, with the R2010 and R2013 groups gated by version and colours written as AcCmColor values. On the read side, the context text colour (90) is now decoded as an AcCmColor rather than RGB. The `LEADER{` groups, which had no class map, are now read: connection point, direction, index, landing distance and attachment direction.

</details>

### 0038 — DXF writer drops the entity data of ENDBLK

- **File:** `third_party/acad-ts-patches/0038-dxf-endblk-entity-data.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfBlocksSectionWriter.ts`
- **Symptom:**
  - `_writeBlockEnd` wrote only the AcDbEntity marker and the layer.
  - The colour, linetype, lineweight, linetype scale and visibility of every ENDBLK came back as their defaults. AutoCAD gives ENDBLK the same entity data as its BLOCK.
  - Corpus: 87 differences (`ENDBLK color._color`) in the acadsharp sample DXFs, ENDBLKs of colour 193.
- **Fix:** write the common entity data with `writeCommonEntityData`, as `_writeBlock` does for BLOCK.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0038 DXF writer writes the common entity data of ENDBLK".
  - Files: acadsharp AC1015–AC1032 ASCII DXFs, with ASCII and binary saves.
  - The layer, linetype, colour, lineweight, linetype scale and visibility of every ENDBLK must survive.
  - ENDBLK 9D3 of the R2000 sample is checked for colour 193.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the common entity data of ENDBLK in DXF

`DxfBlocksSectionWriter._writeBlockEnd` writes only the AcDbEntity subclass marker and the layer, so the colour, linetype, lineweight and the rest of a block end are lost on save. This writes them with `writeCommonEntityData`, as `_writeBlock` already does for the block begin.

</details>

### 0039 — DXF reader leaves the caret codes of TOLERANCE text encoded

- **File:** `third_party/acad-ts-patches/0039-dxf-tolerance-text-carets.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:**
  - `_readTolerance` let the text (1) go through the generic class map, which keeps the raw value. A two-row frame read as `99^Ja`, while the DWG of the same drawing holds `99` and `a` with a real line break.
  - The writer then escaped the caret again, so each save turned `^J` into `^ J` and the frame gained literal text.
  - Corpus: 24 differences (`TOLERANCE text`) in the acadsharp sample DXFs. The entity oracle listed the gap under M1-32.
- **Fix:** read 1 with `valueAsString`, which decodes the caret codes, as the other text entities do.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0039 DXF reader decodes the caret codes of TOLERANCE text".
  - TOLERANCE 823 of the R2000 sample must read as `99\na` from both the DWG and the DXF.
  - Every TOLERANCE text of the acadsharp AC1015–AC1032 DXFs must survive ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Decode caret codes in DXF TOLERANCE text

`_readTolerance` assigns group 1 through the class map, so the `^J` row separators of a feature control frame stay encoded, unlike the DWG reader's result. The writer then escapes the caret, and each save turns `^J` into `^ J`. This reads the text with `valueAsString`, like TEXT and MTEXT.

</details>

### 0040 — DXF writer writes the MESH header groups on the wrong codes

- **File:** `third_party/acad-ts-patches/0040-dxf-mesh-header-codes.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:**
  - `_writeMesh` wrote the subdivision level as 71, which is the version, and 0 for 72 (blend crease) and 91 (subdivision level).
  - A save turned every version 2 mesh into version 0 and lost its blend crease and level.
  - Corpus: 25 differences (`MESH version`) in the acadsharp sample DXFs.
- **Fix:** write 71 version, 72 blend crease and 91 subdivision level, the codes the reader and the class map use and AutoCAD writes (`71 2`, `72 0`, `91 0` in the samples).
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0040 DXF writer writes MESH version, blend crease and subdivision level on their codes".
  - The version, blend crease and level of every MESH of the acadsharp AC1015–AC1032 DXFs must survive ASCII and binary saves.
  - MESH 343 of the R2000 sample is checked for version 2.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write DXF MESH version, blend crease and subdivision level on their own codes

`_writeMesh` writes the subdivision level as group 71 and zero for 72 and 91. Group 71 is the version, 72 the blend crease and 91 the subdivision level, as the reader and AutoCAD use them, so a read-write cycle resets every mesh to version 0. This writes each value on its own code.

</details>

### 0041 — DWG writer drops the cell overrides of R2004 and R2007 tables

- **File:** `third_party/acad-ts-patches/0041-dwg-table-cell-overrides.patch`
- **Touches:** `src/Entities/TableEntity.ts`, `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:**
  - Before R2010, a table cell stores its own overrides behind a flag word: alignment, fill, background and content colour, text style, text height, and the colour, lineweight and visibility of each border.
  - The reader read them into `styleOverride` but did not keep the flag word. `_writeTableCell` always wrote "no overrides", so a save reset every overridden cell to its table style.
  - Corpus: 146 differences (`ACAD_TABLE _content.rows[].cells[].styleOverride.*`) in the acadsharp R2004 and R2007 DWGs.
- **Fix:**
  - Keep the flag word as `TableEntityCell.overrideFlags`.
  - Write the flag word, the virtual edge flag and each flagged field in the order the reader reads them. Colours are written as the table style writes them.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0041 DWG writer writes the cell overrides of R2004 and R2007 tables".
  - Every cell override of acadsharp `sample_AC1018.dwg` and `sample_AC1021.dwg` must survive a DWG save.
  - Cell 4,0 of table 528 is checked: alignment 5, background 165, content colour 7, text height 4, and top and left borders of colour 63, 0.40 mm, hidden.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the cell overrides of pre-R2010 DWG tables

`DwgObjectReader._readTableCellData` reads a pre-R2010 cell's override flags and fields, but the flags are not kept, and `DwgObjectWriter._writeTableCell` always writes the "has overrides" bit as false. A read-write cycle therefore drops every cell's alignment, colours, text height and border overrides. This keeps the flag word on the cell (`overrideFlags`) and writes it back with the virtual edge flag and each flagged field, in the reader's order.

</details>

### 0042 — DWG writer drops the geometry of R2010+ table cells that list no content geometry

- **File:** `third_party/acad-ts-patches/0042-dwg-table-cell-geometry.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:**
  - The writer wrote a cell's geometry (flags, width, height) only when the cell listed content geometry.
  - A cell with a stated geometry and no content geometry lost its flags and size on a save.
  - Corpus: 72 differences (`ACAD_TABLE _content.rows[].cells[].geometry*`) in the acadsharp R2010–R2018 DWGs and `sample_base.dwg`.
- **Fix:** write the geometry block when the cell has any geometry flag, size or reference, not only when it lists content geometry.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0042 DWG writer keeps the geometry of R2010+ table cells that list no content geometry".
  - Every cell geometry of acadsharp `sample_AC1024.dwg`, `sample_AC1027.dwg` and `sample_AC1032.dwg` must survive a DWG save.
  - Cell 0,1 of table 528 is checked: flags 3 and size 0.0684.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep table cell geometry with no content geometry in DWG

The R2010+ table content writer writes the "has geometry" flag only when the cell lists content geometry. The reader reads the geometry flags, width and height whenever the flag is set, even with a geometry count of 0. As a result, cells that have a size but no content geometry lose that size on a save. This writes the block whenever the cell carries any geometry data.

</details>

### 0043 — DWG writer drops the block record of R2004 and R2007 block cells

- **File:** `third_party/acad-ts-patches/0043-dwg-table-block-cell-record.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:**
  - Before R2010, a block cell names its block record as the cell value, and the reader stores it in `cell.value`.
  - `_writeTableCell` took the handle from the cell content, which such cells do not have, and wrote a null handle.
  - Corpus: 4 differences (`ACAD_TABLE _content.rows[].cells[].value`) in the acadsharp R2004 and R2007 DWGs.
- **Fix:** fall back to `cell.value` when a block cell has no content block record.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0043 DWG writer keeps the block record of R2004 and R2007 block cells".
  - Every cell value handle of acadsharp `sample_AC1018.dwg` and `sample_AC1021.dwg` must survive a DWG save.
  - Cell 1,3 of table A35 must point at block record A0B.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep the block record of pre-R2010 DWG block cells

For a pre-R2010 block cell, the reader stores the block record handle in `cell.value`. The writer, however, takes the block record from `cell.content`, which is null for these cells, so a read-write cycle empties every block cell. This falls back to `cell.value`.

</details>

### 0044 — DXF reader keeps the paper image origin apart from the one the writers use

- **File:** `third_party/acad-ts-patches/0044-plot-settings-paper-image-origin.patch`
- **Touches:** `src/Objects/PlotSettings.ts`
- **Symptom:**
  - `PlotSettings` had both `paperImageOrigin` (an XY) and `paperImageOriginX`/`Y` (numbers).
  - The DXF class map assigns 148/149 to the numbers. The DWG reader and both writers use the XY.
  - So a DXF save wrote a paper image origin of 0,0, and a DXF-read layout written to DWG lost its origin too.
  - Corpus: 19 differences (`LAYOUT paperImageOriginX/Y`) in the ezdxf example DXFs.
- **Fix:** make `paperImageOriginX`/`Y` accessors over `paperImageOrigin`. The class map's names keep working and there is one value.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0044 DXF reader and writers keep one paper image origin for a layout".
  - The Model layout of ezdxf `viewports.dxf` must read as origin 114.98, 300.29.
  - The origin of every layout must survive ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Use one paper image origin in PlotSettings

`PlotSettings` declares both `paperImageOrigin` and `paperImageOriginX`/`paperImageOriginY`. The DXF reader fills the pair through the class map, while the DWG reader and both writers use `paperImageOrigin`, so the origin read from a DXF file is written as 0,0. This turns the pair into accessors over `paperImageOrigin`.

</details>

### 0045 — DXF writer writes the print scale where the standard scale goes

- **File:** `third_party/acad-ts-patches/0045-dxf-layout-standard-scale.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:**
  - Group 147 of AcDbPlotSettings is the standard scale factor, the value behind the standard scale type (75). The reader and the DWG code use it that way.
  - The writer wrote the custom print scale (142 / 143) there, so a save changed 0.069 into 0.0688….
  - Corpus: 19 differences (`LAYOUT standardScale`) in the ezdxf example DXFs.
- **Fix:** write `standardScale` as 147.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0045 DXF writer writes the standard scale of a layout as 147".
  - The Model layout of ezdxf `viewports.dxf` must read as 0.069.
  - The standard scale of every layout must survive ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the standard scale factor as DXF group 147

`writePlotSettings` writes `printScale` (numerator / denominator) as group 147. Group 147 is the standard scale factor, which the reader stores in `standardScale` and the DWG writer writes. This writes `standardScale`.

</details>

### 0046 — DXF LTYPE alignment read as digits and written as 0

- **File:** `third_party/acad-ts-patches/0046-dxf-ltype-alignment-char-code.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfTablesSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`
- **Symptom:**
  - LTYPE 72 holds the character code of the alignment: 65 for "A".
  - The reader stored the digits ("65") as the alignment, so a DWG save wrote "6".
  - The writer passed the string to an integer group. The default "A" of the linetypes acad-ts adds to R12 files therefore went out as 0.
  - Corpus: 11 differences (`LTYPE alignment`) in the R12 DXFs.
- **Fix:**
  - Read 72 as a character code.
  - Write the alignment's character code, with 65 when it is empty.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0046 DXF LTYPE alignment (72) is read and written as a character code".
  - Every linetype of ezdxf `ASCII_R12.dxf` and acadsharp `sample_AC1015_ascii.dxf` must read as "A".
  - The alignments must survive ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write DXF LTYPE alignment (72) as a character code

Group 72 of a linetype is the ASCII code of its alignment, which is always 65 ("A"). The reader currently stores the digits "65" in `LineType.alignment`, and the DWG writer then writes "6". The writer passes the string to an integer group, so "A" becomes 0. This converts the alignment on read and on write.

</details>

### 0047 — DXF writer writes ARC_DIMENSION without its dimension data

- **File:** `third_party/acad-ts-patches/0047-dxf-arc-dimension.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:**
  - `_writeEntity` had no `DimensionArc` branch. An arc length dimension went out as an `ARC_DIMENSION` with only its common entity data, and came back with no block, points or angles. `_writeDimensionArc` existed but was never reached.
  - That writer also wrote the leader points (16/17) only when 71 says there is a leader. AutoCAD writes them always, and the reader keeps them.
  - Corpus: 16 differences (`ARC_DIMENSION *`) in ezdxf `uncommon.dxf`.
- **Fix:**
  - Dispatch `DimensionArc` to `_writeDimension`.
  - Write 16 and 17 unconditionally.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0047 DXF writer writes ARC_DIMENSION entities".
  - ARC_DIMENSION 3F6 of ezdxf `uncommon.dxf` is checked for block `*D19`, angles 6.2225/1.4547 and attachment point 5.
  - Its block, style, points, angles and flags must survive ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write ARC_DIMENSION entities to DXF

`DxfSectionWriterBase._writeEntity` dispatches every dimension type except `DimensionArc` to `_writeDimension`. As a result, an `ARC_DIMENSION` is written with only its AcDbEntity data and loses its geometry on save. This adds the branch. It also writes the leader points (16, 17) unconditionally, as AutoCAD does, because the reader keeps them even when 71 is 0.

</details>

### 0048 — DWG writer writes the frozen flag where "frozen in new viewports" goes

- **File:** `third_party/acad-ts-patches/0048-dwg-layer-frozen-new-viewports.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:**
  - The R2000+ layer flag word took bit 4 (frozen in new viewports) from `LayerFlags.Frozen`.
  - A save therefore froze every frozen layer in new viewports and cleared the flag on every other layer.
  - Corpus: 2 differences (`LAYER flags`) in each acadsharp R2000–R2018 DWG and `sample_base.dwg`.
- **Fix:** take bit 4 from `LayerFlags.FrozenNewViewports`, as the reader does.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0048 DWG writer keeps the frozen-in-new-viewports flag of R2000+ layers".
  - Every layer's flags, visibility and plot flag in the acadsharp R2000–R2018 DWGs must survive a save.
  - Layers 279 (65) and 283 (66) of the R2000 sample are checked.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the "frozen in new viewports" layer flag in R2000+ DWG

`_writeLayer` sets bit 4 of the R2000+ flag word from `LayerFlags.Frozen`. That bit means frozen in new viewports, which the reader maps to `LayerFlags.FrozenNewViewports`. This takes the bit from `FrozenNewViewports`.

</details>

### 0049 — DWG writer writes linetype index 0 for every pre-R2018 MLINESTYLE element

- **File:** `third_party/acad-ts-patches/0049-dwg-mlinestyle-linetype-index.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:**
  - Before R2018, an MLINESTYLE element names its linetype by index: 0x7FFF for ByLayer, 0x7FFE for ByBlock, and otherwise the position in the LTYPE table. This is how `CadMLineStyleTemplate` reads it.
  - The writer always wrote 0, so every element came back with the first linetype of the table.
  - Corpus: 2 differences (`MLINESTYLE _elements[]._lineType`) in each acadsharp R2000–R2013 DWG.
- **Fix:** write the index the template reads.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0049 DWG writer writes the linetype index of pre-R2018 MLINESTYLE elements".
  - The element linetypes of every MLINESTYLE in the acadsharp R2000–R2018 DWGs must survive a save.
  - The Standard style of the R2000 sample is checked for ByLayer, ByLayer.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the linetype index of pre-R2018 DWG MLINESTYLE elements

Before R2018, an MLINESTYLE element's linetype is a BS index: 0x7FFF for ByLayer, 0x7FFE for ByBlock, and otherwise the LTYPE table position, which is how `CadMLineStyleTemplate` resolves it. `_writeMLineStyle` writes 0, so every element is read back with the first linetype of the table. This writes the matching index.

</details>

### 0050 — DWG writer rebuilds block insert lists from model space only

- **File:** `third_party/acad-ts-patches/0050-dwg-block-record-insert-list.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:**
  - For each block record, the R2000+ BLOCK_HEADER lists the INSERTs of that block.
  - The writer rebuilt the list from the INSERTs in model space only. The read list was kept only for `*T` blocks.
  - A block inserted from paper space, another block, a dimension block or a table block therefore lost those entries. The list's order was lost too, and so were the erased inserts AutoCAD keeps in it.
  - Corpus: 5 differences (`BLOCK_RECORD insertHandles*`) in each acadsharp R2000–R2018 DWG and `sample_base.dwg`. For example, `my_block` in the R2000 sample lists 10 inserts, from model space, `*T16` and `*U25`.
- **Fix:**
  - Collect INSERTs from every block record.
  - Write the list as read, in its order, then any insert not yet in it.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0050 DWG writer keeps the insert list of every block record".
  - Every block record's insert list in the acadsharp R2000–R2018 DWGs must survive a save.
  - `my_block` of the R2000 sample is checked for 10 entries.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep the insert list of DWG block records

The R2000+ block header lists the INSERTs of its block. `_writeBlockHeader` rebuilds that list from `document.entities`, which holds model space only, and keeps the list as read only for `*T` blocks. Inserts that live in paper space, other blocks, dimension blocks or table blocks therefore drop out on a save, along with the read order. This collects inserts from every block record and writes the list as read, followed by any insert that is new.

</details>

### 0051 — DWG writer writes null R2000+ header arrow blocks

- **File:** `third_party/acad-ts-patches/0051-dwg-header-arrow-blocks.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgHeaderWriter.ts`
- **Symptom:**
  - From R2000, the header names `$DIMBLK`, `$DIMBLK1` and `$DIMBLK2` by block record handle.
  - The writer wrote null handles for all of them, so a save reset the drawing's default arrowheads to closed filled.
  - Corpus: 1 difference (`HEADER $DIMBLK`) in each acadsharp R2000–R2018 DWG, `sample_base.dwg` and `AecObjects.dwg`.
- **Fix:**
  - Write the block record that the header names. A name is looked up both as DXF writes it (`BoxBlank`) and as the block record is named (`_BoxBlank`).
  - `$DIMLDRBLK` has no header field in acad-ts, so it is still written as null. The DWG reader also lets it overwrite `dimensionBlockName` when set; no corpus file sets it.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0051 DWG writer writes the R2000+ header arrow blocks".
  - `$DIMBLK`/`$DIMBLK1`/`$DIMBLK2` of the acadsharp R2000–R2018 DWGs must survive a save.
  - The R2000 sample is checked for `_BoxBlank`.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the header arrow blocks in R2000+ DWG

The R2000+ header stores `DIMBLK`, `DIMBLK1` and `DIMBLK2` as block record handles. The reader resolves these handles into `dimensionBlockName` and its two siblings, but `DwgHeaderWriter` writes null handles, so the arrowheads are lost on save. This writes the named block records. A name is accepted with or without the leading underscore that arrow block records carry.

</details>

### 0052 — DWG writer detaches every LEADER from its annotation

- **File:** `third_party/acad-ts-patches/0052-dwg-leader-annotation.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:**
  - `_writeLeader` wrote a null annotation handle.
  - On a save, every leader came off the MTEXT, tolerance or block reference it was attached to.
  - Corpus: 1 difference (`LEADER associatedAnnotation`) in each acadsharp R14–R2018 DWG and `sample_base.dwg`.
- **Fix:** write `associatedAnnotation`.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0052 DWG writer writes the annotation a LEADER is attached to".
  - The annotation of every LEADER in the acadsharp R14–R2018 DWGs must survive a save.
  - LEADER 512 of the R2000 sample is checked for MTEXT 513.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the associated annotation of DWG LEADER entities

`_writeLeader` writes a null handle where the annotation goes. The reader resolves that handle into `associatedAnnotation`, so after a read-write cycle no leader is attached to anything. This writes `associatedAnnotation`.

</details>

### 0053 — DWG writer writes colour 0 for pre-R2004 DBCOLOR objects

- **File:** `third_party/acad-ts-patches/0053-dwg-dbcolor-index.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:**
  - Before R2004, a DBCOLOR holds only a colour index, which the reader reads.
  - The writer always wrote 0, so every colour came back as ByBlock.
  - Corpus: 1 difference (`DBCOLOR color._color`) in acadsharp `sample_AC1014.dwg` and `sample_AC1015.dwg`.
- **Fix:** write the index (the nearest index for a true colour) before R2004. Keep 0 from R2004, where the true colour follows.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0053 DWG writer writes the colour index of pre-R2004 DBCOLOR objects".
  - Every DBCOLOR of the acadsharp R14 and R2000 DWGs must survive a save.
  - DBCOLOR 996 of the R2000 sample is checked for index 42.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the colour index of pre-R2004 DWG DBCOLOR objects

`_writeBookColor` always writes 0 as the colour index. Before R2004 that index is the whole colour, so the colour of every DBCOLOR is lost on save. This writes the index (or the nearest index for a true colour) before R2004.

</details>

### 0054 — DXF writer writes unset R2007+ header flags as 0

- **File:** `third_party/acad-ts-patches/0054-dxf-header-unset-char-flags.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfHeaderSectionWriter.ts`
- **Symptom:**
  - `$LOFTNORMALS`, `$LIGHTGLYPHDISPLAY`, `$DWFFRAME` and `$DGNFRAME` are single-character flags. A drawing without them (every file before R2007, and minimal files) reads them as `''`.
  - With `writeAllHeaderVariables` the writer put `''` out under group 280, which reads back as `"0"`.
  - Corpus: 4 differences in each of 19 files (76).
- **Fix:** skip a header variable whose value is the empty string when none of its group codes holds a string, so a flag the drawing never had stays out of the file.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0054 DXF writer leaves out R2007+ header flags the drawing never set".
  - The R2000 and minimal R2007 files must keep `''`. The R2018 file, which sets the flags, must keep its values. Both ASCII and binary.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Do not write unset character header variables to DXF

With `writeAllHeaderVariables`, char-typed header variables that the drawing never set (`''`) were written under their numeric group code and read back as `"0"`. This skips a variable whose value is empty when none of its codes holds a string.

</details>

### 0055 — DXF reader keeps single-character header variables as digits

- **File:** `third_party/acad-ts-patches/0055-dxf-header-char-variables.patch`
- **Touches:** `src/DxfPropertyBase.ts`, `src/Metadata/MetadataTypes.ts`, `src/Metadata/LookupTables/Core.ts`
- **Symptom:**
  - `$DIMDSEP` (70) holds the character code of the decimal separator, and the R2007+ flags above (280) hold a character whose code is the setting. The DWG reader turns these into characters (`.`, `\u0001`).
  - The DXF reader stored the digits (`"46"`, `"1"`), so the same drawing read differently from DXF and DWG. A DXF-to-DWG save then wrote the code of the first digit (`"4"`).
  - Corpus: 1 difference (`HEADER _dimensionStyleOverrides.decimalSeparator`, read `"."` and written back as `"0"`) in each of 9 R14-era files.
- **Fix:** add a `char` value kind and mark these five variables with it. Reading turns a code into its character, and writing turns the character back into its code (an empty value writes nothing).
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0055 DXF reader and writer keep single-character header variables as characters".
  - The R2004 and R2018 acadsharp samples must read the same five values from DXF as from DWG, and keep them through ASCII and binary saves.
  - The R2018 DXF is checked for `.`, `\u0001`, `\u0001`, `\u0002`, `\u0000`.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write char-typed DXF header variables as character codes

`$DIMDSEP`, `$LOFTNORMALS`, `$LIGHTGLYPHDISPLAY`, `$DWFFRAME` and `$DGNFRAME` are `char` in the DWG header and character codes in DXF. The DXF path stored the code's digits as the string, so DXF and DWG reads of one drawing disagreed and DXF-to-DWG saves wrote the wrong byte. This adds a `char` value kind that converts in both directions.

</details>

### 0056 — DXF writer drops the default pixel size of IMAGEDEF

- **File:** `third_party/acad-ts-patches/0056-dxf-imagedef-default-size.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:**
  - IMAGEDEF 11/21 is the size of one pixel in drawing units. The reader reads it, and the writer left it out, so saved image definitions came back with the 1 × 1 default.
  - Corpus: 2 differences (`IMAGEDEF defaultSize.x/y`) in each of 17 files (34).
- **Fix:** write 11/21 after the image size, in AutoCAD's group order.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0056 DXF writer writes the default pixel size of IMAGEDEF objects".
  - Every IMAGEDEF of the acadsharp R2000 sample and ezdxf `images.dxf` must survive ASCII and binary saves. IMAGEDEF 8C4 is checked for 0.2645833333333333.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write IMAGEDEF default pixel size (11/21) to DXF

`writeImageDefinition` omitted group 11/21 (default size of one pixel), so the value reset to 1 × 1 on every DXF save. This writes it.

</details>

### 0057 — DXF writer drops the visual style of VIEW table entries

- **File:** `third_party/acad-ts-patches/0057-dxf-view-visual-style.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`
- **Symptom:**
  - A named view keeps its visual style handle in 348. The reader reads it, and the writer left it out.
  - Corpus: 1 difference (`VIEW visualStyle`) in each of 8 R2007+ acadsharp sample DXFs.
- **Fix:** write 348 after the render mode (281), when the view has a visual style.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0057 DXF writer writes the visual style of VIEW table entries".
  - Every view of the acadsharp R2007 and R2018 sample DXFs keeps its visual style through ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the VIEW visual style handle (348) to DXF

`_writeView` did not write group 348, so named views lost their visual style on save. This writes it when set.

</details>

### 0058 — DXF writer always writes false for the MLEADERSTYLE 298 flag

- **File:** `third_party/acad-ts-patches/0058-dxf-mleaderstyle-flag-298.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:**
  - The reader reads 298 into `unknownFlag298` (the DWG writer writes it), and the DXF writer wrote a constant `false`.
  - Corpus: 1 difference in each of 3 ezdxf files.
- **Fix:** write `unknownFlag298`.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0058 DXF writer writes the 298 flag of MLEADERSTYLE objects as read".
  - Every MLEADERSTYLE of ezdxf `text.dxf` keeps the flag through ASCII and binary saves. Style 2D8 is checked for `true`.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the MLEADERSTYLE 298 flag as read

The DXF writer wrote a constant `false` for group 298 of MLEADERSTYLE, discarding the value read. This writes `unknownFlag298`, as the DWG writer already does.

</details>

### 0059 — DWG writer drops XRECORD entries that point at nothing

- **File:** `third_party/acad-ts-patches/0059-dwg-xrecord-null-references.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:**
  - An XRECORD may hold an object reference (330–369) whose handle is 0, a null pointer. The reader keeps the entry.
  - The writer skipped such entries, so the record came back shorter.
  - Corpus: 4 differences (`XRECORD _entries.length`) in acadsharp `sample_AC1014.dwg`.
- **Fix:** write the entry with handle 0, as AutoCAD does.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0059 DWG writer keeps the null object references of XRECORD entries".
  - Every XRECORD of the R14 sample must keep its entry codes through a save. XRECORD 118C is checked for its single 340 entry.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep null object references in DWG XRECORD entries

`_writeXRecord` skipped object-reference entries whose handle is 0, so an XRECORD that holds a null pointer lost that entry on save and its entry count changed. This writes the entry with handle 0.

</details>

### 0060 — DWG writer never writes the default entry of a dictionary with default

- **File:** `third_party/acad-ts-patches/0060-dwg-dictionary-default-entry.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:**
  - `ACDBDICTIONARYWDFLT` writes the handle of its default entry. In R14 files that entry (an `ACDBPLACEHOLDER`) is owned by nothing else, so no other path writes the object.
  - The handle then pointed at nothing, and the default read back as null.
  - Corpus: 1 difference (`ACDBDICTIONARYWDFLT defaultEntry`) in acadsharp `sample_AC1014.dwg`.
- **Fix:** queue the default entry for writing. The queue skips objects that are already written.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0060 DWG writer writes the default entry of a dictionary with default".
  - Every dictionary with default of the R14 and R2000–R2018 samples keeps its default entry through a save. Dictionary E of the R14 sample is checked for default F.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the default entry object of a DWG dictionary with default

`_writeCadDictionaryWithDefault` writes the default entry's handle but never queues the object. When nothing else owns it (the R14 `ACDBPLACEHOLDER`), the saved file points at a missing object. This queues it like other owned objects.

</details>

### 0061 — DXF writer refuses DIMASSOC objects

- **File:** `third_party/acad-ts-patches/0061-dxf-write-dimassoc.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:**
  - `_isObjectSupported` lists `DimensionAssociation` as "Object not implemented", although `_writeDimensionAssociation` writes every field the reader reads, including both osnap point references.
  - Every DIMASSOC was dropped on a DXF save. Its dictionary entry and the reactors that dimensions and their geometry hold went with it.
  - Corpus: 47 save-stage handles in 15 files. Round-trip differences: `DIMASSOC <missing>`, `DIMENSION`/`LINE`/`CIRCLE` `_reactors` and the `ACAD_DIMASSOC` dictionary entries (0061 and 0062 together remove 401).
- **Fix:** take `DimensionAssociation` off the list.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0061 DXF writer writes DIMASSOC objects".
  - Every DIMASSOC of the acadsharp R2000 sample and ezdxf `uncommon.dxf` must keep its handle, dimension and flags through ASCII and binary saves. The round-trip suite then shows no DIMASSOC difference on any corpus file.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write DIMASSOC objects to DXF

`DxfObjectsSectionWriter._isObjectSupported` rejects `DimensionAssociation` with "Object not implemented", although `_writeDimensionAssociation` is complete. Associative dimensions therefore lose their DIMASSOC object (and the reactors pointing at it) on every DXF save. This removes it from the unsupported list.

</details>

### 0062 — DXF writer drops the IMAGEDEF_REACTOR of every image

- **File:** `third_party/acad-ts-patches/0062-dxf-image-definition-reactor.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:**
  - An IMAGE hard-owns its IMAGEDEF_REACTOR (360). The writer wrote the handle but never queued the object for the OBJECTS section, and no dictionary owns it.
  - The reactor was dropped, so the image (`definitionReactor`) and its definition (`_reactors`) lost the link.
  - Corpus: 77 save-stage handles in 14 files (`IMAGEDEF_REACTOR <missing>`, `IMAGE definitionReactor`, `IMAGEDEF _reactors`).
- **Fix:** queue `image.definitionReactor` when the image is written.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0062 DXF writer writes the IMAGEDEF_REACTOR of every image".
  - Every IMAGE of the acadsharp R2000 sample and ezdxf `images.dxf` keeps its reactor through ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the IMAGEDEF_REACTOR of raster images to DXF

`_writeCadImage` writes the 360 handle of the image's IMAGEDEF_REACTOR but never adds the reactor to the objects to write, and nothing else owns it, so it is missing from the saved file. This queues it with the image.

</details>

### 0063 — DXF writer skips every proxy object

- **File:** `third_party/acad-ts-patches/0063-dxf-proxy-object-raw.patch`
- **Touches:** `src/Objects/ProxyObject.ts`, `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:**
  - The DXF writer has no field writer for `ProxyObject` and skips it with "Object not implemented : ProxyObject".
  - Every ACAD_PROXY_OBJECT was dropped on a DXF save, together with the dictionary entries that own it.
  - Corpus: 98 save-stage handles, 49 in each of the binary R13 and R14 DXFs (154 and 156 round-trip differences).
- **Fix:** under DEC-040, proxy objects join MATERIAL and VISUALSTYLE.
  - With `keepRawDxfPassthroughObjects`, the reader keeps their group codes as read, and the writer writes those codes back, rewriting only the handle and owner.
  - `ProxyObject` gains the `IRawCadObject` fields for this.
  - Proxy objects with no recorded codes are still skipped with the notification, as before.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0063 DXF proxy objects are kept as read and written back raw (DEC-040)".
  - Every proxy object of `bin_dxf_r13.dxf` and `bin_dxf_r14.dxf` keeps its handle, owner and proxy data through a binary DXF save, and its group codes come back unchanged.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep ACAD_PROXY_OBJECTs through DXF read and write

The DXF writer has no writer for `ProxyObject` and skips it, so every proxy object (and the dictionary entries owning it) is missing from a saved DXF. Under the existing `keepRawDxfPassthroughObjects` option, which already keeps MATERIAL and VISUALSTYLE as read, this records the group codes of proxy objects on read and writes them back unchanged, rewriting only the handle and owner. Without the option, behaviour is unchanged.

</details>

### 0064 — R12 DXF writer leaves out the $MODEL_SPACE and $PAPER_SPACE blocks

- **File:** `third_party/acad-ts-patches/0064-dxf-r12-space-blocks.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfBlocksSectionWriter.ts`
- **Symptom:**
  - For R12 the BLOCKS section skipped the model and paper space blocks altogether.
  - AutoCAD's R12 export writes both, empty, as `$MODEL_SPACE` and `$PAPER_SPACE`. The acadsharp `sample_AC1009` files, which come from AutoCAD, have them, and so do ezdxf's R12 files.
  - Their BLOCK and ENDBLK handles were lost: a reopened file made new ones.
  - Corpus: 12 save-stage handles in 5 R12 files. The reread space blocks also changed owner and handle in the round trip.
- **Fix:** write both blocks for R12 under their R12 names. Their entities still go to the ENTITIES section, as before.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0064 R12 DXF saves write the $MODEL_SPACE and $PAPER_SPACE blocks".
  - The acadsharp R12 sample and ezdxf `ASCII_R12.dxf` and `bin_dxf_r12.dxf` keep both ENDBLK handles through ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the $MODEL_SPACE and $PAPER_SPACE blocks to R12 DXF

AutoCAD writes the model and paper space blocks to R12 DXF files as empty `$MODEL_SPACE` and `$PAPER_SPACE` blocks, and the DXF reader maps them back. The R12 writer skipped both, so their BLOCK/ENDBLK handles were lost on every R12 save. This writes them under their R12 names; their entities stay in the ENTITIES section.

</details>

### 0065 — R12 DXF writer leaves out the DIMSTYLE handle

- **File:** `third_party/acad-ts-patches/0065-dxf-r12-dimstyle-handle.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:**
  - For R12 `writeCommonObjectData` wrote group 5 for every handle, except a DIMSTYLE, whose handle it left out.
  - A DIMSTYLE keeps its handle in 105, because 5 is DIMBLK, and the reader reads 105 in R12 as well. `write()` drops every code from 80 up for R12, so 105 could not simply be added there.
  - The style came back under a new handle (ezdxf `r12_blocks_with_no_names.dxf`, 1 save-stage handle).
- **Fix:** write the DIMSTYLE handle on 105 with `writeRaw`.
  - This follows ezdxf's R12 files. AutoCAD's own R12 export writes no handles on table entries at all, so its documented behaviour does not settle this.
  - Every other R12 table entry already gets a handle on 5 from this writer.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0065 R12 DXF saves keep the DIMSTYLE handle".
  - The `Standard` style of `r12_blocks_with_no_names.dxf` keeps handle 2B through ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep DIMSTYLE handles in R12 DXF

R12 DIMSTYLE entries carry their handle in group 105, which the reader reads, but the R12 writer writes no handle for them, so a reopened file gives every dimension style a new handle. This writes 105 for R12 dimension styles (raw, since the R12 code filter drops codes from 80 up).

</details>

### 0066 — DXF ACAD_TABLE reader loses the override flags and misreads the table-wide overrides

- **File:** `third_party/acad-ts-patches/0066-dxf-table-read-overrides.patch`
- **Touches:** `src/Entities/TableEntity.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/Templates/CadTableEntityTemplate.ts`
- **Symptom:**
  - The table-wide overrides (93–96 and the codes after them, up to the first row height) were read as block reference and cell fields: 41, the vertical cell margin there, became the table's X scale.
  - A cell's override flags (177 before R2007, 91 from R2007) were never read, so every cell override after them was meaningless on a save.
  - 144 (block scale) was read as the text height, 170 (alignment) was not read, and a text whose 2 chunks come before 1 lost them.
  - Corpus: the 12 acadsharp `sample_AC10xx` DXFs.
- **Fix:**
  - The table-wide overrides are kept as read in `tableOverrideDxfCodes` (DEC-043), because acad-ts models none of them.
  - Override flags, block scale and alignment are read into their fields, and chunked cell text is joined in either order.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0066 DXF ACAD_TABLE reader keeps cell override flags and the table-wide overrides".
  - Table 0x528 of the R2000 and R2018 samples keeps its override codes and X scale 1. Cell (4, 0) keeps its flags, alignment 5 and background colour 165.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read ACAD_TABLE override flags and table-wide overrides from DXF

The DXF table reader reads the table-wide override groups (93–96 and the values after them) into block-reference and cell fields, so group 41 (a cell margin) becomes the table's X scale. It also ignores cell override flags (177, and 91 from R2007), reads 144 as the text height instead of the block scale, and drops 170. This keeps the table-wide overrides as read on `TableEntity.tableOverrideDxfCodes`, and reads the cell override flags, block scale, alignment and chunked text into their fields.

</details>

### 0067 — DXF table values lose their format, and empty values break the reader

- **File:** `third_party/acad-ts-patches/0067-dxf-cad-value-format.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:**
  - `writeCadValue` wrote an empty or unknown-typed value as 91=0, which `setValue` rejects on read. The object holding the value was lost: FIELD 0x5F8 in ezdxf `uncommon.dxf`.
  - From R2007 the writer left out the units (94), format (300) and formatted value (302).
  - The reader lost string chunks (2) that come before the last chunk (1).
- **Fix:** an empty or unknown value writes no payload; R2007+ writes 94, 300 and 302; chunked strings are joined in either order.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0067 DXF values keep their unit, format and formatted value; empty ones stay empty".
  - Every cell value of the R2018 sample keeps its flags, type, value, units, format and formatted value through ASCII and binary saves, and FIELD 0x5F8 of `uncommon.dxf` survives a save.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep CadValue format data in DXF and stop writing an unreadable empty value

`writeCadValue` writes an empty value as type 91 with value 0, which the reader cannot set, so the FIELD or table holding it fails to load from the saved file. It also omits groups 94, 300 and 302 (units, format, formatted value) from R2007 on, and the reader drops string chunks that come before group 1. This writes no payload for an empty value, writes the three format groups, and joins chunks in either order.

</details>

### 0068 — DXF writer has no ACAD_TABLE writer

- **File:** `third_party/acad-ts-patches/0068-dxf-write-acad-table.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:**
  - `TableEntity` extends `Insert`, so the DXF writer wrote every table as a bare INSERT under the ACAD_TABLE name, and the reader could not read it back as a table.
  - Every table was lost on a DXF save, with its extension dictionary, round-trip XRECORD and TABLECONTENT, and the TABLESTYLE reactors pointing at it.
  - Corpus: 24 ACAD_TABLE handles in the 12 acadsharp `sample_AC10xx` DXFs.
- **Fix:** write ACAD_TABLE as AutoCAD does (DXF reference, ACAD_TABLE).
  - The block reference, then the table header (version, style, block, direction, flags, size).
  - The table-wide overrides as read (0066), the row heights and column widths.
  - Every cell: type, flags, merges, overrides behind their flag word, borders, and its text (before R2007) or CELL_VALUE (R2007+).
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0068 DXF writer writes ACAD_TABLE entities".
  - Every table of the six ASCII acadsharp samples (R2000 to R2018) keeps its block, style, insertion point, overrides, rows, columns and cells through ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write ACAD_TABLE entities to DXF

The DXF writer has no branch for `TableEntity`, so a table is written as an INSERT and is lost when the file is read again. This adds a table writer that follows the DXF reference: block reference, table header, table-wide overrides as read, row heights, column widths and each cell (overrides behind the cell's flag word, borders, text before R2007 and a CELL_VALUE block from R2007).

</details>

### 0069 — DXF XRECORD strings are escaped twice and unresolved handles dropped

- **File:** `third_party/acad-ts-patches/0069-dxf-xrecord-strings-handles.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:**
  - XRECORD string entries kept their caret escapes on read, and the writer escaped them again, so a `^J` line break came back as the text `^ J`.
  - A handle entry that resolved to no object on read stays a number, and the writer skipped it. The table round-trip XRECORDs point at objects acad-ts never reads.
  - Corpus: XRECORDs 0x14FD and 0x148C in the acadsharp R2000 sample, among others.
- **Fix:** decode strings on read, as the writer escapes them; write an unresolved handle as read.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0069 DXF XRECORDs keep caret-escaped strings and unresolved handles".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep XRECORD strings and unresolved handles through a DXF save

XRECORD string entries are stored with their caret escapes and escaped again on write, so line breaks change on every save. Handle entries whose target was not found on read are stored as numbers and then skipped by the writer. This decodes strings on read and writes unresolved handles back as read.

</details>

### 0070 — DXF writer skips TABLECONTENT

- **File:** `third_party/acad-ts-patches/0070-dxf-table-content-raw.patch`
- **Touches:** `src/Objects/TableContent.ts`, `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:**
  - The DXF writer has no field writer for `TableContent` and skips it. Its DXF read is lossy as well.
  - The TABLECONTENT under each table's `ACAD_ROUNDTRIP_2008_TABLE_ENTITY` XRECORD was lost on every DXF save (20 handles in the acadsharp samples).
- **Fix:** under DEC-040, TABLECONTENT joins MATERIAL, VISUALSTYLE and ACAD_PROXY_OBJECT: kept as read and written back raw with `keepRawDxfPassthroughObjects`.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0070 DXF TABLECONTENT objects are kept as read and written back raw (DEC-040)".
  - TABLECONTENT 0x747 and 0x12D7 of the R2018 sample keep their group codes through ASCII and binary saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep TABLECONTENT objects through DXF read and write

The DXF writer skips `TableContent`, so the table content under a table's round-trip XRECORD is missing from a saved DXF. Under `keepRawDxfPassthroughObjects` this records its group codes on read and writes them back unchanged, rewriting only the handle and owner, as for MATERIAL and VISUALSTYLE.

</details>
