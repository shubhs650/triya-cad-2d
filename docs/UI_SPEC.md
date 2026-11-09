# UI Specification

Design intent: **an AutoCAD drafter finds everything where they expect it; everyone else sees a modern, fast, beautiful tool.** Structure and names come from AutoCAD; execution (icons, spacing, motion, theming, responsiveness) is ours.

## 1. Shell layout

```
┌ Title bar: [OET home] Triya CAD 2D  v1.0 (badge) ─── doc tabs ─── [Report issue] [Settings] ┐
├ Ribbon tabs: Home · Insert · Annotate · Parametric · View · Output · Layout · Tools         │
├ Ribbon panels (responsive, see §3)                                                           │
├─────────────────────────────────────────────────────────┬─────────────────────────────────┤
│                                                         │ Palette stack (dockable)        │
│  Canvas (OffscreenCanvas)                               │  Properties                      │
│  + transient layer                                      │  Layers                          │
│  + Dynamic Input overlay                                │  Blocks / Library                │
│                                                         │  References                      │
│                                                         │  Constraints · Compare · Health  │
├ Model | Layout1 | Layout2 | +  ────────── command line (2 lines, expandable, F2 window) ─────┤
├ Status bar: X,Y,Z · SNAP GRID ORTHO POLAR OSNAP OTRACK DYN LWT TPY · MODEL/PAPER · 1:10 ▾ · ⚙ ┤
```

- Canvas always wins space. Palettes dock right by default; can float, auto-hide, or dock left/bottom; layout persisted locally.
- Document tabs behave like AutoCAD file tabs (hover preview, close, dirty dot, drag to reorder). Resting the mouse on a tab for 400 ms previews the drawing's Model and layouts (each as last drawn; a space not yet shown is pictured as it would open, by a canvas made only for the picture), resting on a thumbnail shows that drawing and space in the drawing area until the pointer leaves the preview (which brings back what showed before), and clicking one keeps it; Ctrl+Shift+Page Up/Down moves the focused tab. A tab shows a dot after its name while the drawing has unsaved changes (not part of the tab's accessible name); closing it, CLOSE, or leaving the page then asks first, in AutoCAD's message box: "Save changes to <name>?" with Yes (focused), No and Cancel, Esc cancelling. Save and Save As… sit in the title bar (Ctrl+S, Ctrl+Shift+S); a save reports "Saved <name>." in a status notice for 4 s.
- Layout tabs sit above the command line; `+` creates a layout; right-click for layout commands.
- *As built (M2-19):* beside the version badge the title bar shows the offline status once the service worker runs (`Saving for offline… n%`, then `Ready offline` in green, `Working offline` with no connection), and an Install button before Settings while the browser would install the app. A new version shows a banner under the title bar, "A new version of Triya CAD 2D is ready. Reload to use it; drawings with unsaved changes ask first.", with Reload and Later; nothing reloads until Reload is pressed.

## 2. Ribbon content (tabs → panels → items)

Panel names and groupings match AutoCAD so the drafter's spatial memory transfers. Items are the commands in `COMMANDS.md` by tier.

**Home:** Draw (Line, Polyline, Circle▾, Arc▾, Rectangle▾, Ellipse▾, Hatch▾, Spline▾, Xline/Ray, Point▾, Revcloud▾, Wipeout, Region/Boundary) · Modify (Move, Copy, Stretch, Rotate, Mirror, Scale, Trim▾, Extend, Fillet▾, Chamfer, Array▾, Offset, Explode, Erase, Break▾, Join, Lengthen, Align, Overkill) · Annotation (Text▾, Dimension▾, Leader▾, Table, Centerline▾) · Layers (Layer Properties, layer dropdown, tool row) · Block (Insert▾, Create, Edit, Edit Attributes▾) · Properties (Match Properties, colour/linetype/lineweight/transparency dropdowns, Properties palette) · Groups · Utilities (Measure▾, Quick Select, ID, List) · Clipboard

**Insert:** Block (Insert, Edit Attribute, Create Block, Define Attributes, Manage Attributes, Block Editor) · Reference (Attach, Clip, Adjust, Xref palette, Bind) · Library (PV symbols, Weld symbols, GD&T) · Import (PDF underlay) · Data (Field) · Linking (none; Extract/Link Data excluded)

**Annotate:** Text (Multiline, Single, style dropdown, height, Find, Spell) · Dimensions (dim style dropdown, Dimension, Linear▾, Aligned, Angular, Radius▾, Ordinate, Arc, Jogged, Quick, Continue▾, Baseline, Space, Break, Edit tools, Reassociate, Inspect, Override) · Centerlines · Leaders (Multileader, style dropdown, Add/Remove Leader, Align, Collect) · Tables (Table, style dropdown) · Markup (Wipeout, Revision Cloud▾) · Annotation Scaling (current scale display; Add/Delete/Sync disabled with tooltip "Annotative creation is view-only in v1")

**Parametric:** Geometric (12 constraints, Show/Hide, Infer) · Dimensional (Linear▾, Aligned, Radius, Diameter, Angular, Show/Hide, Convert) · Manage (Delete Constraints, Parameters Manager, Settings)

**View:** Navigate (Zoom▾, Pan, Previous, Extents, Window, Named Views) · Viewport Tools · Palettes (Properties, Layers, Blocks/Library, References, Constraints, Compare, Health, Command History) · Interface (File tabs, Layout tabs, Status bar, Theme) · Compare (Compare drawings)

**Output:** Plot (Plot, Preview, Page Setup, Plot Styles, Plotter config = n/a) · Export (PDF, SVG, PNG, DXF) · Publish

**Layout:** Layout (New, Page Setup, Delete, Copy) · Layout Viewports (Rectangular, Polygonal, Object, Clip, Lock, Scale list) · (Create View / Modify View / Update / Styles & Standards panels **omitted**; DEC-001)

**Tools:** Drawing Utilities (Units, Audit/Health, Purge, Recover) · Drafting Settings · Options · Alias editor · Keyboard · Clear local data · About

**Contextual tabs** appear while active: Hatch Creation, Text Editor, Table Cell, Block Editor, Xref/Image/PDF Underlay, Array Creation, Compare.

## 3. Responsive ribbon rules (DEC-017)

Breakpoints (viewport width): **≥1920 "full"**, **1600–1919 "wide"**, **1366–1599 "laptop"**, **1280–1365 "compact"**. Minimum supported 1280×720.

- **Full:** three-row labelled ribbon, all panels expanded, large icons with labels, dropdown groups expanded where AutoCAD expands them. This is the professional-drafter mode.
- **Wide:** two-row ribbon; labels on primary items; secondary items icon-only with tooltips.
- **Laptop / Compact:** one-row icon ribbon. **Hard rule: on Home, every item in Draw, Modify and Annotation panels stays visible as an individual icon (dropdown groups keep their split-button) — no overflow menu for those three panels.** Other panels compress in this order: Clipboard → Utilities → Groups → Properties (dropdowns become one combined popover) → Block (collapses to Insert + overflow) → Layers (dropdown + Layer Properties + overflow). If space is still short at 1280, the ribbon scrolls horizontally *only for the non-protected panels*.
- Each item carries explicit size rules in `ribbon.config.ts`: `{ full: 'large-label', wide: 'small-label', laptop: 'icon' }` and a `protected: true` flag for Home Draw/Modify/Annotation.
- Ribbon may be collapsed to tabs-only (double-click a tab) like AutoCAD; a collapsed ribbon pops a panel on click.
- A Playwright test asserts T9 at 1280, 1366, 1600, 1920 and 2560.

## 4. Palettes

- Dockable stack with tabs; drag to reorder; float; auto-hide; width persisted. Below 1366 px palettes open as a right slide-over that overlays the canvas and closes on Esc.
- **Properties:** AutoCAD grouping (General, 3D Visualization omitted, Geometry, Misc, per-type sections); multi-select shows `*VARIES*`; inline edit with units formatting; Quick Properties overlay on hover (toggle in status bar).
- **Layers:** manager with column chooser, search, filters tree, states menu, VP overrides when a viewport is active, inline edit.
- **Blocks / Library:** current drawing blocks, recent, user library folders, PV standards library with search and preview thumbnails.
- **References:** tree of xrefs/images/PDF underlays with status (loaded/missing/unloaded), paths, actions. M1-21: columns Reference name, Status (Loaded, Not found, Unloaded), Type (Attach, Overlay, Image, PDF underlay), Saved path; Find files…, Choose folder… and Reconnect (kept folders the browser asks about); a status-bar button names how many references are not found and opens the palette. Attach/detach/reload/unload/bind are M5-04.
- **Constraints:** list with DOF, conflicts, parameters manager.
- **Compare:** source/target pickers, results list, filters.
- **Health:** report cards with fix buttons.
- **Command History:** F2 equivalent.

## 5. Command line and Dynamic Input

- Two-line docked command window, resizable, with autocomplete (commands, aliases, sysvars), option buttons rendered as clickable chips (`[Undo] [Close]`), recent commands on Up/Down, F2 pops the history palette.
- Dynamic Input: prompt text next to the cursor, numeric fields (distance, angle) with Tab switching and lock, dimension input during drag, pointer input toggle; `DYNMODE` and settings in DRAFTINGSETTINGS.
- Ctrl+K palette: fuzzy search over commands (shows alias and F-key), settings, recent files; Enter runs.
- **As built (M2-02 part 1):** the command window sits under the layout tabs: two history lines over the prompt line, set in a monospace face; the prompt's options are buttons (`[Close/Undo]`, each titled with its shortcut letters) that answer the keyword; completion lists the command an alias names exactly, then the commands whose names begin with what is typed (Tab or a click takes one); Up/Down recall what was entered; F2 toggles the whole history above the command line (Esc in the input closes it). Keys typed outside a text field or dialog go to the command line, and Enter or Space there ends the input (on a button they press it); Esc cancels the running command. While a command waits at a point, distance or angle prompt the canvas shows crosshairs, a left click picks the point under it, and a rubber band follows the cursor from the prompt's base point. A typed number at a rubber-band prompt goes towards the cursor's last point on the canvas (direct distance).
- **As built (M2-02 part 2):** Dynamic Input shows, while a command waits and the cursor is over a drawing, a tooltip right of and below the cursor with the prompt (a ↓ when it has options) and its fields: X and Y at a point prompt (the first point absolute, later ones relative to the last, `#` for absolute; a comma moves to Y), Distance and Angle at a point prompt with a rubber band (`<` or Tab moves to the angle; a distance alone is a direct distance towards the cursor), one field at other prompts. Fields left empty show the cursor's values. Tab locks the field typed in (a padlock) and moves on, Backspace unlocks an emptied one; anything that is not a number (an option, `@100<45`, FROM, `'Z`) is sent as typed. ↓/↑ open and move through the options, Enter takes one. Keys typed outside a text field go to the tooltip rather than the command line then (also from the command line's field while it is empty). F12 and the status bar's DYN button toggle it (DYNMODE, on by default). Ctrl+K opens the palette over the drawing: a search box and a list of the commands (with their aliases) and app actions (Command history F2, Dynamic Input F12, Settings), matched fuzzily (whole names and exact aliases first, then prefixes, word starts, scattered letters); ↑/↓ move, Enter runs, Esc or a click outside closes. The view commands typed at the command line act on the current viewport of the space shown, as the navigation bar does; ZOOM Window's and -VIEW Window's second corner show a rectangle.

## 6. Theme and canvas

- **Default:** light chrome (OET house style), dark model canvas `#212830` with `#2B3340` grid, white paper space with `#8A8F98` surround and dashed printable area. Dark chrome available. Canvas colours configurable (model, paper, grid, crosshair, selection, transient).
- ACI 7 renders white on dark and black on light backgrounds; ACI 0 as ByBlock; true colours unchanged.
- *As built (M2-20 part 1):* Settings (title bar, Ctrl+K "Settings"/"Options") is one scrolling dialog: **Display** (Color theme: Same as system, Light, Dark; Canvas colors: Model space background, Layout paper, Layout background, Selection highlight, Grid lines with Automatic; Restore default colors; Coordinates: Drawing units (UNITS) or Decimal), **Drafting** (Object Snap modes in DRAFTINGSETTINGS order, Polar increment angle, AutoSnap marker size 1–20, Aperture size 1–50, Dynamic Input (F12)), **Hatch patterns**, **Fonts**, **Local data** ("Clear all local data…", confirmed in place: "Clear and restart"). ACI 7 is white on a canvas colour whose WCAG luminance is under ~0.18, black above; the AutoSnap marker and tracking colours follow the same test. The dark chrome swaps the chrome colour variables; the canvas keeps its own colours.
- Plot-preview toggle (status bar / View) renders the drawing with the current CTB resolution on white.
- Selection: AutoCAD-like highlight (dashed + glow), hover highlight, grips blue/hot red, osnap markers per mode shape, tracking vectors dashed. *As built (M2-03):* selected objects get a 5 px glow at 35 % and a 1 px 4/3 dashed line in `#4DA3FF` (`RenderStyle.selection`); a selection window is filled at 18 % and edged in blue, solid, when it is a window (left to right) and in green `#5FD35F`, dashed, when it is a crossing window (right to left). Hover highlight is M3-04. *As built (M2-06 part 2):* grips are 8 px squares with a dark 1 px edge, in GRIPCOLOR (ACI 150) and the hot one in GRIPHOT (ACI 12), shown on up to 100 selected objects (GRIPOBJLIMIT); a click within 5 px takes a grip. Objects a command drags are drawn in their own colours over their originals on the transient layer.
- Motion: 120 ms hover/press transitions, 160 ms panel open, respect `prefers-reduced-motion`.
- Icons: Microsoft Fluent UI System Icons (filled on hover), 20 px in laptop mode, 32 px large in full mode; custom CAD glyph set for commands Fluent lacks (drawn in the same grid and stroke weight).

## 7. Dialogs

AutoCAD-equivalent structure (tabs, groups, labels) with modern controls. Required set: DIMSTYLE (manager + modify dialog, all tabs), TEXTSTYLE, TABLESTYLE, MLEADERSTYLE, LAYER (palette), PAGESETUP, PLOT, PUBLISH, OPTIONS, DRAFTINGSETTINGS, ATTDEF, EATTEDIT, BATTMAN, INSERT, BLOCK, WBLOCK, XREF/IMAGEATTACH/PDFATTACH, LINETYPE, LWEIGHT, UNITS, HATCH (dialog alternative to contextual tab), QSELECT, FILTER, PURGE, FIELD, TOLERANCE, UNITS, ALIAS editor, KEYBOARD editor, the MTEXT editor's Column Settings (M2-07 part 3).
Every dialog is keyboard-operable and has an Esc/Enter contract matching AutoCAD.

*As built (M2-12):* the Enhanced Attribute Editor (EATTEDIT), Edit Attributes (ATTEDIT) and Edit Attribute Definition (TEXTEDIT on an ATTDEF) are modal `<dialog>`s with AutoCAD's labels: Enter is OK outside a text area or button, Esc is Cancel, the attribute list moves with the arrow keys, and the tabs and fields are reached with Tab. A multiline value shows one line per paragraph and its `...` button opens the in-place MTEXT editor, after which the dialog returns.

## 8. Status bar

Coordinates (absolute/relative/geographic n/a), SNAP (F9), GRID (F7), ORTHO (F8), POLAR (F10), OSNAP (F3), OTRACK (F11), DYN (F12), LWT, TPY (transparency), Quick Properties, Selection Cycling, MODEL/PAPER, annotation scale dropdown, workspace, hardware acceleration indicator (renderer type), clean screen (Ctrl+0), customisation menu.

*As built (M2-04 part 1):* SNAP, ORTHO, POLAR and OSNAP toggle buttons (pressed = on, the F-key in the tooltip) before DYN; OSNAP has an arrow opening a menu with a checkbox per running object snap mode (Drafting Settings order, arrow keys move, Esc closes). While a command waits for a point the coordinates show the point a click would give. AutoSnap draws a 10 px marker in each mode's shape (yellow on the model canvas, amber on paper) and the mode's name in a tooltip above right of the cursor (Dynamic Input's is below right); polar tracking draws a dashed path from the base point and a `Polar: 14.3543 < 45°` tooltip. *As built (M2-04 part 2):* the status bar reads GRID, SNAP, ORTHO, POLAR, OTRACK, OSNAP, LWT, TPY, DYN (AutoCAD's order); F7 and F11 join the F-keys and the Ctrl+K palette has every toggle. GRID draws lines a device pixel wide under the drawing, minor at 12 % and major (every GRIDMAJOR-th) at 24 % of the foreground over the background, leaving out lines closer than 8 px. An acquired tracking point shows a 4 px cross in the tracking colour; tracking paths are dashed like polar's, a small cross marks the tracked point, and the tooltip reads `Endpoint: 30.0000 < 270°` or `Endpoint: < 90°, Polar: < 0°`. Tab steps the marker through the snap points under the cursor until something is typed. Shift+right-click at a point prompt opens the object snap menu at the cursor (From, Mid Between 2 Points, the 14 modes, None; arrow keys move, Esc closes).

## 9. Templates (bundled)

**Triya ISO (mm):** layers `0, DEFPOINTS, CENTER (red, CENTER2), HIDDEN (yellow, HIDDEN2), DIMENSIONS (green), TEXT (white), HATCH (8), TITLE (white, 0.5), VIEWPORT (no-plot), NOTES, REVISION (magenta)`; dim styles `ISO-25`, `ISO-25-5`, `ISO-25-10`, `ISO-25-20`, `ISO-25-50` (DIMSCALE variants); text styles `Standard (oet-simplex)`, `ROMANS (oet-romans)`, `ISOCP (oet-isocp)`, `Arial`; layouts A4–A0 landscape with a generic title block (attributes: TITLE, DWGNO, REV, SCALE, DATE, DRAWN, CHECKED, APPROVED, PROJECT, CLIENT, SHEET) and revision table (4 rows). **Triya ANSI (inch):** same with decimal-inch dim styles and ANSI A–E sheets.

## 10. Start screen

Recent drawings (thumbnails from last autosave), New (default template one-click + Templates), Open, Open PDF (red-line flow), Samples (public corpus), "Coming from AutoCAD" guide, privacy statement, version and links.

## 11. Micro-interactions worth doing well

Marching-ants selection; grip hover scale; osnap marker snap-in animation; panel/palette slide with easing; command chip ripple; Dynamic Input field focus glow; smooth zoom-to-cursor with inertia on trackpads (toggle); undo toast with count; recovery banner.
