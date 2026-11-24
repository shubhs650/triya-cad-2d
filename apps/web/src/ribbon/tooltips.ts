// The ribbon's rich tooltips (M7-02, UI_SPEC.md §2): as AutoCAD's, a button's name, one line on
// what it does, then the command it runs with the aliases and keys that run it too, so the
// drafter learns the faster way. Descriptions are Triya's own words, by item id (an item and its
// split entries each have one; ids shared between tabs run the same thing). Pure: the aliases
// come from the command registry (the user's alias file included) and the keys from the keymap.
import type { RibbonItem } from './ribbon.config';

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  // Home > Draw
  line: 'Creates straight line segments, each one a separate object.',
  polyline: 'Creates a single object of connected line and arc segments.',
  circle: 'Creates a circle.',
  'circle-cr': 'Creates a circle from its center point and radius.',
  'circle-2p': 'Creates a circle from the two endpoints of a diameter.',
  'circle-3p': 'Creates a circle through three points on its circumference.',
  'circle-ttr': 'Creates a circle of a given radius tangent to two objects.',
  arc: 'Creates an arc.',
  'arc-3p': 'Creates an arc through a start point, a second point and an endpoint.',
  'arc-cse': 'Creates an arc from its center, start point and endpoint.',
  rectangle: 'Creates a rectangle or a regular polygon as a closed polyline.',
  rectang: 'Creates a rectangular polyline from two opposite corners.',
  polygon: 'Creates an equilateral closed polyline with 3 to 1024 sides.',
  ellipse: 'Creates an ellipse or an elliptical arc.',
  'ellipse-center': 'Creates an ellipse from its center, an axis endpoint and half the other axis.',
  'ellipse-axis': 'Creates an ellipse from the endpoints of one axis and half the other axis.',
  'ellipse-arc': 'Creates an elliptical arc.',
  hatch: 'Fills an enclosed area or selected objects with a hatch pattern or gradient.',
  'hatch-hatch': 'Fills an enclosed area or selected objects with a hatch pattern or solid fill.',
  gradient: 'Fills an enclosed area or selected objects with a gradient fill.',
  spline: 'Creates a smooth curve through or near points.',
  'spline-fit': 'Creates a spline that passes through the points you pick.',
  'spline-cv': 'Creates a spline shaped by control vertices.',
  xline: 'Creates a line of infinite length in both directions.',
  'xline-xline': 'Creates a line of infinite length in both directions.',
  ray: 'Creates a line that starts at a point and runs to infinity.',
  point: 'Creates point objects.',
  'point-multiple': 'Creates point objects until you press Esc.',
  divide: 'Places point objects or blocks at equal intervals along an object.',
  measure: 'Places point objects or blocks at a set distance along an object.',
  revcloud: 'Creates or modifies a revision cloud.',
  'revcloud-rect': 'Creates a rectangular revision cloud from two corners.',
  'revcloud-poly': 'Creates a polygonal revision cloud from the points you pick.',
  'revcloud-free': 'Creates a freehand revision cloud by dragging.',
  'revcloud-object': 'Converts a closed object into a revision cloud.',
  wipeout: 'Creates a polygon that masks the objects under it with the background colour.',
  // Home > Modify
  move: 'Moves objects a distance in a direction.',
  copy: 'Copies objects a distance in a direction.',
  stretch: 'Stretches the objects a crossing window or polygon crosses.',
  rotate: 'Rotates objects around a base point.',
  mirror: 'Creates a mirrored copy of objects across a line.',
  scale: 'Enlarges or reduces objects, keeping their proportions.',
  trim: 'Trims or extends objects to meet the edges of other objects.',
  'trim-trim': 'Trims objects to meet the edges of other objects.',
  'trim-extend': 'Extends objects to meet the edges of other objects.',
  extend: 'Extends objects to meet the edges of other objects.',
  fillet: 'Rounds or chamfers the corner between two objects.',
  'fillet-fillet': 'Rounds the corner between two objects with an arc.',
  'fillet-chamfer': 'Bevels the corner between two lines.',
  chamfer: 'Bevels the corner between two lines.',
  array: 'Creates copies of objects in a pattern.',
  'array-rect': 'Creates copies of objects in rows and columns.',
  'array-polar': 'Creates copies of objects evenly around a center point.',
  'array-path': 'Creates copies of objects evenly along a path.',
  offset: 'Creates concentric circles, parallel lines and parallel curves.',
  explode: 'Breaks a compound object into its component objects.',
  erase: 'Removes objects from the drawing.',
  break: 'Breaks an object between two points.',
  'break-break': 'Breaks an object between two points.',
  'break-at-point': 'Breaks an object into two at a single point.',
  join: 'Joins the ends of similar objects into a single object.',
  lengthen: 'Changes the length of objects and the included angle of arcs.',
  align: 'Moves, rotates and scales objects to line them up with other objects.',
  overkill: 'Removes duplicate and overlapping lines, arcs and polylines.',
  // Home > Annotation
  text: 'Creates multiline or single-line text.',
  mtext: 'Creates a paragraph of text as a single multiline text object.',
  dtext: 'Creates one or more lines of text, each a separate object.',
  dimension: 'Creates dimensions.',
  'dim-linear': 'Creates a horizontal or vertical linear dimension.',
  'dim-aligned': 'Creates a linear dimension aligned with the points measured.',
  'dim-angular': 'Measures the angle between lines, of an arc, or between three points.',
  'dim-arc': 'Measures the length along an arc or polyline arc segment.',
  'dim-radius': 'Measures the radius of a circle or an arc.',
  'dim-diameter': 'Measures the diameter of a circle or an arc.',
  'dim-jogged': 'Creates a jogged radius dimension for a large circle or arc.',
  'dim-ordinate': 'Measures the X or Y distance of a point from the origin.',
  leader: 'Creates and edits multileaders.',
  mleader: 'Creates a multileader: an arrowhead, a leader line and its content.',
  'mleader-add': 'Adds leader lines to a multileader.',
  'mleader-remove': 'Removes leader lines from a multileader.',
  table: 'Creates an empty table.',
  centerline: 'Creates centerlines and center marks.',
  'centerline-line': 'Creates a centerline between two lines.',
  centermark: 'Creates a center mark at the center of circles and arcs.',
  // Home > Layers
  'layer-properties': 'Manages layers and their properties.',
  'layer-control':
    'Shows the layer of the selected objects, or the current layer; pick a layer to move the objects to it, or with none selected to make it current.',
  'layer-off': 'Turns off the layers of the objects you pick.',
  'layer-isolate': 'Hides or locks every layer except those of the objects you pick.',
  'layer-unisolate': 'Restores the layers hidden or locked by the last Isolate.',
  'layer-freeze': 'Freezes the layers of the objects you pick.',
  'layer-lock': 'Locks the layer of an object you pick.',
  'layer-unlock': 'Unlocks the layer of an object you pick.',
  'layer-on': 'Turns on every layer in the drawing.',
  'layer-thaw': 'Thaws every layer in the drawing.',
  'layer-make-current': 'Makes the layer of an object you pick the current layer.',
  'layer-match': 'Changes the layer of objects to the layer of another object.',
  'layer-previous': 'Undoes the last change to layer settings.',
  // Home > Block, Insert > Block
  insert: 'Inserts a block or a drawing into the current drawing.',
  create: 'Creates a block definition from the objects you select.',
  edit: 'Opens a block definition in the Block Editor.',
  'edit-attributes': 'Edits the attributes of a block reference.',
  eattedit: 'Edits the attribute values and properties of a block reference.',
  battman: 'Manages the attribute definitions of a block.',
  'define-attributes': 'Creates an attribute definition for storing data in a block.',
  'manage-attributes': 'Manages the attribute definitions of a block.',
  'block-editor': 'Opens a block definition in the Block Editor.',
  'edit-attribute': 'Edits the attribute values and properties of a block reference.',
  // Home > Properties
  'match-properties': 'Applies the properties of one object to other objects.',
  'color-control':
    'Shows the color of the selected objects, or the color new objects take; pick one to change it.',
  'linetype-control':
    'Shows the linetype of the selected objects, or the linetype new objects take; pick one to change it.',
  'lineweight-control':
    'Shows the lineweight of the selected objects, or the lineweight new objects take; pick one to change it.',
  'transparency-control':
    'Shows the transparency of the selected objects, or the transparency new objects take; pick one to change it.',
  properties: 'Shows the Properties palette.',
  // Home > Groups
  group: 'Creates a named or unnamed group from the objects you select.',
  ungroup: 'Removes the group the objects you pick belong to.',
  'group-edit': 'Adds objects to a group, removes them, or renames it.',
  'group-manager': 'Manages groups in the Object Grouping dialog.',
  'group-selection': 'Selects a whole group when you pick one of its objects.',
  'group-box': 'Shows a bounding box around a selected group.',
  // Home > Utilities
  'measure-tools': 'Measures the distance, radius, angle, area or volume of objects.',
  'measure-geom': 'Measures the distance, radius, angle, area or volume of objects.',
  dist: 'Measures the distance and angle between two points.',
  area: 'Measures the area and perimeter of objects or of a region you define.',
  'quick-select': 'Selects the objects that match a property you filter by.',
  'id-point': 'Shows the coordinates of a point.',
  list: 'Lists the properties and geometry of the objects you select.',
  // Home > Clipboard
  paste: 'Pastes objects from the clipboard.',
  pasteclip: 'Pastes objects from the clipboard.',
  pasteblock: 'Pastes the objects on the clipboard as a block.',
  pasteorig: 'Pastes the objects on the clipboard at their original coordinates.',
  cut: 'Removes objects and puts them on the clipboard.',
  'copy-clip': 'Copies objects to the clipboard.',
  'copy-base': 'Copies objects to the clipboard with a base point you pick.',
  // Insert > Reference, Import, Data
  attach: 'Attaches a drawing, image or PDF as a reference.',
  xattach: 'Attaches a drawing as an external reference.',
  imageattach: 'Attaches a raster image.',
  pdfattach: 'Attaches a PDF page as an underlay.',
  clip: 'Crops the display of an external reference, image or underlay to a boundary.',
  adjust: 'Adjusts the brightness, contrast and fade of an image or underlay.',
  imageadjust: 'Adjusts the brightness, contrast and fade of an image.',
  pdfadjust: 'Adjusts the contrast, fade and monochrome display of a PDF underlay.',
  'xref-palette': 'Shows the External References palette.',
  bind: 'Binds named objects of an external reference into the drawing.',
  'underlay-layers': 'Turns the layers of a PDF underlay on and off.',
  'underlay-snap': 'Snaps to the geometry of PDF underlays, or stops snapping to it.',
  'underlay-snap-on': 'Snaps to the geometry of PDF underlays.',
  'underlay-snap-off': 'Stops snapping to the geometry of PDF underlays.',
  'pdf-import': 'Attaches a PDF page as an underlay to trace over.',
  field: 'Inserts a field that updates with the data it shows.',
  // Text Editor (M7-02 part 5)
  'text-bold':
    'Turns bold on or off for the selected text, or the text typed next (TrueType only).',
  'text-italic':
    'Turns italic on or off for the selected text, or the text typed next (TrueType only).',
  'text-underline': 'Turns underlining on or off for the selected text, or the text typed next.',
  'text-overline': 'Turns overlining on or off for the selected text, or the text typed next.',
  'text-strike': 'Turns strikethrough on or off for the selected text, or the text typed next.',
  'text-stack': 'Stacks the selected text around its /, # or ^ as a fraction or tolerance.',
  'text-paragraph': 'Sets the tabs, indents, alignment and spacing of the paragraph.',
  'text-columns': 'Flows the text into columns, or breaks a column here.',
  'text-field': 'Inserts a field that updates with the data it shows.',
  'text-spell': 'Underlines the words the dictionaries do not have as you type.',
  'close-text-editor': 'Closes the Text Editor and keeps the text.',
  // Annotate (M7-02 part 2)
  'text-style':
    'Shows the current text style; pick another to make it current, or manage the text styles.',
  find: 'Finds and replaces text in the drawing.',
  spell: 'Checks the spelling of text in the drawing.',
  'justify-text': 'Changes the justification point of text without moving it.',
  'scale-text': 'Enlarges or reduces text objects without moving them.',
  'text-align': 'Lines up text objects along a line or with another text.',
  qdim: 'Creates a series of dimensions from the objects you select.',
  continue: 'Continues a dimension from the last or a selected one.',
  'dim-continue': 'Creates a dimension that starts at the second extension line of another.',
  'dim-baseline': 'Creates a dimension from the first extension line of another.',
  'dim-style':
    'Shows the current dimension style; pick another to make it current, or manage the dimension styles.',
  'dim-space': 'Spaces parallel linear and angular dimensions evenly.',
  'dim-break': 'Breaks dimension and extension lines where objects cross them.',
  'dim-jogline': 'Adds or removes a jog line on a linear dimension.',
  'dim-inspect': 'Adds or removes an inspection frame and rate on a dimension.',
  'dim-oblique': 'Slants the extension lines of linear dimensions.',
  'dim-text-angle': 'Moves and rotates the text of a dimension.',
  'dim-reassociate': 'Associates dimensions with the objects they measure.',
  'dim-disassociate': 'Removes the association between dimensions and their objects.',
  'dim-override': 'Overrides dimension variables for the dimensions you select.',
  'mleader-align': 'Lines up and spaces multileaders you select.',
  'mleader-collect': 'Gathers multileaders holding blocks into one leader.',
  'mleader-style':
    'Shows the current multileader style; pick another to make it current, or manage the multileader styles.',
  'table-style':
    'Shows the current table style; pick another to make it current, or manage the table styles.',
  'scale-list': 'Edits the list of scales offered for viewports, layouts and plots.',
  'add-scales': 'Adds or deletes annotation scales of annotative objects.',
  'sync-scales': 'Resets the positions of annotative objects at other scales.',
  // Parametric (M9-05)
  'gc-coincident': 'Constrains two points together, or a point to an object.',
  'gc-collinear': 'Makes two or more lines lie along the same line.',
  'gc-concentric': 'Makes two arcs or circles share a center.',
  'gc-fix': 'Locks a point or an object in place.',
  'gc-parallel': 'Makes two lines parallel to each other.',
  'gc-perpendicular': 'Makes two lines lie at right angles to each other.',
  'gc-horizontal': 'Makes a line, or the line between two points, parallel to the X axis.',
  'gc-vertical': 'Makes a line, or the line between two points, parallel to the Y axis.',
  'gc-tangent': 'Makes a curve tangent to another curve or a line.',
  'gc-smooth': 'Joins a spline to another curve with curvature continuity.',
  'gc-symmetric': 'Makes two objects or points symmetric about a line.',
  'gc-equal': 'Makes lines the same length, or arcs and circles the same radius.',
  'gc-show-hide': 'Shows or hides the constraint bars of the objects you select.',
  'gc-show-all': 'Shows the constraint bars of every constrained object.',
  'gc-hide-all': 'Hides every constraint bar.',
  'gc-auto': 'Applies constraints to the objects you select by how they lie to one another.',
  'gc-infer': 'Applies constraints as you draw, from the object snaps that place each point.',
  'gc-settings': 'Sets the constraint bars, constraint names and Auto Constrain rules.',
  'dc-linear': 'Holds the horizontal or vertical distance between two points at a value.',
  'dc-linear-linear': 'Holds the horizontal or vertical distance between two points at a value.',
  'dc-horizontal':
    'Holds the horizontal distance between two points, or a line’s ends, at a value.',
  'dc-vertical': 'Holds the vertical distance between two points, or a line’s ends, at a value.',
  'dc-aligned': 'Holds a length, or the distance between points and lines, at a value.',
  'dc-radius': 'Holds the radius of a circle or arc at a value.',
  'dc-diameter': 'Holds the diameter of a circle or arc at a value.',
  'dc-angular': 'Holds the angle between two lines, of an arc, or at three points at a value.',
  'dc-convert': 'Turns an associative dimension into a dimensional constraint.',
  'dc-show-dynamic':
    'Shows or hides the dynamic constraints; hidden ones show while their objects are selected.',
  'dc-show-hide': 'Shows or hides the dynamic constraints of the objects you select.',
  'delete-constraints':
    'Removes every geometric and dimensional constraint from the objects you select.',
  'parameters-manager':
    "Opens the Parameters Manager: the dimensional constraints' names, expressions and values, edited in place.",
  // View
  zoom: 'Enlarges or reduces the view of the drawing.',
  'zoom-extents': 'Zooms to show every object in the drawing.',
  'zoom-window': 'Zooms to show the area of a window you draw.',
  'zoom-previous': 'Zooms back to the previous view.',
  'zoom-realtime': 'Zooms in and out as you drag up and down.',
  'zoom-all': 'Zooms to the drawing limits or extents, whichever is larger.',
  'zoom-center': 'Zooms to a center point and a magnification or height.',
  'zoom-object': 'Zooms to show the objects you select as large as possible.',
  'zoom-in': 'Zooms in to twice the current magnification.',
  'zoom-out': 'Zooms out to half the current magnification.',
  pan: 'Moves the view as you drag.',
  'named-views': 'Saves and restores named views.',
  'ucs-icon': 'Shows or hides the UCS icon.',
  'ucs-icon-on': 'Shows the UCS icon.',
  'ucs-icon-off': 'Hides the UCS icon.',
  ucs: 'Sets the origin and orientation of the user coordinate system.',
  regen: 'Regenerates the drawing in the current viewport.',
  'regen-all': 'Regenerates the drawing in every viewport.',
  'viewport-config': 'Splits the drawing area into tiled model viewports.',
  'layers-palette': 'Manages layers and their properties.',
  designcenter: 'Shows DesignCenter, to browse and insert content from drawings.',
  references: 'Shows the External References palette.',
  health: 'Shows the Health palette: what the drawing holds that may need attention.',
  diagnostics:
    "Shows the Diagnostics palette: frame times, entity counts, caches, workers and the last command's timing.",
  history: 'Shows the Command History palette.',
  theme: 'Sets the colour theme of the window.',
  'theme-system': "Follows the device's light or dark setting.",
  'theme-light': 'Uses the light colour theme.',
  'theme-dark': 'Uses the dark colour theme.',
  // Output
  plot: 'Plots the drawing to a PDF or a printer.',
  preview: 'Shows the drawing as it will be plotted.',
  'page-setup': 'Manages the page setups of model space and the layouts.',
  'export-pdf': 'Exports the drawing to a PDF file.',
  export: 'Exports the drawing to another file format.',
  publish: 'Plots several layouts and drawings to one PDF.',
  // Layout
  'new-layout': 'Creates a layout.',
  'layout-new': 'Creates a layout from scratch.',
  'layout-template': 'Creates a layout from a template drawing.',
  'layout-copy': 'Copies a layout.',
  'layout-rename': 'Renames a layout.',
  'layout-delete': 'Deletes a layout.',
  viewports: 'Creates layout viewports.',
  'mview-rect': 'Creates a rectangular layout viewport.',
  'mview-poly': 'Creates a layout viewport of a polygonal shape you draw.',
  'mview-object': 'Turns a closed object into a layout viewport.',
  'vp-clip': 'Clips a layout viewport to a boundary.',
  'vp-lock': 'Locks the scale and view of layout viewports.',
  'vp-layer': 'Sets layer visibility in layout viewports.',
  'vp-max': 'Enlarges a layout viewport to fill the drawing area.',
  'vp-min': 'Brings a maximized layout viewport back to its layout.',
  // Tools
  units: 'Sets the drawing units, precision and angle measure.',
  purge: 'Removes unused styles, layers, blocks and other named objects.',
  recover: 'Shows the drawings recovered after the app closed unexpectedly.',
  options: 'Customizes the program settings.',
  'drafting-settings': 'Sets snap, grid, polar tracking and object snap modes.',
  linetype: 'Loads, sets and manages linetypes.',
  lineweight: 'Sets the current lineweight and how lineweights display.',
  'point-style': 'Sets the style and size of point objects.',
  setvar: 'Lists or changes the values of system variables.',
  aliases: 'Edits the command aliases (acad.pgp).',
  shortcuts: 'Edits the keyboard shortcuts.',
  about: 'Shows the version and the third-party software notices.',
  // Contextual tabs (M7-02 part 4). Hatch Creation: HATCH's and GRADIENT's options.
  'pick-points': 'Picks points inside areas the objects enclose, to hatch each area.',
  'select-boundaries': 'Selects closed objects to hatch.',
  'remove-boundaries': 'Removes islands from the areas found.',
  'undo-boundary': 'Undoes the last area or object added.',
  'hatch-settings': 'Opens the Hatch and Gradient dialog.',
  'close-hatch-creation': 'Makes the hatch and closes the tab.',
  // Hatch Editor: -HATCHEDIT's options on the hatch selected.
  'add-boundaries': 'Adds areas to the hatch, by points or objects.',
  'remove-hatch-boundaries': 'Removes boundaries from the hatch.',
  'recreate-boundary': 'Draws the hatch boundary again as polylines.',
  'edit-hatch': 'Opens the Hatch Edit dialog for the hatch.',
  'match-hatch': 'Applies the properties of one object to other objects.',
  'set-origin': 'Sets where the hatch pattern starts.',
  'separate-hatches': 'Makes one hatch of each area the hatch fills.',
  'hatch-front': 'Brings the hatch in front of other objects.',
  'hatch-back': 'Sends the hatch behind other objects.',
  'close-hatch-editor': 'Deselects the hatch and closes the tab.',
  // Image and PDF Underlay.
  'bring-front': 'Brings the image in front of other objects.',
  'send-back': 'Sends the image behind other objects.',
  'image-adjust': 'Adjusts the brightness, contrast and fade of the image.',
  'image-clip': 'Clips the image to a boundary.',
  'close-image': 'Deselects the image and closes the tab.',
  'pdf-adjust': 'Adjusts the fade, contrast and monochrome of the PDF underlay.',
  'pdf-clip': 'Clips the PDF underlay to a boundary.',
  'pdf-layers': 'Turns the layers of the PDF underlay on and off.',
  'pdf-snap': 'Snaps to the geometry of PDF underlays, or stops snapping to it.',
  'pdf-snap-on': 'Snaps to the geometry of PDF underlays.',
  'pdf-snap-off': 'Stops snapping to the geometry of PDF underlays.',
  'pdf-front': 'Brings the PDF underlay in front of other objects.',
  'pdf-back': 'Sends the PDF underlay behind other objects.',
  'close-pdf-underlay': 'Deselects the PDF underlay and closes the tab.',
  // External Reference.
  'edit-reference': 'Edits the reference in place, in this drawing.',
  'xref-clip': 'Clips the reference to a boundary.',
  'xref-manager': 'Shows the External References palette.',
  'close-external-reference': 'Deselects the reference and closes the tab.',
  // Array: ARRAYEDIT's options on the array selected.
  'edit-source': 'Edits the source objects of the array, changing every item.',
  'replace-item': 'Replaces items of the array with other objects.',
  'reset-array': 'Undoes the items replaced and restores items erased.',
  'explode-array': 'Breaks the array into separate objects.',
  'close-array': 'Deselects the array and closes the tab.',
  // Array Creation: ARRAYRECT's, ARRAYPOLAR's and ARRAYPATH's options.
  'array-associative': 'Sets whether the array stays one object you can edit as an array.',
  'array-base-point': 'Sets the point the array is placed by.',
  'close-array-creation': 'Makes the array and closes the tab.',
  'array-columns': 'Sets the number of columns and the distance between them.',
  'array-count': 'Sets the number of columns and rows.',
  'array-spacing': 'Sets the distance between columns and between rows.',
  'array-rows': 'Sets the number of rows and the distance between them.',
  'array-items': 'Sets the number of items in the array.',
  'array-angle-between': 'Sets the angle between items.',
  'array-fill-angle': 'Sets the angle between the first and last items.',
  'array-rotate-items': 'Sets whether the items turn as they are arrayed.',
  'array-method': 'Sets whether the items divide the path evenly or are measured along it.',
  'array-tangent': 'Sets the direction the items keep along the path.',
  'array-align-items': 'Sets whether each item turns to follow the path.',
  // Table Cell: TABLECELL's options on the cells selected.
  'insert-above': 'Inserts a row above the cells selected.',
  'insert-below': 'Inserts a row below the cells selected.',
  'delete-rows': 'Deletes the rows of the cells selected.',
  'insert-left': 'Inserts a column left of the cells selected.',
  'insert-right': 'Inserts a column right of the cells selected.',
  'delete-columns': 'Deletes the columns of the cells selected.',
  'merge-cells': 'Merges the cells selected into one.',
  'merge-all': 'Merges the cells selected into one cell.',
  'merge-rows': 'Merges the cells selected row by row.',
  'merge-columns': 'Merges the cells selected column by column.',
  'unmerge-cells': 'Splits merged cells back into their cells.',
  'match-cell': 'Gives the cells clicked the format of the cell selected.',
  'cell-style': 'Puts the cells selected on a cell style.',
  'cell-background': 'Sets the background fill of the cells selected.',
  'cell-borders': 'Sets the borders of the cells selected.',
  'cell-alignment': 'Sets where text sits in the cells selected.',
  'remove-overrides': 'Gives the cells selected back their cell style’s formats.',
  'cell-locking': 'Locks the content or the format of the cells selected.',
  'data-format': 'Sets how the cells selected show numbers, dates and other data.',
  'row-height': 'Sets the height of the rows of the cells selected.',
  'cell-block': 'Inserts a block into the cell selected.',
  'cell-text': 'Edits the text of the cell selected.',
  'close-table-cell': 'Deselects the cells and closes the tab.',
  // Block Editor.
  'edit-block': 'Opens another block definition in the Block Editor.',
  'save-block': 'Saves the changes to the block definition.',
  'attribute-definition': 'Defines an attribute in the block.',
  'block-attribute-manager': 'Manages the attributes of block definitions.',
  'close-block-editor': 'Closes the Block Editor.',
};

/** An item's tooltip: its name, what it does, and the command, aliases and keys that run it. */
export interface Tooltip {
  readonly title: string;
  readonly description: string;
  /** The command it runs, as typed at the command line (`CIRCLE`); none for a toggle. */
  readonly command?: string;
  /** The keywords it types at the command's prompts (`2P`). */
  readonly keywords?: readonly string[];
  readonly aliases: readonly string[];
  readonly keys: readonly string[];
  /** Why it cannot run (an item shown greyed out). */
  readonly unavailable?: string;
}

export interface TooltipSources {
  /** The aliases that run a command now (acad.pgp's and the user's alias file). */
  aliasesOf(command: string): readonly string[];
  /** The keys that run a keymap action (`command:PLOT`, `drafting:osnap`). */
  keysOf(action: string): readonly string[];
}

/** Commands whose keys belong to an app action of the keymap rather than `command:<NAME>`. */
const KEY_ACTION_OF: Readonly<Record<string, string>> = {
  ADCENTER: 'designcenter',
  PROPERTIES: 'properties',
  'palette:history': 'history',
};

export const descriptionOf = (id: string): string | undefined => DESCRIPTIONS[id];

/**
 * The tooltip of `item` running `now` (a split button's entry picked last, else the item): the
 * entry's name after the button's, as AutoCAD's split buttons title it.
 */
export function tooltipOf(item: RibbonItem, now: RibbonItem, from: TooltipSources): Tooltip {
  const title =
    now === item || now.label === item.label ? item.label : `${item.label}: ${now.label}`;
  const description = DESCRIPTIONS[now.id] ?? DESCRIPTIONS[item.id] ?? '';
  const run = now.run;
  if (now.unavailable)
    return { title, description, aliases: [], keys: [], unavailable: now.unavailable };
  if ('command' in run)
    return {
      title,
      description,
      command: run.command,
      ...(run.keys && { keywords: run.keys }),
      aliases: from.aliasesOf(run.command),
      keys: from.keysOf(KEY_ACTION_OF[run.command] ?? `command:${run.command}`),
    };
  // A contextual tab's option names the keyword it types at the command's prompt (Enter none).
  if ('keyword' in run)
    return {
      title,
      description,
      ...(run.keyword && { keywords: [run.keyword] }),
      aliases: [],
      keys: [],
    };
  return {
    title,
    description,
    aliases: [],
    keys: from.keysOf(KEY_ACTION_OF[run.action] ?? run.action),
  };
}
