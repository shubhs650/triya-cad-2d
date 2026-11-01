# File Fidelity Matrix

One row per DXF/DWG entity, object or table type. A type is **done** only when all five columns are ticked and a corpus file exercises it. Threads update rows in the PR that lands the work. "P" in a column means handled purely by passthrough (preserved, not interpreted) — that is a valid final state for the types marked *(passthrough-only)*.

Columns: **Read** (mapped into Triya model) · **Render** (drawn like AutoCAD) · **Edit** (modifiable by Triya commands) · **Write** (rebuilt on export without loss) · **Test** (corpus file + round-trip + fidelity reference).

## Entities

| Type | Read | Render | Edit | Write | Test file |
|---|---|---|---|---|---|
| LINE | ✓ | | | | |
| XLINE | ✓ | | | | |
| RAY | ✓ | | | | |
| CIRCLE | ✓ | | | | |
| ARC | ✓ | | | | |
| ELLIPSE | ✓ | | | | |
| POINT | ✓ | | | | |
| LWPOLYLINE | ✓ | | | | |
| POLYLINE (2D) + VERTEX + SEQEND | ✓ | | | | |
| POLYLINE (3D, mesh, pface) *(render as 2D projection; edit none)* | ✓ 3D (meshes not yet) | | — | | |
| SPLINE | ✓ | | | | |
| SOLID | ✓ | | | | |
| TRACE | ✓ as SOLID (acad-ts reads TRACE as SOLID, M1-32) | | | | |
| 3DFACE *(render edges)* | ✓ | | — | | |
| TEXT | | | | | |
| MTEXT | | | | | |
| ATTDEF | | | | | |
| ATTRIB | | | | | |
| INSERT | | | | | |
| MINSERT | | | | | |
| DIMENSION (linear/aligned) | | | | | |
| DIMENSION (angular 2-line / 3-point) | | | | | |
| DIMENSION (radial / diametric) | | | | | |
| DIMENSION (ordinate) | | | | | |
| DIMENSION (arc length) | | | | | |
| DIMENSION (jogged) | | | | | |
| LEADER | | | | | |
| MLEADER (+ MLEADERSTYLE) | | | | | |
| HATCH (pattern/solid/gradient; line/arc/ellipse/spline/polyline edges) | | | | | |
| WIPEOUT | | | | | |
| IMAGE (+ IMAGEDEF, IMAGEDEF_REACTOR) | | | | | |
| TABLE (ACAD_TABLE + TABLESTYLE + cell styles) | | | | | |
| VIEWPORT | | | | | |
| TOLERANCE | | | | | |
| MLINE (+ MLINESTYLE) | | | | | |
| REGION *(render from proxy graphics / boundary)* | | | — | | |
| PDFUNDERLAY / DWFUNDERLAY / DGNUNDERLAY (+ definitions) | | | | | |
| OLE2FRAME *(render bounds + frame)* | | | — | | |
| ACAD_PROXY_ENTITY *(render proxy graphics)* | | | — | P | |
| ARRAY (associative array: anonymous block + ACAD_ARRAY xdata) | | | | | |
| 3DSOLID / SURFACE / MESH / BODY *(passthrough-only; render proxy graphics if present)* | P | | — | P | |
| HELIX / LIGHT / CAMERA / SECTION *(passthrough-only)* | P | — | — | P | |

Read ticks for entities (M1-04) mean every entity of the type in every readable public ASCII DXF matches an independent DXF reader in plan view (DEC-039), common properties included (`packages/testkit/src/mapping/entities.corpus.test.ts`), apart from the acad-ts read gaps listed there (M1-32). Entities on a tilted plane are reported unmapped.

## Tables

| Table | Read | Edit | Write | Test |
|---|---|---|---|---|
| LAYER (+ VP overrides via xdata/dictionaries) | ✓ record (VP overrides not yet) | | | |
| LTYPE (simple + complex) | ✓ | | | |
| STYLE (text styles, SHX and TTF, bigfont) | ✓ | | | |
| DIMSTYLE (all DIMVARS + overrides via xdata) | ✓ record, all DIMVARs (xdata overrides not yet) | | | |
| APPID | ✓ | | | |
| BLOCK_RECORD (+ BLOCK/ENDBLK, *Model_Space, *Paper_Space*, *D, *U, *X, *T) | ✓ record (BLOCK/ENDBLK with M1-04) | | | |
| VPORT | ✓ | | | |
| VIEW | ✓ | | | |
| UCS | ✓ | | | |

Read ticks for tables (M1-03) mean every field of the record compares equal to an independent DXF reader on every readable public corpus file (`packages/testkit/src/mapping/tables.corpus.test.ts`), except the acad-ts read gaps listed there as `ACAD_TS_GAPS` (layer material, `BLOCK_RECORD` 70 insert units, nameless shape `STYLE` records, R12 `DIMBLK` names, `TABLESTYLE` border visibility), which M1-32 closes. MLEADERSTYLE and TABLESTYLE objects are checked the same way. The header is mapped too: every variable acad-ts knows is carried by DXF name, compared the same way; 32 variables acad-ts does not know are M1-32.

## Objects (non-graphical)

| Object | Read | Edit | Write | Test |
|---|---|---|---|---|
| DICTIONARY / ACDBDICTIONARYWDFLT | | | | |
| LAYOUT + PLOTSETTINGS | | | | |
| MLEADERSTYLE / TABLESTYLE / MLINESTYLE | ✓ MLEADERSTYLE, TABLESTYLE (MLINESTYLE not yet) | | | |
| SCALE (ACAD_SCALELIST) | | | | |
| LAYER_FILTER / LAYER_INDEX / ACAD_LAYERSTATES | | | | |
| GROUP | | | | |
| XRECORD | | | | |
| PLACEHOLDER / IDBUFFER / SORTENTSTABLE | | | | |
| IMAGEDEF / RASTERVARIABLES | | | | |
| PDFDEFINITION / DWFDEFINITION / DGNDEFINITION | | | | |
| SPATIAL_FILTER (XCLIP) | | | | |
| WIPEOUTVARIABLES | | | | |
| FIELD / FIELDLIST | | | | |
| DATATABLE / DATALINK *(passthrough-only)* | P | — | P | |
| VISUALSTYLE / MATERIAL / LIGHTLIST *(passthrough-only)* | P | — | P | |
| ACDBASSOC* / ACDBPERSSUBENTMANAGER (AutoCAD constraints, *passthrough-only*) | P | — | P | |
| BLOCK representation data for dynamic blocks (*passthrough-only*) | P | — | P | |
| ACAD_PROXY_OBJECT *(passthrough-only)* | P | — | P | |
| Header variables not modelled *(passthrough-only)* | P | — | P | |
| CLASSES section *(passthrough-only)* | P | — | P | |

## Triya-owned objects

| Object | Notes |
|---|---|
| `TRIYA_CONSTRAINTS` dictionary → XRECORDs | parametric constraints; ignored by AutoCAD; round-trip through acad-ts |
| `TRIYA_META` XRECORD | app version that last saved, feature flags used; optional |

## Version coverage

| Version | DXF read | DXF write | DWG read | DWG write | Corpus |
|---|---|---|---|---|---|
| AC1009 (R12) | | | | | |
| AC1012 (R13) | | | | | |
| AC1014 (R14) | | | | | |
| AC1015 (2000) | | | | | |
| AC1018 (2004) | | | | | |
| AC1021 (2007) | | | | | |
| AC1024 (2010) | | | | | |
| AC1027 (2013) | | | | | |
| AC1032 (2018) | | | | | |

Writing to a version older than the source drops entities that didn't exist in that version; Triya warns with the list before saving and never drops silently.

## acad-ts layer status (M0-06 spike)

The columns above track Triya. This section tracks the library underneath, from `docs/reports/M0-acad-ts-spike.md` (acad-ts 315f3d8 + patches 0001–0013). R-numbers are the root causes in that report §4; the tasks that fix them are M1-27 to M1-30.

| Version | Corpus files (DWG / ASCII DXF / binary DXF) | Read | Round trip clean | Main open defects |
|---|---|---|---|---|
| R2.6–R12 (AC1009 and earlier) | 0 / 7 / 2 | all | 0 | R16 synthesised R13+ objects |
| R13 (AC1012) | 0 / 2 / 1 | all | 0 | DXF writer gaps |
| R14 (AC1014) | 1 / 1 / 1 | all | 0 | R17 block entity lists |
| 2000 (AC1015) | 1 / 5 / 2 | all | 0 | R17, DXF writer gaps |
| 2004–2013 (AC1018–AC1027) | 4 / 46 / 4 | all | 0 | R15 table content, R11 sort order, DXF writer gaps |
| 2018 (AC1032) | 14 / 26 / 1 | all but `recover02.dxf` (malformed) | 11 (DWG) | DXF writer gaps |

| Type | acad-ts status after M0-06 and M1-30 |
|---|---|
| VPORT, LAYER, LAYOUT (DXF write) | Fixed by patches 0008, 0009, 0010 |
| Header flag word, true colours, template page, layout limits, block previews (DWG) | Fixed by patches 0003–0007 |
| Dynamic-block evaluation graph (DXF write) | Writer no longer crashes (0002); DWG round trip clean |
| VISUALSTYLE / MATERIAL | Read; **not written to DXF** (R2, R3). DWG round trip keeps them |
| ACDBASSOC* / ACDBPERSSUBENTMANAGER / SUN / view styles / AEC_* and every other unmapped type | Kept raw and written back under its handle (patches 0014, 0016; `readCadDocument` sets the keep flags): DXF → DXF as the group codes read, DWG → DWG of the same version as the object record read. All 1,329 unknown objects in the public corpus survive a save. **Not** converted across formats or versions: a DWG-read object saved to DXF, or to another DWG version, is skipped with a writer notification |
| SUN (VPORT / VIEWPORT 361), 3DSOLID history (350) | Linked and written (0017). Pre-R2007 DWG solid history objects (`ACSH_*`, 6 in the corpus) are still not reached (M1-31) |
| CLASSES with a shared DXF name (AEC) | Both kept under their read class numbers; class numbers survive a save (0015) |
| DATATABLE / TABLECONTENT owned through an XRECORD | Read and kept (0018); TABLECONTENT is **not written to DXF** (writer gap, M1-31) |
| DIMASSOC | Read; **not written to DXF** (M1-31) |
| ACAD_PROXY_OBJECT | Kept on read; **skipped by the DXF writer** |
| TABLESTYLE / CELLSTYLEMAP, MLEADER, MTEXT columns, ACAD_TABLE, VIEWPORT entity | Lossy in DXF (R5, R12–R15) |
| XRECORD, SORTENTSTABLE | Kept when owned by unknown objects (0014); sort order changes (R11, M1-29) |
| LAYOUT plot flags (DXF read), `$CELWEIGHT` (DWG header) | Fixed by patches 0019 and 0020 |
