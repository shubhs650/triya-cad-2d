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
}

export interface TooltipSources {
  /** The aliases that run a command now (acad.pgp's and the user's alias file). */
  aliasesOf(command: string): readonly string[];
  /** The keys that run a keymap action (`command:PLOT`, `drafting:osnap`). */
  keysOf(action: string): readonly string[];
}

/** Commands whose keys belong to an app action of the keymap rather than `command:<NAME>`. */
const KEY_ACTION_OF: Readonly<Record<string, string>> = { PROPERTIES: 'properties' };

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
  if ('command' in run)
    return {
      title,
      description,
      command: run.command,
      ...(run.keys && { keywords: run.keys }),
      aliases: from.aliasesOf(run.command),
      keys: from.keysOf(KEY_ACTION_OF[run.command] ?? `command:${run.command}`),
    };
  return { title, description, aliases: [], keys: from.keysOf(run.action) };
}
