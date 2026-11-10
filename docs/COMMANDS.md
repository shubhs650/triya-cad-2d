# Command and Alias Reference (normative)

This is the command surface a drafter expects. Aliases are the AutoCAD `acad.pgp` defaults. **Tier 1** = required for the markup workflow (M2). **Tier 2** = required for v1 complete. **Tier 3** = Should. Status: ` ` open · `~` in progress · `x` done (PR). Threads update the Status column in the same PR that lands the command. A command is "done" only with its options, prompts, Dynamic Input behaviour, and tests.

Transparent commands (usable mid-command with `'`) are marked ᵀ. Dash variants (`-NAME`) are required where noted.

The Aliases column is the engine's alias table (`ALIASES` in `packages/engine/src/commands/aliases.ts`, M2-01); `tests/docs/commands-aliases.test.ts` fails if the two differ, so change both together. Keyboard shortcuts (Ctrl+…, F-keys) in that column belong to the UI.

## Draw

| Command | Aliases | Tier | Options / notes | Status |
|---|---|---|---|---|
| LINE | L | 1 | Undo, Close, continue from last (↵), tangent/perp via osnap | ~ (#222: Undo, Close, ↵ from the last line; #226: running osnaps incl. PER and TAN from the last point; arcs M3-01) |
| PLINE | PL | 1 | Arc (Angle/CEnter/CLose/Direction/Halfwidth/Line/Radius/Second pt/Undo/Width), Halfwidth, Length, Undo, Width, Close | |
| CIRCLE | C | 1 | 3P, 2P, TTR, TTT, Diameter | |
| ARC | A | 1 | all 11 methods; Continue (↵); Direction; Angle; Length; CEnter | |
| RECTANG | REC | 1 | Chamfer, Elevation(ignored), Fillet, Thickness(ignored), Width, Area, Dimensions, Rotation | |
| POLYGON | POL | 2 | Edge, Inscribed/Circumscribed | |
| ELLIPSE | EL | 2 | Arc, Center, Rotation | |
| SPLINE | SPL | 2 | Method (Fit/CV), Knots, Degree, Object, Close, Tolerance | |
| XLINE | XL | 2 | Hor, Ver, Ang, Bisect, Offset | |
| RAY | — | 2 | | |
| POINT | PO | 2 | PDMODE, PDSIZE, Multiple | |
| DONUT | DO | 3 | | |
| HATCH | H, BH | 2 | contextual tab; -HATCH dash variant required | |
| GRADIENT | GD | 2 | | |
| BOUNDARY | BO | 2 | Island detection, object type (polyline/region) | |
| REGION | REG | 3 | 2D only | |
| WIPEOUT | — | 1 | Frames, Polyline | x (#231; Frames ON/OFF, "Display but not plot" in M2-24) |
| REVCLOUD | — | 1 | Arc length, Object, Rectangular, Polygonal, Freehand, Style (Normal/Calligraphy), Modify | x (#231; Modify and corner grips #258) |
| DIVIDE | DIV | 2 | Block | |
| MEASURE | ME | 2 | Block | |
| MLINE | ML | 3 | read/render required; creation Should | |
| SKETCH | — | 3 | | |

## Modify

| Command | Aliases | Tier | Options / notes | Status |
|---|---|---|---|---|
| ERASE | E, DEL | 1 | | x (#227: unhooks hatches, DIMASSOCs, groups, XCLIPs, leaders and viewport clips; a viewport named by layer overrides is refused) |
| OOPS | — | 1 | | x (#223) |
| MOVE | M | 1 | Displacement, Base | x (#227, #229: base/second point, Displacement, ↵ as displacement; dragged with the cursor) |
| COPY | CO, CP | 1 | Displacement, mOde (Single/Multiple), Array | x (#227, #229: all options incl. Array Fit and Undo; dragged with the cursor, an Array is not) |
| ROTATE | RO | 1 | Copy, Reference | x (#227, #229: Copy, Reference with Points, ANGDIR/ANGBASE line; dragged with the cursor) |
| SCALE | SC | 1 | Copy, Reference; works on tables (DEC-014) | ~ (#227, #229: Copy, Reference with Points, dragged with the cursor; a table's cell text heights do not rescale yet; scaled dimensions are regenerated, #239) |
| STRETCH | S | 1 | crossing/polygon; dims/defpoints follow | ~ (#229: the last crossing window (CPolygon with M3-04), Displacement, dragged with the cursor; hatches, multilines, multileaders, regions and viewports move only when wholly inside; dimensions stretch their definition points inside and are regenerated, #239) |
| MIRROR | MI | 1 | MIRRTEXT | x (#227, #229: MIRRTEXT and MIRRHATCH, Erase source; MTEXT always stays readable; dragged with the cursor) |
| OFFSET | O | 2 | Through, Erase, Layer, Multiple, Undo; gap types | |
| TRIM | TR | 2 | Fence, Crossing, Project(2D), Edge, eRase, Undo; Shift→Extend; ↵↵ all | |
| EXTEND | EX | 2 | same as TRIM; Shift→Trim | |
| FILLET | F | 2 | Undo, Polyline, Radius, Trim, Multiple; Shift for R=0 | |
| CHAMFER | CHA | 2 | Undo, Polyline, Distance, Angle, Trim, mEthod, Multiple | |
| BREAK | BR | 2 | First point; @ for same point | |
| BREAKATPOINT | — | 2 | | |
| JOIN | J | 2 | lines/arcs/polylines/splines/ellipses | |
| EXPLODE | X | 1 | blocks, polylines, dims, mleaders, tables, hatches(to lines), arrays | |
| ARRAY | AR | 2 | Rectangular, Polar, PAth; associative; ARRAYEDIT basic; -ARRAY dash | |
| ARRAYCLASSIC | — | 3 | dialog | |
| ALIGN | AL | 2 | 2-point scale | |
| LENGTHEN | LEN | 2 | DElta, Percent, Total, DYnamic | |
| PEDIT | PE | 2 | Close/Open, Join, Width, Edit vertex, Fit, Spline, Decurve, Ltype gen, Reverse, Undo, Multiple | |
| SPLINEDIT | SPE | 3 | | |
| REVERSE | — | 2 | | |
| OVERKILL | — | 2 | tolerance, ignore props, combine | |
| CHANGE / CHPROP | -CH / CH→PROPERTIES | 2 | | |
| MATCHPROP | MA | 1 | Settings dialog | |
| PROPERTIES | PR, CH, MO, Ctrl+1 | 1 | palette | ~ (#247: palette v1, General + per-type sections, undoable edits; leftovers M2-35) |
| PROPERTIESCLOSE | — | 2 | closes the palette | x (#247) |
| UNDO / U | U, Ctrl+Z | 1 | Auto, Control, BEgin/End, Mark, Back, number | x (#223; Ctrl+Z, the Quick Access Undo button and the undo toast #252; a Layers palette toggle and a layout's rename, move or page setup are steps of their own, LAYER and LAYOUT; Auto/Combine/Layer kept as settings until macros, undoable views and the Layer Properties Manager exist) |
| REDO | Ctrl+Y | 1 | | x (#223; Ctrl+Y, Cmd+Shift+Z on a Mac and the Quick Access Redo button #252) |
| MREDO | — | 2 | | |
| COPYBASE / PASTECLIP / PASTEBLOCK / PASTEORIG / COPYCLIP / CUTCLIP | Ctrl+Shift+C, Ctrl+V, Ctrl+Shift+V, Ctrl+C, Ctrl+X | 1 | cross-document | x (#242: one Clipboard for every open drawing; the layers, linetypes, styles and blocks the objects use come along, matched by name in the target; new handles above its $HANDSEED; base point the extents' lower-left corner; PASTECLIP and PASTEBLOCK drag the curves and the extents' frame; PASTEBLOCK makes an `A$C…` block; PASTEORIG only from another drawing. Not yet pasted: images, underlays, multileaders with block attributes, xrefs, M2-32) |
| DRAWORDER | DR | 1 | Above, Under, Front, Back | x (#231) |
| TEXTTOFRONT | — | 1 | Text, Dims, Leaders, All | x (#231) |
| HATCHTOBACK | — | 1 | | x (#231) |
| GROUP / UNGROUP / GROUPEDIT / CLASSICGROUP | G / UNG | 2 | Ctrl+Shift+A toggle | |

## Selection and inquiry

| Command | Aliases | Tier | Notes | Status |
|---|---|---|---|---|
| SELECT | — | 1 | all modes: W, C, F, WP, CP, L, P, ALL, BOX, AU, A, R, M, U, SI, G | ~ (#225): pick, implied windowing (window left to right, crossing right to left, clicked or dragged), Shift-remove, W, C, BOX, ALL, L, P, A, R, U, AU, SI; Ctrl+A; PICKFIRST pre-selection at `Command:`. F, WP, CP, M, G in M3-04 |
| QSELECT | — | 2 | dialog | |
| FILTER | FI | 2 | dialog, named filters | |
| SELECTSIMILAR | — | 2 | settings | |
| Selection cycling | Ctrl+W | 2 | list popup | |
| DIST | DI | 2 | | |
| ID | — | 2 | | |
| LIST | LI, LS | 2 | | |
| AREA | AA | 2 | Add, Subtract, Object | |
| MEASUREGEOM | MEA | 2 | Distance, Radius, Angle, ARea, Quick | |
| DBLIST | — | 3 | | |

## Annotation

| Command | Aliases | Tier | Notes | Status |
|---|---|---|---|---|
| TEXT / DTEXT | DT | 1 | Justify (all), Style | ~ (#230: every justification incl. Align/Fit, Style with `?`, ↵ continues below the last text, typed in place one line at a time; TEXTSIZE follows the height; a click elsewhere starts the next line there, #232) |
| MTEXT | T, MT | 1 | in-place editor; -MTEXT dash | x (#230: two corners or Width, Height/Justify/Line spacing/Rotation/Style; in-place editor with Bold, Italic, Underline, Overline, Strikethrough, Height, Color and Stack, Ctrl+Enter or a click outside to close, Esc to drop; -MTEXT and the command line take lines until an empty one. #232: Font list, AutoStack (`1/2 ` → diagonal fraction, `^` tolerance), Enter keeps the paragraph's formatting. #234: Columns option (Dynamic/Static/No columns, widths, gutter, height), the editor's Columns menu, Column Settings dialog and Alt+Enter column break, and the ruler (first-line and paragraph indents, tab stops). Manual column heights, column grips, tab types: M2-26; fields: M4-10) |
| TEXTEDIT / DDEDIT | ED | 1 | Undo, Mode (Single/Multiple); double-click | ~ (#232: TEXT in its in-place line, MTEXT in its editor keeping the codes it has no control for; Undo, Mode; a double click on a TEXT or MTEXT runs it (DBLCLKEDIT); an emptied text is erased. an ATTDEF opens Edit Attribute Definition (tag, prompt, default; a multiline default in the MTEXT editor), #236; a dimension's text in the MTEXT editor with `<>` for the measurement, also on a double click, #241) |
| STYLE | ST | 2 | dialog; -STYLE dash | |
| FIND | — | 2 | | |
| SPELL | SP | 3 | | |
| SCALETEXT / JUSTIFYTEXT / TEXTALIGN | — | 2 | | |
| FIELD / UPDATEFIELD | — | 2 | | |
| DIMLINEAR | DLI | 1 | Mtext, Text, Angle, Horizontal, Vertical, Rotated | x (#241: two origins or a selected line, arc or polyline segment (a circle: M2-31); horizontal or vertical by the location; dragged while placed; non-associative, DIMASSOC 1) |
| DIMALIGNED | DAL | 1 | Mtext, Text, Angle | x (#241) |
| DIMRADIUS | DRA | 1 | Mtext, Text, Angle | x (#241: circle or arc; the text where the location is) |
| DIMDIAMETER | DDI | 1 | Mtext, Text, Angle | x (#241) |
| DIMANGULAR | DAN | 1 | Quadrant | ~ (#241: two lines, an arc, a circle and a second point, or three points; Mtext, Text, Angle; Quadrant: M2-31) |
| DIMCONTINUE | DCO | 1 | Select, Undo | ~ (#241: from the last linear, aligned or three-point angular dimension made, or one selected (its extension line nearest the pick); ordinate and two-line angular bases: M2-31) |
| DIMBASELINE | DBA | 1 | Select, Undo | ~ (#241: as DIMCONTINUE, each one DIMDLI further out) |
| DIMORDINATE | DOR | 2 | X/Y datum | |
| DIMARC | DAR | 2 | Partial, Leader | |
| DIMJOGGED | DJO, JOG | 2 | | |
| DIMJOGLINE | DJL | 2 | | |
| QDIM | — | 2 | | |
| DIMSPACE / DIMBREAK | — | 2 | | |
| DIMEDIT / DIMTEDIT | DED / DIMTED | 2 | Home, New, Rotate, Oblique; text position | |
| DIMOVERRIDE | DOV | 2 | | |
| DIMREASSOCIATE / DIMDISASSOCIATE | DRE | 2 | defpoint re-pick semantics (DIMASSOC=1) | |
| DIMINSPECT | — | 3 | | |
| DIMSTYLE | D, DST, DIMSTY | 2 | manager; -DIMSTYLE dash (Restore/Save/STatus/Variables/Apply) | |
| DIMREGEN | — | 2 | regenerate from engine | |
| MLEADER | MLD | 1 | leader/content first, Options | ~ (#233: arrowhead/landing/content first, Options, text and block content; annotative and built-in content blocks are M2-25) |
| MLEADEREDIT | MLE | 1 | Add/Remove | x (#233: also AIMLEADEREDITADD / AIMLEADEREDITREMOVE) |
| MLEADERALIGN / MLEADERCOLLECT | MLA / MLC | 2 | | |
| MLEADERSTYLE | MLS | 2 | | |
| LEADER / QLEADER | LEAD / LE | 2 | legacy; read/edit; create Should | |
| CENTERMARK / CENTERLINE | — | 2 | sysvars CENTEREXE, CENTERMARKEXE, CENTERLTYPE… | |
| TABLE | TB | 2 | | |
| TABLESTYLE | TS | 2 | | |
| TABLEDIT / TINSERT (cell edit) | — | 2 | | |
| TOLERANCE | TOL | 2 | | |
| WIPEOUT / REVCLOUD | — | 1 | (see Draw) | (see Draw) |

## Blocks and references

| Command | Aliases | Tier | Notes | Status |
|---|---|---|---|---|
| INSERT | I | 1 | dialog + -INSERT | |
| BLOCK | B | 2 | dialog + -BLOCK | |
| WBLOCK | W | 2 | | |
| BEDIT / BCLOSE / BSAVE | BE | 2 | block editor | |
| REFEDIT / REFCLOSE / REFSET | — | 2 | | |
| ATTDEF | ATT | 2 | dialog + -ATTDEF | |
| ATTEDIT / EATTEDIT | ATE / ATE | 1 | dialogs; -ATTEDIT dash; double-click | ~ (#236: EATTEDIT's Enhanced Attribute Editor (Attribute: values, a multiline one's `...` opening the MTEXT editor; Text Options: style, height, rotation, width factor, obliquing, backwards, upside down; Properties: layer, linetype, colour, lineweight; Apply, Select block), ATTEDIT's Edit Attributes (values, eight a page), -ATTEDIT one at a time (Value Change/Replace, Position, Height, Angle, Style, Layer, Color with Truecolor, Next) and global (string replaced, visible-on-screen or the whole drawing), block/tag/value wildcards; a double click on a reference with attributes runs EATTEDIT. Justification, annotative, plot style, picking single attributes: M2-27) |
| BATTMAN / ATTSYNC / ATTDISP / ATTREDEF | — | 2 | | |
| XREF / XATTACH / XBIND / XCLIP / XOPEN | XR / XA / XB / XC | 2 | manager palette; bind/insert | |
| IMAGEATTACH / IMAGECLIP / IMAGEADJUST / IMAGEFRAME / IMAGEQUALITY | IAT / ICL / IAD | 2 | | |
| PDFATTACH / PDFCLIP / PDFADJUST / PDFLAYERS(read) | — | 2 | | |
| EXTERNALREFERENCES | ER | 2 | palette | |
| ADCENTER | ADC, Ctrl+2 | 3 | Design-Center-lite | |
| BASE | — | 2 | | |

## Layers and properties

| Command | Aliases | Tier | Notes | Status |
|---|---|---|---|---|
| LAYER | LA | 1 | palette; -LAYER dash with full option set. Palette list, search, On/Freeze/Lock and VP Freeze display done in M1-23; command, -LAYER and other columns open | ~ |
| LAYISO / LAYUNISO | — | 2 | settings: lock+fade or off | |
| LAYOFF / LAYON / LAYFRZ / LAYTHW / LAYLCK / LAYULK | — | 2 | | |
| LAYMCUR / LAYMCH / LAYCUR / LAYWALK / LAYERP / LAYDEL / LAYMRG | — | 2 | | |
| LAYERSTATE | LAS | 2 | | |
| LAYVPI / VPLAYER | — | 2 | | |
| LINETYPE | LT | 2 | dialog + -LINETYPE | |
| LTSCALE / CELTSCALE / PSLTSCALE / MSLTSCALE | LTS | 2 | sysvars | |
| LWEIGHT | LW | 2 | dialog | |
| COLOR | COL | 2 | dialog + -COLOR | |
| CETRANSPARENCY | — | 2 | | |
| PURGE | PU | 2 | dialog + -PURGE | |
| AUDIT / RECOVER | — | 2 | Health report implementation | |
| UNITS | UN | 2 | dialog + -UNITS | |
| SETVAR | SET | 2 | any registered sysvar | |

## View and navigation

| Command | Aliases | Tier | Notes | Status |
|---|---|---|---|---|
| ZOOM ᵀ | Z | 1 | All, Center, Dynamic(≈window), Extents, Previous, Scale (nX/nXP), Window, Object, real-time | ~ (#224): window corner, n/nX/nXP (nXP in a layout; refused on the Model tab, where Triya has no floating viewport), All, Center, Dynamic (a window), Extents, Previous, Scale, Window, real time (drag up/down), transparent `'Z`; also the wheel, middle double-click and navigation bar (M1-22). Object (#225), the pre-selection too |
| PAN ᵀ | P | 1 | real-time, -PAN | x (#224): real time (left button until Esc or Enter) and -PAN (two points, or a displacement with Enter), transparent `'P`; middle-button drag and the navigation bar (M1-22) |
| REGEN / REGENALL | RE / REA | 1 | x (#224): REGEN rebuilds the current viewport's display, REGENALL every viewport of the space shown; Regen on the navigation bar (M1-22) |
| REDRAW ᵀ | R | 1 | | |
| VIEW | V | 2 | named views dialog; -VIEW | ~ (#224): VIEW and -VIEW run the -VIEW prompts ?, Restore, Save and Window on the space shown (the drawing's plan views and this session's; saved views reach the file with M2-13); the View Manager dialog, Delete and the 3D options wait |
| VPORTS / MVIEW / VPCLIP / VPMAX / VPMIN | — | 2 | | partial (M1-22 part 4): model-space tiled viewports saved in the drawing open as saved, and a click makes one current; the VPORTS command and dialog wait on M2-02 (the command line; the command engine is M2-01) |
| MSPACE / PSPACE / MODEL | MS / PS | 2 | | |
| LAYOUT / LAYOUTWIZARD(no) / PAGESETUP | LO | 2 | | |
| SCALELISTEDIT | — | 2 | | |
| CLEANSCREENON/OFF | Ctrl+0 | 2 | | |
| DSETTINGS / OSNAP / DDPTYPE | DS, SE / OS / — | 2 | | ~ (#226): running object snaps (OSMODE) are chosen from the status bar's OSNAP menu, F3 toggles them; #228: one-shot overrides typed at a point prompt (`END`, `MID,END`, `NON`…) or chosen from the Shift+right-click menu; #249: PDF underlays' geometry snapped to while PDFOSNAP is on (Settings > Drafting); the dialog is M3-06 |
| ORTHO / GRID / SNAP / POLAR(F10) / OTRACK(F11) / DYN(F12) | F8 / F7 / F9 | 1 | ~ (#224): DYN (F12 and the status bar) toggles Dynamic Input; #226: ORTHO (F8), SNAP (F9) and POLAR (F10) toggle on the status bar and in the Ctrl+K palette (not yet typed as commands); #228: GRID (F7, GRIDUNIT lines with GRIDMAJOR, adaptive) and OTRACK (F11) too, with LWT and TPY |
| OPTIONS | OP | 2 | | |
| TEXTSCR / GRAPHSCR | F2 | 1 | history window | partial (M2-01): `PromptBus.history` holds the text window's lines; the window is M2-02 |

## Output and file

| Command | Aliases | Tier | Notes | Status |
|---|---|---|---|---|
| NEW / QNEW | Ctrl+N | 1 | template dialog / default template | |
| OPEN / CLOSE / CLOSEALL | Ctrl+O | 1 | | ~ (#83: OPEN from the Open button, Ctrl+O, a drop or the file handler; #238: CLOSE asks to save unsaved changes, Yes / No / Cancel; CLOSEALL is M2-29) |
| SAVE / QSAVE / SAVEAS | Ctrl+S / Ctrl+Shift+S | 1 | AC1032 DXF only (DEC-047); a version picker is post-launch | ✓ (#238): QSAVE writes in place over an AC1032 `.dxf` opened through File System Access, else goes to Save As; SAVE and SAVEAS always ask, offering "AutoCAD 2018 DXF (*.dxf)"; without File System Access the `.dxf` downloads |
| DXFOUT / DXFIN (via SAVEAS/OPEN) | — | 1 | | ~ (#238): through SAVEAS / OPEN; not typed as commands |
| PLOT / PRINT | Ctrl+P | 1 | dialog; -PLOT dash (scriptable) | ~ (#251, #254): the Plot dialog plots the space shown to a one-page PDF (paper, area Layout/Extents/Display/Limits/Window, offset, scale or fit, bundled CTB/STB, lineweight and paperspace-last options, orientation) with AutoCAD's partial preview (red edge when the plot runs off the paper); Window< hides the dialog and PLOT asks "Specify window for printing" / first / opposite corner, then reopens it with the settings kept, and Esc at the corners reopens it as it was (#259); the dialog opens on the page setup's plot style table (AutoCAD's acad.ctb, monochrome.ctb, … answered by the bundled tables) and plot options (plot with plot styles, lineweights, scale lineweights, paperspace last), and lists the CTBs/STBs added in Settings; a table the page setup names that the device lacks is shown "(not found)" and plots as None (#259); -PLOT and named page setups are M2-17 part 4 |
| PREVIEW | PRE | 1 | | ~ (#257): the space shown as it will plot, in the drawing area (the plot's own PDF drawn by pdf.js, so it pixel-matches the rasterised PDF), with the settings it last plotted or previewed with (the Plot dialog's defaults before); AutoCAD's toolbar and shortcut menu (Plot, Pan, Zoom, Zoom Window, Zoom Original, Exit); Esc or Enter leaves; also the Plot dialog's Preview… and the status bar's PREVIEW toggle. Page setups wait on M2-17 part 3 |
| PUBLISH | — | 2 | | ~ (#254): the Publish dialog lists the drawing's sheets ("<drawing>-<layout>", model first, page setup "<Default: None>") with a check each; Publish writes one PDF, a page per sheet with its own paper, labelled with the layout and bookmarked with the sheet name; a sheet that cannot plot is reported in Status and skipped; each sheet plots with its page setup's plot style table and options (#259). Several drawings, page setup overrides and the publish log file are M2-17 part 4 |
| EXPORTPDF / EXPORT (svg/png) | — | 1 | | ~ (#255): SVG and PNG through the Plot dialog's Triya SVG and Triya PNG plotters (layers as Inkscape layers; PNG resolution and background); the commands themselves are M2-18 part 2 |
| PLOTSTYLE / STYLESMANAGER | — | 2 | CTB/STB store | |
| DRAWINGRECOVERY | — | 1 | recovery flow | x (#240, #242): the launch's recovery banner offers each unsaved drawing a closed or crashed page left (Recover, Discard); DRAWINGRECOVERY shows it again with every drawing not yet recovered, or says there are none |

## Parametric (M9)

| Command | Aliases | Tier | Notes | Status |
|---|---|---|---|---|
| GEOMCONSTRAINT | GCON | 2 | all 12 | |
| DIMCONSTRAINT / DCLINEAR / DCALIGNED / DCRADIUS / DCDIAMETER / DCANGULAR / DCCONVERT | DCON… | 2 | | |
| CONSTRAINTBAR / CONSTRAINTSETTINGS / DELCONSTRAINT / CONSTRAINTINFER | CBAR / CSETTINGS / DELCON | 2 | | |
| PARAMETERS | PAR | 2 | manager | |

## Differentiators (M8)

| Command | Aliases | Tier | Notes | Status |
|---|---|---|---|---|
| LIBRARY (PV symbols palette) | LIB | 2 | | |
| FLANGE (insert B16.5/B16.47 flange) | — | 2 | prompts NPS/class/type/view | |
| WELDSYMBOL | — | 2 | builder dialog | |
| COMPARE | — | 2 | | |
| HEALTH (drawing health report) | — | 2 | | |
| PDFREDLINE (open PDF → sheet) | — | 2 | start screen flow | |

## Excluded on purpose (do not implement)

VIEWBASE/VIEWPROJ/VIEWSECTION/VIEWDETAIL · BPARAMETER/BACTION (dynamic blocks) · OBJECTSCALE/AIOBJECTSCALEADD (annotative creation) · DATAEXTRACTION/DATALINK · SHEETSET · PLOTSTAMP · 3D commands · LISP/VBA/NETLOAD/CUI · SNAP isometric style · MLSTYLE creation (Should at most).
