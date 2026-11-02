# File Fidelity Matrix

One row per DXF/DWG entity, object or table type. A type is **done** only when all five columns are ticked and a corpus file exercises it. Threads update rows in the PR that lands the work. "P" in a column means handled purely by passthrough (preserved, not interpreted) — that is a valid final state for the types marked *(passthrough-only)*.

Since M1-05 every save goes through `exportDocument`: it starts from the retained original and writes back only what differs from the original's own mapping, so a type Triya does not edit is written back untouched (its Write cell stays empty until its writer exists, roadmap M1-75), and the round-trip suite gates zero differences on every readable corpus file.

Columns: **Read** (mapped into Triya model) · **Render** (drawn like AutoCAD) · **Edit** (modifiable by Triya commands) · **Write** (rebuilt on export without loss) · **Test** (corpus file + round-trip + fidelity reference).

## Entities

| Type | Read | Render | Edit | Write | Test file |
|---|---|---|---|---|---|
| LINE | ✓ | | | ✓ (changes written back by handle onto the original, only the fields that changed, M1-05; `export.corpus.test.ts`) | |
| XLINE | ✓ (drawn clipped to the view, its linetype laid out from the base point both ways so dashes stay put while panning, M1-45; text and shapes in the linetype not drawn) | | | ✓ (changes written back by handle onto the original, only the fields that changed, M1-05; `export.corpus.test.ts`) | |
| RAY | ✓ (drawn clipped to the view, its linetype laid out from the base point onward, M1-45; text and shapes in the linetype not drawn) | | | ✓ (changes written back by handle onto the original, only the fields that changed, M1-05; `export.corpus.test.ts`) | |
| CIRCLE | ✓ | | | ✓ (changes written back by handle onto the original, only the fields that changed, M1-05; `export.corpus.test.ts`) | |
| ARC | ✓ | | | ✓ (changes written back by handle onto the original, only the fields that changed, M1-05; `export.corpus.test.ts`) | |
| ELLIPSE | ✓ | | | ✓ (changes written back by handle onto the original, only the fields that changed, M1-05; `export.corpus.test.ts`) | |
| POINT | ✓ | | | ✓ (changes written back by handle onto the original, only the fields that changed, M1-05; `export.corpus.test.ts`) | |
| LWPOLYLINE | ✓ (widths drawn as filled segments, tapered along lines and arcs, mitred where wide segments meet, outlined under FILLMODE 0, and bounded by those outlines, M1-46; wide segments draw continuous whatever the linetype until M1-66) | | | ✓ (changes written back by handle onto the original, only the fields that changed, M1-05; `export.corpus.test.ts`) | |
| POLYLINE (2D) + VERTEX + SEQEND | ✓ (widths, with the POLYLINE's 40/41 defaults, drawn as for LWPOLYLINE, M1-46) | | | | |
| POLYLINE (3D, mesh, pface) *(render as 2D projection; edit none)* | ✓ 3D (meshes not yet) | | — | | |
| SPLINE | ✓ (a spline stored only as fit points, as R2013+ DWGs can hold one, draws and is bounded as AutoCAD's interpolation of them, M1-47; tangent, closed, √chord, uniform and fit-tolerance cases unverified until M1-65) | | | | |
| SOLID | ✓ | | | | |
| TRACE | ✓ as SOLID (acad-ts reads TRACE as SOLID, M1-32) | | | | |
| 3DFACE *(render edges)* | ✓ | | — | | |
| TEXT | ✓ (drawn by the renderer as SHX strokes or TrueType fills from the loaded fonts, with AutoCAD's justification, M1-41 part 1; unverified against AutoCAD plots until M1-24/M1-26) | | | ✓ (changes written back by handle onto the original, only the fields that changed, M1-05; `export.corpus.test.ts`) | |
| MTEXT | ✓ (contents with codes as stored; R2018 columns kept through DXF and DWG saves, 0035/0036; drawn by the renderer from the loaded fonts with colour, font, stack, big-font and decoration codes, M1-41 part 1; background fill, mask and frame, M1-41 part 2; vertical text not yet) | | | ✓ (changes written back by handle onto the original, only the fields that changed, M1-05; `export.corpus.test.ts`) | |
| ATTDEF | ✓ (version, lock position and R2018 multiline text kept through a DXF save, 0032) | | | | |
| ATTRIB | ✓ folded into its INSERT (version, lock position and R2018 multiline text kept through a DXF save, 0032) | | | | |
| INSERT | ✓ (drawn by the renderer through nesting with ByBlock and layer-0 inheritance, M1-14 part 1; attributes not drawn yet) | | | | |
| MINSERT | ✓ (every cell drawn, M1-14 part 1) | | | | |
| DIMENSION (linear/aligned) | ✓ (rotated with an empty AcDbRotatedDimension read as aligned by acad-ts, M1-32; drawn from its stored `*D` block by the renderer, M1-15 part 1, its text with it once fonts are loaded, M1-41 part 1; annotative scale representations not yet) | | | | |
| DIMENSION (angular 2-line / 3-point) | ✓ (drawn from its stored `*D` block, M1-15 part 1) | | | | |
| DIMENSION (radial / diametric) | ✓ (drawn from its stored `*D` block, M1-15 part 1) | | | | |
| DIMENSION (ordinate) | ✓ (drawn from its stored `*D` block, M1-15 part 1) | | | | |
| DIMENSION (arc length) | ✓ (ARC_DIMENSION; drawn from its stored `*D` block, M1-15 part 1) | | | | |
| DIMENSION (jogged) | ✓ DXF (LARGE_RADIAL_DIMENSION read as `DimensionRadialLarge` since acad-ts patch 0107, M1-34); DWG still kept raw, not mapped (M1-74) | ✓ (drawn from its stored `*D` block) | | ✓ DXF (written with its AcDbRadialDimensionLarge data); left out of a DWG save of a DXF, as before (M1-74) | `entities.corpus.test.ts` (2 in uncommon.dxf) |
| LEADER | ✓ (drawn by the renderer as its path and arrowhead from its DIMSTYLE and `DSTYLE` overrides, and bounded by them, M1-52 part 2; a DXF LEADER without group 71 has its arrowhead on, as its DWG twin, since acad-ts patch 0074) | | | | |
| MLEADER (+ MLEADERSTYLE) | ✓ (DXF branches and the context text colour read since 0037; the context arrowhead size read as `drawnArrowheadSize`; drawn by the renderer as its leader lines, landing, arrowheads and MTEXT with its frame, and bounded by them, M1-52 part 1; block content drawn as an INSERT of its block, M1-52 part 2; spline leaders drawn as the cubic through their vertices, M1-47; block-content attributes, per-line overrides and underline attachments for a later part) | | | | |
| HATCH (pattern/solid/gradient; line/arc/ellipse/spline/polyline edges) | ✓ (style 75, seed points and ellipse-edge major axes read since acad-ts patch 0108, M1-32 part 1; solid and pattern fills drawn by the renderer from the stored pattern lines, M1-16 part 1; gradient fills and the sub-pixel pattern tint, M1-16 part 2; a hatch stored without pattern lines drawn from its user-defined settings or the bundled patterns, M1-16 part 3; with the gradient ramps unverified against AutoCAD plots until M1-24/M1-26) | | | | |
| WIPEOUT | ✓ (acad-ts skips the clip type 71; the mapper infers a polygon from more than two vertices, M1-32; drawn by the renderer as its boundary filled in the background colour, framed per WIPEOUTFRAME, M1-19 part 1) | | | | `images.corpus.test.ts` (23 wipeouts) |
| IMAGE (+ IMAGEDEF, IMAGEDEF_REACTOR) | ✓ IMAGE (clip type as for WIPEOUT); drawn by the renderer from the app's decoded bitmap, clipped (rectangle, polygon, inverted), framed per IMAGEFRAME, with brightness, contrast, fade and transparency applied (our curves, unverified until M1-64), outlined while no bitmap is loaded (M1-19 part 1); BMP, TIFF, PNG, JPEG and GIF decoded, IMAGEQUALITY draft unsmoothed (part 2); finding the files is M1-21 | | | | `images.corpus.test.ts` (85 images, no bitmaps in the corpus) |
| TABLE (ACAD_TABLE + TABLESTYLE + cell styles) | ✓ grid, `*T` block and cells (text, block, spans, merges, rotation) and cell formats (alignment, text style and height, content colour, background, edges, R2010+ margins; DXF/R2004 flag words and R2010+ cell, row, column and content formats folded the same way, M1-36, patch 0110); table-wide overrides not mapped yet (M1-77); ezdxf-written tables are read since patch 0099 (an empty cell's 91 had thrown, M1-33); drawn by the renderer from the `*T` block in the table's frame, M1-17 | | | | |
| VIEWPORT | ✓ frame, view, clip boundary, frozen layers, plot style and render mode (DXF status 68, clip boundary 340 and the R12 MVIEW view lost by acad-ts, M1-32; DWG reads 68 and 340; a stated viewport ID of 0 is kept, M1-58); drawn in its layout as its frame and its view of model space, clipped to the frame (M1-18 part 1), hiding the layers frozen in it and scaling linetypes by PSLTSCALE (part 2); non-rectangular clips, VP layer overrides and annotative scales not yet | | | | |
| TOLERANCE | ✓ (caret codes decoded since 0039; drawn by the renderer as its compartment frames and text, sized by the text engine, and bounded by them, M1-52 part 4; GD&T symbols (`{\Fgdt;x}`) draw with the bundled GD&T font `oet-gdt`, M1-54; DXF frames take AutoCAD's DIMGAP since 0075, M1-53) | | | | |
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
| LTYPE (simple + complex) | ✓ (patterns, text and shape elements fitted by `dashPath`, M1-13 part 1; `.lin` files read by `parseLin`; drawn by the renderer at LTSCALE × object scale, M1-13 part 3; embedded text and shapes drawn with their STYLE's font or shape file, M1-45 part 1; DXF segment styles (340) read since patch 0105) | | | `style.corpus.test.ts` (473 records) |
| STYLE (text styles, SHX and TTF, bigfont) | ✓ | | | |
| DIMSTYLE (all DIMVARS + overrides via xdata) | ✓ record, all DIMVARs (xdata overrides not yet); DIMVARs a DXF leaves out read as AutoCAD's defaults since acad-ts patch 0075, so every acadsharp DXF style equals its DWG twin's; R2004+ DWG true colours (DIMCLRD/E/T, DIMTFILLCLR) are kept beside the ACI AutoCAD writes for them in DXF (M1-55) and LEADER/TOLERANCE draw in them | | | |
| APPID | ✓ | | | |
| BLOCK_RECORD (+ BLOCK/ENDBLK, *Model_Space, *Paper_Space*, *D, *U, *X, *T) | ✓ record (BLOCK/ENDBLK with M1-04) | | | |
| VPORT | ✓ | | | |
| VIEW | ✓ | | | |
| UCS | ✓ | | | |

Read ticks for tables (M1-03) mean every field of the record compares equal to an independent DXF reader on every readable public corpus file (`packages/testkit/src/mapping/tables.corpus.test.ts`), except the acad-ts read gaps listed there as `ACAD_TS_GAPS` (layer material, nameless shape `STYLE` records, R12 `DIMBLK` names), which M1-32 closes. MLEADERSTYLE and TABLESTYLE objects are checked the same way. The header is mapped too: every variable acad-ts knows is carried by DXF name and compared the same way, which since M1-32 part 2 (acad-ts patch 0111) is every AutoCAD variable a corpus DXF states (`$LINMIN`/`$LINMAX` in ezdxf's hand-written `Minimal_DXF_AC1006.dxf` are not AutoCAD variables and are skipped, as AutoCAD skips them).

## Objects (non-graphical)

| Object | Read | Edit | Write | Test |
|---|---|---|---|---|
| DICTIONARY / ACDBDICTIONARYWDFLT | | | | |
| LAYOUT + PLOTSETTINGS | ✓ tab, block record, layout flags, limits and the page setup that places the sheet: paper size, margins, paper units, rotation, plot offset, scale, plot type and flags (`mapLayouts`, M1-18 part 1); the sheet equals AutoCAD's stored limits on 70 corpus layouts (`layouts.corpus.test.ts`); other PLOTSETTINGS fields stay on the retained original | | | `packages/io/test/map-layouts.test.ts`, `packages/testkit/src/render/layouts.corpus.test.ts` |
| MLEADERSTYLE / TABLESTYLE / MLINESTYLE | ✓ MLEADERSTYLE, TABLESTYLE (MLINESTYLE not yet) | | | |
| SCALE (ACAD_SCALELIST) | | | | |
| LAYER_FILTER / LAYER_INDEX / ACAD_LAYERSTATES | | | | |
| GROUP | | | | |
| XRECORD | | | | |
| PLACEHOLDER / IDBUFFER | | | | |
| SORTENTSTABLE | ✓ entries in stored order (`mapSortEnts`), draw order by sort handle (`drawOrder`; M1-13 part 2) | | | `style.corpus.test.ts` (75 tables, 28 reorder their block) |
| IMAGEDEF / RASTERVARIABLES | ✓ file name, pixel size, default pixel size, loaded flag and units; IMAGEFRAME, IMAGEQUALITY and units (`mapImageObjects`, M1-19 part 1) | | | `images.corpus.test.ts` (25 IMAGEDEFs, each IMAGE's found) |
| PDFDEFINITION / DWFDEFINITION / DGNDEFINITION | | | | |
| SPATIAL_FILTER (XCLIP) | | | | |
| WIPEOUTVARIABLES | ✓ WIPEOUTFRAME (`mapImageObjects`, M1-19 part 1; acad-ts reads it as on/off, so value 2 reads as on) | | | |
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
| R2.6–R12 (AC1009 and earlier) | 0 / 7 / 2 | all | 9 | none in the public corpus (M1-56); no R12 DWG yet (M1-26) |
| R13 (AC1012) | 0 / 2 / 1 | all | 3 | none in the public corpus (M1-58) |
| R14 (AC1014) | 1 / 1 / 1 | all | 3 | none in the public corpus (M1-58) |
| 2000 (AC1015) | 1 / 5 / 2 | all | 8 | none in the public corpus (M1-58) |
| 2004–2013 (AC1018–AC1027) | 4 / 46 / 4 | all | 54 | none in the public corpus (M1-58) |
| 2018 (AC1032) | 15 / 26 / 1 | all but `recover02.dxf` (malformed) | 41 | none in the public corpus (M1-33 part 1) |

| Type | acad-ts status after M0-06 and M1-30 |
|---|---|
| VPORT, LAYER, LAYOUT (DXF write) | Fixed by patches 0008, 0009, 0010 |
| Header flag word, true colours, template page, layout limits, block previews (DWG) | Fixed by patches 0003–0007 |
| Dynamic-block evaluation graph (DXF write) | Writer no longer crashes (0002). The graph's parameters, grips, actions and grip-location components join the document with their graph (0092), DXF actions keep their owner and selection set (0093), DXF saves write them as read (0094), a DWG flip grip reads in the right order (0095), and DXF expressions of any value type read (0097): every handle of the acadsharp `dynamic-blocks` files is kept. Left (M1-33): the graphs of the R14–R2004 `sample_AC10xx` DWGs and `ACDB_BLOCKREPRESENTATION_DATA` in the R2000/R2004 DXFs |
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
| SUN (VPORT / VIEWPORT 361), 3DSOLID history (350) | Linked and written (0017). `ACSH_*` solid history nodes join the document with their graph (0092); before R2007 the history is held through an XRECORD in the solid's extension dictionary and now joins the document with the solid, with its graph and nodes (0101) |
| CLASSES with a shared DXF name (AEC) | Both kept under their read class numbers; class numbers survive a save (0015) |
| AEC_WALL, AEC_WALL_STYLE, AEC_CLEANUP_GROUP_DEF, BINRECORD (DWG) | Raw data ends at the data stream (0073); it took in the handle and string streams, so each save grew it by 6–20 bytes. `AecObjects.dwg` round-trips with no difference |
| DATATABLE / TABLECONTENT owned through an XRECORD | Read and kept (0018); TABLECONTENT kept as read and written back raw in DXF (0070, DEC-040), it was skipped on every DXF save. R2000/R2004 DXF DATATABLE, TABLEGEOMETRY and the objects after a TABLECONTENT are loaded (0098, 0099); the TABLECONTENT reader had run past its end and swallowed them |
| DIMASSOC | Read and written (0061); the DXF writer refused it, dropping 47 associations and the reactors that point at them |
| IMAGEDEF_REACTOR (DXF write) | Written with its image (0062); 77 reactors were dropped because nothing queued them |
| ACAD_PROXY_OBJECT | Kept as read and written back raw in DXF (0063, DEC-040); the DXF writer skipped all 98 in the R13/R14 binary DXFs |
| R12 `$MODEL_SPACE` / `$PAPER_SPACE` blocks (DXF write) | Written, empty, as AutoCAD writes them (0064); were left out, so their BLOCK/ENDBLK handles changed on every R12 save. A space block the file did not have is still left out (0076), so reopening makes it up again under the same handle |
| R12 DIMSTYLE handle (DXF write) | Written on 105 (0065); was left out. Nameless blocks with no record (ezdxf `r12_blocks_with_no_names.dxf`, `r2000_blocks_with_no_name_and_no_block_record.dxf`) are kept as raw entities and written back in BLOCKS (0104) |
| R12 handles acad-ts makes up (DXF write) | Left out of the saved file with every table entry and block acad-ts added as a default, and `$HANDSEED` written as read (0076), so reopening makes up the same handles for the same objects. A save wrote some made-up handles and a raised `$HANDSEED`, so every R12 BLOCK_RECORD, BLOCK and owner link moved: about 6,000 differences in the R12 corpus. An object added after reading keeps its handle, and the made-up ones then move above it |
| Xdata of POLYLINE and of INSERT with attributes (DXF write) | Written before the VERTEX/ATTRIB records (0078); written after the SEQEND, it was read back as the SEQEND's xdata |
| Layer, linetype and style of ATTRIB / VERTEX / SEQEND / polyface faces | The document's table entries (0106); held inside their owner, they kept detached defaults, and a layer-0 child read back with no layer after a DXF save (code 8 is omitted for layer 0). The round-trip diff compares these children since M1-68 |
| Xdata of BLOCK (DXF write) | Written (0080); the BLOCK writer wrote none, so ezdxf's `$MODEL_SPACE` tags were dropped |
| R12 xdata 1003 layer names (DXF read) | Linked to the layer once its handle is made up (0077); an R12 layer states no handle, so the record named handle 0 and a save left the 1003 out |
| R12 `$DWGCODEPAGE` (DXF write) | Written (0079); R12 saves left it out, so a drawing in any other code page was read back as ANSI_1252 |
| DXF with no `$ACADVER` (read) | Read as R12 when it has no CLASSES or OBJECTS section, as AutoCAD and ezdxf read it, and saved as R12 (0081); it was saved as R2018 with a layout and dictionaries the file never had. A block record's owned handles follow its entities when the document renumbers one |
| GEODATA coordinate system (DXF read) | The last 301 chunk appended after the 303s (0082); it replaced them, so the XML or WKT definition kept only its tail, with `^J` left as text |
| R2009 GEODATA (DXF) | Reference point read from 40/41/42 and not zeroed by the 11 after it (0090); horizontal unit scale written as 46 (0091), where the user scale factor went |
| FIELD code and format string (DXF read) | Every chunk appended in order: field code 3s then 2, format string 9s then 301 (0083); the last chunk replaced the ones before it |
| STYLE `ACAD` font xdata (DXF write) | Face name and charset, pitch and family bits kept as read while the font file is unchanged; only bold and italic are refreshed (0084). They were rebuilt from the file name ("ariblk" for "Arial Black") |
| DBCOLOR without a true colour (DXF write) | 420 written only for a true colour (0085); index colours went out as true colour 0 (black) |
| ACI for a true colour (DXF 62 beside 420, R12 DXF, R2000 DWG, `$CECOLOR`, table cells) and the ACI palette | The nearest ACI in the palette AutoCAD looks true colours up in, as AutoCAD writes it on all 3,532 corpus pairs, and 62 written before an entity's 420 (0109); it was usually 0 (ByBlock) or 1, and entities had no 62. The 31 mistyped `Color._indexRgb` entries (ACI 29, 91, …, 192, greys 250–254) match the computed palette (0109) |
| IMAGE clip mode (DXF write, R2010+) | 290 written (0086); an inverted clip came back normal |
| DEFPOINTS plot flag (DXF read) | Read as not plotted, as AutoCAD treats it and as the writer writes it (0087) |
| MLINESTYLE element colours (DXF read) | 62 after an element's 49 read as that element's colour (0088); it overwrote the fill colour |
| VIEWPORT ID 0 (DXF) | A stated 69 = 0 is kept (0089); 0 read as unset, so the ID was numbered by position and written that way |
| DXF owner (330) | Taken only from the 330 before the first subclass marker, unless none was stated (0096); a later 330 an object's reader did not consume (an unknown action's selection set, TABLEGEOMETRY's null cell references) replaced the owner, and the object never joined the document |
| TABLESTYLE / CELLSTYLEMAP, ACAD_TABLE | Lossy in DXF (R5, R12–R15) |
| ACAD_TABLE (DXF) | Written (0068): the writer had no table branch, so every table went out as a bare INSERT and was lost with its extension dictionary, round-trip XRECORD and TABLECONTENT. The reader keeps cell override flags, block scale, alignment and chunked text (0066), and the table-wide overrides as read (DEC-043); 41 there had been read as the X scale. The acadsharp R2000–R2018 DXFs now round-trip with no table difference |
| Table cell values (DXF) | Units, format and formatted value written from R2007 (0067); an empty value writes no payload, it was written as 91=0, which the reader rejects (FIELD 0x5F8 of `uncommon.dxf` was lost) |
| Table, data-map and field values before R2007 (DXF read) | End on their type's last data code (0098): they have no 304 ACVALUE_END, so the reader consumed the enclosing structure and the next objects (each TABLECONTENT of the acadsharp R2000/R2004 DXFs swallowed its TABLEGEOMETRY, DATATABLE and the dictionaries after it) |
| Child fields | Kept inside the parent field (`Field.children`, never registered with the document) and saved with it; the handle gate counts them since M1-33 part 3 |
| Date values (DXF) | Read and written as `92 = 16` and a SYSTEMTIME `310` from R2007 (0100); the reader skipped the bytes and the writer wrote `91 = 0`, so field and table-cell dates were lost on every save |
| Dictionary default entry | A `DICTIONARYWDFLT` default that is not one of the entries (R14 `ACAD_PLOTSTYLENAME` → `ACDBPLACEHOLDER`) is registered and written to DXF (0102); the DXF save dropped it |
| Objects no reference reaches (DWG) | An object in the object map whose owner is not in the file (a block record the map lacks, an erased dictionary) is read once the references are exhausted and kept as its raw record in `CadDocument.unreachableObjects`; a DWG save of the same version writes it back (0103, `keepUnreachableObjects`). A DXF save of a DWG drops them, as it drops other DWG-only raw objects |
| Unknown-type table value with a 91 (DXF read) | Read (0099); setting the 91 threw and dropped the whole ACAD_TABLE or TABLECONTENT (empty cells of ezdxf `acad_table_simple.dxf`, `acad_table_with_blk_ref.dxf` and every pre-R2007 table) |
| XRECORD strings and unresolved handles (DXF) | Strings decoded on read, so `^J` stays a line break (0069); handles to objects acad-ts never reads written as read, they were dropped |
| Text encoding of R2007+ DXF | Read and written as UTF-8, as AutoCAD writes it (0071); was read in the `$DWGCODEPAGE` code page, so every non-ASCII character came in garbled ("15°" as "15Â°") and the save repeated the mistake in reverse |
| `\U+XXXX` escapes (DXF) | Decoded on read, and written for characters the code page cannot hold before R2007 (0072); kept as text, so escaped names were refused on save (the `dxf_unicode.dxf` and `ASCII_R12.dxf` layers) and other characters were written as "?". DWG strings before R2007 still keep the escapes as text (M1-32) |
| ACAD_TABLE cells (DWG write) | R2004/R2007 cell overrides (alignment, colours, text height, borders) written behind their flag word (0041); R2010+ cell geometry written with no content geometry (0042); R2004/R2007 block cells keep their block record (0043). All three were reset on a save; DWG tables now round-trip with no difference |
| MULTILEADER (DXF) | Written in AutoCAD's group order with its context data, branches and leader lines (0037); the reader decodes the context text colour as an AcCmColor and reads the branch groups. A save reset every multileader to defaults with an empty label |
| ENDBLK entity data (DXF write) | Colour, linetype, lineweight, linetype scale and visibility written as for BLOCK (0038); only the layer was written |
| TOLERANCE text (DXF) | Caret codes decoded on read, so the `^J` between rows is a line break as in DWG (0039); each save had turned `^J` into `^ J` |
| MESH header (DXF write) | Version, blend crease and subdivision level written on 71, 72 and 91 (0040); the level went out as the version and the rest as 0 |
| MTEXT columns (R2018) | Written to DXF as the embedded object, with the defined extents (0035); the DWG reader keeps the column count (0036). Every multi-column MTEXT lost its columns on a DXF save |
| Angles (DXF write): TEXT rotation, ARC angles, HATCH pattern lines and edges | Written as the degree value that reads back to the same radians (0033); about one angle in a few dozen moved by an ulp on every save. HATCH edge angles past 360° are kept, and a SOLID hatch keeps its pattern angle, scale and lines |
| VIEWPORT entity (DXF write) | Every AcDbViewport group written with its own code, R2000+ settings included (0031); id, angles, zoom, UCS, plot style, clip boundary and visual style were scrambled or dropped |
| ATTDEF / ATTRIB fields (DXF) | Version (R2010+), lock position (R2007+) and R2018 multiline text read and written (0032); AcDbText 71 mirror flags no longer read as the multiline flag |
| XRECORD, SORTENTSTABLE | Kept when owned by unknown objects (0014); entries written in the order read (0034); the draw order was kept, the entry order was not. DXF `SORTENTSTABLE` is loaded: the 94 "lost" handles were its sort handles, which the handle gate counted as objects (M1-33 part 2). XRECORDs under skipped objects dropped with them (1,368 at save, M1-31); of the 240 never loaded, 230 came back with 0098/0099 or were attribute dictionaries the gate did not look into; 10 are left (`AecObjects.dwg`, `sample_base.dwg`, M1-33) |
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
| XRECORD null object references (DWG write) | Written as handle 0 (0059); the entry was dropped |
| ACDBDICTIONARYWDFLT default entry (DWG write) | Object written (0060); an R14 placeholder owned only through it was lost |
| 30 header variables missing from the acad-ts header map (`$ATTDIA`, `$ATTREQ`, `$SURFTAB1`/`2`, `$SURFU`/`V`, `$PUCSORG`, `$UCSORTHOREF`, `$CMATERIAL`, `$INTERSECTIONCOLOR`, `$TILEMODELIGHTSYNCH`, …) | Read from DXF and written back (0111, M1-32 part 2); DXF read dropped them and saves never wrote them. In DWG, `$SURFV` was read into `$SURFU`, the R2004+ `$INTERSECTIONCOLOR` into `$INTERFERECOLOR`, and the R13/R14 `$ATTREQ`/`$ATTDIA`/`$DELOBJ`/`$DRAGMODE`/`$COORDS`/`$PICKSTYLE`, `$TILEMODELIGHTSYNCH`, the orthographic UCS views and the material and visual-style pointers were read and dropped, then written as constants; all are kept now. `$CMATERIAL`, `$INTERFEREOBJVS` and `$INTERFEREVPVS` are kept as raw handles (acad-ts has no MATERIAL or VISUALSTYLE class) |
