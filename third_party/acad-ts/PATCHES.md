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

Upstream test suite at the pinned commit, run in the upstream checkout: 717 passed, 16 skipped (61 files). With patch 0001 applied: same. Patches 0002–0013 (M0-06), 0014–0020 (M1-30), 0021–0030 (M1-28), 0031–0060 (M1-29) and 0061–0072 (M1-31), 0073 (M1-48), 0074 (M1-52), 0075 (M1-53), 0076 (M1-49) 0077–0081 (M1-56), 0082–0091 (M1-58), 0092–0097 (M1-33), 0098–0099 (M1-33 part 2) and 0100 (M1-33 part 3), 0105 (M1-45), 0106 (M1-68), 0107 (M1-34), 0108 (M1-32), 0109 (M1-43), 0110 (M1-36), 0111 (M1-32 part 2) 0112–0114 (M1-32 part 3), 0115–0119 (M1-32 part 4) 0120 (M1-76), 0121–0125 (M1-79), 0126 (M1-77), 0127 (M1-80), 0128 (M1-82), 0129 (M1-83), 0130 (M1-84), 0131 (M1-85), 0132 (M1-87), 0133 (M1-88), 0134 (M1-89), 0135 (M1-90), 0136 (M1-91), 0137–0141 (M1-92), 0142 (M1-75 part 12) 0143–0145 (M1-93), 0146 (M1-94), 0147 (M1-95) 0148–0150 (M1-75 part 19) and 0157–0159 (M1-75 part 22) were not run against the upstream suite: neither thread could install upstream's dev dependencies. They are covered by our own tests and the corpus round trip; run the upstream suite before submitting them.

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

### 0071 — R2007+ DXF read and written in the code page instead of UTF-8

- **File:** `third_party/acad-ts-patches/0071-dxf-r2007-utf8.patch`
- **Touches:** `src/IO/DXF/DxfReader.ts`, `src/IO/DXF/DxfWriter.ts`
- **Symptom:**
  - AutoCAD writes DXF as UTF-8 from R2007. `$DWGCODEPAGE` still names the drawing's code page, and acad-ts read and wrote the file in that code page.
  - Every non-ASCII character of an R2007+ DXF came in garbled: "OBLIQUE 15°" read as "OBLIQUE 15Â°".
  - The round trip could not see it, because the writer made the same mistake in reverse and the bytes came back unchanged.
  - Corpus: 9 R2007+ ASCII DXFs have non-ASCII text, all of it valid UTF-8 (the acadsharp R2007–R2018 samples, and ezdxf `mtext_complex_inline_codes.dxf`, `text_in_viewports.dxf`, `text_oblique_rotate.dxf`, `uncommon.dxf` and `dxf_unicode.dxf`).
- **Fix:** from AC1021 the reader and writer use UTF-8 whatever `$DWGCODEPAGE` says. The header value itself is kept and written as read.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0071 R2007+ DXF text is read and written as UTF-8".
  - `text_oblique_rotate.dxf` reads "OBLIQUE 15°", an ASCII save is valid UTF-8 with that text, and both saves read it back.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write R2007+ DXF as UTF-8

From R2007, DXF files are UTF-8; `$DWGCODEPAGE` still holds the drawing's code page (usually ANSI_1252). The reader switches its decoder to `$DWGCODEPAGE`, so every non-ASCII character in an R2007+ DXF is decoded wrongly ("°" becomes "Â°"), and the writer encodes in the same code page. This uses UTF-8 for both from AC1021, keeping `$DWGCODEPAGE` as read.

</details>

### 0072 — DXF \U+ escapes are not decoded, and characters outside the code page become "?"

- **File:** `third_party/acad-ts-patches/0072-dxf-unicode-escapes.patch`
- **Touches:** `src/IO/TextEncoding.ts`, `src/IO/DXF/DxfStreamReader/DxfStreamReaderBase.ts`, `src/IO/DXF/DxfWriter.ts`, `src/IO/DXF/DxfStreamWriter/DxfBinaryWriter.ts`
- **Symptom:**
  - Before R2007, DXF is in the drawing's code page. AutoCAD writes a character outside it as `\U+XXXX`, and acad-ts kept the escape as text.
  - Escaped names were saved with their backslash, which is invalid in a DXF name, so the writer refused them. Layer 2F `Tschüss mit \U+00FC` of ezdxf `dxf_unicode.dxf` was the last save-stage handle in the corpus. The Greek layer of `ASCII_R12.dxf` was refused the same way, and its entities moved to a new layer.
  - The writer turned every character outside the code page into "?".
- **Fix:**
  - Every DXF string value is decoded on read. ASCII is never escaped, so `\U+0000`–`\U+007F` stays as written (`\U+005C` would otherwise start an MTEXT code), and `\\` stays an escaped backslash.
  - DXF writers escape characters the code page cannot hold, and write UTF-8 from R2007 (0071).
  - DWG strings are unchanged.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0072 DXF \U+ escapes are decoded on read and written back where the code page lacks the character".
  - Layer 2F of `dxf_unicode.dxf` reads as "Tschüss mit ü" and survives ASCII and binary saves.
  - The `ASCII_R12.dxf` Greek layer keeps its entities through both saves, and the R12 ANSI_1252 output writes `\U+039B\U+0391`.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Decode and write \U+XXXX escapes in DXF strings

DXF files before R2007 store text in the drawing's code page and escape other characters as `\U+XXXX`. The reader keeps these escapes as literal text, so escaped symbol names fail DXF name validation on write and are dropped, and the writer replaces characters outside the code page with "?". This decodes non-ASCII `\U+XXXX` escapes in DXF string values (leaving ASCII escapes and `\\` alone) and escapes characters the target code page cannot encode.

</details>

### 0073 — DWG AEC objects read their handle and string streams as raw data

- **File:** `third_party/acad-ts-patches/0073-dwg-aec-raw-data-end.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`
- **Symptom:**
  - `AEC_CLEANUP_GROUP_DEF`, `AEC_WALL_STYLE` and `BINRECORD` kept everything to the end of the object as raw data, and `AEC_WALL` kept everything to the handle reader's position. Both include the handle stream (and the R2007+ string stream), which the writer then writes again after the raw bytes.
  - Each save grew the raw data by 6–20 bytes: 4 differences in acadsharp `AecObjects.dwg`.
- **Fix:** the raw data ends where the object's data stream ends: at the R2007+ string stream when there is one, at its flag bit when there is not, and at the handle stream before R2007. The last byte is padded with the following bits, so no data bit is dropped.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0073 DWG AEC objects keep their raw data, and only it, through a save".
  - The four objects of `AecObjects.dwg` keep their raw bytes unchanged through two DWG saves.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Stop AEC raw data at the end of the DWG data stream

The AEC readers (`AEC_CLEANUP_GROUP_DEF`, `AEC_WALL_STYLE`, `BINRECORD`, `AEC_WALL`) keep the bytes after their known fields as raw data, but read to the end of the object (or to the handle reader's position), so the raw data includes the string and handle streams. The writer writes the raw data and then the handles again, so the data grows on every save. This ends the raw data at the end of the data stream (the string stream start in R2007+, the handle stream before).

</details>

### 0074 — a DXF LEADER without group 71 reads as having no arrowhead

- **File:** `third_party/acad-ts-patches/0074-dxf-leader-arrowhead-default.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** DXF 71 (arrowhead flag) is optional, and AutoCAD-written and ezdxf-written files omit it when the arrowhead is on. acad-ts takes the `Leader` class default (`arrowHeadEnabled = false`), so every such LEADER lost its arrowhead on read. Corpus: the 12 DXF LEADERs of the acadsharp samples omit 71; their DWG twins have the arrowhead on.
- **Fix:** the DXF reader starts a LEADER with the arrowhead on, so 71 = 0 still turns it off. The class default is unchanged, so leaders made in code are not affected.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0074 a DXF LEADER without group 71 has its arrowhead on". The mapping oracle (`entities.corpus.test.ts`) now expects a missing 71 to mean on, and `leaders.corpus.test.ts` checks every corpus LEADER draws its arrowhead.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Default the DXF LEADER arrowhead flag (71) to on

Group 71 of LEADER is optional, and AutoCAD omits it when the arrowhead is enabled (ezdxf's `has_arrowhead` defaults to 1 for the same reason). The DXF reader left `arrowHeadEnabled` at the class default `false`, so leaders from such files lost their arrowhead, while the same drawing saved as DWG keeps it. This change sets the flag to `true` before the DXF entity codes are read; an explicit `71 0` still disables it, and `new Leader()` is unchanged.

</details>

### 0075 — a DXF DIMSTYLE without a group reads acad-ts's ISO default for it

- **File:** `third_party/acad-ts-patches/0075-dxf-dimstyle-autocad-defaults.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfTablesSectionReader.ts`
- **Symptom:** a DXF DIMSTYLE record leaves out every DIMVAR at AutoCAD's default, the initial value of a new style. acad-ts filled the gaps with its `DimensionStyle` class defaults, several of them ISO values: DIMGAP 0.625 where AutoCAD means 0.09, DIMEXO 0.625 for 0.0625, DIMEXE 1.25 for 0.18, DIMDLI 3.75 for 0.38, and DIMDEC 2 for 4, among 16. Corpus: every style of the acadsharp DXF samples (`Standard`, `Annotative`, `ISO-25`, …) disagreed with its DWG twin on up to 16 DIMVARs, so DXF feature control frames drew with gaps seven times too wide.
- **Fix:** the DXF reader starts each DIMSTYLE at AutoCAD's initial values for the 16 DIMVARs whose class defaults differ: DIMALTD, DIMALTTD, DIMDEC, DIMDLI, DIMEXE, DIMEXO, DIMFIT, DIMGAP, DIMSAH, DIMTAD, DIMTDEC, DIMTIH, DIMTOH, DIMTOLJ, DIMTZIN and DIMZIN. Groups in the file still win. The class defaults are unchanged, so styles made in code are not affected.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0075 a DXF DIMSTYLE without a group reads it as the AutoCAD default" drops DIMGAP and DIMEXO from a written style and reads them back as 0.09 and 0.0625. `tables.corpus.test.ts` → "reads every DXF DIMSTYLE with the DIMVARs of its DWG twin" checks all six acadsharp pairs.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read omitted DXF DIMSTYLE groups as AutoCAD's defaults

AutoCAD writes a DIMSTYLE record with only the DIMVARs that differ from their defaults. The DXF reader left the missing ones at the `DimensionStyle` class defaults, several of which are ISO values (DIMGAP 0.625, DIMEXO 0.625, DIMEXE 1.25, DIMDLI 3.75, DIMDEC 2, …), so a style read from DXF differs from the same style read from the DWG of the same drawing. This change sets the 16 affected properties to AutoCAD's initial values before the DIMSTYLE's groups are read. Groups present in the file still apply, and `new DimensionStyle()` is unchanged.

</details>

### 0076 — R12 DXF saves move the handles acad-ts made up

- **File:** `third_party/acad-ts-patches/0076-r12-made-up-handles.patch`
- **Touches:** `src/CadDocument.ts`, `src/IO/CadDocumentBuilder.ts`, `src/IO/DXF/DxfDocumentBuilder.ts`, `src/IO/DXF/DxfReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`, `DxfHeaderSectionWriter.ts`, `DxfTablesSectionWriter.ts`, `DxfBlocksSectionWriter.ts`
- **Symptom:**
  - R12 has no BLOCK_RECORD table and many R12 files state no handles, so the reader makes up handles from `$HANDSEED`. It also adds defaults the file does not have (LTYPE ByLayer when an entity refers to it, a `*PAPER_SPACE` or model-space record, DIMSTYLE entries).
  - A save wrote some of the made-up handles, wrote the defaults as table entries and blocks, and wrote the raised `$HANDSEED`. Reopening made the handles up again in a different order and from a different seed, so every R12 BLOCK_RECORD, BLOCK and owner link moved: about 6,000 differences, 2,911 in each acadsharp `sample_AC1009` file.
- **Fix:**
  - The reader records the range of handles it made up (`CadDocument.madeUpHandles`), and which of them belong to objects that have no template, that is defaults it added.
  - An R12 save writes no handle for a made-up one, leaves the added defaults out of the tables and leaves an added space or empty block out of BLOCKS. It writes `$HANDSEED` as read, unless an object was added after reading, in which case it writes the current seed.
  - Reopening then makes up the same handles for the same objects. An added object keeps its handle, and the made-up ones then move above it.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0076 R12 DXF saves keep the handles acad-ts made up for what R12 does not store".
  - Four R12 files (acadsharp `sample_AC1009_ascii.dxf`, ezdxf `ASCII_R12.dxf`, `r12_blocks_with_no_names.dxf`, `AC1003_LINE_Example.dxf`), saved as ASCII and binary DXF, reopen with the same objects under the same handles.
  - A LINE added after reading keeps its handle, and no handle is used twice.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep made-up R12 handles stable through a DXF save

R12 DXF files have no BLOCK_RECORD table and often no handles, so `DxfReader` makes up handles from `$HANDSEED` and adds default table entries and space blocks. Saving as R12 wrote some made-up handles, wrote the defaults, and wrote the raised `$HANDSEED`, so reopening the saved file numbered everything differently. This records the made-up range and the reader's defaults on `CadDocument.madeUpHandles`; an R12 save leaves those handles and defaults out and writes `$HANDSEED` as read, so a reopened file gets the same handles.

</details>

### 0077 — an R12 xdata layer name links to handle 0

- **File:** `third_party/acad-ts-patches/0077-r12-xdata-layer-without-handle.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DXF/DxfDocumentBuilder.ts`
- **Symptom:** a 1003 xdata record is read as a link to the named layer's handle. R12 layers state no handle, so the link was to handle 0, and a save left the 1003 out (acadsharp `sample_AC1009` TEXT 91B, `LAYER_APP`).
- **Fix:** a record read while its layer has no handle is linked again once `createMissingHandles` has given the layer one.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0077 an R12 DXF 1003 xdata layer keeps its layer when the layer has no handle in the file".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Link R12 xdata layer names after layer handles are made up

DXF 1003 xdata stores a layer name, which the reader turns into the layer's handle. In R12 files layers usually have no handle when the entities are read, so the record pointed at handle 0 and the writer could not resolve it. This relinks those records after the builder assigns handles.

</details>

### 0078 — POLYLINE and INSERT xdata is written after the SEQEND

- **File:** `third_party/acad-ts-patches/0078-dxf-owner-xdata-before-children.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** the entity writer wrote an entity's xdata after the entity-specific data, which for a POLYLINE, and for an INSERT with attributes, includes its VERTEX/ATTRIB records and SEQEND. The reader then gave the xdata to the SEQEND (`sample_AC1009` POLYLINEs, 5 differences in each file).
- **Fix:** a POLYLINE, and an INSERT with attributes, writes its xdata before its children, and the general writer does not write it again.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0078 DXF POLYLINE and INSERT xdata is written with them, not after their SEQEND".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write POLYLINE/INSERT xdata before their VERTEX/ATTRIB records

An entity's xdata ends its own record, but the DXF writer appended it after `_writePolyline`/`_writeInsert`, which had already written the vertices or attributes and the SEQEND. Readers then attach the xdata to the SEQEND. This writes it before the children.

</details>

### 0079 — R12 DXF saves leave out $DWGCODEPAGE

- **File:** `third_party/acad-ts-patches/0079-r12-dxf-codepage.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfHeaderSectionWriter.ts`
- **Symptom:** the R12 header vocabulary did not list `$DWGCODEPAGE`, which R12 has. The text was still written in the drawing's code page, so a saved drawing in any code page but ANSI_1252 was read back wrongly; ezdxf `bin_dxf_r12.dxf` lost its `ansi_1252` spelling.
- **Fix:** `$DWGCODEPAGE` is in the R12 vocabulary.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0079 R12 DXF saves write $DWGCODEPAGE, so the text is read back in its code page".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write $DWGCODEPAGE in R12 DXF

R12 DXF files carry `$DWGCODEPAGE` and the writer encodes text in that code page, but the R12 header variable list left it out, so readers fell back to ANSI_1252. This adds it to the list.

</details>

### 0080 — BLOCK xdata is not written

- **File:** `third_party/acad-ts-patches/0080-dxf-block-xdata.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfBlocksSectionWriter.ts`
- **Symptom:** the BLOCK writer wrote no xdata, so a block's xdata was lost on save (ezdxf tags the `$MODEL_SPACE` BLOCK of `r12_blocks_with_no_names.dxf`).
- **Fix:** the BLOCK writer writes the block's xdata.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0080 DXF BLOCK xdata is written with the block".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write BLOCK entity xdata

BLOCK is an entity and can carry xdata, which the reader keeps, but `_writeBlock` never wrote it. This writes it at the end of the BLOCK record.

</details>

### 0081 — a DXF with no $ACADVER is saved as R2018

- **File:** `third_party/acad-ts-patches/0081-dxf-versionless-as-r12.patch`
- **Touches:** `src/IO/DXF/DxfReader.ts`, `src/IO/DXF/DxfDocumentBuilder.ts`
- **Symptom:** with no `$ACADVER` (the minimal R12 file is an ENTITIES section and EOF) the document kept the header's R2018 default and was saved as R2018, with a layout, dictionaries and a BLOCK_RECORD table the file never had. With no `$HANDSEED`, an entity's made-up handle could also collide with a table's, and the document renumbered the entity while its block record kept the old handle (ezdxf `Minimal_DXF_AC1009.dxf`, `R12_with_trash_beyond_EOF.dxf`).
- **Fix:** a DXF with no `$ACADVER` and no CLASSES or OBJECTS section is read as R12, as AutoCAD and ezdxf read it. After the build, a block record's owned handles are taken from its entities if any of them no longer names one of its entities.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0081 a DXF with no version and no R13 sections reads as R12 and saves as R12".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read a DXF without $ACADVER as R12

AutoCAD and ezdxf treat a DXF without `$ACADVER` and without R13+ sections as R12. acad-ts kept its R2018 default version, so saving such a file produced an R2018 file with objects the source never had. This sets the version to AC1009 in that case, and keeps block records' owned handles in step with their entities when the document renumbers a made-up handle that collided.

</details>

### 0082 — GEODATA's coordinate system keeps only its last chunk

- **File:** `third_party/acad-ts-patches/0082-dxf-geodata-last-chunk.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`
- **Symptom:** a GEODATA coordinate system definition longer than one group is written as 303 chunks and a last 301. The 303s were appended, then the map assigned the 301, which replaced them and kept its caret codes (`^J`) as text (acadsharp `geoloc.dxf` XML, `geoloc_AC1021.dxf` WKT).
- **Fix:** 301 is appended like the 303s.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0082 GEODATA coordinate system XML is read with its line breaks and kept through a save".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Append the last GEODATA 301 chunk

`_readGeoData` appends each 303 to `coordinateSystemDefinition`, but 301 falls through to the map and replaces the text read so far. Append it too.

</details>

### 0083 — FIELD code and format string keep only their last chunk

- **File:** `third_party/acad-ts-patches/0083-dxf-field-last-chunks.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`
- **Symptom:** the field code is written as 3 chunks and a last 2, the format string as 9 chunks and a last 301. Each went through the map, so every chunk replaced the one before (ezdxf `mtext_complex_inline_codes.dxf` FIELD A9, whose format string is 1,995 characters).
- **Fix:** 2 and 3 append to `fieldCode`, 9 and 301 to `formatString`.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0083 a DXF FIELD keeps its whole field code and format string".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read FIELD overflow chunks

FIELD splits the field code (3…, 2) and the format string (9…, 301) into 255-character chunks. They were assigned through the map, so only the last chunk survived. Append them in order.

</details>

### 0084 — a TrueType STYLE's ACAD font xdata is rebuilt from the file name

- **File:** `third_party/acad-ts-patches/0084-dxf-style-font-xdata-as-read.patch`
- **Touches:** `src/IO/TextStyleExtendedData.ts`
- **Symptom:** on save the `ACAD` 1000/1071 pair of a TrueType style was rebuilt from the font file name, so "Arial Black" became "ariblk" and the charset, pitch and family bits of 1071 were lost (ezdxf `text_fonts.dxf` STYLE 6A8).
- **Fix:** the reader remembers each style's font file; while it is unchanged the writer keeps the face name and the non-style bits as read and refreshes only bold and italic. A changed font file still rebuilds the pair.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0084 a TrueType STYLE keeps its ACAD font xdata as read through a DXF save".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep ACAD font xdata while the font file is unchanged

The face name and the charset/pitch/family bits cannot be derived from the font file name. Keep them as read unless the style's font file changed; refresh only the bold and italic bits.

</details>

### 0085 — a DBCOLOR without a true colour is written with 420 = 0

- **File:** `third_party/acad-ts-patches/0085-dxf-dbcolor-indexed.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** `writeBookColor` always wrote 420, so an index colour went out as true colour 0 and read back as true-colour black (acadsharp `sample_AC1015` ASCII and binary, DBCOLOR 996).
- **Fix:** 420 is written only when the colour is a true colour.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0085 a DBCOLOR with no true colour is not written with one".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write DBCOLOR 420 only for true colours

An index colour has no 24-bit value; writing 420 = 0 turns it into true-colour black on reopen.

</details>

### 0086 — the DXF writer leaves out IMAGE clip mode

- **File:** `third_party/acad-ts-patches/0086-dxf-image-clip-mode.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** R2010+ IMAGE 290 (clip mode, inverted clip) was read but not written, so an inverted clip came back normal (ezdxf `viewports.dxf` IMAGE 7E9).
- **Fix:** 290 is written after the clip boundary from R2010.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0086 an R2010+ DXF IMAGE keeps its clip mode (290)".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write IMAGE clip mode (290)

The reader keeps `clipMode`; the writer did not write it.

</details>

### 0087 — a DXF Defpoints layer reads as plotted

- **File:** `third_party/acad-ts-patches/0087-dxf-defpoints-plot-flag.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfTablesSectionReader.ts`
- **Symptom:** a DEFPOINTS layer with no 290 kept the plottable default, which the getter hides; the writer writes AutoCAD's 290 = 0, so the reopened layer stored a different flag (ezdxf `duplicate_handles.dxf` LAYER 29).
- **Fix:** a layer named Defpoints is read as not plotted, as AutoCAD treats it and as the writer writes it.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0087 a DXF Defpoints layer reads as not plotted, as it is written".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read the Defpoints layer as not plotted

AutoCAD never plots Defpoints, and the writer writes 290 = 0 for it. Store the same flag on read so a save does not change it.

</details>

### 0088 — MLINESTYLE element colours overwrite the fill colour

- **File:** `third_party/acad-ts-patches/0088-dxf-mlinestyle-element-colour.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`
- **Symptom:** each element's 62 went through the map to `fillColor`, so the fill read as the last element's colour and every element kept ByLayer (ezdxf `text_negative_extrusion.dxf` MLINESTYLE 18: fill 256, elements 0).
- **Fix:** 62 before the first 49 is the fill colour; after it, it is the colour of the element the last 49 started.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0088 a DXF MLINESTYLE keeps its fill colour apart from its element colours".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read MLINESTYLE element colours

MLINESTYLE uses 62 for the fill colour and again for each element after its 49. Route the element 62s to the element.

</details>

### 0089 — a DXF VIEWPORT ID of 0 is renumbered

- **File:** `third_party/acad-ts-patches/0089-dxf-viewport-stated-id.patch`
- **Touches:** `src/Entities/Viewport.ts`
- **Symptom:** `Viewport.id` treats 0 as unset and numbers the viewport by its position, so a file's 69 = 0 (an off viewport in ezdxf `text_negative_extrusion.dxf`, VIEWPORT 46A) was written as 2.
- **Fix:** an ID set through `id` is returned as set, 0 included; only a viewport whose ID was never set is numbered by position.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0089 a DXF VIEWPORT keeps a stated id of 0".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep a stated viewport ID of 0

AutoCAD writes 69 = 0 for some viewports. The getter's position numbering is for viewports made in code; once an ID is set, return it as set.

</details>

### 0090 — an R2009 GEODATA loses its reference point

- **File:** `third_party/acad-ts-patches/0090-dxf-geodata-r2009-reference-point.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`
- **Symptom:** version 1 GEODATA states the reference point in 40/41/42 and then writes 11/21/31 = 0. The map took 11 as the version 2+ reference point, so every R2009 DXF GEODATA read with its reference point at 0,0,0 (acadsharp `geoloc_AC1021.dxf` GEODATA 241). Both reads of a round trip agreed, so the structural diff could not see it.
- **Fix:** 11/21/31 are skipped for version 1; later versions still read them through the map.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0090 an R2009 DXF GEODATA keeps its reference point from 40/41/42".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Do not read R2009 GEODATA 11 as the reference point

Version 1 has the reference point in 40/41/42; 11/21/31 are a zero vector after it and overwrote it.

</details>

### 0091 — an R2009 GEODATA horizontal unit scale is written from the wrong field

- **File:** `third_party/acad-ts-patches/0091-dxf-geodata-r2009-unit-scale.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** the DXF reader and the DWG reader and writer take version 1's 46 as the horizontal unit scale; the DXF writer wrote the user scale factor there, so 0.0254 came back as 1 (acadsharp `geoloc_AC1021.dxf`).
- **Fix:** 46 is written from `horizontalUnitScale`; the user scale factor stays in the Civil 3D block's 141.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0091 an R2009 DXF GEODATA writes its horizontal unit scale as 46".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write R2009 GEODATA 46 as the horizontal unit scale

Match the DXF reader and the DWG reader/writer.

</details>

### 0092 — dynamic-block graph nodes never join the document

- **File:** `third_party/acad-ts-patches/0092-dynamic-block-graph-nodes-registered.patch`
- **Touches:** `src/IO/CadDocumentBuilder.ts`
- **Symptom:** an evaluation graph's parameters, grips, actions and grip-location components are owned by the graph and reached only through its nodes. The builder linked them to the nodes but never registered them, so the document did not hold them (`getCadObject` returned nothing, new handles could reuse theirs) and the M1-27 handle gate counted 437 of them as never loaded, in DWG and DXF alike (acadsharp `dynamic-blocks/*`, every `sample_AC10xx`).
- **Fix:** an object owned by an evaluation graph and named by one of its nodes is registered with the graph, as an object owned through an XRECORD entry is.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0092 dynamic-block graph nodes join the document with their graph".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Register evaluation graph node expressions in the document

Graph node expressions are owned by their `ACAD_EVALUATION_GRAPH` but no collection registers them, so `CadDocument` never holds them. Register them once their graph is in the document.

</details>

### 0093 — a DXF block action's selection set replaces its owner

- **File:** `third_party/acad-ts-patches/0093-dxf-block-action-selection-set.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`
- **Symptom:** the AcDbBlockAction 330s (the entities the action acts on) went through the common codes, which take every 330 as the owner. The action's owner became its last entity, so it was not linked to its graph, and its `entities` stayed empty (acadsharp `BLOCKLINEARPARAMETER.dxf` BLOCKSCALEACTION 26C on CIRCLE 258); the DWG reader reads both.
- **Fix:** AcDbBlockAction 330s are read as the selection set, into a `CadBlockActionTemplate` (now also used for actions read through the generic path), as the DWG reader does.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0093 a DXF block action keeps its graph owner and reads its selection set".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read DXF block action selection sets

The 330s of AcDbBlockAction are the action's entities. They were read as owner handles, so the last entity replaced the graph as owner.

</details>

### 0094 — DXF saves drop data of dynamic-block graph nodes

- **File:** `third_party/acad-ts-patches/0094-dxf-dynamic-block-nodes-as-read.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`, `src/Objects/Evaluations/EvaluationExpression.ts`
- **Symptom:** the DXF writer writes these objects from their DXF maps, which hold only part of them; every visibility state of a BLOCKVISIBILITYPARAMETER was dropped (acadsharp `BLOCKVISIBILITYPARAMETER.dxf` 33B and the `sample_AC10xx` DXFs: 52 differences once 0092 made the nodes visible).
- **Fix:** with `keepRawDxfPassthroughObjects`, the reader keeps the group codes of every evaluation expression and the DXF writer writes them back as read, as for MATERIAL and VISUALSTYLE. Nodes read from DWG still go through the field writer.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0094 DXF saves write dynamic-block graph nodes as read".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep DXF group codes of evaluation expressions

The map-driven DXF writer for dynamic-block objects loses data (visibility states, among others). Keep the codes as read when the reader is asked to, and write them back.

</details>

### 0095 — a DWG BLOCKFLIPGRIP is read in the wrong field order

- **File:** `third_party/acad-ts-patches/0095-dwg-block-flip-grip-field-order.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`
- **Symptom:** the reader read the direction (3BD) before the flip id (BL); the record and the writer have the id first. The grip read as direction 1, -11159.6, 3.5e-162 and id 2 (the DXF twin: 0, 7.6, 0 and 3), and a saved grip did not read back, which was the last round-trip difference of `BLOCKFLIPPARAMETER.dwg`.
- **Fix:** the id is read first, then the direction.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0095 a DWG BLOCKFLIPGRIP reads its flip id before its direction, as written".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read BLOCKFLIPGRIP flip id before direction

The writer writes BL 93 then 3BD 140–142, which matches the file; the reader had them swapped.

</details>

### 0096 — a DXF 330 after the first subclass marker replaces the owner

- **File:** `third_party/acad-ts-patches/0096-dxf-owner-before-first-subclass.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** the common codes took every 330 as the owner, so any 330 an object's reader did not consume (the selection set of an unknown BLOCKFLIPACTION, references inside TABLEGEOMETRY) replaced the owner stated before the first subclass marker. Such objects were attached to an entity and never joined the document (acadsharp `BLOCKFLIPPARAMETER.dxf` 26D; 16 TABLEGEOMETRY objects in the `sample_AC10xx` DXFs).
- **Fix:** a 330 after the first subclass marker sets the owner only when none was stated.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0096 a DXF 330 after the first subclass marker does not replace the stated owner".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep the owner stated before the first subclass marker

DXF states an object's owner as the 330 in its common data, before the first 100. A later 330 is object data; when a reader does not consume it, it must not overwrite the owner.

</details>

### 0097 — a DXF evaluation expression with a non-double value is dropped

- **File:** `third_party/acad-ts-patches/0097-dxf-evaluation-expression-value-type.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`
- **Symptom:** AcDbEvalExpr holds `1`, then `70` (the value's type), then the value in that type's group. The reader required 140 after the 70 and threw on a short value (70 = 70, 70 = 0), which dropped the object (acadsharp `BLOCKFLIPPARAMETER.dxf` BLOCKGRIPLOCATIONCOMPONENT 263).
- **Fix:** the value group is read whatever its code.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0097 a DXF evaluation expression reads a value of any type".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read AcDbEvalExpr values of any type

The value after the 70 type group can be any type's group code; requiring 140 threw for shorts.

</details>

### 0098 — a pre-R2007 DXF table value runs past the end of its object

- **File:** `third_party/acad-ts-patches/0098-dxf-pre-r2007-value-end.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`
- **Symptom:** before R2007 a table, data-map or field value has no `304 ACVALUE_END`: it is a `90` type and that type's data (`301 DATAMAP_VALUE`, `90 = 2`, `140 = 7783`, `309 DATAMAP_END`). `readCadValue` and `_readDataMapValue` waited for a 304, so they read the enclosing `DATAMAP_END`, `CELLCONTENT_END` and so on as value codes, then the next objects. In acadsharp `sample_AC1015_ascii.dxf` and `sample_AC1018_ascii.dxf` (and their binary twins) each TABLECONTENT swallowed its TABLEGEOMETRY, the ACDBDATATABLE and the dictionaries after it, which were never loaded. With 0099 the corpus handle-coverage gate goes from 318 to 52 lost handles.
- **Fix:** before R2007, a value ends on its type's last data code (91 for unknown and long, 140 double, 1 string, 21 2D point, 31 3D point, 330 handle; date and buffer after the 92 byte count of 310s; result buffer and general on the 90 itself). R2007 and later still end on 304.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0098 an R2000/R2004 DXF table value ends on its data, so the objects after it are read". The TABLECONTENT itself is read only with 0099 too, because its empty cells are unknown-type values with a 91.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** End pre-R2007 DXF table values on their data, not on ACVALUE_END

R2004 and earlier DXF files write a value as its 90 type and the type's data, with no 304 ACVALUE_END (that marker, the 93 flags and the 94/300/302 groups arrived with R2007). The value readers waited for a 304 and consumed the enclosing structure and the following objects. This ends a pre-R2007 value on its type's last data code.

</details>

### 0099 — a DXF table value of unknown type with a 91 throws

- **File:** `third_party/acad-ts-patches/0099-dxf-unknown-value-91.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** an empty table cell is a value of type 0 (unknown) that still carries `91 = 0` (every pre-R2007 one, and ezdxf `acad_table_simple.dxf`, R2013: `301 CELL_VALUE`, `93 = 3`, `90 = 0`, `91 = 0`). `readCadValue` passed the 91 to `CadValue.setValue`, which throws for the unknown type, so the ACAD_TABLE or TABLECONTENT was dropped with the objects the failed read had passed. This was the M1-04 mapping gap "acad-ts drops ACAD_TABLE entities of ezdxf-written files from their block" (M1-32).
- **Fix:** the 91 of an unknown-type value is skipped.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0099 a DXF table value of unknown type with a 91 is read, not thrown away".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Do not throw on the 91 of an unknown-type DXF table value

Empty cells are written as unknown-type values with a 91. Setting it threw "Invalid operation for value type" and dropped the whole table; the 91 carries no value for that type and is now skipped.

</details>

### 0100 — a DXF date value is dropped on read and written as 91 = 0

- **File:** `third_party/acad-ts-patches/0100-dxf-date-value.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** an R2007+ date value (field, table cell) is `90 = 8`, `92 = 16`, `310` = a SYSTEMTIME. `readCadValue` skipped the 92 and 310, so the value stayed empty, and the writer wrote `91 = 0` for a date. ezdxf `uncommon.dxf` FIELD 5F9 (an AcVar Date child field, 2020-04-21 16:45:39) and the acadsharp R2007+ `ACAD_TABLE` date cell lost their dates on every save. The structural diff could not see it: both reads had an empty value.
- **Fix:** the reader decodes the 16 bytes as the DWG reader does (year, month, day of week, day, hour, minute, second, millisecond, little-endian shorts). The writer writes `92 = 16` and the SYSTEMTIME for a date from R2007 on. Pre-R2007 8-byte dates are unchanged.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0100 a DXF date value keeps its date through a save".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write DXF date values (92/310 SYSTEMTIME)

R2007+ DXF stores a date value as a byte count (92) and a SYSTEMTIME (310). The reader ignored both and the writer emitted `91 0`, so dates in fields and table cells were lost on a DXF save. This decodes and encodes the SYSTEMTIME the same way the DWG reader and writer do.

</details>

### 0101 — a pre-R2007 3DSOLID history is not in the document

- **File:** `third_party/acad-ts-patches/0101-dwg-pre-r2007-solid-history.patch`
- **Touches:** `src/IO/CadDocumentBuilder.ts`
- **Symptom:** before R2007 a 3DSOLID has no history handle (350 came with R2007). Its `ACSH_HISTORY_CLASS` is owned by the solid (its owner handle) but referenced only from the `ACAD_XREC_ROUNDTRIP` XRECORD in the solid's extension dictionary (a 360 entry). The DWG reader read it from that entry, but nothing registered it, so the history and the evaluation graph and `ACSH_*` nodes it owns (kept raw since M1-30) were not in the document. acadsharp `sample_AC1014/1015/1018.dwg`: solid D65 → history D66 → graph D67 → box D68, and solid D6A → D6B → D6C → D6D (18 handles).
- **Fix:** when an object's owner holds it through an owner entry (350–369) of an XRECORD in the owner's extension dictionary, the builder registers it with that owner, as it already does for an object owned through an XRECORD's entries.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0101 a pre-R2007 3DSOLID keeps its history, and the history its graph".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Register pre-R2007 3DSOLID history objects

Before R2007 a solid's ACSH_HISTORY_CLASS is referenced from an XRECORD in the solid's extension dictionary, not from the solid. The object was read but never registered, so it, and the graph it owns, were missing from the document. The builder now registers an object held through an owner entry of an XRECORD in its owner's extension dictionary.

</details>

### 0102 — a dictionary's default entry that is not one of its entries is lost

- **File:** `third_party/acad-ts-patches/0102-dictionary-default-entry.patch`
- **Touches:** `src/IO/CadDocumentBuilder.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** acadsharp `sample_AC1014.dwg`'s `ACAD_PLOTSTYLENAME` (E) has no entries; its default (340) is `ACDBPLACEHOLDER` F. Only the dictionary held the placeholder, so it was not in the document, and a DXF save wrote the 340 but never the object (the DWG writer already wrote it).
- **Fix:** the builder registers a default entry owned by its dictionary-with-default, and the DXF writer writes the default entry with the dictionary's entries (it skips one already written).
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0102 a dictionary-with-default keeps a default entry that is not one of its entries".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep a DICTIONARYWDFLT default entry that is not one of its entries

A dictionary-with-default can name a default that is not one of its entries. The default was resolved but never registered with the document, and the DXF writer wrote its handle without writing the object. Both are fixed.

</details>

### 0103 — a DWG object no reference reaches is never read

- **File:** `third_party/acad-ts-patches/0103-dwg-unreachable-objects.patch`
- **Touches:** `src/IO/CadReaderConfiguration.ts`, `src/CadDocument.ts`, `src/IO/CadDocumentBuilder.ts`, `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** the DWG reader reads only the objects it reaches from the header, the tables and the references it decodes. An object in the object map whose owner is not in the map is never reached, so a save drops it. acadsharp `AecObjects.dwg`: `BLOCK`/`ENDBLK` 2ADC/2ADE and 2AE0/2AE3 (their block records 2ADB and 2ADF are listed by the block table but are not in the map), `DICTIONARY` 2C9C with `XRECORD` 2C9D, and `XRECORD`s 3DEB, 3DEE, 3DEF, 3DF2, 3DF5, 3DF6 (owners 3DEA, 3DED, 3DF1, 3DF4 not in the map). `sample_base.dwg`: `XRECORD`s E1A, E1D, E1E (owners E19, E1C not in the map). AutoCAD keeps such objects in the database.
- **Fix:** a new reader setting, `keepUnreachableObjects` (off by default). With it, once the references are exhausted, every object left in the map is kept as its raw record in an `UnknownNonGraphicalObject` (whatever its type), registered with the document and listed in `CadDocument.unreachableObjects`. The DWG writer writes them raw, as it writes unknown objects (same version only).
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0103 a DWG object no reference reaches is kept raw and written back".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Optionally keep DWG objects that no reference reaches

DWG files can hold objects whose owner is not in the file. The reader never reaches them, so they disappear on save. `CadReaderConfiguration.keepUnreachableObjects` reads every object left in the object map after the references are followed, keeps each as its raw record in `CadDocument.unreachableObjects`, and the DWG writer stores them unchanged for the same version.

</details>

### 0104 — a DXF block with no name and no block record is dropped

- **File:** `third_party/acad-ts-patches/0104-dxf-unreachable-nameless-blocks.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfBlockSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfBlocksSectionWriter.ts`
- **Symptom:** a `BLOCK` with no name (no 2 or 3) and no block record in the file made the reader create a record with an empty name, which a table cannot hold, so the block and its `ENDBLK` were dropped with an error. ezdxf `r12_blocks_with_no_names.dxf` (BLOCK 2E/ENDBLK 2F, BLOCK 33/ENDBLK 34) and `r2000_blocks_with_no_name_and_no_block_record.dxf` (BLOCK 30/ENDBLK 31 owned by 2F, BLOCK 33/ENDBLK 34 owned by 32; neither record is in the file).
- **Fix:** with `keepUnreachableObjects` (0103), the block's header, entities and `ENDBLK` are kept as raw `UnknownEntity`s in `CadDocument.unreachableObjects`, and the DXF writer writes them at the end of the BLOCKS section as read. No INSERT can name such a block, so it stays unreachable.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0104 a DXF block with no name and no block record is kept raw and written back".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep nameless DXF blocks without a block record

A BLOCK with no name and no BLOCK_RECORD failed with an empty table entry name and was dropped. With `keepUnreachableObjects`, the block is kept as raw entities and written back in the BLOCKS section.

</details>

### 0105 — a DXF linetype segment loses the text style it names

- **File:** `third_party/acad-ts-patches/0105-dxf-linetype-segment-style.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfTablesSectionReader.ts`
- **Symptom:** a complex linetype element names the STYLE record of its text font or shape file in group 340 (after 75). The DXF reader skipped the group, so every segment's `style` was null after a DXF read; the template already resolves `styleHandle` and the DWG reader sets it. acadsharp `sample_AC1009`–`AC1032` DXF: GAS_LINE's "GAS" lost Standard (11), and TRACKS, BATTING and the other shape linetypes lost their `ltypeshp.shx` style (27F), so their text and shapes had no font to draw with (M1-45). The writer already wrote the handle back, so the round trip did not show it.
- **Fix:** read 340 into the segment template's `styleHandle`, which the builder resolves to the text style.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0105 a DXF linetype segment keeps the text style it names (340)".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read the text style of DXF linetype segments (group 340)

`_readLineTypeSegment` skipped group 340, the STYLE record of a text or shape element, so complex linetypes read from DXF had no style on their segments. The segment template already resolves `styleHandle` (the DWG reader fills it); the DXF reader now does too.

</details>

### 0106 — attributes, vertices and SEQENDs never take the document's table entries

- **File:** `third_party/acad-ts-patches/0106-held-children-table-entries.patch`
- **Touches:** `src/Entities/Insert.ts`, `src/Entities/Polyline.ts`, `src/Entities/PolyfaceMesh.ts`, `src/IO/CadDocumentBuilder.ts`
- **Symptom:** an INSERT's attributes and `SEQEND`, a polyline's vertices and `SEQEND` and a polyface mesh's faces are held inside their owner, not registered with the document, so `assignDocument` never ran on them. A child whose record had no 8/6/7 kept a detached `Layer.default`/`LineType.byLayer`/`TextStyle.default` instead of the document's `0`/`ByLayer`/`STANDARD`, and its `document` stayed null. From R13 on the DXF writer omits code 8 for layer `0`, so after a save such a child read back with no layer at all. ezdxf `small_r13.dxf` VERTEX 78, acadsharp `sample_AC1009.dxf` ATTRIB 705 (style), `sample_AC1015.dxf` VERTEX 423 / SEQEND 42A after a DXF save; 388 differences across 19 corpus files once the structural diff compares held children.
- **Fix:** `Insert` and `Polyline` gain `assignHeldChildren(doc)`, called from `assignDocument` and, at the end of a build, by the builder for every insert and polyline (the readers push the children after the owner joined the document). `PolyfaceMesh` extends it to its faces. `unassignDocument` releases the children too. A child already in a document is left alone.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0106 attributes, vertices and SEQENDs take their layer, linetype and style from the document".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Assign the document to attributes, vertices, faces and SEQENDs

Entities held inside an INSERT or a POLYLINE never had `assignDocument` called, so their layer, linetype and text style stayed detached defaults rather than the document's table entries, and a layer-0 child lost its layer after a DXF save (the writer omits code 8 for layer 0). Owners now assign their held children when they join a document and after the reader builds them, and release them when they leave.

</details>

### 0107 — DXF reads LARGE_RADIAL_DIMENSION as a dimension

- **File:** `third_party/acad-ts-patches/0107-dxf-large-radial-dimension.patch`
- **Touches:** new `src/Entities/DimensionRadialLarge.ts`; `src/index.ts`, `src/DxfFileToken.ts`, `src/DxfSubclassMarker.ts`, `src/Classes/DxfClassDefinitionRegistry.ts`, `src/Metadata/LookupTables/Entities.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** acad-ts had no class for the jogged radius dimension, so a `LARGE_RADIAL_DIMENSION` read as an `UnknownEntity`. It was kept through saves, but its block, style and points could not be mapped or drawn. ezdxf `uncommon.dxf` has two (37C and 414).
- **Fix:** a `DimensionRadialLarge` entity (subclass `AcDbRadialDimensionLarge`): 15 the chord point, 13 the displaced centre, 14 the jog point, 40 the leader length; 10 stays the centre (the definition point), so the measurement is 10→15. The DXF reader reads it like `ARC_DIMENSION`, and the DXF writer writes it with its subclass. The class definition matches AutoCAD's (`uncommon.dxf` CLASS: proxy flags 1025, entity). Type 70 keeps what the file says (AutoCAD writes 9 | 32 | 128 = 169); a new one starts at 9 | 32. The DWG layout is not implemented: a DWG file's jogged dimension still reads as an `UnknownEntity` and is written back raw, and one read from DXF is left out of a DWG save, as it was before.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0107 DXF reads LARGE_RADIAL_DIMENSION as a jogged radius dimension and writes it back". The 0014 case for `uncommon.dxf` now uses `ACDBASSOCPERSSUBENTMANAGER` as its unknown object.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write LARGE_RADIAL_DIMENSION (jogged radius dimension) in DXF

`LARGE_RADIAL_DIMENSION` had no entity class, so it was read as an unknown entity and its geometry was not available. This adds `DimensionRadialLarge` with the `AcDbRadialDimensionLarge` codes (13 override centre, 14 jog point, 15 chord point, 40 leader length), reads it in the DXF entity section, and writes it back with its subclass. The flags (70) are kept as read. The DWG object layout is not included; the DWG writer skips the entity as it did before.

</details>

### 0108 — a DXF hatch loses its style, its seed points and its ellipse edges' major axes

- **File:** `third_party/acad-ts-patches/0108-dxf-hatch-style-seeds-ellipse-axis.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** three DXF `HATCH` read losses found by the M1-04 entity oracle (`entities.corpus.test.ts` `ACAD_TS_GAPS`, roadmap M1-32). (1) `readHatch` skipped group 75, so every outer and ignore hatch read as normal (acadsharp `sample_AC1015`–`AC1032` ASCII: 35A, 36E, 371, 376, BBB, BC0, BC2, BC4). (2) `_readPattern` advanced past the code that ends the last pattern line, so the group after the pattern was lost: when it was 98 (a line with no dashes ends on `79 0`, then `98 1`), the seed-point count went with it and the seed points that follow were dropped (35A, 36E, BC0); when it was 47, the pixel size was lost. (3) the ellipse-edge reader built the major axis end point (11/21) from the centre's other coordinate, so a later 21 replaced the x the 11 had set with the centre's x. The writer already wrote all three, so the round trip compared two equally wrong reads and did not show it.
- **Fix:** read 75 into `hatch.style`; leave the code that ends the last pattern line for the caller (only advance while the line goes on); build the major axis from its own components.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0108 a DXF hatch keeps its style, seed points and ellipse-edge major axes".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read DXF hatch style, seed points and ellipse-edge major axes

The DXF hatch reader skipped the hatch style (75); `_readPattern` consumed the group after the last pattern line, so a `98` that directly follows a dashless line was lost along with the seed points it counts (and a following `47` lost the pixel size); and an ellipse edge's major axis end point took its missing component from the edge's centre, so its x was overwritten by the centre's x once 21 was read. All three are written correctly by the DXF writer, so a round trip hides them.

</details>

### 0109 — the ACI palette's mistyped entries, and the ACI written for a true colour

- **File:** `third_party/acad-ts-patches/0109-aci-palette-approx-index.patch`
- **Touches:** `src/Color.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** 31 of the 255 entries of `Color._indexRgb` broke the palette's own pattern: mistyped digits (38 written 28 or 88, 76 written 126, 127 written 125 or 217, 145 written 142), ACI 192 with red and blue swapped, and the greys 250–254. `Color.approxIndex` summed signed channel differences and returned at the first sum below the previous one, so a true colour saved through `getApproxIndex` (layer 62 next to 420, entity colour-book 62, the `$CECOLOR` header, R12 DXF, R2000 DWG colours, table cell and visual style colours) got an unrelated index, usually 0 (ByBlock) or 1. The DXF writer also left out the 62 that AutoCAD writes before an entity's 420. Found by the M1-13 palette oracle (`style.corpus.test.ts`) and M1-55.
- **Fix:** the 31 entries now follow the palette's rule (24 hues 15° apart, values 1, 0.65, 0.5, 0.3, 0.15 of 255 at full and half saturation, floored; greys 51 + 40.8·k), which equals Triya's computed `aciRgb` on all 255. `approxIndex` returns the nearest ACI by squared RGB distance over 1–255, lowest index on a tie, in the palette AutoCAD itself looks true colours up in (hue rows 1, 0.8, 0.6, 0.5, 0.3; greys 51, 80, 105, 130, 190), the same lookup as `@triya/io`'s `aciOfTrueColor`: it reproduces all 3,532 62/420 pairs AutoCAD wrote in the public corpus. The DXF writer writes that ACI in 62 before a true-colour entity's 420, as AutoCAD does (every corpus entity with a 420 has one).
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0109 the ACI palette has no mistyped entries and a true colour maps to the ACI AutoCAD writes" and "0109 DXF writes the nearest ACI (62) before a true colour (420), as AutoCAD does"; `packages/testkit/src/mapping/style.corpus.test.ts` (acad-ts equals `aciRgb` on 1–255) and `true-color.corpus.test.ts` (every corpus pair).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Fix mistyped ACI palette entries and nearest-colour lookup

`Color._indexRgb` had 31 entries that do not follow the AutoCAD Color Index pattern (for example ACI 29 was 38,28,19 instead of 38,23,19, ACI 192 had red and blue swapped, and the greys 250–254 were off). `Color.approxIndex` compared signed sums of channel differences and stopped at the first decrease, so most true colours mapped to index 0 (ByBlock) or 1. This fixes the table, makes `approxIndex` return the nearest index (squared RGB distance, 1–255) in the palette AutoCAD uses when it stores an ACI next to a true colour (it reproduces the 62 AutoCAD writes beside 420 in the ezdxf and ACadSharp sample files), and writes that 62 before an entity's 420 in DXF, as AutoCAD does.

</details>

### 0110 — Table cell formats: border edge ids, R2004 border visibility, R2010 cell-style flags, DXF cell text style

- **File:** `third_party/acad-ts-patches/0110-table-cell-style-reads.patch`
- **Touches:** `src/Entities/TableEntity.ts`, `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/Templates/CadTableEntityTemplate.ts`
- **Symptom:** four ways a table cell's format overrides read wrong, found mapping them (M1-36) and comparing each acadsharp `sample_*.dwg` with its DXF save:
  1. `CellEdgeFlags` had 2 as the right edge and 0x20 as the inside horizontal line. ObjectARX `AcDb::GridLineType` has them the other way round (kHorzInside = 2, kVertRight = 0x20). So an R2010+ cell style's right-edge override landed on `horizontalInsideBorder`: in `sample_AC1024.dwg` table 528, cell (4,2) is drawn with a colour-63 right edge, and its DXF save says so (65 = 63), but acad-ts put that edge inside.
  2. An R2004/R2007 DWG cell's edge visibility override (BS) was read inverted, 0 as hidden. In `sample_AC1018.dwg`, cell (4,0) of table 528 flags its top and left visibility with 0, and acad-ts read both edges as hidden. The `*T9` block draws both edges (colour 63, 0.40 mm), and the R2010+ saves state them visible.
  3. A DWG R2010+ cell style states its own property override flags, and then its content format, which has flags of its own. The content format's flags overwrote the cell style's in `propertyOverrideFlags`, so whatever a cell, row, column or table cell style overrode (alignment, background, margins, text height) was lost. In `sample_AC1024.dwg`, cell (4,0) overrides 0x63E10 (alignment, background 165, margins), and acad-ts read 0.
  4. The DXF reader dropped a cell's text style override (7). The flag (0x10) was read, but the style was not, although the DXF writer writes it.
- **Fix:** swap the two `CellEdgeFlags` values. The reader and writer both use the enum, so files round-trip as before, with the edges now named right. `CellStyle.cellPropertyOverrideFlags` (null unless read from DWG) keeps the cell style's own flags, and the writer writes it back in their place. The R2004 reader and writer treat the visibility short as "hidden" (1 = hidden). The DXF reader keeps a cell's 7, and the cell template resolves it by name when the cell is built, as for a handle.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0110 DWG table cells keep their border edges, R2004 visibility and R2010 cell-style flags" (1–3, with DWG round trips); `packages/io/test/acad-ts-patches.test.ts` → "0110 a DXF table cell keeps the text style override it names (7)" (4). The M1-36 corpus test "maps the tables of a DWG like those of the same drawing saved as DXF" now compares cell formats, and it fails without 1–3.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file). Visibility (2) is inferred from the drawing, because no corpus file has an edge that is really hidden. AutoCAD's DXF for the same cells writes no 289/285/286/288, and acad-ts reads none.

<details><summary>Upstream PR text</summary>

**Title:** Fix table cell format reads: grid line ids, R2004 edge visibility, R2010 cell style override flags, DXF cell text style

- `CellEdgeFlags`: 2 is the inside horizontal grid line and 0x20 the right edge (`AcDb::GridLineType`). Before this, R2010+ right-edge overrides were stored on `HorizontalInsideBorder`.
- R2004/R2007 DWG cell overrides: the edge visibility short was read inverted. A cell whose `*T` block draws its edge, and whose R2010 save states it visible, stores 0 there.
- R2010+ DWG cell styles: the cell style's override flags were overwritten by its content format's flags, which are read next. They are now kept in `CellStyle.CellPropertyOverrideFlags` and written back.
- DXF ACAD_TABLE cells: a cell's text style override (7) is now read and resolved by name.

</details>

### 0111 — header variables the header map leaves out are dropped on DXF read and never written

- **File:** `third_party/acad-ts-patches/0111-header-variables-missing-from-map.patch`
- **Touches:** `src/Metadata/LookupTables/Core.ts`, `src/Metadata/MetadataTypes.ts`, `src/DxfPropertyBase.ts`, `src/Header/CadHeader.ts`, `src/IO/DWG/DwgStreamReaders/DwgHeaderReader.ts`, `src/IO/DWG/DwgHeaderHandlesCollection.ts`, `src/IO/DWG/DwgStreamWriters/DwgHeaderWriter.ts`
- **Symptom:** the DXF header reader and writer only know the variables in the `CadHeader` metadata, and 30 variables AutoCAD writes were missing from it, so DXF read dropped them and a save never wrote them: `$ATTDIA`, `$ATTREQ`, `$COORDS`, `$DELOBJ`, `$DRAGMODE`, `$HANDLING`, `$PICKSTYLE`, `$SAVEIMAGES`, `$SKPOLY`, `$SURFTAB1`/`2`, `$SURFU`/`V`, `$HIDETEXT`, `$INTERSECTIONCOLOR`, `$INTERSECTIONDISPLAY`, `$OBSCOLOR`, `$OBSLTYPE`, `$TILEMODELIGHTSYNCH`, `$REALWORLDSCALE`, `$UCSORTHOREF`, `$UCSORTHOVIEW`, `$PUCSORG`, `$PUCSXDIR`, `$PUCSYDIR`, `$PUCSORTHOREF`, `$PUCSORTHOVIEW`, `$CMATERIAL`, `$INTERFEREOBJVS`, `$INTERFEREVPVS` (found by the M1-03 header oracle, `tables.corpus.test.ts`, roadmap M1-32; up to 80 corpus files each). Half of them already had a `CadHeader` field the DWG reader fills. The DWG header had its own losses: `$SURFV` was read into `surfaceDensityM` (so `$SURFU` took `$SURFV`'s value and `$SURFV` stayed 6); the R2004+ `$INTERSECTIONCOLOR` short was read into `interfereColor` (and written from it); `$TILEMODELIGHTSYNCH`, `$UCSORTHOVIEW`, `$PUCSORTHOVIEW`, the R13/R14 `$ATTREQ`, `$ATTDIA`, `$DELOBJ`, `$DRAGMODE`, `$COORDS`, `$PICKSTYLE` and the `$CMATERIAL`, `$UCSORTHOREF`, `$PUCSORTHOREF`, `$INTERFEREOBJVS`, `$INTERFEREVPVS` pointers were read and thrown away, and the writer wrote constants (`'0'` for `$TILEMODELIGHTSYNCH`, which AutoCAD stores as 1) or null handles.
- **Fix:** metadata entries for the 30 variables; new `CadHeader` fields for those with none (`attributeDialog`, `attributeRequest`, `coordinateDisplay`, `deleteObjects`, `dragMode`, `handling`, `saveImages`, `intersectionColor`, `tileModeLightSynch`, `realWorldScale`, `ucsOrthographicReferenceName`/`View`, `paperSpaceUcsOrthographicReferenceName`/`View`, `paperSpaceOrigin`) and, for the three object pointers, `currentMaterialHandle`, `interfereObjectVisualStyleHandle` and `interfereViewportVisualStyleHandle`, kept as raw handles through a new `'handle'` value kind (the DXF header is read before the objects, and acad-ts has no MATERIAL or VISUALSTYLE class). The DWG reader fills the fields and resolves the pointers once the objects are built (a handle nothing has is dropped); the DWG writer writes them, a pointer as 0 when its object is gone.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0111 header variables the acad-ts header map left out are read, written and kept in DWG"; `packages/testkit/src/mapping/tables.corpus.test.ts` no longer lists them in `ACAD_TS_GAPS`.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write the header variables missing from the CadHeader metadata

Thirty header variables AutoCAD writes (`$ATTDIA`, `$ATTREQ`, `$SURFTAB1`, `$SURFU`, `$PUCSORG`, `$UCSORTHOREF`, `$CMATERIAL`, `$INTERSECTIONCOLOR`, …) had no entry in the `CadHeader` system-variable metadata, so the DXF reader skipped them and the DXF writer never wrote them, even where `CadHeader` already had the field. This adds the entries, the fields that were missing, and a `'handle'` value kind for header variables that point at objects the library has no class for (kept as the raw handle). It also fixes the DWG header: `$SURFV` was read into `SurfaceDensityM`, the R2004+ `$INTERSECTIONCOLOR` went into `InterfereColor`, and several values and pointers were read and discarded or written as constants.

</details>

### 0112 — a layer's material is looked up on read and dropped, and never written

- **File:** `third_party/acad-ts-patches/0112-layer-material.patch`
- **Touches:** `src/IO/Templates/CadLayerTemplate.ts`, `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** both readers keep a layer's material handle (DXF 347, DWG R2007+), and `CadLayerTemplate` looks the material up but never assigns it, so `Layer.material` was always null. The DXF writer wrote no 347 and the DWG writer wrote a null handle, so a save detached every layer from its material. Found by the M1-03 tables oracle (`tables.corpus.test.ts`, `LAYER 347`, roadmap M1-32): every layer of the R2007+ acadsharp and dynamic-block samples points at the Global material.
- **Fix:** the template assigns the material when the handle names one; the DXF writer writes 347 for R2007+ (AutoCAD writes it after 390) and the DWG writer writes the material handle.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0112 a layer keeps its material (DXF 347, DWG R2007+) through read and save"; `tables.corpus.test.ts` no longer lists `LAYER 347` in `ACAD_TS_GAPS`.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep a layer's material on read and write it back

`CadLayerTemplate.Build` looks up the material from `MaterialHandle` but never assigns it to `Layer.Material`, so every layer read from DXF (347) or R2007+ DWG has no material. The DXF writer never writes 347 and the DWG writer writes a null material handle, so a round trip detaches layers from their materials. This assigns it, writes 347 for R2007+ DXF and writes the handle in DWG.

</details>

### 0113 — nameless shape-file text styles are renamed `unnamedN`

- **File:** `third_party/acad-ts-patches/0113-nameless-shape-file-styles.patch`
- **Touches:** `src/Tables/Collections/Table.ts`, `src/Tables/TableEntry.ts`, `src/Tables/TextStyle.ts`
- **Symptom:** AutoCAD stores the STYLE record of a shape file (loaded for complex linetypes or SHAPE entities, flag 1) with an empty name, and a drawing can hold several. `Table.add` renamed every nameless entry `unnamed0`, `unnamed1`, …, so the name read back was not the file's, an R12 record (no handle) could not be told apart, and a DXF writer that dropped the rename would have hit the "name is invalid" check, which skips the record. A DWG style control can list an entry twice; a named entry lands on the same key, so that was harmless while the rename gave a nameless one a name. Found by the M1-03 tables oracle (`STYLE 2`, roadmap M1-32) on `sample_AC1009/AC1015/AC1018_ascii.dxf`.
- **Fix:** `TableEntry.keepsEmptyName` (true for a shape-file `TextStyle`) keeps the empty name: the table stores such an entry under a key no name can have (so lookups by name never find it, as AutoCAD's do not), adds it once, and re-keys it if it is renamed; `validate` accepts its empty name.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0113 a nameless shape-file text style keeps its empty name" (R12 and R2000 DXF, R2004 DWG, with saves); `tables.corpus.test.ts` matches R12 nameless records in file order and no longer lists `STYLE 2`.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep the empty name of shape-file text styles

AutoCAD writes the STYLE table record of a shape file with an empty name (flag 1), and a drawing may have several. `Table.Add` renamed them `unnamed0`, `unnamed1`, … This keeps the empty name for entries that allow it (`TableEntry.KeepsEmptyName`, true for shape-file text styles): they are stored under a private key so they never match a lookup by name, added once even when a DWG style control lists them twice, and pass DXF name validation.

</details>

### 0114 — R12 DIMSTYLE arrow names are parsed as handles and never written

- **File:** `third_party/acad-ts-patches/0114-r12-dimstyle-arrow-names.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfTablesSectionReader.ts`, `src/IO/Templates/CadDimensionStyleTemplate.ts`, `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`
- **Symptom:** an R12 DIMSTYLE names its arrow blocks in 5, 6 and 7 (DIMBLK, DIMBLK1, DIMBLK2). 5 is a handle code, so the reader parsed the name as hex (`BOXBLANK` became `11`, an empty name `0`) and the arrow block never resolved. AutoCAD also writes a built-in arrowhead there without the underscore of its block (`BOXBLANK` for `_BOXBLANK`, as the DIMBLK system variable takes it), which a lookup by name misses. The R12 writer wrote none of 5/6/7. Found by the M1-03 tables oracle (`DIMSTYLE 5`, roadmap M1-32) on `sample_AC1009_ascii.dxf`.
- **Fix:** the reader takes 5 from the line as written; the template resolves a built-in arrowhead name (AutoCAD's DIMBLK list) to its underscored block when no block has the name as written; the R12 writer writes 5/6/7 as names, a built-in arrowhead without its underscore.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0114 an R12 DIMBLK names its arrow block, a built-in arrowhead without its underscore" (ASCII and binary R12, saved both ways, and the text AutoCAD writes); `tables.corpus.test.ts` no longer lists `DIMSTYLE 5`.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write R12 DIMSTYLE arrow block names

In R12 DXF the DIMSTYLE record names its arrow blocks in groups 5, 6 and 7. Group 5 is a handle code, so the reader parsed `BOXBLANK` as the hex number 11 and the arrow block was never found. AutoCAD writes built-in arrowheads there without the leading underscore of their block (`BOXBLANK` for `_BOXBLANK`). This reads 5 as text, resolves built-in arrowhead names to their underscored blocks when no block has the name as written, and writes 5/6/7 in R12 the way AutoCAD does.

</details>

### 0115 — an R12 entity drawn ByBlock reads as ByLayer

- **File:** `third_party/acad-ts-patches/0115-r12-byblock-linetype.patch`
- **Touches:** `src/IO/Templates/CadEntityTemplate.ts`
- **Symptom:** R12 files have no BYBLOCK or BYLAYER LTYPE records, yet an entity names them in 6. The linetype lookup by name failed, so the entity kept its default ByLayer and drew in its layer's linetype instead of its block's. Found by the M1-04 entity oracle (`entity 6`, roadmap M1-32) on 69 entities of `sample_AC1009_ascii.dxf`.
- **Fix:** when no table entry has the name and it is `BYBLOCK` (any case), the entity gets `LineType.byBlock`; the document adds the entry as it already did for ByLayer.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0115 an R12 entity drawn ByBlock keeps its linetype though the file has no BYBLOCK record"; `entities.corpus.test.ts` no longer lists the gap.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read ByBlock linetypes in R12 DXF files

R12 DXF files have no BYBLOCK linetype record, but entities still set group 6 to BYBLOCK. The lookup by name failed and the entity silently fell back to ByLayer. This assigns ByBlock when the name is BYBLOCK and the table has no such entry.

</details>

### 0116 — DXF caret codes other than ^J, ^M and ^I stay encoded

- **File:** `third_party/acad-ts-patches/0116-dxf-caret-control-characters.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfStreamReaderBase.ts`, `src/IO/DXF/DxfStreamWriter/DxfStreamWriterBase.ts`
- **Symptom:** DXF writes a control character as `^` and the character 64 above it (`^@` is 0, `^A` 1, …, `^_` 31) and a caret as `^ `. The reader decoded only `^J`, `^M` and `^I`, so `^A` and the rest came back as text, and the writer encoded only line feed, return and tab, so any other control character would be written raw. Decoding in sequence also read `^^J` as a caret and a line feed. Found by the M1-04 entity oracle (`MTEXT 1`, roadmap M1-32) on ezdxf's `caret_encoding.dxf`.
- **Fix:** decode `^@`–`^_` and `^ ` in one left-to-right pass; encode every character below 32 the same way after escaping carets.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0116 DXF caret codes ^@ to ^_ decode to the control characters 0 to 31 and encode back"; `entities.corpus.test.ts` no longer lists the gap.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Decode and encode every DXF caret code

DXF stores control characters 0–31 in caret notation (`^@` … `^_`) and a caret as `^ `. Only `^J`, `^M` and `^I` were decoded and encoded. This decodes the whole range in a single pass (so `^^` is character 30, not a caret) and encodes every control character on write.

</details>

### 0117 — a rotated dimension with an empty AcDbRotatedDimension subclass reads as aligned

- **File:** `third_party/acad-ts-patches/0117-rotated-dimension-without-rotation.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** AutoCAD leaves out 50 when a rotated (linear) dimension is at 0°, so its `AcDbRotatedDimension` subclass marker is empty and is all that tells it from an aligned one. The reader made a `DimensionLinear` only on 50, so these read as `DimensionAligned`. Found by the M1-04 entity oracle (`DIMENSION 70`, roadmap M1-32) on 16 dimensions of the acadsharp samples, `dimension_in_nested_blocks.dxf` and `uncommon.dxf`.
- **Fix:** the `AcDbRotatedDimension` marker turns the dimension into a `DimensionLinear` (rotation 0) unless it already is one.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0117 a rotated DXF dimension whose AcDbRotatedDimension subclass is empty stays rotated"; `entities.corpus.test.ts` no longer lists the gap.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read rotated dimensions that omit their rotation

A rotated dimension at 0° is written without group 50, leaving the AcDbRotatedDimension subclass empty. The reader only switched to DimensionLinear on group 50, so these came back as aligned dimensions. The subclass marker now switches it.

</details>

### 0118 — DXF viewport status (68) and clip boundary (340) are skipped

- **File:** `third_party/acad-ts-patches/0118-dxf-viewport-status-and-clip-boundary.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** the VIEWPORT reader returned on 68 without reading it, so every viewport read as on and active (1) and a save wrote that, and it never read 340, so a non-rectangular viewport lost its clip entity on a DXF read (DWG reads both). Found by the M1-04 entity oracle (`VIEWPORT 68`, `VIEWPORT 340`, roadmap M1-32) on 56 and 4 viewports.
- **Fix:** 68 sets `activeStatus`, 340 sets the template's boundary handle, which the template already resolves.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0118 a DXF viewport keeps its status (68) and clip boundary (340)"; `entities.corpus.test.ts` no longer lists the gap.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read DXF viewport status and clip boundary

The DXF VIEWPORT reader skipped group 68 (off, or on with its stacking order) and never read group 340 (the clip boundary entity), although the writer writes both and the DWG reader reads them. This reads them.

</details>

### 0119 — an R12 viewport has no view

- **File:** `third_party/acad-ts-patches/0119-r12-viewport-mview-xdata.patch`
- **Touches:** `src/IO/Templates/CadViewportTemplate.ts`
- **Symptom:** R12 states a viewport's frame as groups (10, 40, 41, 68, 69) and its view, snap and grid in the ACAD xdata after `MVIEW` (DXF R12 reference, VIEWPORT). acad-ts never read that xdata into the viewport, so view centre, height, lens and the rest read as 0. Found by the M1-04 entity oracle (`VIEWPORT MVIEW 12/42/45`, roadmap M1-32) on `sample_AC1009_ascii.dxf`.
- **Fix:** for documents before R13, the template reads the MVIEW xdata into view target, direction, twist, height, centre, lens, front and back clip, snap angle, base and spacing, grid spacing, circle zoom and the status bits (view mode, UCS icon, fast zoom, snap, grid, isometric snap, isopair, hidden in plot), and sets the ViewportOff flag when 68 is 0, since R12 has no 90 flags to say so. The xdata itself is kept as read.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0119 an R12 viewport reads its view from the MVIEW xdata"; `entities.corpus.test.ts` no longer lists the gap.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read the R12 viewport view from its MVIEW xdata

R12 DXF files keep a viewport's view, snap and grid settings in the ACAD xdata after the MVIEW string rather than as groups. This reads them into the Viewport properties when the file is older than R13, leaving the xdata untouched so it is written back as read.

### 0120 — the DWG colour method None reads as true-colour black

- **File:** `third_party/acad-ts-patches/0120-dwg-colour-method-none.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgStreamReaderAC18.ts`, `src/IO/DWG/DwgStreamReaders/DwgMergedReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgStreamWriterAC18.ts`, `src/IO/DWG/DwgStreamWriters/DwgMergedStreamWriter.ts`
- **Symptom:** an R2004+ DWG colour (CMC, and the complex-colour long of an ENC) carries its AcCmEntityColor method in the high byte of the RGB long. The readers knew ByLayer (0xC0), the ACI methods (low bit set: 0xC1 ByBlock, 0xC3 ACI) and took everything else as an RGB colour, so None (0xC8) came back as true-colour black. Every AutoCAD drawing has some: the corpus DWGs state 21 to 76 each, in visual styles and in table and cell styles, where a None cell background means no fill (M1-36 had to read black as no fill, so a real black fill was lost). The writers wrote ACI 257, the ACI of None (`AcCmEntityColor::kACInone`), as method 0xC3 with index 257 & 0xFF, ACI 1 (red).
- **Fix:** the CMC readers (the stream reader and the merged reader's own copy) and the ENC complex-colour branch read method 0xC8 as `Color.byEntity`, ACI 257, which is what AutoCAD's DXF saves of the same drawings state (CELLSTYLE background 62 = 257) and what the DXF reader already returns. The CMC writers write ACI 257 as method 0xC8. True-colour black (0xC2000000) stays black.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0120 DWG AC1018/AC1021/AC1024/AC1032 keeps the colour method None (0xC8) apart from true-colour black" (the CMC and ENC bit streams, the CMC writer, and a DWG round trip of DIMTFILLCLR None and black in the header and a DIMSTYLE). `packages/io/test/map-table.test.ts` maps a None cell background as no fill and a black one as black.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file). The ENC branch has no corpus sample: no corpus entity colour uses method None, so it follows the CMC encoding.

<details><summary>Upstream PR text</summary>

**Title:** Read and write the DWG colour method None (0xC8)

R2004+ DWG colours store the AcCmEntityColor colour method in the high byte of the RGB value. `ReadCmColor` handled ByLayer (0xC0) and the indexed methods and read every other value as a true colour, so None (0xC8) became black (0,0,0). AutoCAD writes None for visual style colours and for the background of table and cell styles, where it means "no fill", so a real black fill could not be told apart from none. On write, ACI 257 (the ACI value AutoCAD uses for None, `kACInone`, and the value DXF stores) was written as method 0xC3 with index `257 & 0xFF`, i.e. red.

This reads method 0xC8 as `Color.ByEntity` (257) in `ReadCmColor` (stream and merged readers) and in the complex-colour branch of `ReadEnColor`, and writes 257 back as method 0xC8 in `WriteCmColor` and the merged writer. True black stays a true colour.

</details>

### 0121 — a TRACE reads as a SOLID

- **File:** `third_party/acad-ts-patches/0121-trace-kept-apart-from-solid.patch`
- **Touches:** `src/Entities/Solid.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`
- **Symptom:** the DXF and DWG readers made a `Solid` for a `TRACE`, and `Solid` always names itself SOLID, so a save turned every TRACE into a SOLID. No corpus file has a TRACE (the SOLIDs of the AutoCAD samples carry the `AcDbTrace` subclass marker, which is what AutoCAD writes for a SOLID). Listed by M1-32, fixed in M1-79.
- **Fix:** `Solid.isTrace` (false by default); when set, `objectName` is TRACE and `objectType` is `ObjectType.TRACE`, which both writers already use. The readers set it for TRACE.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0121 a TRACE reads and saves as a TRACE, not a SOLID".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep TRACE entities apart from SOLID

TRACE has the same data as SOLID, and both readers read it into a `Solid`, which always reports itself as SOLID, so a TRACE was saved as a SOLID. This adds `Solid.isTrace`; when it is set the entity names itself TRACE (`objectName`, `objectType`), and the DXF and DWG readers set it for TRACE.

</details>

### 0122 — DXF MULTILEADER and MLEADERSTYLE colours read as raw integers

- **File:** `third_party/acad-ts-patches/0122-dxf-mleader-colours.patch`
- **Touches:** `src/Color.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`, `src/IO/DXF/DxfStreamWriter/DxfStreamWriterBase.ts`
- **Symptom:** DXF states these colours as one 32-bit AcCmEntityColor value each (MULTILEADER 91/92/93, its context's 91/93, MLEADERSTYLE 91/93/94; high byte 0xC0 ByLayer, 0xC1 ByBlock, 0xC2 RGB, 0xC3 ACI, 0xC8 None). The reader assigned the raw integer to the `Color` property, so a DXF→DWG save could not write it, and the MLEADERSTYLE writer, given a number, wrote ByBlock. The context text colour (90) was decoded, but 0xC3 (ACI) read as RGB. Both writers wrote an ACI colour as 0xC1 + index and ByLayer as ByBlock. Every corpus value is 0xC0, 0xC1 or 0xC2 (`sample_AC1015_ascii.dxf` and `sample_AC1018_ascii.dxf` have an RGB 200,200,200 text background). Listed by M1-32, fixed in M1-79.
- **Fix:** `Color.fromCmValue` / `Color.toCmValue` decode and encode the value (0xC1 and the methods that carry no colour keep the low byte as an index, as `DwgStreamReaderAC18.readCmColor` does); the readers decode those groups and both writers encode with it.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0122 DXF MULTILEADER and MLEADERSTYLE colours read as colours and save back".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write MULTILEADER and MLEADERSTYLE colours as AcCmEntityColor values

These DXF groups hold a 32-bit AcCmEntityColor (high byte 0xC0 ByLayer, 0xC1 ByBlock, 0xC2 RGB, 0xC3 ACI, 0xC8 None), but the reader assigned the raw integer to `Color` properties, which the DWG writer then cannot write. This adds `Color.fromCmValue`/`toCmValue`, decodes MULTILEADER 91/92/93, its context's 90/91/93 and MLEADERSTYLE 91/93/94 with it, and writes ACI as 0xC3 and ByLayer as 0xC0 (they were written as 0xC1, ByBlock).

</details>

### 0123 — DXF IMAGE and WIPEOUT lose their clip boundary type (71)

- **File:** `third_party/acad-ts-patches/0123-dxf-image-clip-type.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** the reader skipped group 71 (1 rectangular, 2 polygonal), so every DXF image and wipeout read as rectangular, and a save wrote 71 = 1 with the polygon's vertices. Corpus: `wipeout_door.dxf` (2), `images.dxf` (1), `viewports.dxf` (2) and the acadsharp R2000/R2004 wipeouts. Listed by M1-32, fixed in M1-79.
- **Fix:** 71 sets `clipType`. The DWG reader already read it.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0123 a DXF IMAGE or WIPEOUT keeps its clip boundary type (71)".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read the DXF image clip boundary type

The DXF reader skipped group 71 of IMAGE and WIPEOUT, so a polygonal clip read as rectangular and was saved back as one. This reads it into `clipType`, as the DWG reader does.

</details>

### 0124 — R14 and R2000 DWG tables read as unknown objects

- **File:** `third_party/acad-ts-patches/0124-dwg-r14-r2000-tables.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`
- **Symptom:** the DWG reader read `ACAD_TABLE` only from R2004 on and left an R14 or R2000 one as an unknown entity, so the two tables of `sample_AC1014.dwg` and `sample_AC1015.dwg` were not mapped. AutoCAD saves them there as a custom class object with the R2004 layout. Listed by M1-32, fixed in M1-79.
- **Fix:** read `ACAD_TABLE` in every version. The R14 and R2000 tables map exactly like the same drawing's R2000 DXF save, and the writer already wrote that layout.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0124 R14 and R2000 DWGs read their ACAD_TABLEs and save them back"; `entities.corpus.test.ts` → "maps the tables of a DWG like those of the same drawing saved as DXF" now includes AC1014 and AC1015.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read ACAD_TABLE from R14 and R2000 DWG files

Tables in R14 and R2000 DWG files are custom class objects with the R2004 layout, but the reader only read them from R2004 on and kept older ones as unknown entities. Reading them in every version gives the same table as the drawing's R2004 save (checked on the ACadSharp R14/R2000/R2004 samples).

</details>

### 0125 — DWG strings before R2007 keep their \U+ escapes

- **File:** `third_party/acad-ts-patches/0125-dwg-unicode-escapes.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgStreamReaderBase.ts`, `src/IO/DWG/DwgStreamWriters/DwgStreamWriterBase.ts`
- **Symptom:** before R2007, DWG strings are in the drawing's code page and AutoCAD writes a character outside it as `\U+XXXX`, as in DXF. 0072 decodes them in DXF; the DWG reader kept them as text (`sample_AC1014/1015/1018.dwg` MTEXT `\U+220545,6` and `94\U+00B0`, which their DXF save reads as `∅45,6` and `94°`), and the writer turned a character outside the code page into "?". Listed by M1-32, fixed in M1-79.
- **Fix:** `readVariableText` decodes with `decodeDxfUnicode` and `writeVariableText` escapes with `escapeDxfUnicode`; R2007+ (`DwgStreamReaderAC21`, `DwgStreamWriterAC21`) reads and writes UTF-16 through its own overrides.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0125 a DWG before R2007 decodes its \U+ escapes and writes them back".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Decode and encode \U+ escapes in pre-R2007 DWG strings

Before R2007 a DWG string is in the drawing's code page and AutoCAD stores a character outside it as \U+XXXX, exactly as in DXF. The DWG reader kept the escape as text and the writer replaced such characters with "?". This applies the DXF reader's decoding and the DXF writer's escaping to the pre-R2007 variable text.

### 0126 — the table-wide overrides of an ACAD_TABLE are read and dropped

- **File:** `third_party/acad-ts-patches/0126-table-wide-overrides.patch`
- **Touches:** `src/Entities/TableEntity.ts`, `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/Templates/CadTableEntityTemplate.ts`, `src/index.ts`
- **Symptom:** a table can override its table style for the whole table: title suppression, flow direction, the horizontal and vertical cell margins, and per row type (title, header, data) the content colour, fill, alignment, text style and text height (flag word 93 and the values after it). The R2004/R2007 DWG reader read every one of them and threw them away, and the DXF reader kept them only as raw codes for the writer (0066, DEC-043), so no caller could see them, and the DWG writer wrote "no overrides", so a DWG save dropped them. Sample table 528 (acadsharp `sample_AC10xx`) overrides both margins and the three text heights.
- **Fix:** a `TableStyleOverrides` model (`flags`, `suppressTitle`, `suppressHeader`, `flowDirection`, the two margins, and a `TableRowTypeOverrides` per row type) on `TableEntity.tableOverrides`, null when the table states none. The DWG reader fills it as it reads; the DXF reader fills it from the kept codes when they end, and still writes them back as read. DXF writes the values with the codes the ODA specification gives (280, 281, 70, 40, 41, then per row type 64, 283, 63, 170, 7, 140) and repeats a per-row-type code in AcDb::RowType order (data, title, header), where DWG and the flag bits go title, header, data: the DWG and DXF saves of table 528 state its title height (0.1425) first and second. Text styles resolve on build (DWG handle, DXF name). The R2004/R2007 DWG writer writes the model back as the reader reads it, so a DWG save keeps them (a DXF-read table saved to DWG too). The border overrides (94–96) are still read and dropped: no corpus file states one, so their DXF layout cannot be checked (Triya task M1-81).
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0126 DXF and DWG up to R2007 keep the table-wide overrides through a DWG save" (table 528 in the six DXF and the R2004/R2007 DWG saves, through DXF and DWG saves, and every 93 property in an edited DXF, read and through a DWG save); the corpus round trip of `sample_AC1018.dwg` and `sample_AC1021.dwg` stays clean only with the writer change.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file). Only the margins and text heights have a corpus sample; the other properties follow the ODA specification.

<details><summary>Upstream PR text</summary>

**Title:** Keep the table-wide style overrides of ACAD_TABLE

`DwgObjectReader` reads the R2004/R2007 table overrides (flag word, title suppression, flow direction, cell margins and the per-row-type colours, fills, alignments, text styles and heights) and discards every value, and the DXF reader does not read group 93 and the values after it at all; `DwgObjectWriter` writes "no overrides". This adds `TableStyleOverrides` / `TableRowTypeOverrides` on `TableEntity.tableOverrides` and fills it from both readers, and writes it back to R2004/R2007 DWG. In DXF a per-row-type value repeats for each row type whose bit is set, in `AcDb::RowType` order (data, title, header), which differs from the bit order (title, header, data) DWG uses; AutoCAD's DWG and DXF saves of the same table show it. The DXF writer is unchanged.

</details>

### 0127 — DXF POLYLINE drops the fit type of spline-fit polylines (75)

- **File:** `third_party/acad-ts-patches/0127-dxf-polyline-fit-type.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** the writer wrote group 75 (curves and smooth surface type) for polygon meshes only. A spline-fit 2D or 3D POLYLINE (70 bit 4) states its fit type there too (5 quadratic, 6 cubic, 8 Bezier), so a quadratic or Bezier fit saved to DXF read back as the default cubic. The DXF and DWG readers both keep it. No corpus file has a spline-fit polyline, so the round trip could not see it; found by M1-75 part 1, fixed in M1-80.
- **Fix:** write 75 for every other POLYLINE whose `smoothSurface` is not `NoSmooth`. It is optional with default 0 (DXF reference, POLYLINE), so polylines without a smooth type are written as before.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0127 DXF writes POLYLINE 75 for spline-fit 2D and 3D polylines, not only for meshes"; `packages/io/test/export.test.ts` → "keeps a … spline fit through a DXF save".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the DXF POLYLINE smooth surface type (75) for spline-fit polylines

Group 75 is the curve and smooth surface type of any POLYLINE, not only of polygon meshes: a spline-fit 2D or 3D polyline stores its fit type there (5 quadratic, 6 cubic, 8 Bezier). The DXF writer wrote it for `PolygonMesh` only, so a quadratic or Bezier spline-fit polyline saved to DXF read back with `smoothSurface` 0, which AutoCAD treats as cubic. This writes 75 for 2D and 3D polylines when `smoothSurface` is set, and leaves the output unchanged otherwise.

### 0128 — DXF DIMENSION loses its line spacing factor (41) and oblique angle (52)

- **File:** `third_party/acad-ts-patches/0128-dxf-dimension-line-spacing-oblique.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`, `src/IO/Templates/CadDimensionTemplate.ts`
- **Symptom:** the DXF reader skipped group 41 of every dimension (it only took it, after `AcDbArcDimension`, as an ARC_DIMENSION's end angle), so the text line spacing factor read back as 0, though the writer writes it. The writer left out 52, the extension lines' oblique angle of an aligned or rotated dimension, so an obliqued dimension saved to DXF read back straight. The reader took 52 through the class map as radians, where DXF states it in degrees like every other angle (ezdxf converts it with `math.radians`), and only after `AcDbAlignedDimension`, where ezdxf writes it in `AcDbDimension`. The DWG reader and writer keep both. Found by Triya M1-75 part 3; the round trip compares acad-ts with itself, so it could not see the losses.
- **Fix:** 41 outside `AcDbArcDimension` sets `lineSpacingFactor`. 52 is read in degrees wherever it comes; read before the subclass marker that makes the dimension aligned or rotated, the template keeps it and hands it to the dimension `setDimensionObject` creates. The writer states 52 in `AcDbAlignedDimension`, in degrees, when the angle is not 0, as the DXF reference describes it ("Linear dimension types with an oblique angle have an optional group code 52") and AutoCAD leaves it out of every corpus dimension.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0128 a DXF DIMENSION keeps its line spacing factor (41) and oblique angle (52)"; `packages/io/test/export-annotations.test.ts` → "writes the line spacing factor and the oblique angle, through a DXF save (M1-82)".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file). No corpus drawing states either code, so the placement of 52 follows the DXF reference; the reader accepts ezdxf's placement too.

<details><summary>Upstream PR text</summary>

**Title:** Read DIMENSION 41 and read and write 52 in degrees

`DxfSectionReaderBase._readDimension` ignored group 41 unless it followed `AcDbArcDimension` (the arc's end angle), so every dimension's text line spacing factor read back as 0. `DxfSectionWriterBase` never wrote 52, the extension line oblique angle of aligned and rotated dimensions, and the reader assigned 52 in radians although DXF angles are in degrees. This reads 41 as the line spacing factor outside `AcDbArcDimension`, reads 52 in degrees (also when it comes in `AcDbDimension`, before the aligned or rotated subclass marker, as ezdxf writes it), and writes 52 in degrees after the extension line points when it is not 0.

</details>

### 0129 — DXF PDFUNDERLAY loses its normal (210) and clip boundary (11/21)

- **File:** `third_party/acad-ts-patches/0129-dxf-underlay-normal-clip.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** the DXF writer wrote an underlay's 340, 10, 41–43, 50 and 280–282 only, so an underlay on −Z or with a clip boundary saved to DXF read back on +Z and unclipped; the DXF reader did not read the clip vertices (11/21) either. The DWG reader and writer keep both. No corpus underlay has a normal or clip, so the round trip could not see it; found by Triya M1-75 part 4, fixed in M1-83.
- **Fix:** the writer states 210 after the rotation when the normal is not +Z (AutoCAD leaves it out of every corpus underlay) and the clip boundary as repeated 11/21 pairs after the fade, with no count, as the DXF reference (UNDERLAY) lists them; the reader collects those pairs. "Clip is inside mode" (inverted clip) is bit 16 of the 280 flags, which both already keep. The 91 count and 290 of the IMAGE clip are not UNDERLAY codes.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0129 a DXF PDFUNDERLAY keeps its normal (210) and clip boundary (11/21)"; `packages/io/test/export-fills.test.ts` → "writes an underlay’s normal and clip boundary to DWG and DXF (M1-83)".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write and read the DXF underlay normal and clip boundary

`DxfSectionWriterBase._writePdfUnderlay` wrote no normal (210) and no clip boundary, and `DxfSectionReaderBase._readUnderlayEntity` ignored the clip vertices, so a PDF underlay on a −Z plane or with a clip lost both through a DXF save, although the DWG reader and writer keep them. This writes 210 after the rotation when the normal is not (0, 0, 1), and each clip vertex as an 11/21 pair after the fade (DXF reference, UNDERLAY: two points are the corners of a clip rectangle, more are a polygon), and reads the pairs back into `clipBoundaryVertices`.

</details>

### 0130 — DXF MULTILEADER loses its arrowhead (342), content block (344, context 341) and leader line indexes (91)

- **File:** `third_party/acad-ts-patches/0130-dxf-multileader-blocks-line-index.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** the DXF reader skipped four groups the DXF writer writes: the multileader's arrowhead block (342) and content block (344) in `AcDbMLeader`, the content block in the context data (341) and each `LEADER_LINE{`'s index (91). A block multileader saved to DXF read back with no block and the default arrowhead, and every leader line as index 0. The templates already had the handle fields (`arrowheadHandle`, `blockContentHandle`, `blockRecordHandle`), filled only by the DWG reader. Found by Triya M1-75 part 5, fixed in M1-84; every corpus multileader is mtext with the default arrowhead and one line, so the round trip could not see it.
- **Fix:** read 342 and 344 into the multileader template's handles, context 341 into the context template's block record handle (entity 341 stays the leader linetype), and LEADER_LINE 91 into `LeaderLine.index`.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0130 a DXF MULTILEADER keeps its arrowhead (342), content block (344, context 341) and line indexes (91)"; `packages/io/test/export-mleader-viewport.test.ts` → "writes a block MULTILEADER’s arrowhead block, content block and second leader line to dxf so it maps back".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read the DXF multileader arrowhead, content block and leader line index

`DxfSectionReaderBase._readMLeader` ignored 342 (arrowhead block) and 344 (block content), `_readMultiLeaderObjectContextData` ignored 341 (block content in the context data) and `_readMultiLeaderLine` ignored 91 (the leader line index), although `DxfSectionWriterBase` writes all four and the DWG reader keeps them. A block multileader saved to DXF read back without its block and with the default arrowhead, and every leader line with index 0. This reads the three handles into the existing `CadMLeaderTemplate.arrowheadHandle` / `blockContentHandle` and `CadMLeaderAnnotContextTemplate.blockRecordHandle`, which the templates already resolve, and 91 into `LeaderLine.index`.

</details>

### 0131 — DWG VIEWPORT loses its style sheet (DXF 1) and visual style (348)

- **File:** `third_party/acad-ts-patches/0131-dwg-viewport-style-sheet-visual-style.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`, `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** the DWG writer wrote a viewport's plot style sheet name as an empty string and its visual style handle as null, so every DWG save of a viewport with a plot style table or a visual style dropped them. The DWG reader read the R2007+ visual style handle and threw it away, so 33 of the 51 viewports in the public corpus DWGs lost their visual style on read, which the round trip (acad-ts against itself) could not see. Found by Triya M1-75 part 5, fixed in M1-85.
- **Fix:** the writer writes `styleSheetName` (R2000+) and the visual style as a hard pointer (R2007+), where the ODA specification (VIEWPORT, 348) places them; the reader keeps the visual style handle for the template to resolve, as the DXF reader already does for 348. The background (332) and shade plot (333) handles beside it stay null: `Viewport` has no field for either and the DXF reader drops them too. With DWG visual styles now read, the DXF writer names a visual style in 348 only when it writes that object, that is one read from DXF and kept as its raw codes; one read from DWG has no DXF writer, so naming it would leave a handle to an object the file does not have.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0131 a DWG VIEWPORT keeps its style sheet (DXF 1) and visual style (348)"; `packages/io/test/export-mleader-viewport.test.ts` → "writes a VIEWPORT’s style sheet to dwg so it maps back" and "writes a viewport’s visual style to DWG so it maps back (M1-85)".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write the DWG viewport style sheet and visual style, and keep the visual style on read

`DwgObjectWriter._writeViewport` wrote an empty style sheet name and a null visual style handle, and `DwgObjectReader._readViewport` discarded the R2007+ visual style handle it read, so a viewport's plot style table and visual style did not survive a DWG save, and the visual style did not survive a DWG read. This writes `styleSheetName` and `visualStyle` (hard pointer, R2007+) and assigns the read handle to `CadViewportTemplate.visualStyleHandle`, which the template already resolves for DXF. Since a visual style read from DWG has no DXF object writer, `DxfSectionWriterBase._writeViewport` now writes 348 only for a visual style that carries its DXF raw codes, so a DWG-to-DXF conversion does not reference an object it leaves out.

</details>

### 0132 — DWG header DIMLDRBLK, DIMLTYPE, DIMLTEX1/2, DIMMZF and REALWORLDSCALE; DXF `$DIMTFILLCLR`

- **File:** `third_party/acad-ts-patches/0132-dwg-header-dimension-linetypes-leader-block-mzf.patch`
- **Touches:** `src/IO/DWG/DwgHeaderHandlesCollection.ts`, `src/IO/DWG/DwgStreamReaders/DwgHeaderReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgHeaderWriter.ts`, `src/Metadata/LookupTables/Core.ts`
- **Symptom:** the DWG header writer wrote DIMLDRBLK (R2000+) and DIMLTYPE, DIMLTEX1, DIMLTEX2 (R2007+) as null handles, and the reader resolved DIMLDRBLK into `dimensionBlockName` (overwriting DIMBLK) and never resolved the three linetype handles, so every DWG read reported ByBlock where the corpus DXF saves of the same drawings state BATTING, TRACKS and ZIGZAG. In the R2010+ block after DIMALTMZF/DIMALTMZS, where the ODA specification puts DIMMZF, the reader read and the writer wrote `dimensionFit` (the R2010+ corpus DWGs hold 100 there, DIMMZF's default, beside DIMALTMZF's 100; DIMFIT runs 0–5). The R2007+ bit before INTERFERECOLOR, REALWORLDSCALE, was skipped on read and written as 0. The DXF writer skipped `$DIMTFILLCLR`, marked Ignored in the header metadata, although AutoCAD writes it (62) and the reader reads it. Found by Triya M1-75 part 6, fixed in M1-87.
- **Fix:** the writer writes DIMLDRBLK from `arrowBlockName` by block record (as DIMBLK), DIMLTYPE/DIMLTEX1/DIMLTEX2 by linetype record (null when the document has no such linetype, which AutoCAD reads as ByBlock), `dimensionMzf` in the DIMMZF slot and `realWorldScale` in its bit; the reader reads the same fields into the same properties and resolves DIMLDRBLK into `arrowBlockName`. `$DIMTFILLCLR` loses its Ignored flag.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0132 a DWG header keeps DIMLDRBLK, DIMLTYPE, DIMLTEX1/2, DIMMZF and REALWORLDSCALE; DXF keeps DIMTFILLCLR"; `packages/testkit/src/export/export-header.corpus.test.ts` (every corpus DWG and DXF version that stores them maps a change back).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write the DWG header DIMLDRBLK, DIMLTYPE, DIMLTEX1/2, DIMMZF and REALWORLDSCALE, and the DXF $DIMTFILLCLR

`DwgHeaderWriter` wrote null handles for DIMLDRBLK and the R2007+ DIMLTYPE, DIMLTEX1 and DIMLTEX2, and `DwgHeaderHandlesCollection.updateHeader` assigned the DIMLDRBLK block record's name to `DimensionBlockName` (DIMBLK) and ignored the three linetype handles, so a DWG read reports ByBlock for linetypes the same drawing's DXF save names. In the R2010+ dimension block, the double after DIMALTMZS is DIMMZF (ODA specification, header section), but the reader and writer used `DimensionFit`; AutoCAD drawings hold 100 there, DIMMZF's default. The R2007+ bit before INTERFERECOLOR is REALWORLDSCALE and was skipped and written as 0. This writes and reads all of them into the existing header properties (`ArrowBlockName`, `DimensionLineType`, `DimensionTex1/2`, `DimensionMzf`, `RealWorldScale`). It also drops the Ignored flag from `$DIMTFILLCLR`, which AutoCAD writes to DXF (group 62) and the DXF reader already reads.

</details>

### 0133 — DXF writer writes VISUALSTYLE objects from their fields

- **File:** `third_party/acad-ts-patches/0133-dxf-visualstyle-field-writer.patch`
- **Touches:** `src/IO/DWG/DwgVisualStyle.ts`, `src/IO/DXF/DxfStreamWriter/DxfVisualStyle.ts` (new), `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** the DXF writer wrote a VISUALSTYLE only as the group codes it read from DXF (0021) and skipped any other with "Object not implemented", so a DWG saved as DXF lost all 24 visual styles, their `ACAD_VISUALSTYLE` entries and extension dictionaries, and since 0131 every viewport naming one lost its 348. Found by Triya M1-85, fixed in M1-88.
- **Fix:** `writeDxfVisualStyle` writes the AcDbVisualStyle subclass from the fields the DWG reader fills, in the layout AutoCAD writes for the version: one code per value up to R2007 (R2000/R2004 DXF too), each value followed by its operation (176) in R2010, and in R2013+ a counted list of all 58 values under their type's code (90, 40, 290, 62/420, 1), each with its operation. True colours follow their ACI at code + 358 in R2007/R2010 (421–425), 420 in R2013+. AutoCAD writes two values the DWG record does not hold: 62 = 5 before the R2007-layout mono colour, and 177 = 2 (R2010) or 3 (R2013+); both are written as constants. A style read from DXF is still written back as read. The viewport writer writes 348 for any visual style.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0133 DXF writer writes a DWG's VISUALSTYLEs as AutoCAD's DXF save of the drawing" (the R2007, R2010, R2013 and R2018 sample DWGs saved as ASCII and binary DXF write every code of all 24 styles as AutoCAD's DXF save of the same drawing does, except 360 handles and Realistic's R2007 face lighting quality, which AutoCAD stored as 2 in the DWG and wrote as 3 in the DXF; dictionary entries and viewport 348 kept); `packages/io/test/acad-ts-patches.test.ts` → "0133 the DXF writer writes a VISUALSTYLE from its fields in the layout of each version" (edge true colours 422–425).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write VISUALSTYLE objects to DXF from their fields

`DxfObjectsSectionWriter` has no VISUALSTYLE writer, so a DWG saved as DXF drops every visual style, their dictionary entries and the viewports' 348 references. This adds a writer for the AcDbVisualStyle subclass from the fields the DWG reader fills, in the three layouts AutoCAD uses: R2007 (also used for R2000/R2004 DXF), R2010 (an operation code 176 after each value) and R2013+ (a count of 58 values in 70, each value under its type's code with its operation). Checked code for code against AutoCAD's own DXF saves of the R2007, R2010, R2013 and R2018 sample drawings, whose DWGs hold the same styles. Two values AutoCAD writes have no DWG field and are written as the constants AutoCAD uses: 62 = 5 before the R2007 mono colour, and 177 = 2 (R2010) or 3 (R2013+).

</details>

### 0134 — an R12 DXF keeps its paper space (67 = 1)

- **File:** `third_party/acad-ts-patches/0134-r12-paper-space.patch`
- **Touches:** `src/IO/Templates/CadEntityTemplate.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DXF/DxfStreamReader/DxfEntitiesSectionReader.ts`, `src/IO/DXF/DxfDocumentBuilder.ts`, `src/IO/DXF/DxfReader.ts`
- **Symptom:** the DXF reader skipped group 67 and put every entity that states no owner (330) into `*Model_Space`. R12 states no owners, so an R12 drawing's paper-space entities (the R12 sample's two viewports) read into model space, which has no layout there, and the writer, which writes 67 from the owner's layout, wrote them back without it: an R12 save moved paper space into model space. The round-trip diff compares acad-ts with itself and could not see it. Found by Triya M1-86, fixed in M1-89.
- **Fix:** the reader keeps 67 = 1 on the entity template (`isPaperSpace`), and an entity with no owner that states it goes to `*Paper_Space` (a record is made up, like the model space one, when the file has no `$PAPER_SPACE` block). An R12 read then gives `*Paper_Space` the Layout1 AutoCAD opens it as (tab 1, limits, extents, insertion base and elevation from `$PLIM*`, `$PEXT*`, `$PINSBASE`, `$PELEVATION`, PSLTSCALE and LIMCHECK flags from `$PSLTSCALE`/`$PLIMCHECK`), made up like the other R12 defaults, so an R12 save leaves it out; the writer then writes 67 = 1 for the record's BLOCK, ENDBLK and entities as it does for any paper-space layout.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0134 an R12 DXF keeps its paper space (67 = 1) through a save" (the ASCII and binary R12 samples read both viewports into `*Paper_Space` with Layout1; an ASCII R12 save states 67 = 1 on the same BLOCK, ENDBLK and two VIEWPORTs as the original); `packages/io/test/acad-ts-patches.test.ts` → "0134 an R12 entity that states 67 = 1 reads into paper space, which saves back" (a file with no BLOCKS section).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read DXF group 67 into paper space for entities with no owner handle

`DxfSectionReaderBase.readCommonEntityCodes` ignores group 67, and `DxfEntitiesSectionReader` adds every entity without an owner handle (330) to model space. R12 DXF files never state 330, so their paper-space entities (67 = 1), including every viewport, are read into model space and written back there. This keeps 67 on the entity template and adds such entities to the paper space block record, making one up when the file has no `$PAPER_SPACE` block. Since R12 has no LAYOUT objects, the reader also gives an R12 paper space the Layout1 layout AutoCAD opens it as, from the header's paper-space limits, extents, insertion base and elevation and its PSLTSCALE/PLIMCHECK flags, so the writer states 67 = 1 again on save.

</details>

### 0135 — an R12 viewport reads and saves its frozen layers in the MVIEW xdata

- **File:** `third_party/acad-ts-patches/0135-r12-viewport-frozen-layers.patch`
- **Touches:** `src/IO/Templates/CadViewportTemplate.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** R12 names a viewport's frozen layers as 1003 strings in the group nested at the end of its ACAD MVIEW xdata (DXF R12 reference, VIEWPORT); it has no 331 handles. Patch 0119 read the view from that xdata but stopped at the nested group, so every R12 viewport read with no frozen layers. The R12 DXF writer wrote `frozenLayers` as 331 handles, which R12 does not have, naming handles made up on read that an R12 save leaves out. Found by Triya M1-86, fixed in M1-90.
- **Fix:** `_readR12View` adds the layer of each 1003 record in the nested group (the reader has already resolved the name to its layer's handle) to the template's frozen-layer handles, which `build` resolves with the 331s; the DXF writer writes 331 only after R12. The xdata is still written back as read.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0135 an R12 viewport reads its frozen layers from the MVIEW xdata and saves them there" (two layers named in viewport 267 of the R12 sample read into `frozenLayers`; ASCII and binary R12 saves keep the names and write no 331, and read back the same).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read an R12 viewport's frozen layers from its MVIEW xdata, and write no 331 to R12

An R12 VIEWPORT has no 331 groups: its frozen layers are the 1003 layer names in the group nested at the end of its ACAD xdata after the string MVIEW (DXF R12 reference, VIEWPORT). This reads them into `Viewport.frozenLayers` alongside the view settings in that xdata, and stops the DXF writer from writing 331 handles for R12, where they are not part of the format and name handles that an R12 file usually does not state. The xdata itself is still written back as read, so a save keeps the names.

</details>

### 0136 — DXF reader reads VISUALSTYLE objects into their fields

- **File:** `third_party/acad-ts-patches/0136-dxf-visualstyle-field-reader.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfVisualStyle.ts` (exports the R2007/R2010 code table), `src/Objects/VisualStyle.ts` (doc comment)
- **Symptom:** `_readVisualStyle` returned true for every code and assigned nothing, so a VISUALSTYLE read from DXF kept only its group codes (0021, for a DXF save) and every field stayed at the class default. The DWG writer writes the fields, so a DXF saved as DWG wrote all 24 visual styles with the defaults (no lighting, no edges, no colours), and the style's extended data was swallowed. Found by Triya M1-88, fixed in M1-91.
- **Fix:** the reader reads the AcDbVisualStyle subclass into the fields the DWG reader fills, as the inverse of 0133's writer: 2 the description, the first 70 the type, 291 the internal flag; in the R2007 layout (also R2000/R2004 DXF) each value by its code, 174 the edge style apply flag and 45 the value DWG R2007 stores after the internal flag, skipping the constant 62 = 5; in R2010 the same codes, each followed by its operation (176); in R2013+ (177, 291, then 70 = 58) the 28 values and 30 extended properties by position under their types' codes (90, 40, 290, 62, 1), each with its operation. A true colour (421–425 in R2007/R2010, 420 in R2013+) replaces the index colour before it. Extended data (1001) goes to the common reader. The codes are still kept for a DXF save (0021).
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0136 DXF reader reads VISUALSTYLEs into the fields the same drawing's DWG holds" (every field, operation, extended property and extended data of all 24 styles in the R2007, R2010, R2013 and R2018 acadsharp ASCII and binary DXFs equal the same drawing's DWG read, except Realistic's R2007 face lighting quality, 3 in the DXF and 2 in the DWG, see 0133), "0136 DXF reader reads an R2000/R2004 DXF VISUALSTYLE (R2007 layout) as the R2007 DWG holds it" (R2000 DXF has no true colours: there a colour reads as the index AutoCAD wrote for the DWG's true colour), and "0136 a DXF saved as DWG keeps its VISUALSTYLEs" (an R2007, R2010 and R2018 DXF saved as DWG read back with the same fields); `packages/io/test/acad-ts-patches.test.ts` → "0136 the DXF reader reads a VISUALSTYLE into its fields in the layout of each version" (every field off its default, all five colours as true colours, operations and extended properties).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read VISUALSTYLE objects from DXF into their fields

`DxfObjectsSectionReader._readVisualStyle` consumes every group code without assigning anything, so a visual style read from DXF has default values everywhere and a DXF saved as DWG writes all of them as defaults. This reads the AcDbVisualStyle subclass into the same fields the DWG reader fills, in the three layouts AutoCAD writes: R2007 (also used in R2000/R2004 DXF; one code per value, with a constant 62 = 5 before the mono colour), R2010 (an operation code 176 after each value) and R2013+ (177, 291, a count of 58 in 70, then each value under its type's code — 90, 40, 290, 62, 1 — with its operation). True colours follow their index colour at code + 358 (R2007/R2010) or 420 (R2013+). Checked field by field against the DWG reads of the same drawings (the R2007, R2010, R2013 and R2018 samples, which share handles with their DXF saves). Extended data on the object is now read too.

</details>

### 0137 — the DXF writer writes DIMARCSYM 1 (above the text)

- **File:** `third_party/acad-ts-patches/0137-dxf-dimstyle-dimarcsym-default.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`
- **Symptom:** `_writeDimensionStyle` left DIMARCSYM (90) out when it was 1 (above the dimension text), taking that for the default, and wrote it when it was 0. AutoCAD's default, and what a reader assumes when 90 is absent (the class default too), is 0 (before the text), so a style with the symbol above the text read back with it before. Found by Triya M1-75 part 9, fixed in M1-92.
- **Fix:** 90 is left out only when DIMARCSYM is 0, as AutoCAD writes it.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0137 the DXF writer writes DIMARCSYM 1 (above the text), leaving out only 0" (0, 1 and 2 round trip through ASCII and binary DXF; ASCII states 90 only for 1 and 2).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write DIMARCSYM 1 to DXF and leave out 0, its default

`DxfTablesSectionWriter._writeDimensionStyle` skipped group 90 (DIMARCSYM) when the value was `AboveDimensionText` (1). The AutoCAD default is 0 (`BeforeDimensionText`, also the `DimensionStyle` default), so the value a reader assumes for an absent 90 is 0: a style with the arc symbol above the text came back with it before the text, and every default style carried a redundant `90 0`. The writer now leaves 90 out only for 0.

</details>

### 0138 — DXF DIMTXTDIRECTION is group 294

- **File:** `third_party/acad-ts-patches/0138-dxf-dimstyle-dimtxtdirection-294.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfTablesSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`, `src/Metadata/LookupTables/Tables.ts`
- **Symptom:** The DXF writer never wrote DIMTXTDIRECTION, so a right-to-left style read back left to right, and the metadata table mapped `textDirection` to group 295, while the DXF reference's DIMSTYLE gives it as 294. Found by Triya M1-75 part 9, fixed in M1-92.
- **Fix:** The reader reads 294 (non-zero = right to left); the R2010+ writer writes 294 = 1 after 290 when the text runs right to left and leaves out the default; the metadata entry is 294.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0138 DXF DIMTXTDIRECTION is group 294, as the DXF reference gives it" (right to left round trips through R2010 ASCII and binary DXF, written as 294 = 1; the default is left out; a record that states 294 = 1 reads right to left).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write DIMSTYLE DIMTXTDIRECTION as DXF group 294

The DXF reference lists DIMTXTDIRECTION as group 294 of the DIMSTYLE record, but the metadata table maps `DimensionStyle.textDirection` to 295 and the DXF writer never writes it, so a right-to-left dimension style saved as DXF reads back left to right. This reads 294 explicitly, corrects the metadata code, and writes `294 1` for R2010+ when the direction is right to left (AutoCAD leaves the default out).

</details>

### 0139 — the DXF writer writes DIMTFILLCLR whatever DIMTFILL is

- **File:** `third_party/acad-ts-patches/0139-dxf-dimstyle-dimtfillclr-without-fill.patch`
- **Touches:** `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`
- **Symptom:** `_writeDimensionStyle` wrote the DIMTFILLCLR colour (the record's second 70) only when DIMTFILL was not 0, and 70 = 0 otherwise, so a style with a fill colour but no fill read back ByBlock. The DWG record keeps the colour whatever the fill mode. Found by Triya M1-75 part 9, fixed in M1-92.
- **Fix:** 69 is still left out when DIMTFILL is 0; the second 70 always holds DIMTFILLCLR's colour number.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0139 the DXF writer writes DIMTFILLCLR whatever DIMTFILL is" (colour 5 with fill modes 0, 1 and 2 through ASCII and binary DXF).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write DIMTFILLCLR to DXF when DIMTFILL is 0

The DIMSTYLE writer writes the text fill colour (DIMTFILLCLR, the second group 70) only when DIMTFILL (69) is not 0, and `70 0` otherwise, so a style that has a fill colour set but the fill turned off loses the colour on a DXF save, although DWG keeps it. This always writes the colour number; 69 is still omitted at its default.

</details>

### 0140 — DXF DIMUNIT (270) reads into DIMUNIT and R13/R14 saves write it

- **File:** `third_party/acad-ts-patches/0140-dxf-dimstyle-dimunit.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfTablesSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfTablesSectionWriter.ts`
- **Symptom:** The DXF reader read DIMUNIT (270, R13/R14) into `linearUnitFormat` (DIMLUNIT, 277), so `dimensionUnit` kept its default and a file stating 277 before 270 had its DIMLUNIT overwritten; the DWG reader keeps DIMUNIT in `dimensionUnit`. The writer never wrote 270, so an R13/R14 DXF save lost DIMUNIT. Found by Triya M1-75 part 9, fixed in M1-92.
- **Fix:** 270 reads into `dimensionUnit`; the writer writes it for R13 and R14 (R12 has no DIMUNIT; R2000 replaced it by DIMLUNIT and DIMFRAC and its DWG record has none).
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0140 DXF DIMUNIT (270) reads into DIMUNIT, not DIMLUNIT, and R13/R14 saves write it" (DIMUNIT 4 beside DIMLUNIT 2 round trips through R13 and R14 DXF; R12, R2000 and R2018 write no 270; an R14 record with 277 before 270 keeps both).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read DIMSTYLE group 270 as DIMUNIT and write it to R13/R14 DXF

Group 270 of a DIMSTYLE record is DIMUNIT, the R13/R14 unit format that R2000 replaced by DIMLUNIT (277) and DIMFRAC. The DXF reader assigned it to `linearUnitFormat` (DIMLUNIT), so `dimensionUnit` stayed at its default and a 277 before it was overwritten, unlike the DWG reader, which reads DIMUNIT into `dimensionUnit`. The writer never wrote 270. This reads 270 into `dimensionUnit` and writes it for AC1012/AC1014.

</details>

### 0141 — an R2000+ DWG DIMSTYLE reads and writes DIMATFIT in its own place

- **File:** `third_party/acad-ts-patches/0141-dwg-dimstyle-dimatfit.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** In the R2000+ DIMSTYLE record the BS after DIMUPT is DIMATFIT (ODA Open Design Specification §20.4.53, DXF 289). The reader read it into `dimensionFit` (DIMFIT, obsolete since R2000) and the writer wrote a constant 3 there, so every R2000+ DWG read DIMATFIT 3 (the class default) and a save wrote 3. Found by Triya M1-75 part 9, fixed in M1-92.
- **Fix:** The reader reads that BS into `dimensionTextArrowFit` and the writer writes it from there. R2000+ stores no DIMFIT, so the reader sets `dimensionFit` to 3, what the DXF reader gives a style without 287 (AutoCAD's default), keeping DWG and DXF reads of a drawing equal.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0141 an R2000+ DWG DIMSTYLE reads and writes DIMATFIT in its own place" (DIMATFIT 0, 1 and 2 round trip through R2000, R2004, R2010 and R2018 DWG; DIMFIT reads 3; R14 DIMFIT unchanged); `packages/testkit/src/mapping/tables.corpus.test.ts` "reads every DXF DIMSTYLE with the DIMVARs of its DWG twin" still passes.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write DIMATFIT in the R2000+ DWG DIMSTYLE record

From R2000 the DIMSTYLE object stores DIMATFIT (BS, DXF 289) after DIMUPT (ODA spec §20.4.53); DIMFIT no longer exists. The DWG reader assigned that value to `dimensionFit` and the writer wrote a constant 3, so `dimensionTextArrowFit` always read as its default and a saved style lost its arrow/text fit. This reads and writes the value as `dimensionTextArrowFit`, and gives `dimensionFit` the value the DXF reader assumes when 287 is absent (3).

</details>

### 0142 — TABLESTYLE row styles keep their text colour (DWG) and data and unit types (DXF)

- **File:** `third_party/acad-ts-patches/0142-tablestyle-row-text-colour-data-type.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`, `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** a TABLESTYLE's three row styles (data, title, header; DXF and DWG before R2010) came apart between the formats. The DWG reader and writer kept a row style's text colour in `CellStyle.textColor`, where DXF (62) and the R2010 content format keep it in `color`, so a DWG style read with ByBlock text whatever it held, and a DXF style saved as DWG lost its text colour. The DXF reader and writer kept 90 and 91, the cell data type and unit type (AutoCAD DXF reference, TABLESTYLE), in `cellStyleType` and `styleClass`, the R2010 cell style's type and class, where the DWG row style keeps them in `valueDataType`/`valueUnitType`, so the same drawing read 512/0 from DXF and 0/1 from DWG, and an edited data type did not reach a DWG. Found by Triya M1-75 part 12 (TABLESTYLE writer).
- **Fix:** the DWG row style reads and writes its text colour as `color`; DXF 90/91 are read into and written from `valueDataType`/`valueUnitType`.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0142 TABLESTYLE row styles keep their text colour (DWG) and data and unit types (DXF)" (the acadsharp R2007 sample's Standard style reads alike from its DXF and DWG, and a text colour, data type and unit type edit survives a DXF and a DWG save); `packages/io/test/export-table-styles.test.ts` (every field through DXF and DWG saves R2000–R2007).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** TABLESTYLE: read the row styles' text colour and data/unit types into the same fields in DXF and DWG

Before R2010 a TABLESTYLE holds three row styles (data, title, header). The DWG reader and writer put a row style's text colour in `CellStyle.textColor`, while the DXF reader and writer (group 62) and the R2010 content format use `CellStyle.color`, so a style read from DWG appears to have ByBlock text and a DXF style written to DWG loses its text colour. The DXF reader and writer put groups 90 and 91 (cell data type and unit type) into `cellStyleType` and `styleClass`, which belong to the R2010 cell style, while the DWG reader and writer use `valueDataType` and `valueUnitType`; the same drawing then reads different values from its DXF and DWG, and a data type set in memory is not written to DWG. This uses `color` for the text colour and `valueDataType`/`valueUnitType` for 90/91 in both formats.

</details>

### 0143 — the DWG reader reads a viewport's view mode as stored

- **File:** `third_party/acad-ts-patches/0143-dwg-vport-view-mode.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`
- **Symptom:** The VPORT record stores each view mode bit (perspective, front clip, back clip, front clip not at eye, follow UCS) as its own B (ODA Open Design Specification §20.4.56). The reader ORs the bits it reads onto `VPort.viewMode`, whose default is 16 (front clip not at eye), so a viewport without bit 16 read with it: every DWG viewport read 16 or more, and a save of view mode 0 read back 16. Found by Triya M1-75 part 10, fixed in M1-93.
- **Fix:** Start the view mode from 0 before reading the bits, as the VIEW reader does (View's default is 0).
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0143 the DWG reader reads a viewport view mode as stored, not onto the default 16" (modes 0, 1|4, 2|8 and 16|8 round trip through R14–R2018 DWG).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read a DWG VPORT's view mode without VPort's default bit

`DwgObjectReader._readVPort` sets each view mode bit it reads with `vport.viewMode |= ...` on a fresh `VPort`, whose `viewMode` defaults to `FrontClippingZ` (16). The record stores all five bits, so the default is never cleared and every DWG viewport reads with bit 16, whatever the file says. This resets `viewMode` to `Off` before reading the bits.

</details>

### 0144 — DWG viewports read and write the UCS icon's on and at-origin bits

- **File:** `third_party/acad-ts-patches/0144-dwg-vport-ucs-icon-bits.patch`
- **Touches:** `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** The VPORT record stores UCSICON as two B (ODA spec §20.4.56: bit 0 on, bit 1 at origin; DXF 71 `UscIconType` 0–3). The reader assigned `OnLower` (1) or `OnOrigin` (3) for each bit set, so an icon that is off (0) kept the default 3 and one off at the origin (2) read 3; the writer wrote the second bit as `icon & OnOrigin`, which is also set for an icon that is on but not at the origin (1), so 1 read back as 3. Found by Triya M1-75 part 10, fixed in M1-93.
- **Fix:** The reader adds the two bits up from 0; the writer writes the second from the at-origin bit (2) alone.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0144 the DWG reader reads the UCS icon on and at-origin bits as stored" (0–3 round trip through R14–R2018 DWG).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write a DWG VPORT's UCS icon as two bits

The VPORT object stores the UCS icon setting as two bits, on (1) and at origin (2), which together are `UscIconType` 0–3. The reader assigned `OnLower` or `OnOrigin` per bit instead of adding them, so `Off` read as the default `OnOrigin` and `OffOrigin` as `OnOrigin`; the writer tested the second bit with `OnOrigin` (3), so `OnLower` was written with the at-origin bit. This adds the bits up on reading and writes the second bit from `OffOrigin` (2).

</details>

### 0145 — the DXF reader keeps every tiled viewport sharing a name

- **File:** `third_party/acad-ts-patches/0145-dxf-repeated-vport-names.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfTablesSectionReader.ts`
- **Symptom:** All tiled viewports of the current configuration are VPORT records named `*Active`, and a saved configuration's tiles share its name. With `failsafe` on (the default and Triya's setting) the tables reader skipped any record whose name the table already had, so a DXF with two or more tiles read only the first; the DWG reader and `VPortsTable.add` (which keys a repeat by handle) keep them all, and the writer writes them all. Found by Triya M1-75 part 10, fixed in M1-93.
- **Fix:** The duplicate-name skip leaves out the VPORT table, whose `add` keeps repeated names.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0145 the DXF reader keeps every tiled *Active viewport, as the DWG reader does" (two `*Active` tiles read back with their own corners and handles from R12, R2000 and R2018 DXF, ASCII and binary).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep repeated VPORT names when reading DXF in failsafe mode

A drawing split into tiled viewports has one VPORT record per tile, all named `*Active` (named configurations work the same way). `DxfTablesSectionReader` skips a record whose name is already in the table when `failsafe` is set, so only the first tile is read. `VPortsTable.add` already keeps repeated names under a handle-prefixed key, which is how the DWG reader keeps them, so this exempts the VPORT table from the duplicate check.

</details>

### 0146 — the DXF reader keeps a MLEADERSTYLE's arrowhead and content block

- **File:** `third_party/acad-ts-patches/0146-dxf-mleaderstyle-arrowhead-content-block.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`
- **Symptom:** `_readMLeaderStyle` had cases for the leader linetype (340) and text style (342) handles but none for the arrowhead block (341) or the content block (343), so the class map could not assign them and every DXF MLEADERSTYLE read with the default arrowhead and no content block. The DWG reader and both writers keep them, and `CadMLeaderStyleTemplate` already resolves `arrowheadHandle` and `blockContentHandle`. Found by Triya M1-75 part 11, fixed in M1-94.
- **Fix:** The reader stores 341 in `arrowheadHandle` and 343 in `blockContentHandle`.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0146 the DXF reader keeps a MLEADERSTYLE arrowhead (341) and content block (343)" (R2007, R2010 and R2018 DXF, ASCII and binary).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read MLEADERSTYLE arrowhead (341) and block content (343) handles from DXF

`DxfObjectsSectionReader._readMLeaderStyle` reads the leader line type (340) and MText style (342) handles into `CadMLeaderStyleTemplate`, but not the arrowhead block (341) or the block content (343), so a style read from DXF loses both, while the DWG reader keeps them and the DXF writer writes them. This adds the two cases; the template already resolves both handles when the document is built.

</details>

### 0147 — `CadDictionary.rename` renames an entry in place

- **File:** `third_party/acad-ts-patches/0147-cad-dictionary-rename-in-place.patch`
- **Touches:** `src/Objects/CadDictionary.ts`
- **Symptom:** A dictionary keys an entry by the name it was added under, and both writers write that key as the entry name (DXF 3, the DWG entry text), which is the only place a MLEADERSTYLE, TABLESTYLE or IMAGEDEF keeps its name. Setting the object's `name` left the key as it was, so the save wrote the old name, and the only other route, `remove` then `add`, sets the owner to null on the way (which the document takes as an unlink) and moves the entry to the end. Upstream ACadSharp renames the key from `OnNameChanged`; the port dropped that handler. Found by Triya M1-75 parts 11–13, fixed in M1-95.
- **Fix:** A `rename(key, newName)` method that swaps the key where the entry stands, keeps its handle and owner, gives the object the new name, refuses a name another entry has (without regard to case) and returns false when there is no entry `key`. It is explicit rather than a name-change handler, so a reader that sets a name after adding an entry changes nothing.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0147 CadDictionary.rename renames an entry in place, keeping its handle and owner" (entry order, case-only renames, refusals, and R2000/R2018 DXF and R2004/R2018 DWG saves reading back with the new name in the old place).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Add `CadDictionary.rename` to rename an entry in place

Objects such as MLEADERSTYLE, TABLESTYLE and IMAGEDEF are named only by their dictionary entry, which `CadDictionary` keys by the name the object was added under. Changing the object's `name` does not change the key, so the writers keep writing the old name; ACadSharp handles this with `onEntryNameChanged`, which the TypeScript port does not have. `remove` + `add` works but unassigns the object from the document and moves the entry to the end of the dictionary. This adds `rename(key, newName)`, which replaces the key at the same position, keeps the object's handle and owner, sets its name, and throws if another entry already has the new name.

</details>

### 0148 — the DXF reader keeps an MTEXT's xdata after its R2018 column data

- **File:** `third_party/acad-ts-patches/0148-dxf-mtext-columns-keep-xdata.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** R2018 DXF keeps an MTEXT's columns in an embedded object (101 "Embedded Object") after the background groups, and the entity's xdata (1001 and its values) follows it. `_readColumnData` read on until the next entity (code 0), so it took the 1001 and every xdata value as unknown column codes and the MTEXT came back without its xdata. Found by Triya M1-75 part 19 (xdata saved on every corpus entity).
- **Fix:** The column reader also stops at 1001 and leaves it to the entity reader, which reads the xdata as for any entity.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0148 the DXF reader keeps an MTEXT’s xdata after its R2018 column data" (ASCII and binary DXF).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Stop reading MTEXT column data at the entity's extended data

In R2018 DXF the MTEXT column settings are an embedded object (group 101) that AutoCAD writes after the background groups, and the entity's extended data (1001 onwards) comes after it. `DxfSectionReaderBase._readColumnData` loops until the next group 0, so it consumes the 1001 group and the xdata values as unknown column codes, and the MTEXT loses its xdata. This stops the loop at 1001 as well; the entity reader then reads the extended data as usual.

</details>

### 0149 — the DWG writer writes an xdata 1005 handle as read

- **File:** `third_party/acad-ts-patches/0149-dwg-xdata-handle-as-read.patch`
- **Touches:** `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** `_writeExtendedDataEntry` wrote an xdata database handle (1005) as 0 when `document.getCadObject` did not find it: one naming an erased object, and one naming an object the document does not index (an ATTRIB). AutoCAD keeps a 1005 as it is on save, as the DXF writer does since patch 0029, so a DWG save lost what a DXF save kept. Found by Triya M1-75 part 19.
- **Fix:** A 1005 is written as read. A 1003 layer reference still needs its layer, which is the only place a DWG save can take its handle from.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0149 the DWG writer writes an xdata 1005 handle as read" (a dangling handle and one naming the entity).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Write extended data handles (1005) as read in DWG

`DwgObjectWriter._writeExtendedDataEntry` replaces an extended data handle with 0 when the document cannot resolve it. AutoCAD keeps such handles (for example to an erased object, which a later UNDO or an application may still use), and the DXF writer writes them as read, so the two formats disagree after a save. This writes `ExtendedDataHandle` values unchanged and keeps the resolution only for the layer reference (1003), whose handle has to come from the layer.

</details>

### 0150 — the DXF reader gives a multiline attribute's xdata to the attribute

- **File:** `third_party/acad-ts-patches/0150-dxf-multiline-attribute-xdata.patch`
- **Touches:** `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`
- **Symptom:** R2018 DXF writes a multiline ATTDEF's or ATTRIB's text as an embedded MTEXT (101 "Embedded Object") that runs to the end of the entity, and the attribute's xdata after it. The attribute reader read the embedded object with `readEntityCodes`, which went on to the next entity, so the xdata went to the embedded MTEXT (which neither writer writes) and the attribute lost it. Found by Triya M1-75 part 19 (sample_AC1032_ascii.dxf's multiline ATTDEF and ATTRIB).
- **Fix:** After the embedded MTEXT is read, the xdata it collected moves to the attribute's template.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0150 the DXF reader gives a multiline attribute’s xdata to the attribute" (ASCII and binary DXF).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep a multiline attribute's extended data on the attribute when reading DXF

A multiline ATTRIB or ATTDEF in R2018 DXF carries its text as an embedded MTEXT object (group 101), which AutoCAD writes after the attribute's own groups and before its extended data. The DXF reader reads that embedded object with `readEntityCodes`, which continues to the next entity, so the 1001 groups are stored on the embedded MTEXT's template and the attribute loses its extended data (the writers write the attribute's, not the embedded MTEXT's). This moves the extended data collected while reading the embedded object back to the attribute.

</details>

### 0151 — the DXF CELLSTYLEMAP's text height (144) and background colour (62)

- **File:** `third_party/acad-ts-patches/0151-dxf-cellstylemap-text-height-background.patch`
- **Touches:** `src/Metadata/LookupTables/Objects.ts`, `src/IO/DXF/DxfStreamReader/DxfObjectsSectionReader.ts`, `src/IO/DXF/DxfStreamWriter/DxfObjectsSectionWriter.ts`
- **Symptom:** A table style's CELLSTYLEMAP (which AutoCAD 2008 and later save beside the TABLESTYLE row styles in every DXF) holds each cell style's content format with the block scale at 140 and the text height at 144: every corpus DXF states 140 = 1.0 and 144 = the row's text height (0.25 for a Standard title, 0.18 for its header and data rows, as the same style in the DWG save states them). acad-ts read and wrote the two swapped, so a cell style came back with text height 1 and scale 0.25, and a text height written to it went to the block scale. The cell style's own 62, after its merge flags (92) and before CONTENTFORMAT, is its background colour (257 when None, as the DWG's background colour is), but it was read into and written from `textColor`, which nothing else uses. Found by Triya M1-96 part 2, which keeps the map in step with the rows.
- **Fix:** `ContentFormat` maps 140 to `scale` and 144 to `textHeight`; the TABLEFORMAT reader takes 62 as `backgroundColor`, and the CELLSTYLEMAP writer writes `backgroundColor` there and 140 / 144 the right way round. The other TABLEFORMAT codes acad-ts misreads (170 the data flag, 91 the override flags, 93 the content layout flags, and GRIDFORMAT 90 / 91) are left for M1-98.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0151 the DXF CELLSTYLEMAP states the text height at 144 and the background at 62" (ASCII and binary DXF); `packages/testkit/src/mapping/tables.corpus.test.ts` → "maps every TABLESTYLE CELLSTYLEMAP like the row styles it is kept in step with".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write the CELLSTYLEMAP text height and background colour at their DXF codes

In a CELLSTYLEMAP (and the TABLEFORMAT records of table cell styles), the content format states the block scale at group 140 and the text height at group 144, and the cell style's 62 before its CONTENTFORMAT is the background colour (257 for None). AutoCAD's own DXF saves confirm it: 140 is 1.0 and 144 the row's text height in every one, matching the cell styles of the same drawing saved as DWG. `ContentFormat` mapped 140 to `TextHeight` and 144 to `Scale`, and the cell style's 62 to `TextColor`, so a cell style read back with text height 1 and the background colour was lost on write. This maps the two content format codes the right way round, reads the cell style's 62 as `BackgroundColor`, and writes them back the same way.

</details>

### 0152 — an entity's material is dropped on read and never written

- **File:** `third_party/acad-ts-patches/0152-entity-material.patch`
- **Touches:** `src/IO/Templates/CadEntityTemplate.ts`, `src/IO/CadDocumentBuilder.ts`, `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`
- **Symptom:** both readers keep an entity's material handle (DXF 347; DWG R2007+ after the material flags 11), but `CadEntityTemplate` never assigned it, the DWG reader skipped the flags 01 that state ByBlock, and neither writer wrote a material (the DWG writer always wrote the flags 00, ByLayer). So every entity read without its material, and Triya's material edits (the Properties palette's Material row) were lost on save. Every ACadSharp R2007+ sample gives a POINT the ByBlock material and four CIRCLEs materials of their own (Aluminum Cast, Beech, Bamboo, Asphalt - Wet), and a multiline attribute's embedded MTEXT points at the ByLayer material. Found by Triya M1-75 part 21.
- **Fix:** the template assigns the material the handle names, or for the DWG flags 01 the drawing's ByBlock material (`CadDocumentBuilder.findCadObject`, which finds a read object by a test and remembers it); the DXF writer writes 347 for R2007+ when the entity has a material, and the DWG writer writes the flags 01 for ByBlock and 11 with a hard pointer for any other material, 00 for none.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0152 an entity keeps its material (DXF 347, DWG R2007+) through read and save" (the R2007+ DXF and DWG samples agree, and keep it through ASCII, binary and DWG saves).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write an entity's material

The DXF reader stores an entity's 347 and the DWG reader the R2007+ material handle in `CadEntityTemplate.materialHandle`, but the template never resolves it, so `Entity.material` is always null after a read. The DWG reader also discards the material flags, where 01 means ByBlock (the DXF save of the same drawing points 347 at the ByBlock MATERIAL). Neither writer writes a material: the DXF writer has no 347 and the DWG writer always writes the flags 00. This resolves the handle in the template (and the flags 01 to the drawing's ByBlock material), writes 347 from R2007 in DXF, and writes the DWG flags 01 for ByBlock or 11 and the hard pointer. With the ACadSharp sample files, the materials of the DXF and DWG saves now read alike and survive a save in either format.

</details>

### 0153 — a DWG layer's plot style name is dropped on read and written as 0

- **File:** `third_party/acad-ts-patches/0153-dwg-layer-plot-style.patch`
- **Touches:** `src/IO/Templates/CadLayerTemplate.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** the DWG reader read a layer's R2000+ plot style name handle into `CadLayerTemplate.plotStyleHandle`, which nothing used, and the DWG writer wrote 0 for it, so every DWG layer read with no plot style and every DWG save detached each layer from its plot style name (Normal in every corpus sample, as their DXF saves state in 390). Patch 0009 fixed the same loss for DXF. Found by Triya M1-75 part 21.
- **Fix:** the template sets `Layer.plotStyleName` from the handle, and the writer writes it.
- **Test:** `packages/testkit/src/spike/acad-ts-patches.corpus.test.ts` → "0153 a DWG layer keeps its plot style name (R2000+) through read and save" (AC1015–AC1032 DWG samples agree with their DXF saves before and after a DWG save).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep a DWG layer's plot style name

`DwgObjectReader._readLayer` reads the R2000+ plot style name handle into `CadLayerTemplate.plotStyleHandle`, which is never assigned to the layer, and `DwgObjectWriter._writeLayer` writes a null handle in its place. Every DWG layer therefore reads without a plot style and a DWG save detaches it from its plot style name (an ACDBPLACEHOLDER in ACAD_PLOTSTYLENAME). This assigns `Layer.plotStyleName` in the template and writes it, as the DXF writer does for 390.

</details>

### 0154 — an entity's plot style name is dropped on read and never written

- **File:** `third_party/acad-ts-patches/0154-entity-plot-style.patch`
- **Touches:** `src/Entities/Entity.ts`, `src/IO/DXF/DxfStreamReader/DxfSectionReaderBase.ts`, `src/IO/DXF/DxfStreamWriter/DxfSectionWriterBase.ts`, `src/IO/DWG/DwgStreamReaders/DwgObjectReader.ts`, `src/IO/DWG/DwgStreamWriters/DwgObjectWriter.ts`
- **Symptom:** in a named-plot-style drawing ($PSTYLEMODE 0) an entity names its plot style by a hard pointer to an ACDBPLACEHOLDER in ACAD_PLOTSTYLENAME: DXF 390 in AcDbEntity, and in a DWG from R2000 the plot style flags (00 ByLayer, 01 ByBlock, 10 the dictionary default, 11 and the pointer). `Entity` had no field for it: the DXF reader dropped 390, the DWG reader read and discarded the flags and handle, and both writers wrote ByLayer. No public corpus file names one on an entity; Triya M1-75 part 21 (the Properties palette's Plot style row) needs it saved.
- **Fix:** `Entity.plotStyleType` (`EntityPlotStyleType`) and `Entity.plotStyleName` (the raw handle, as `Layer.plotStyleName` keeps it) are read from 390 (as ByObjectId) and from the DWG flags and pointer, and written back: 390 for ByObjectId from R2000 in DXF, which has no group for ByBlock or the dictionary default, and the flags (and pointer) in a DWG.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0154 an entity keeps its plot style name (DXF 390, DWG R2000+) through a save" (each flag through R2000 and R2018 DWG saves; ByObjectId through ASCII and binary DXF).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Read and write an entity's plot style name

An entity in a named-plot-style drawing points at its plot style name (an ACDBPLACEHOLDER in ACAD_PLOTSTYLENAME) with DXF group 390, and a DWG from R2000 states the plot style flags (ByLayer, ByBlock, dictionary default, or by object id followed by a hard pointer). `Entity` has no field for it, so the DXF reader drops 390, `DwgObjectReader` reads and discards the flags and handle, and both writers always write ByLayer. This adds `Entity.plotStyleType` and `Entity.plotStyleName` (the handle, as `Layer.plotStyleName` holds it), reads them in both formats and writes them back; DXF, which has no code for ByBlock or the dictionary default, gets 390 for a plot style by object id only.

</details>

### 0157 — every DXF block reads with the last block's base point

- **File:** `third_party/acad-ts-patches/0157-dxf-block-base-point.patch`
- **Touches:** `src/DxfPropertyBase.ts`
- **Symptom:** `DxfPropertyBase.setValue` wrote a vector group (10/20/30 …) into the object's current `XY`/`XYZ` in place. Every `Block` starts with the same shared `XYZ_Zero`, so reading a BLOCK's base point changed the base point of every block read so far, and of every `Block` made afterwards: all blocks of a DXF ended up with the base point of the last one read. Found by Triya M1-75 part 22 (BASE in the block editor).
- **Fix:** the setter writes into a copy of the vector and assigns it, so no default vector is shared.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0157 the DXF reader gives every block its own base point".
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Do not mutate default vectors when reading DXF vector groups

`DxfPropertyBase.setValue` assigns a vector component (`10`, `20`, `30` …) by writing into the property's current `XY`/`XYZ` instance. `Block.basePoint` defaults to the module-level `XYZ_Zero`, which every new `Block` shares, so reading one BLOCK's base point changes the base point of every block in the document (and of every `Block` created later): after a read, all blocks have the base point of the last BLOCK in the file. This copies the vector before setting the component, so a shared default is never written to.

</details>

### 0158 — a block from a file without Allow exploding reads as not explodable

- **File:** `third_party/acad-ts-patches/0158-block-explodable-default.patch`
- **Touches:** `src/Tables/BlockRecord.ts`
- **Symptom:** `BlockRecord.isExplodable` defaulted to false. A DWG before R2007 has no explodability field (the BLOCK_HEADER states it from R2007) and an R12 DXF has no BLOCK_RECORD, so every block in them read as one that cannot be exploded, though AutoCAD (Allow exploding came with AutoCAD 2006) explodes them. A new block saved to such a file came back not explodable. Found by Triya M1-75 part 22.
- **Fix:** the default is true; a file that states the field is read as it says.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0158 a block is explodable unless the file says otherwise" (R2004 DWG, R12 DXF, and an R2018 DXF stating 280 = 0).
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Blocks are explodable unless the file says otherwise

`BlockRecord.isExplodable` defaults to `false`, so a block read from a file that has no explodability field (a DWG before R2007, an R12 DXF) is reported as not explodable, although every block in such a file can be exploded (the option arrived with AutoCAD 2006). This makes the default `true`; DXF 280 and the R2007+ DWG bit still set it when present.

</details>

### 0159 — renaming a table entry moves it to the end of its table

- **File:** `third_party/acad-ts-patches/0159-table-rename-keeps-order.patch`
- **Touches:** `src/Tables/Collections/Table.ts`
- **Symptom:** `Table._onEntryNameChanged` re-keyed a renamed entry by deleting it and adding it again, which moves it to the end of the table's entries. Tables (and the BLOCKS section) are written in entry order, so a rename reordered the file; in R12, whose block records and table entries state no handle, acad-ts numbers the ones it makes up in read order, so a renamed block renumbered every block record after it on the next read. Found by Triya M1-75 part 22 (RENAME).
- **Fix:** the entries are re-keyed in place, keeping their order.
- **Test:** `packages/io/test/acad-ts-patches.test.ts` → "0159 renaming a table entry keeps its place in the table"; `packages/testkit/src/export/export-blocks.corpus.test.ts` renames blocks in the R12 samples with no other difference.
- **Upstream status:** PR text drafted below, not yet submitted (owner submits). Upstream suite not rerun with this patch (see top of file).

<details><summary>Upstream PR text</summary>

**Title:** Keep a renamed table entry in place

When a table entry is renamed, `Table` re-keys it with `entries.set(newKey)` followed by `entries.delete(oldKey)`, which moves the entry to the end of the map. Tables are written in entry order, so renaming a layer or block reorders the written file. This rebuilds the map with the entry re-keyed at its original position.

</details>
