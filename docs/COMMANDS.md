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
| WIPEOUT | — | 1 | Frames, Polyline | x (#231; Frames ON/OFF and "Display but not plot", shown on screen and left off plots, #260) |
| REVCLOUD | — | 1 | Arc length, Object, Rectangular, Polygonal, Freehand, Style (Normal/Calligraphy), Modify | x (#231; Modify and corner grips #258; REVCLOUDGRIPS 0, a grip at every arc's end, #302) |
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
| PROPERTIES | PR, CH, MO, Ctrl+1 | 1 | palette | ~ (#247: palette v1, General + per-type sections, undoable edits; #273: a dimension's Dim style, Text override and eight DIMVAR rows, redrawn at once; #283: current settings with nothing selected; #285: text Style/Justify, block Scale X/Y/Z, polyline Global width; #288: hatch Pattern name, Angle, Scale, Spacing, Double, Island detection style; #292: Select Color dialog; #295: a dimension's Lines & Arrows, Text, Fit, Primary Units, Alternate Units and Tolerances rows; #296: Plot style, Hyperlink, Thickness and 3D Visualization's Material; #310: a dimension's Measurement, an angular dimension's Angle format rows; #315: a multileader's Contents (`...`), Text style, Justify and Text height; #317: a multileader's Leaders rows (type, colour, linetype, lineweight, arrowhead, arrowhead size, Horz landing, Landing distance); #319: a hatch's gradient rows (Gradient name, Color 1/2, Gradient tint, Gradient angle, Centered), Origin X/Y and Associative; #321: a multileader's Text rotation, Line space factor/distance/style, Background mask and Text frame; #326: a block multileader's Source block, Block color, Block scale and Block rotation; leftovers M2-35) |
| PROPERTIESCLOSE | — | 2 | closes the palette | x (#247) |
| UNDO / U | U, Ctrl+Z | 1 | Auto, Control, BEgin/End, Mark, Back, number | x (#223; Ctrl+Z, the Quick Access Undo button and the undo toast #252; the Undo drop-down list runs UNDO n #287; a Layers palette toggle and a layout's rename, move or page setup are steps of their own, LAYER and LAYOUT; views are steps (#325): ZOOM and PAN, typed, from the navigation bar, the wheel or a drag, one step for a row of them under Control Combine Yes (each its own under No), and a named view restored, VIEW; Auto/Layer kept as settings until macros and the Layer Properties Manager exist) |
| REDO | Ctrl+Y | 1 | | x (#223; Ctrl+Y, Cmd+Shift+Z on a Mac and the Quick Access Redo button #252; the Redo drop-down list runs MREDO n #287) |
| MREDO | — | 2 | number, All, Last | x (#287; Last = the action REDO would redo first; n splits a U or UNDO's group, REDO then puts back the rest) |
| COPYBASE / PASTECLIP / PASTEBLOCK / PASTEORIG / COPYCLIP / CUTCLIP | Ctrl+Shift+C, Ctrl+V, Ctrl+Shift+V, Ctrl+C, Ctrl+X | 1 | cross-document | x (#242: one Clipboard for every open drawing; the layers, linetypes, styles and blocks the objects use come along, matched by name in the target; new handles above its $HANDSEED; base point the extents' lower-left corner; PASTECLIP and PASTEBLOCK drag the curves and the extents' frame; PASTEBLOCK makes an `A$C…` block; PASTEORIG only from another drawing. #274 (M2-32 part 1): pasted into a drawing in other units (INSUNITS) the objects are scaled about the base point, and dragged so, as INSERT scales a drawing; nothing is scaled where either drawing is unitless; PASTEBLOCK's block keeps the source's units and its reference takes the scale. M2-32 part 2: images and PDF underlays bring their IMAGEDEF / PDFDEFINITION, filed in the target's ACAD_IMAGE_DICT / ACAD_PDFDEFINITIONS (made on the first one); a definition the target has under the same name is the target's; the pasted ones show the files the user supplied, as in the source. M2-32 part 3: records keep their xdata (not the annotative property's), saved with them; multileaders whose block holds attribute definitions name the pasted ATTDEFs, or the target's of the same tag. M2-32 part 4: a dynamic block reference stays dynamic: the definition brings its evaluation graph, each `*U` state its AcDbBlockRepBTag link, each reference its `AcDbBlockRepresentation`, saved in new extension dictionaries; a definition the target has by name is the target's. M2-32 part 5: the objects go on the system clipboard too, in Triya's own format beside a PNG picture of them that other apps paste; a paste reads the system clipboard first, so another Triya window's objects paste (PASTEORIG takes them as another drawing's), another app's text pastes as MTEXT with the MTEXT defaults (PASTECLIP only), and another app's picture is refused with a reason (M2-54); without permission to read it, or in a browser without web custom formats, the window's own Clipboard pastes. Not yet pasted: xrefs (M5-04), pictures (OLE, M2-54), spreadsheets as tables (M4-06), annotative objects stay so (M2-43)) |
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
| MTEXT | T, MT | 1 | in-place editor; -MTEXT dash | x (#230: two corners or Width, Height/Justify/Line spacing/Rotation/Style; in-place editor with Bold, Italic, Underline, Overline, Strikethrough, Height, Color and Stack, Ctrl+Enter or a click outside to close, Esc to drop; -MTEXT and the command line take lines until an empty one. #232: Font list, AutoStack (`1/2 ` → diagonal fraction, `^` tolerance), Enter keeps the paragraph's formatting. #234: Columns option (Dynamic/Static/No columns, widths, gutter, height), the editor's Columns menu, Column Settings dialog and Alt+Enter column break, and the ruler (first-line and paragraph indents, tab stops). #264: Column Settings' Manual Height, each column's height dragged at its bottom edge in the editor, columns set right to left shown so. #266: a columned MTEXT's grips on the canvas, column width, gutter and column height (one per column with manual heights), drawn as triangles; dynamic columns recounted by the canvas after a grip. #268: the ruler's Tab Selection button (left, center, right, decimal stops) and right indent marker, the Paragraph dialog (Tab with decimal style, Left Indent, Right Indent, Paragraph Alignment), Tab typing a tab and the editor laying text at the paragraph's own tab stops; Paragraph Spacing (Before, After) and Paragraph Line Spacing (Multiple, Exactly, At least) in the Paragraph dialog, written as `\px` `b`, `a` and `sm`/`se`/`sa` and drawn by layout and the editor, M2-46 #311; fields: M4-10) |
| TEXTEDIT / DDEDIT | ED | 1 | Undo, Mode (Single/Multiple); double-click | ~ (#232: TEXT in its in-place line, MTEXT in its editor keeping the codes it has no control for; Undo, Mode; a double click on a TEXT or MTEXT runs it (DBLCLKEDIT); an emptied text is erased. an ATTDEF opens Edit Attribute Definition (tag, prompt, default; a multiline default in the MTEXT editor), #236; a dimension's text in the MTEXT editor with `<>` for the measurement, also on a double click, #241, the measurement itself shown highlighted in its place, #278; a text multileader's text in the MTEXT editor, also on a double click, #262; a block multileader's attribute values in Edit Attributes, also on a double click, and the MTEXT editor showing a text's background mask and frame, M2-44) |
| STYLE | ST | 2 | dialog; -STYLE dash | |
| FIND | — | 2 | | |
| SPELL | SP | 3 | | |
| SCALETEXT / JUSTIFYTEXT / TEXTALIGN | — | 2 | | |
| FIELD / UPDATEFIELD | — | 2 | | |
| DIMLINEAR | DLI | 1 | Mtext, Text, Angle, Horizontal, Vertical, Rotated | x (#241: two origins or a selected line, arc or polyline segment; horizontal or vertical by the location; dragged while placed; non-associative, DIMASSOC 1. #276: a selected circle's diameter, horizontal or vertical by the location, by the quadrant picked inside the circle's box; the header's DIMVARs that differ from the current style become each new dimension's DSTYLE overrides, for every DIM command) |
| DIMALIGNED | DAL | 1 | Mtext, Text, Angle | x (#241; #276: a selected circle from the pick to the opposite end of its diameter) |
| DIMRADIUS | DRA | 1 | Mtext, Text, Angle | x (#241: circle or arc; the text where the location is. #278: on an arc, the arc kept in the dimension's `ACAD_DSTYLE_DIMRADIAL_EXTENSION` xdata and an arc extension line drawn along its circle when the location is past its ends (DIMEXO gap, DIMEXE past the line, off with DIMSE1); the Mtext option's editor shows the measurement itself, highlighted, where `<>` stands) |
| DIMDIAMETER | DDI | 1 | Mtext, Text, Angle | x (#241; #278: on an arc, the arc extension line as DIMRADIUS, at the far end too where its arrowhead is) |
| DIMANGULAR | DAN | 1 | Quadrant | x (#241: two lines, an arc, a circle and a second point, or three points; Mtext, Text, Angle. #276: Quadrant, the angle measured fixed whatever the location, the text kept at a location outside it with the arc carried on to it) |
| DIMCONTINUE | DCO | 1 | Select, Undo | x (#241: from the last linear, aligned or three-point angular dimension made, or one selected (its extension line nearest the pick). #276: from an ordinate ("Specify feature location", same origin and axis, leaders ending in line) or a two-line angular dimension (round the lines' meeting point); in the base's style and overrides, as DIMCONTINUEMODE 1) |
| DIMBASELINE | DBA | 1 | Select, Undo | x (#241: as DIMCONTINUE, each one DIMDLI further out; #276: ordinate and two-line angular bases too) |
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
| MLEADER | MLD | 1 | leader/content first, Options | ~ (#233: arrowhead/landing/content first, Options, text and block content; annotative multileaders are needs-human #263 / M2-43. AutoCAD's built-in content blocks `_DetailCallout`, `_TagCircle`, `_TagBox`, `_TagSlot`, `_TagHexagon`, `_TagTriangle` authored when the drawing lacks them, #262) |
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
| ATTEDIT / EATTEDIT | ATE / ATE | 1 | dialogs; -ATTEDIT dash; double-click | ~ (#236: EATTEDIT's Enhanced Attribute Editor (Attribute: values, a multiline one's `...` opening the MTEXT editor; Text Options: style, height, rotation, width factor, obliquing, backwards, upside down; Properties: layer, linetype, colour, lineweight; Apply, Select block), ATTEDIT's Edit Attributes (values, eight a page), -ATTEDIT one at a time (Value Change/Replace, Position, Height, Angle, Style, Layer, Color with Truecolor, Next) and global (string replaced, visible-on-screen or the whole drawing), block/tag/value wildcards; a double click on a reference with attributes runs EATTEDIT. #269: Justification (keeping the insertion point; a multiline attribute's MTEXT attachment), Plot style (named plot styles; ByColor greyed), Annotative shown only (DEC-013), the attribute a block is picked or double-clicked by selected in the list. #272: -ATTEDIT's "Select Attributes" takes the attribute picked on its text and the attributes a window holds or a crossing window crosses, not the whole reference (a reference taken whole by ALL/Last/Previous, or one no loaded font measures, gives all its attributes), the attribute being edited marked with an X, and Color's COlorbook (the colour books the drawing uses; Triya ships none)) |
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
| CETRANSPARENCY | — | 2 | Properties palette with nothing selected (M2-35); kept for the session unless the drawing has a DICTIONARYVAR for it | ~ |
| PURGE | PU | 2 | dialog + -PURGE | |
| AUDIT / RECOVER | — | 2 | Health report implementation | |
| UNITS | UN | 2 | dialog + -UNITS | |
| SETVAR ᵀ | SET | 2 | any registered sysvar | x (#302; every header variable the drawing holds, AutoCAD's types and ranges, read-only ones shown; WIPEOUTFRAME; the drafting aids ORTHOMODE, SNAPMODE, GRIDMODE, OSMODE, POLARANG, LWDISPLAY, TRANSPARENCYDISPLAY and the per-user APERTURE, PDFOSNAP, REVCLOUDGRIPS; `?` lists by wild card; a variable's name typed at `Command:` or transparently. DICTIONARYVAR variables other than CETRANSPARENCY are read-only, M2-59) |

## View and navigation

| Command | Aliases | Tier | Notes | Status |
|---|---|---|---|---|
| ZOOM ᵀ | Z | 1 | All, Center, Dynamic(≈window), Extents, Previous, Scale (nX/nXP), Window, Object, real-time | ~ (#224): window corner, n/nX/nXP (nXP in a layout; refused on the Model tab, where Triya has no floating viewport), All, Center, Dynamic (a window), Extents, Previous, Scale, Window, real time (drag up/down), transparent `'Z`; also the wheel, middle double-click and navigation bar (M1-22). Object (#225), the pre-selection too |
| PAN ᵀ | P | 1 | real-time, -PAN | x (#224): real time (left button until Esc or Enter) and -PAN (two points, or a displacement with Enter), transparent `'P`; middle-button drag and the navigation bar (M1-22) |
| REGEN / REGENALL | RE / REA | 1 | x (#224): REGEN rebuilds the current viewport's display, REGENALL every viewport of the space shown; Regen on the navigation bar (M1-22) |
| REDRAW ᵀ | R | 1 | | |
| VIEW | V | 2 | named views dialog; -VIEW | ~ (#224, #270): VIEW and -VIEW run the -VIEW prompts ?, Delete, Restore, Save and Window on the space shown; Save, Window and the navigation bar's Save view write the view into the drawing's VIEW table (an undo step, saved with the drawing), Delete removes the views a pattern names (M2-29). VIEW and V open the View Manager (#320, M2-47 part 2): the Views tree (Current, Model Views, Layout Views), the selected view's properties with an editable Name, Set Current (restored on OK or Apply), New... (New View / Shot Properties: View name, Boundary Current display or Define window, whose corners VIEW asks for at the command line) and Delete; -VIEW keeps the prompts. Edit Boundaries... (#327, part 5) shows the selected view and takes its new boundary at the command line, until Enter (a VIEW undo step). Update Layers (M5-07), view categories (M2-70) and the 3D options wait |
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
| OPEN / CLOSE / CLOSEALL | Ctrl+O | 1 | | ~ (#83: OPEN from the Open button, Ctrl+O, a drop or the file handler; #238: CLOSE asks to save unsaved changes, Yes / No / Cancel; #270: CLOSEALL closes every open drawing in tab order, each asking to save its changes, and Cancel stops it there) |
| SAVE / QSAVE / SAVEAS | Ctrl+S / Ctrl+Shift+S | 1 | AC1032 DXF only (DEC-047); a version picker is post-launch | ✓ (#238): QSAVE writes in place over an AC1032 `.dxf` opened through File System Access, else goes to Save As; SAVE and SAVEAS always ask, offering "AutoCAD 2018 DXF (*.dxf)"; without File System Access the `.dxf` downloads |
| DXFOUT / DXFIN (via SAVEAS/OPEN) | — | 1 | | ~ (#238): through SAVEAS / OPEN; not typed as commands |
| PLOT / PRINT | Ctrl+P | 1 | dialog; -PLOT dash (scriptable) | x (#251, #254): the Plot dialog plots the space shown to a one-page PDF (paper, area Layout/Extents/Display/Limits/Window, offset, scale or fit, bundled CTB/STB, lineweight and paperspace-last options, orientation) with AutoCAD's partial preview (red edge when the plot runs off the paper); Window< hides the dialog and PLOT asks "Specify window for printing" / first / opposite corner, then reopens it with the settings kept, and Esc at the corners reopens it as it was (#259); the dialog opens on the page setup's plot style table (AutoCAD's acad.ctb, monochrome.ctb, … answered by the bundled tables) and plot options (plot with plot styles, lineweights, scale lineweights, paperspace last), and lists the CTBs/STBs added in Settings; a table the page setup names that the device lacks is shown "(not found)" and plots as None (#259); the dialog opens on the rest of the page setup too (paper, orientation, plot area and window, scale or fit, centring, offset; model space's from the Model layout) and Apply to Layout writes the settings into it as one undo step (#261); -PLOT asks AutoCAD's -PLOT prompts at the command line (short form: layout, page setup, device, file; detailed: paper, units, orientation, upside down, area and window, scale or Fit, offset or Center, plot styles and table, lineweights, a layout's own options), each defaulting to the dialog's settings for that space, plots any layout without the dialog and can save the answers into its page setup (#265); the dialog's Page setup Name lists <None>, <Previous plot> and the drawing's named page setups of the space's kind (ACAD_PLOTSETTINGS), opening on the one chosen, which Apply to Layout writes into the layout, and -PLOT plots with a named page setup (#267); the dialog's Name opens on the named page setup the layout has applied (LAYOUT DXF 1), Apply to Layout writes the Name shown as the one applied, and -PLOT's "Enter a page setup name" defaults to it (#306); adding named page setups (Add…) is PAGESETUP, M6-01 |
| PREVIEW | PRE | 1 | | ~ (#257): the space shown as it will plot, in the drawing area (the plot's own PDF drawn by pdf.js, so it pixel-matches the rasterised PDF), with the settings it last plotted or previewed with (the Plot dialog's defaults before); AutoCAD's toolbar and shortcut menu (Plot, Pan, Zoom, Zoom Window, Zoom Original, Exit); Esc or Enter leaves; also the Plot dialog's Preview… and the status bar's PREVIEW toggle. Page setups wait on M2-17 part 3 |
| PUBLISH | — | 2 | | ~ (#254): the Publish dialog lists the drawing's sheets ("<drawing>-<layout>", model first, page setup "<Default: None>") with a check each; Publish writes one PDF, a page per sheet with its own paper, labelled with the layout and bookmarked with the sheet name; a sheet that cannot plot is reported in Status and skipped; each sheet plots with its page setup's plot style table and options (#259); each sheet's Page Setup is <Default: None> or a named page setup of its kind, Load All Open Drawings adds every open drawing's sheets, Remove Sheets and Move Sheet Up/Down order the list, and Save publish log downloads the log (.csv) beside the PDF (#267). Publish to PDF, SVG or PNG, an SVG or PNG a file a sheet, several in one ZIP (M2-39 part 4), Publish to PNG at a Resolution chosen (M2-39 part 5). Add Sheets… adds the sheets of drawings picked from the device, a drawing not open read to list them and opened with no tab only while its sheets publish, and Page Setup's own entry names the layout's applied page setup ("<Default: A3 Monochrome>") (M2-45 part 2, #313). Save Sheet List… and Load Sheet List… write and read the list as a DSD file (Replace or Append when sheets are listed; a sheet of a drawing not open shows "Drawing file not found" until Add Sheets supplies it), and Open in viewer when done opens the published file in a new tab (M2-45 part 3, #318). The plot stamp is M2-45 |
| EXPORTPDF / EXPORT | EXP→EXPORT | 1 | | ~ (#255, #297): SVG and PNG through the Plot dialog's Triya SVG and Triya PNG plotters (layers as Inkscape layers; PNG resolution and background); EXPORTPDF opens Save As PDF (File name; Export: Display, Extents or Window in model space, Window picked at the command line; Current layout or All layouts in a layout, all layouts one PDF) and EXPORT (EXP) opens Export Data (Files of type PDF, SVG, PNG or AutoCAD 2018 DXF, the DXF the whole drawing with its unsaved changes, the drawing keeping its file), each plot with the space's current page setup (#297). All layouts as SVG or PNG is a file a layout in one ZIP (M2-39 part 4). Page setup Current or Override (the Page Setup Override dialog: paper, orientation, scale, plot style table) and a PNG's Resolution; -EXPORT asks `Enter file format [Pdf/Svg/pNg/Dxf]`, the plot area, `Detailed plot configuration?` (-PLOT's settings) and the file name (M2-39 part 5). PDF Options (layers, bookmarks, text as geometry) wait on M2-60 |
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
| HEALTH (drawing health report) | — | 2 | | ~ (#105: the Health palette from the palette rail: drawing, missing fonts, font errors, references, hatch patterns, unknown objects, entities not drawn; #275: Dimensions, the stored blocks that differ from what the dimension engine draws, with ZOOM to each; no HEALTH command or fix buttons yet, M8-07) |
| PDFREDLINE (open PDF → sheet) | — | 2 | start screen flow | |

## Excluded on purpose (do not implement)

VIEWBASE/VIEWPROJ/VIEWSECTION/VIEWDETAIL · BPARAMETER/BACTION (dynamic blocks) · OBJECTSCALE/AIOBJECTSCALEADD (annotative creation) · DATAEXTRACTION/DATALINK · SHEETSET · PLOTSTAMP · 3D commands · LISP/VBA/NETLOAD/CUI · SNAP isometric style · MLSTYLE creation (Should at most).
