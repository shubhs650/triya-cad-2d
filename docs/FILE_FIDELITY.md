# File Fidelity Matrix

One row per DXF/DWG entity, object or table type. A type is **done** only when all five columns are ticked and a corpus file exercises it. Threads update rows in the PR that lands the work. "P" in a column means handled purely by passthrough (preserved, not interpreted) — that is a valid final state for the types marked *(passthrough-only)*.

Columns: **Read** (mapped into Triya model) · **Render** (drawn like AutoCAD) · **Edit** (modifiable by Triya commands) · **Write** (rebuilt on export without loss) · **Test** (corpus file + round-trip + fidelity reference).

## Entities

| Type | Read | Render | Edit | Write | Test file |
|---|---|---|---|---|---|
| LINE | | | | | |
| XLINE | | | | | |
| RAY | | | | | |
| CIRCLE | | | | | |
| ARC | | | | | |
| ELLIPSE | | | | | |
| POINT | | | | | |
| LWPOLYLINE | | | | | |
| POLYLINE (2D) + VERTEX + SEQEND | | | | | |
| POLYLINE (3D, mesh, pface) *(render as 2D projection; edit none)* | | | — | | |
| SPLINE | | | | | |
| SOLID | | | | | |
| TRACE | | | | | |
| 3DFACE *(render edges)* | | | — | | |
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

## Tables

| Table | Read | Edit | Write | Test |
|---|---|---|---|---|
| LAYER (+ VP overrides via xdata/dictionaries) | | | | |
| LTYPE (simple + complex) | | | | |
| STYLE (text styles, SHX and TTF, bigfont) | | | | |
| DIMSTYLE (all DIMVARS + overrides via xdata) | | | | |
| APPID | | | | |
| BLOCK_RECORD (+ BLOCK/ENDBLK, *Model_Space, *Paper_Space*, *D, *U, *X, *T) | | | | |
| VPORT | | | | |
| VIEW | | | | |
| UCS | | | | |

## Objects (non-graphical)

| Object | Read | Edit | Write | Test |
|---|---|---|---|---|
| DICTIONARY / ACDBDICTIONARYWDFLT | | | | |
| LAYOUT + PLOTSETTINGS | | | | |
| MLEADERSTYLE / TABLESTYLE / MLINESTYLE | | | | |
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
