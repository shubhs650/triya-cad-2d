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

Upstream test suite at the pinned commit, run in the upstream checkout: 717 passed, 16 skipped (61 files). With patch 0001 applied: same. Patches 0002–0013 (M0-06), 0014–0020 (M1-30) and 0021–0027 (M1-28) were not run against the upstream suite: neither thread could install upstream's dev dependencies. They are covered by our own tests and the corpus round trip; run the upstream suite before submitting them.

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
