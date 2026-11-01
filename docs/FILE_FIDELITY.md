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
| SPLINE | ✓ (a spline stored only as fit points, as R2013+ DWGs can hold one, is neither drawn nor bounded until M1-47 interpolates it) | | | | |
| SOLID | ✓ | | | | |
| TRACE | ✓ as SOLID (acad-ts reads TRACE as SOLID, M1-32) | | | | |
| 3DFACE *(render edges)* | ✓ | | — | | |
| TEXT | ✓ | | | | |
| MTEXT | ✓ (contents with codes as stored; R2018 columns kept through DXF and DWG saves, 0035/0036) | | | | |
| ATTDEF | ✓ (version, lock position and R2018 multiline text kept through a DXF save, 0032) | | | | |
| ATTRIB | ✓ folded into its INSERT (version, lock position and R2018 multiline text kept through a DXF save, 0032) | | | | |
| INSERT | ✓ (drawn by the renderer through nesting with ByBlock and layer-0 inheritance, M1-14 part 1; attributes not drawn yet) | | | | |
| MINSERT | ✓ (every cell drawn, M1-14 part 1) | | | | |
| DIMENSION (linear/aligned) | ✓ (rotated with an empty AcDbRotatedDimension read as aligned by acad-ts, M1-32; drawn from its stored `*D` block by the renderer, M1-15 part 1, its text once MTEXT draws, M1-41; annotative scale representations not yet) | | | | |
| DIMENSION (angular 2-line / 3-point) | ✓ (drawn from its stored `*D` block, M1-15 part 1) | | | | |
| DIMENSION (radial / diametric) | ✓ (drawn from its stored `*D` block, M1-15 part 1) | | | | |
| DIMENSION (ordinate) | ✓ (drawn from its stored `*D` block, M1-15 part 1) | | | | |
| DIMENSION (arc length) | ✓ (ARC_DIMENSION; drawn from its stored `*D` block, M1-15 part 1) | | | | |
| DIMENSION (jogged) | — acad-ts does not read LARGE_RADIAL_DIMENSION as a dimension (M1-34) | | | | |
| LEADER | ✓ | | | | |
| MLEADER (+ MLEADERSTYLE) | ✓ (DXF branches and the context text colour read since 0037) | | | | |
| HATCH (pattern/solid/gradient; line/arc/ellipse/spline/polyline edges) | ✓ (style 75, seed points and ellipse-edge major axes lost by acad-ts, M1-32) | | | | |
| WIPEOUT | ✓ (acad-ts skips the clip type 71; the mapper infers a polygon from more than two vertices, M1-32) | | | | |
| IMAGE (+ IMAGEDEF, IMAGEDEF_REACTOR) | ✓ IMAGE (clip type as for WIPEOUT) | | | | |
| TABLE (ACAD_TABLE + TABLESTYLE + cell styles) | ✓ grid, `*T` block and cells (text, block, spans, merges, rotation); cell formats not mapped yet; ezdxf-written tables dropped by acad-ts (M1-32) | | | | |
| VIEWPORT | ✓ frame, view, clip boundary, frozen layers, plot style and render mode (DXF status 68, clip boundary 340, a 0 viewport ID and the R12 MVIEW view lost by acad-ts, M1-32; DWG reads 68 and 340) | | | | |
| TOLERANCE | ✓ (caret codes decoded since 0039) | | | | |
| MLINE (+ MLINESTYLE) | ✓ MLINE (style handle, scale, justification, flags, vertices with element parameters); MLINESTYLE not yet | | | | |
| REGION *(render from proxy graphics / boundary)* | ✓ boundary read from the ACIS data, SAT text (R14–R2010) or SAB binary (R2013+, DWG): lines, arcs, circles and ellipses per loop; spline (intcurve) edges reported unmapped (M1-39) | | — | | |
| PDFUNDERLAY / DWFUNDERLAY / DGNUNDERLAY (+ definitions) | ✓ PDFUNDERLAY; DWF/DGN have no acad-ts reader and no corpus file (M1-32) | | | | |
| OLE2FRAME *(render bounds + frame)* | mapped (frame corners, OLE type, space, application), unit tests only: no public corpus file has one (M1-40) | | — | | |
| ACAD_PROXY_ENTITY *(render proxy graphics)* | mapped (class name, stated extents, circles, arcs and polylines from proxy graphics; text, meshes and shells counted as skipped), unit tests only: no public corpus file has one (M1-40) | | — | P | |
| ARRAY (associative array: anonymous block + ACAD_ARRAY xdata) | | | | | |
| 3DSOLID / SURFACE / MESH / BODY *(passthrough-only; render proxy graphics if present)* | P | | — | P | |
| HELIX / LIGHT / CAMERA / SECTION *(passthrough-only)* | P | — | — | P | |

Read ticks for entities (M1-04) mean every entity of the type in every readable public ASCII DXF matches an independent DXF reader in plan view (DEC-039), common properties included (`packages/testkit/src/mapping/entities.corpus.test.ts`), apart from the acad-ts read gaps listed there (M1-32). Entities on a tilted plane are reported unmapped.

## Tables

| Table | Read | Edit | Write | Test |
|---|---|---|---|---|
| LAYER (+ VP overrides via xdata/dictionaries) | ✓ record (VP overrides not yet) | | | |
| LTYPE (simple + complex) | ✓ (patterns, text and shape elements fitted by `dashPath`, M1-13 part 1; `.lin` files read by `parseLin`; drawn by the renderer at LTSCALE × object scale, M1-13 part 3; embedded text and shapes not drawn yet, M1-45) | | | `style.corpus.test.ts` (473 records) |
| STYLE (text styles, SHX and TTF, bigfont) | ✓ | | | |
| DIMSTYLE (all DIMVARS + overrides via xdata) | ✓ record, all DIMVARs (xdata overrides not yet) | | | |
| APPID | ✓ | | | |
| BLOCK_RECORD (+ BLOCK/ENDBLK, *Model_Space, *Paper_Space*, *D, *U, *X, *T) | ✓ record (BLOCK/ENDBLK with M1-04) | | | |
| VPORT | ✓ | | | |
| VIEW | ✓ | | | |
| UCS | ✓ | | | |

Read ticks for tables (M1-03) mean every field of the record compares equal to an independent DXF reader on every readable public corpus file (`packages/testkit/src/mapping/tables.corpus.test.ts`), except the acad-ts read gaps listed there as `ACAD_TS_GAPS` (layer material, nameless shape `STYLE` records, R12 `DIMBLK` names), which M1-32 closes. MLEADERSTYLE and TABLESTYLE objects are checked the same way. The header is mapped too: every variable acad-ts knows is carried by DXF name, compared the same way; 32 variables acad-ts does not know are M1-32.

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
| PLACEHOLDER / IDBUFFER | | | | |
| SORTENTSTABLE | ✓ entries in stored order (`mapSortEnts`), draw order by sort handle (`drawOrder`; M1-13 part 2) | | | `style.corpus.test.ts` (75 tables, 28 reorder their block) |
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

The columns above track Triya. This section tracks the library underneath, from `docs/reports/M0-acad-ts-spike.md` (acad-ts 315f3d8 + patches 0001–0013). R-numbers are the root causes in that report §4; the tasks that fix them are M1-27 to M1-31 and M1-33. Since M1-27, `pnpm test` checks every declared handle (DWG handle map, ASCII and binary DXF) after a save; `corpus/handle-coverage-baseline.json` lists the known losses by type and file.

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
| Dynamic-block evaluation graph (DXF write) | Writer no longer crashes (0002). The graph's parameters, grips, actions and grip-location components are **never loaded** (DWG and DXF), so a save drops them: 426 handles in 40 files (M1-33) |
| VISUALSTYLE / MATERIAL | DXF: group codes kept on read and written back as read (0021, M1-28; the DXF reader assigns no VISUALSTYLE field and there is no field writer for either), with their extension dictionaries. DWG round trip keeps them. DWG → DXF still skips them with a notification |
| Xdata 1070 integers (ASCII DXF write) | Negative values written signed (0022); were masked to 0–65535 |
| Xdata on DICTIONARY, DBCOLOR, IMAGEDEF, IMAGEDEF_REACTOR, ACDBPLACEHOLDER (DXF write) | Written (0026); were dropped. The remaining `TEXT` and `VPORT` table xdata are fixed by 0029 and 0030 |
| DBCOLOR colour-book names (DXF write) | `BOOK$COLOR` written once (0027); the book name was appended again, so the colour name read back was the book name |
| RASTERVARIABLES units (DXF write) | Written from `units` (0023); were written as the display quality |
| BLOCK_RECORD insert units and preview (DXF) | 70 read as insert units and every 310 preview chunk kept on read; preview written back (0025). Units had read as 0 and the preview was lost |
| Header dates (`$TDCREATE`, `$TDUPDATE`, …) | Read to the exact millisecond (0024); each save moved them back by 1 ms |
| TABLESTYLE / CELLSTYLEMAP cell styles (DXF) | Kept through a save (0028): data/title/header assigned on read, 284–289 visibility read the right way round, CELLSTYLEMAP margins and borders read and written. Were reset to defaults on every save |
| Xdata 1012 displacements, 1003 layer names, 1005 handles (DXF write) | Written as read (0029); a displacement broke the record and moved the next object's xdata, layers went out as handles, dangling handles as 0 |
| Xdata on symbol tables (DXF write) | Written (0030); the VPORT table's `ACAD DbSaveVer` was dropped |
| ACDBASSOC* / ACDBPERSSUBENTMANAGER / SUN / view styles / AEC_* and every other unmapped type | Kept raw and written back under its handle (patches 0014, 0016; `readCadDocument` sets the keep flags): DXF → DXF as the group codes read, DWG → DWG of the same version as the object record read. All 1,329 unknown objects in the public corpus survive a save. **Not** converted across formats or versions: a DWG-read object saved to DXF, or to another DWG version, is skipped with a writer notification |
| SUN (VPORT / VIEWPORT 361), 3DSOLID history (350) | Linked and written (0017). `ACSH_*` solid history objects are still not reached in DWG (every version) or DXF: 40 handles (M1-33) |
| CLASSES with a shared DXF name (AEC) | Both kept under their read class numbers; class numbers survive a save (0015) |
| DATATABLE / TABLECONTENT owned through an XRECORD | Read and kept (0018); TABLECONTENT is **not written to DXF** (writer gap, M1-31) |
| DIMASSOC | Read; **not written to DXF** (47 handles, M1-31) |
| ACAD_PROXY_OBJECT | Kept on read; **skipped by the DXF writer** (98 handles in the R13/R14 binary DXFs, M1-31) |
| TABLESTYLE / CELLSTYLEMAP, ACAD_TABLE | Lossy in DXF (R5, R12–R15) |
| ACAD_TABLE cells (DWG write) | R2004/R2007 cell overrides (alignment, colours, text height, borders) written behind their flag word (0041); R2010+ cell geometry written with no content geometry (0042); R2004/R2007 block cells keep their block record (0043). All three were reset on a save; DWG tables now round-trip with no difference |
| MULTILEADER (DXF) | Written in AutoCAD's group order with its context data, branches and leader lines (0037); the reader decodes the context text colour as an AcCmColor and reads the branch groups. A save reset every multileader to defaults with an empty label |
| ENDBLK entity data (DXF write) | Colour, linetype, lineweight, linetype scale and visibility written as for BLOCK (0038); only the layer was written |
| TOLERANCE text (DXF) | Caret codes decoded on read, so the `^J` between rows is a line break as in DWG (0039); each save had turned `^J` into `^ J` |
| MESH header (DXF write) | Version, blend crease and subdivision level written on 71, 72 and 91 (0040); the level went out as the version and the rest as 0 |
| MTEXT columns (R2018) | Written to DXF as the embedded object, with the defined extents (0035); the DWG reader keeps the column count (0036). Every multi-column MTEXT lost its columns on a DXF save |
| Angles (DXF write): TEXT rotation, ARC angles, HATCH pattern lines and edges | Written as the degree value that reads back to the same radians (0033); about one angle in a few dozen moved by an ulp on every save. HATCH edge angles past 360° are kept, and a SOLID hatch keeps its pattern angle, scale and lines |
| VIEWPORT entity (DXF write) | Every AcDbViewport group written with its own code, R2000+ settings included (0031); id, angles, zoom, UCS, plot style, clip boundary and visual style were scrambled or dropped |
| ATTDEF / ATTRIB fields (DXF) | Version (R2010+), lock position (R2007+) and R2018 multiline text read and written (0032); AcDbText 71 mirror flags no longer read as the multiline flag |
| XRECORD, SORTENTSTABLE | Kept when owned by unknown objects (0014); entries written in the order read (0034); the draw order was kept, the entry order was not. `SORTENTSTABLE` in DXF is never loaded (94 handles, M1-33); XRECORDs under skipped objects drop with them (1,368 at save, 240 never loaded; M1-31, M1-33) |
| LAYOUT plot flags (DXF read), `$CELWEIGHT` (DWG header) | Fixed by patches 0019 and 0020 |
| LAYOUT paper image origin and standard scale (DXF) | One origin for the DXF reader and both writers (0044); the standard scale written as 147 (0045). A save wrote origin 0,0 and the print scale as the standard scale |
| LTYPE alignment (DXF) | 72 read and written as the character code (0046); read as the digits "65", and the R12 default written as 0 |
| ARC_DIMENSION (DXF write) | Written with its dimension and arc data (0047); only its common entity data was written, so it came back with no block, points or angles |
| LAYER flags (DWG write, R2000+) | "Frozen in new viewports" written from its own flag (0048); it was written from the frozen flag |
| MLINESTYLE element linetypes (DWG write, before R2018) | Written as the linetype index the reader resolves (0049); every element came back with the first linetype |
| BLOCK_RECORD insert list (DWG write, R2000+) | Kept as read, then new inserts, from every block (0050); rebuilt from model-space inserts only |
| `$DIMBLK`, `$DIMBLK1`, `$DIMBLK2` (DWG write, R2000+) | Written as their block records (0051); were written null. `$DIMLDRBLK` is still not kept |
| LEADER annotation (DWG write) | Written (0052); every leader came off its annotation |
| DBCOLOR (DWG write, before R2004) | Colour index written (0053); was written as 0 |
| Single-character header variables `$DIMDSEP`, `$LOFTNORMALS`, `$LIGHTGLYPHDISPLAY`, `$DWFFRAME`, `$DGNFRAME` (DXF) | Read and written as character codes, as in DWG (0055); DXF kept the digits ("46" for "."). A flag the drawing never set stays out of the file (0054); it was written as 0 |
| `$LASTSAVEDBY`, `$ACADMAINTVER` | Describe the program that saved the file; allowed to change on save (DEC-041) |
| IMAGEDEF default pixel size (DXF write) | Written (0056); reset to 1 × 1 |
| VIEW visual style (DXF write) | Written (0057); was dropped |
| MLEADERSTYLE 298 flag (DXF write) | Written as read (0058); was always false |
