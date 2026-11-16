// Prompts and answers of the command engine (M2-01, ARCHITECTURE.md §5.1). A command yields a
// `Prompt` and receives a `PromptAnswer`; the command line, Dynamic Input, the Ctrl+K palette and
// tests are front-ends that turn typed text or picks into answers on the `PromptBus`.
import type { DeferredPick } from '../geom/deferred';
import type { Vec2 } from '../geom/types';
import type { DeferredModes } from '../input/osnap';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Color, EntityType, LinetypeRef, Lineweight } from '../model/types';
import type { ColorBook } from '../properties/color-books';
import type { OverkillSettings } from '../edit/overkill';
import type { GripDimensions } from '../edit/grips';
import type { ArrayCountField } from '../edit/array-grips';
import type { QuickSelectCriteria, QuickSelectType } from '../selection/qselect';
import type { FilterItem, FilterNameKey } from '../selection/filter';
import type { PropertyUnits } from '../properties/sheet';
import type { MatchSettings } from '../properties/match';
import type { CommandPreviewSource } from './command-preview';
import type { DragPreview } from './drag';
import type { UnitsSettings } from './drawing-units';
import type { DimStyleAction, DimStyleRequest } from './dimstyle';
import type { TextStyleAction, TextStyleRequest } from './textstyle';
import {
  DECIMAL_UNITS,
  formatAngle,
  formatDistance,
  formatNumber,
  type DrawingUnits,
} from './units';

/**
 * A selection window's corners as the drafter gave them; for a selection polygon or lasso
 * (M3-04 part 6), the corners of the box round it and `polygon`, its points in order.
 */
export interface SelectionWindow {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly polygon?: readonly Vec2[];
}

/**
 * One step of a selection that took objects (M2-27: -ATTEDIT's "Select Attributes" takes the
 * attribute picked, or the attributes a window holds or crosses, not the whole reference): the
 * objects it took, and the pick or window that took them. A step with neither (ALL, Last,
 * Previous, a pre-selection made with Ctrl+A) took them whole.
 */
export interface SelectionTake {
  readonly ids: readonly EntityId[];
  readonly pick?: Vec2;
  readonly window?: SelectionWindow;
  /** The window was a crossing window. */
  readonly crossing?: boolean;
}

interface PromptBase {
  /** The prompt without options or default, as AutoCAD words it: "Specify next point". */
  readonly message: string;
  /**
   * Option keywords in AutoCAD's display form: the capital letters are what the drafter may type
   * ("Undo", "Close", "eXit", "LAst"). Shown as `[Undo/Close]`.
   */
  readonly options?: readonly string[];
  /**
   * Keywords taken as `options` are but not shown (AutoCAD's keywords a prompt accepts without
   * listing them): the grip mode names MO, RO, SC, MI and ST typed at a grip prompt, and a
   * multi-functional grip's functions (M3-05).
   */
  readonly hiddenOptions?: readonly string[];
  /**
   * A tap of Ctrl (pressed and let go with no other key or button) answers the keyword
   * `GRIP_CYCLE`: a hot multi-functional grip's next function, as AutoCAD's Ctrl cycles them
   * (M3-05).
   */
  readonly ctrlCycles?: true;
  /**
   * A point, distance or angle picked with Ctrl held answers with `ctrl`: the grip modes take it
   * as Copy turned on (M3-05 part 2; AutoCAD 2024 Help, "To Make Multiple Copies with Grips":
   * "You can also make multiple copies by holding down Ctrl as you click the first point").
   */
  readonly ctrlCopies?: true;
  /**
   * Offset or rotation snap (M3-05 part 6; AutoCAD 2024 Help, "To Make Multiple Copies with
   * Grips"): once a grip mode has placed a copy, a point or angle picked with Ctrl held snaps to
   * whole multiples of that copy's offset or angle (`offsetSnapPoint`). The command snaps the
   * answer; the front-end drags the cursor snapped while Ctrl is held.
   */
  readonly offsetSnap?: OffsetSnap;
  /**
   * The menu a right-click on the canvas shows while this prompt waits (M3-05 part 5: the grip
   * modes' menu, AutoCAD 2024 Help, "To Use Grips to Stretch, Move, Rotate, Scale or Mirror
   * Objects": "right-click to display a shortcut menu of grip options"). Each item answers as
   * typed; the front-end draws the items in order, a separator before each `separatorBefore`.
   */
  readonly shortcutMenu?: readonly ShortcutMenuItem[];
  /** The shortcut menu's accessible name; "Grip options" when absent. */
  readonly shortcutMenuTitle?: string;
  /** What Enter gives, shown as `<…>`; without one Enter answers `{ kind: 'enter' }`. */
  readonly default?: PromptAnswer;
  /**
   * What Enter does when that is not an answer, shown as `<…>`: ZOOM's `<real time>`. Enter
   * still answers `{ kind: 'enter' }`; `default` wins when both are given.
   */
  readonly defaultLabel?: string;
  /** The objects dragged with the cursor while this prompt waits (M2-06 part 2). */
  readonly drag?: DragPreview;
  /**
   * COMMANDPREVIEW (M3-12 part 6, `command-preview.ts`): what a pick or point at the cursor would
   * do, which the front-end shows while COMMANDPREVIEW is 1.
   */
  readonly commandPreview?: CommandPreviewSource;
  /**
   * Esc answers `{ kind: 'escape' }` rather than cancelling the command: PLOT's window corners
   * go back to the Plot dialog, as AutoCAD's do (M2-17 part 3). A command typed or picked
   * meanwhile still cancels it.
   */
  readonly escape?: boolean;
  /**
   * AutoCAD 2024's "(hold Ctrl to switch direction)" (M3-01 part 6: ARC's and PLINE's last arc
   * values): a point, distance or angle picked with Ctrl held answers with `ctrl`, which draws
   * the arc the other way round, and the front-end drags it so while Ctrl is held. Anywhere
   * else a Ctrl pick is a plain one. The message says so itself (`CTRL_SWITCH`).
   */
  readonly switchDirection?: true;
}

/** A grip mode's offset snap: copies `step` apart from `from`, or `step` radians about `base`. */
export type OffsetSnap =
  | { readonly kind: 'offset'; readonly from: Vec2; readonly step: Vec2 }
  | { readonly kind: 'rotation'; readonly base: Vec2; readonly step: number };

/**
 * The point `p` snapped by `snap`: to the nearest whole multiple of the step from its start
 * along the step's line (or round the base, at the same distance from it), never the start
 * itself, where the original is.
 */
export function offsetSnapPoint(snap: OffsetSnap, p: Vec2): Vec2 {
  const nearest = (x: number) => {
    const k = Math.round(x);
    return k !== 0 ? k : x < 0 ? -1 : 1;
  };
  if (snap.kind === 'offset') {
    const { from, step } = snap;
    const l2 = step.x * step.x + step.y * step.y;
    if (!(l2 > 0)) return p;
    const k = nearest(((p.x - from.x) * step.x + (p.y - from.y) * step.y) / l2);
    return { x: from.x + k * step.x, y: from.y + k * step.y };
  }
  const { base, step } = snap;
  if (!(Math.abs(step) > 0)) return p;
  const r = Math.hypot(p.x - base.x, p.y - base.y);
  const a = nearest(Math.atan2(p.y - base.y, p.x - base.x) / step) * step;
  return { x: base.x + r * Math.cos(a), y: base.y + r * Math.sin(a) };
}

/** The angle `a` (radians) snapped to the nearest whole multiple of `step`, never 0. */
export function rotationSnapAngle(step: number, a: number): number {
  if (!(Math.abs(step) > 0)) return a;
  const k = Math.round(a / step);
  return (k !== 0 ? k : a < 0 ? -1 : 1) * step;
}

/** The keyword a Ctrl tap answers at a prompt that `ctrlCycles`. */
export const GRIP_CYCLE = 'Ctrl';

/** An item of a prompt's right-click menu (`PromptBase.shortcutMenu`, M3-05 part 5). */
export interface ShortcutMenuItem {
  /** As the menu shows it: "Base Point". */
  readonly label: string;
  /** The keyword it answers with (one the prompt takes); absent, it answers Enter. */
  readonly keyword?: string;
  /** Shown greyed and not chosen: the prompt does not take it here (Reference in MOVE). */
  readonly disabled?: true;
  /** A separator line goes above it. */
  readonly separatorBefore?: true;
}

/** What a prompt that takes Ctrl (`switchDirection`) puts after its message's first words. */
export const CTRL_SWITCH = ' (hold Ctrl to switch direction)';

/** A point; with `rubberBand` the front-end draws a line from it and a number is a direct distance. */
export interface PointPrompt extends PromptBase {
  readonly kind: 'point';
  /**
   * With `box`, a rectangle with its corners at `from` and the cursor (a window's corners);
   * with `selection` too, a selection window (M2-03), drawn as AutoCAD draws one: a window
   * solid on blue, a crossing dashed on green, `auto` either by the cursor's side of `from`.
   */
  readonly rubberBand?: {
    readonly from: Vec2;
    readonly box?: boolean;
    /**
     * False: nothing is drawn for it, the drag draws the shape (RECTANG's rounded or turned
     * rectangle, M3-01 part 3); the cursor is still measured from `from`.
     */
    readonly drawn?: false;
    readonly selection?: 'auto' | 'window' | 'crossing';
    /**
     * A selection window started at `Command:` (M3-04 part 6): SELECTIONPREVIEW bit 1 previews
     * what it would take, rather than bit 2.
     */
    readonly atCommand?: true;
    /**
     * False: dragging from `from` makes this rectangle, never a lasso (PICKAUTO 2 started it
     * from over an object, M3-04 part 6; a lasso starts only where nothing is).
     */
    readonly lasso?: false;
    /**
     * A selection polygon or fence being drawn (M3-04: WPolygon, CPolygon, Fence): its points
     * so far, `from` the last; the front-end draws them on to the cursor, closed back to the
     * first unless `open` (a fence), as `selection` says (a window or a crossing).
     */
    readonly path?: { readonly points: readonly Vec2[]; readonly open?: true };
    /**
     * A press at `from` dragged and let go answers with the path the cursor took (`freehand`
     * on the answer): TRIM's and EXTEND's freehand fence in Quick mode (M3-12 part 6; AutoCAD
     * 2024 Help, "TRIM (Command)": "click and drag to start a freehand selection path"). The
     * front-end draws the path as a fence while it is dragged.
     */
    readonly freehand?: true;
    /**
     * The direction, a unit vector, of the last segment drawn where it ends at `from` (LINE's
     * and PLINE's next point, M3-06 part 3): with POLARMODE 1 the front-end counts the polar
     * tracking angles from it ("Relative to Last Segment").
     */
    readonly direction?: Vec2;
  };
  /**
   * Text that is neither a point nor an option answers `{ kind: 'string' }` instead of being
   * refused (AutoCAD's "arbitrary input", initget bit 128): ZOOM's `2x` and `0.5xp`.
   */
  readonly arbitrary?: boolean;
  /**
   * A press dragged across the canvas answers its release too, as a Shift+click there: table
   * cells selected by dragging across them (TABLECELL, M4-05 part 4).
   */
  readonly releaseExtends?: true;
  /**
   * A one-shot object snap override typed at the prompt before (M2-04: `END`, `MID,END`,
   * `NONe`): the OSMODE bits the front-end snaps this point with instead of the running ones;
   * 0 snaps to nothing. A click the override finds nothing at is refused (`PromptBus.pick`
   * with `missed`).
   */
  readonly osnap?: number;
  /**
   * The TAN and PER object snaps this point takes deferred (M3-01 part 2: LINE's first point,
   * CIRCLE 3P's points): the front-end offers AutoCAD's Deferred Tangent and Deferred
   * Perpendicular on the object under the cursor, and the answer carries it (`deferred`) for
   * the command to solve once its other points are known. Elsewhere TAN and PER are drawn
   * from the last point, as they always are.
   */
  readonly deferred?: DeferredModes;
  /**
   * Freehand (REVCLOUD Freehand, M2-08): the front-end answers with the cursor's point, without
   * a click, each time the cursor has moved `spacing` world units from `from`, as AutoCAD draws
   * a freehand cloud while the crosshairs are guided along its path. A click answers too.
   */
  readonly trace?: { readonly from: Vec2; readonly spacing: number };
  /**
   * Grip stretching one object (M3-06 part 8): what Dynamic Input's dimension fields measure
   * (DYNDIVIS, DYNDIGRIP), a resulting length and angle from `anchor`, a radius from `center`.
   */
  readonly gripDimensions?: GripDimensions;
  /**
   * An associative array's count grip (M3-05 part 7): what Dynamic Input's count field counts,
   * the count the cursor gives (`arrayCountAt`) shown in it and a typed one taken.
   */
  readonly arrayCount?: ArrayCountField;
  /**
   * An object pick (TRIM's and EXTEND's "Select object to trim", M3-02 part 2): the click's own
   * point, with the pickbox rather than the crosshairs and no drafting aids, Shift held or not
   * (the answer's `shift`).
   */
  readonly pickbox?: boolean;
  /**
   * The point goes horizontally or vertically from the rubber band's start, whatever ORTHO says
   * (TK's next tracking point, M3-06 part 4): the front-end constrains the cursor so, and keeps
   * an object snap's X or Y along that axis.
   */
  readonly ortho?: boolean;
  /**
   * What a typed `@` counts from at this prompt instead of LASTPOINT: BREAK's "Specify second
   * break point", where `@` is the first break point however it was given (M3-02 part 4).
   */
  readonly lastPoint?: Vec2;
  /**
   * MEASUREGEOM's Quick mode (M3-07 part 2): as the cursor moves the front-end shows what it
   * measures there (`quickMeasure`: distances across it, an object's length or radius, the
   * angles at a line's ends), and fills `loops`, the spaces clicked so far, green. Asked with
   * `pickbox`, so a click answers with its own point and Shift.
   */
  readonly quick?: { readonly loops: readonly (readonly Vec2[])[] };
}

/** A distance: a number, or two points (one when `base` is given). */
export interface DistancePrompt extends PromptBase {
  readonly kind: 'distance';
  readonly base?: Vec2;
  /** As `PointPrompt.arbitrary`: ZOOM Center's magnification `2x`. */
  readonly arbitrary?: boolean;
}

/** An angle: a number in the drawing's angle units, or two points (one when `base` is given). */
export interface AnglePrompt extends PromptBase {
  readonly kind: 'angle';
  readonly base?: Vec2;
  /**
   * The world direction (radians) a typed angle counts from, in place of ANGBASE: an elliptical
   * arc's angles count from its first axis, XLINE Reference's from the line (M3-01 part 4).
   * Picked points still answer their world angle.
   */
  readonly zero?: number;
  /**
   * A typed angle counts counter-clockwise whatever ANGDIR says: UNITS sets the direction of
   * angle 0 before (or apart from) whether angles run clockwise (M3-09).
   */
  readonly counterClockwise?: true;
  /**
   * The angle is an amount of turning (an included angle, a rotation, an angle between items),
   * not a direction (M3-06 part 7): a typed one counts from ANGBASE alone, the current UCS
   * leaving it as typed. Picked points still answer their world angle.
   */
  readonly turn?: true;
}

/** One of the options only. */
export interface KeywordPrompt extends PromptBase {
  readonly kind: 'keyword';
}

/**
 * Where an in-place text editor opens (M2-07): TEXT's one line at a time, or MTEXT's editor
 * with its formatting toolbar, which answers with the whole contents (`editor: true`).
 */
/**
 * MTEXT columns as the MTEXT editor shows and sets them (M2-07 part 3; AutoCAD's Column
 * Settings dialog). The drawing's values: one column's width (DXF 48, and the MTEXT's DXF 41),
 * the gutter between columns (DXF 49) and the column height (DXF 46).
 */
export interface TextEditorColumns {
  /** 1 static: `count` columns. 2 dynamic: as many as the text needs (`count` is that). */
  readonly type: 1 | 2;
  readonly count: number;
  readonly width: number;
  readonly gutter: number;
  /** The column height (DXF 46); with manual heights, the tallest. */
  readonly height: number;
  /**
   * Dynamic columns of manual height (DXF 73 0, M2-26): each column's own height, dragged in
   * the editor; absent for auto height (and static columns), where all take `height`.
   */
  readonly heights?: readonly number[];
  /** DXF 74: the columns set right to left (kept from the drawing; M2-26). */
  readonly flowReversed?: boolean;
}

export interface TextEditorRequest {
  readonly kind: 'text' | 'mtext';
  /** TEXT: the line's alignment point; MTEXT: the insertion point, on the box by `attachment`. */
  readonly position: Vec2;
  /** Radians, counter-clockwise from world +X. */
  readonly rotation: number;
  readonly height: number;
  /** MTEXT's box width (0: no wrapping); 0 for TEXT. */
  readonly width: number;
  /** MTEXT's attachment point 1–9 (top-left to bottom-right); TEXT's DXF 72/73 as 1–9 too. */
  readonly attachment: number;
  /** The STYLE record, its font file (DXF 3) and TrueType flags (1 italic, 2 bold). */
  readonly style: Handle;
  readonly fontFile: string;
  readonly trueTypeFlags: number;
  /** The style's width factor and obliquing (radians), which MTEXT contents are relative to. */
  readonly widthFactor?: number;
  readonly obliqueAngle?: number;
  /**
   * The text being edited (TEXTEDIT, M2-07 part 2): a TEXT's value or an MTEXT's contents. The
   * editor opens holding it and answers once, `editor: true`, with the whole new value.
   */
  readonly value?: string;
  /** MTEXT's columns, when it has them (M2-07 part 3). */
  readonly columns?: TextEditorColumns;
  /** MTEXT's line spacing style (1 at least, 2 exactly) and factor, for laying out columns. */
  readonly lineSpacingStyle?: number;
  readonly lineSpacing?: number;
  /**
   * A dimension's measurement, formatted (M2-31 part 2): the editor shows it, highlighted, in
   * place of each `<>` in `value`, as AutoCAD's In-Place Text Editor shows a dimension's text,
   * and answers `<>` for it.
   */
  readonly measurement?: string;
  /**
   * The text's background mask and frame, which the editor shows as the text draws them
   * (M2-44): each `pad` drawing units beyond the text box on every side; a mask without a
   * colour is in the drawing window colour. Absent when the text has neither.
   */
  readonly background?: TextEditorBackground;
  /**
   * A table cell's text (TABLEDIT, M4-05 part 2): Tab, Shift+Tab and the arrow keys at the
   * edge of the text close the editor with the move to the next cell (`TableCellMove`).
   */
  readonly cell?: true;
}

/**
 * Where the cell editor goes next (M4-05 part 2; AutoCAD's Help on entering text in table
 * cells: Tab moves to the next cell, Shift+Tab to the previous one, the arrow keys to the cell
 * beside when the cursor is at the start or end of the text).
 */
export type TableCellMove = 'next' | 'previous' | 'left' | 'right' | 'up' | 'down';

/**
 * The Insert Table dialog's settings (TABLE, M4-05 part 2; AutoCAD 2024 Help, "Insert Table
 * Dialog Box"): the table style by name, Insertion behavior (`window`: Specify window), and the
 * Column & row settings. With Specify window one of each pair comes from the window:
 * `autoColumns` the number of columns (else the column width), `autoRows` the number of data
 * rows (else the row height in lines).
 */
export interface InsertTableSettings {
  readonly style: string;
  readonly window: boolean;
  readonly columns: number;
  readonly width: number;
  readonly dataRows: number;
  readonly lines: number;
  readonly autoColumns: boolean;
  readonly autoRows: boolean;
}

/** A table style as the Insert Table dialog lists and previews it. */
export interface TableStyleEntry {
  readonly name: string;
  readonly suppressTitle: boolean;
  readonly suppressHeader: boolean;
  /** The table reads from the bottom up (DXF 70 = 1). */
  readonly up: boolean;
}

/** What `TextEditorRequest.background` shows. */
export interface TextEditorBackground {
  readonly mask?: { readonly color?: Color; readonly pad: number };
  readonly frame?: { readonly pad: number };
}

/** Free text; without `spaces` a space ends the input (the front-end's job, as Space is Enter). */
export interface StringPrompt extends PromptBase {
  readonly kind: 'string';
  readonly spaces?: boolean;
  /** Typed in place on the canvas, where a front-end can (M2-07). */
  readonly editor?: TextEditorRequest;
  /**
   * A click on the canvas answers with its point (TEXT: a click elsewhere starts the next line
   * there, M2-07 part 2).
   */
  readonly pick?: boolean;
}

export interface IntegerPrompt extends PromptBase {
  readonly kind: 'integer';
}

export interface RealPrompt extends PromptBase {
  readonly kind: 'real';
}

/**
 * "Select objects": the bus builds the selection pick by pick (M2-03, `SelectionLoop`) and
 * answers with the chosen entities once Enter ends it (none if nothing was chosen).
 */
export interface SelectionPrompt extends PromptBase {
  readonly kind: 'selection';
  /** The command edits what it selects: objects on locked layers are refused, as AutoCAD does. */
  readonly editable?: boolean;
  /**
   * "Select object": the first pick or window that takes objects ends it (AutoCAD's SIngle
   * mode), and a pre-selection is not taken (M2-08: REVCLOUD Object, WIPEOUT Polyline).
   */
  readonly single?: boolean;
  /**
   * With `single`, the pre-selection still answers it, as for any "Select objects" (TEXTEDIT,
   * M2-07 part 2: a text selected first, or double-clicked, is edited). `false` without `single`:
   * the pre-selection does not answer it either (QSELECT's Select objects, M3-04 part 2).
   */
  readonly pickfirst?: boolean;
  /**
   * A member of a group is taken alone, whatever PICKSTYLE says (M3-08: UNGROUP's and
   * GROUPEDIT's objects name a group by one of its members).
   */
  readonly ungrouped?: boolean;
  /**
   * A badge the front-end draws beside the cursor while this prompt waits: MATCHPROP's
   * paintbrush at "Select destination object(s)" (M3-16; AutoCAD 2024 Help, "MATCHPROP
   * (Command)": "The cursor changes to a Match Properties paintbrush").
   */
  readonly cursor?: 'paintbrush';
}

/**
 * One attribute as the attribute dialogs show it (M2-12): an INSERT's ATTRIB with the prompt of
 * the block's ATTDEF of the same tag. A multiline attribute's `value` is its embedded MTEXT's
 * contents, `\P` between its lines.
 */
export interface AttributeEntry {
  readonly handle: Handle;
  readonly tag: string;
  /** The block's ATTDEF prompt for the tag, or the tag when the block has none. */
  readonly prompt: string;
  readonly value: string;
  readonly multiline: boolean;
  /** DXF 70: 1 invisible, 2 constant, 4 verify, 8 preset. */
  readonly flags: number;
  readonly style: Handle;
  /**
   * DXF 72/73, the justification (M2-27: EATTEDIT changes it, keeping the insertion point). A
   * multiline attribute's is its MTEXT's `attachment` instead.
   */
  readonly halign: number;
  readonly valign: number;
  /** A multiline attribute's MTEXT attachment point, 1–9 (top left to bottom right). */
  readonly attachment?: number;
  readonly height: number;
  /** Radians, the WCS angle of the baseline. */
  readonly rotation: number;
  readonly widthFactor: number;
  /** Radians. */
  readonly oblique: number;
  readonly backward: boolean;
  readonly upsideDown: boolean;
  readonly layer: Handle;
  readonly color: Color;
  readonly linetype: LinetypeRef;
  readonly lineweight: Lineweight;
  /** The named plot style (DXF 390), null for ByLayer (M2-27). */
  readonly plotStyle: Handle | null;
  /**
   * The attribute is annotative: shown, not changed, as making an object annotative is a PRD
   * non-goal (DEC-013).
   */
  readonly annotative: boolean;
}

/** What an attribute dialog may change of one attribute (absent: unchanged). */
export type AttributePatch = { readonly handle: Handle } & Partial<
  Pick<
    AttributeEntry,
    | 'value'
    | 'style'
    | 'height'
    | 'rotation'
    | 'widthFactor'
    | 'oblique'
    | 'backward'
    | 'upsideDown'
    | 'layer'
    | 'color'
    | 'linetype'
    | 'lineweight'
    | 'halign'
    | 'valign'
    | 'attachment'
    | 'plotStyle'
  >
>;

/** A table record a dialog's list offers. */
export interface NamedRecord {
  readonly handle: Handle;
  readonly name: string;
}

/**
 * A dialog a command opens (M2-12), as AutoCAD's: EATTEDIT's Enhanced Attribute Editor (tabs
 * Attribute, Text Options, Properties), ATTEDIT's Edit Attributes (values only) and TEXTEDIT's
 * Edit Attribute Definition (an ATTDEF's tag, prompt and default).
 */
export type DialogRequest =
  | {
      readonly type: 'eattedit';
      /** The block's name, as AutoCAD shows it (a dynamic block's, not its `*U` state's). */
      readonly block: string;
      readonly attributes: readonly AttributeEntry[];
      /** The attribute the list opens on. */
      readonly selected?: Handle;
      readonly styles: readonly NamedRecord[];
      readonly layers: readonly NamedRecord[];
      readonly linetypes: readonly NamedRecord[];
      /**
       * The drawing's named plot styles (ACAD_PLOTSTYLENAME), offered with ByLayer; absent in a
       * colour-dependent drawing ($PSTYLEMODE 1), where the Plot style shows ByColor (M2-27).
       */
      readonly plotStyles?: readonly NamedRecord[];
      /**
       * The colour books the drawing uses, which the Properties tab's Select Color dialog
       * offers (M2-35 part 23); absent when it uses none.
       */
      readonly colorBooks?: readonly ColorBook[];
    }
  | {
      readonly type: 'attedit';
      readonly block: string;
      readonly attributes: readonly AttributeEntry[];
    }
  | {
      readonly type: 'attdef';
      readonly tag: string;
      readonly prompt: string;
      /** The default value; a multiline ATTDEF's MTEXT contents. */
      readonly value: string;
      readonly multiline: boolean;
    }
  | {
      /** MATCHPROP's Property Settings (M3-02 part 5): which properties it copies. */
      readonly type: 'matchprop';
      readonly settings: MatchSettings;
      /** Plot Style is offered: the drawing uses named plot styles. */
      readonly plotStyles: boolean;
    }
  | {
      /** DDPTYPE's Point Style (M3-01 part 6), opened on PDMODE and PDSIZE. */
      readonly type: 'pointstyle';
      readonly mode: number;
      readonly size: number;
    }
  | {
      /** OVERKILL's Delete Duplicate Objects (M3-02 part 6): its settings as it opens. */
      readonly type: 'overkill';
      readonly settings: OverkillSettings;
    }
  | {
      /** QSELECT's Quick Select (M3-04 part 2), opened on `criteria`. */
      readonly type: 'qselect';
      readonly criteria: QuickSelectCriteria;
      /** How many objects are selected (Apply to offers Current selection when any are). */
      readonly selected: number;
      /** The Object type lists of the entire drawing and of the current selection. */
      readonly drawing: readonly QuickSelectType[];
      readonly selection: readonly QuickSelectType[];
      /** How the Value of a distance or angle is shown and typed. */
      readonly units: PropertyUnits;
    }
  | {
      /**
       * DSETTINGS' Drafting Settings (M3-06 part 1): the app's per-user drafting settings, which
       * the dialog sets itself; `tab` the tab it opens on (OSNAP's Object Snap), none for the
       * one shown last.
       */
      readonly type: 'dsettings';
      readonly tab?: DraftingSettingsTab;
      /**
       * The Snap and Grid tab's spacing (M3-06 part 2): the drawing's, from its
       * `*Active` VPORT; none when it has no such viewport.
       */
      readonly snapGrid?: SnapGridSettings;
    }
  | {
      /** SELECTSIMILAR's Select Similar Settings (M3-04 part 3), opened on SELECTSIMILARMODE. */
      readonly type: 'selectsimilar';
      readonly mode: number;
    }
  | {
      /**
       * FILTER's Object Selection Filters (M3-04 part 4). `list` and `name`: the filter it closed
       * with when Add Selected Object reopens it (absent: the app's current filter). `names`
       * offers each name property's values in the drawing, `types` the object types.
       */
      readonly type: 'filter';
      readonly list?: readonly FilterItem[];
      readonly name?: string;
      readonly names: Readonly<Record<FilterNameKey, readonly string[]>>;
      readonly types: readonly { readonly type: EntityType; readonly label: string }[];
    }
  | {
      /**
       * UNITS' Drawing Units (M3-09), opened on `settings`; `direction`: on its Direction
       * Control, after Pick an angle.
       */
      readonly type: 'units';
      readonly settings: UnitsSettings;
      readonly direction?: true;
    }
  | {
      /** TABLE's Insert Table (M4-05 part 2), opened on the settings of the last table. */
      readonly type: 'inserttable';
      readonly settings: InsertTableSettings;
      readonly styles: readonly TableStyleEntry[];
    }
  /** DIMSTYLE's Dimension Style Manager (M4-03). */
  | DimStyleRequest
  /** STYLE's Text Style dialog (M4-04). */
  | TextStyleRequest
  | ObjectGroupingRequest;

/** One row of the Object Grouping dialog's Group Name list (M3-08). */
export interface GroupRow {
  readonly name: string;
  readonly description: string;
  readonly selectable: boolean;
  /** An unnamed group (`*A3`), listed only with Include Unnamed checked. */
  readonly unnamed: boolean;
  readonly members: number;
}

/**
 * CLASSICGROUP's Object Grouping dialog (M3-08; AutoCAD 2024 Help, "Object Grouping Dialog
 * Box"): the drawing's groups in alphabetical order, the one an action left selected, and what
 * the last action had to say (a refusal, Find Name's Group Member List).
 */
export interface ObjectGroupingRequest {
  readonly type: 'objectgrouping';
  readonly groups: readonly GroupRow[];
  readonly selected?: string;
  readonly includeUnnamed: boolean;
  /** Find Name: the groups the object picked belongs to (the Group Member List). */
  readonly memberOf?: readonly string[];
  /** Why the last action did nothing ("A group with this name already exists."). */
  readonly note?: string;
}

/**
 * What an Object Grouping dialog button asks of CLASSICGROUP: those that pick in the drawing
 * (New, Add, Remove, Highlight, Find Name) close the dialog until the pick is made.
 */
export type GroupingAction =
  | {
      readonly op: 'new';
      readonly name: string;
      readonly description: string;
      readonly selectable: boolean;
      readonly unnamed: boolean;
    }
  | { readonly op: 'add' | 'remove' | 'highlight' | 'explode'; readonly group: string }
  | { readonly op: 'find' }
  | { readonly op: 'rename'; readonly group: string; readonly name: string }
  | { readonly op: 'description'; readonly group: string; readonly description: string }
  | { readonly op: 'selectable'; readonly group: string; readonly selectable: boolean }
  | {
      readonly op: 'reorder';
      readonly group: string;
      readonly from: number;
      readonly to: number;
      readonly count: number;
    }
  | { readonly op: 'reverse'; readonly group: string };

/** The Drafting Settings tabs Triya has (M3-06 parts 1 and 2). */
export type DraftingSettingsTab = 'snap' | 'polar' | 'osnap' | 'dyn' | 'qp' | 'sc';

/**
 * What the Snap and Grid tab sets in the `*Active` VPORT (M3-06 part 2): SNAPUNIT, GRIDUNIT (0
 * follows the snap spacing) and GRIDMAJOR, and its Grid behavior (part 6), GRIDDISPLAY's bits.
 */
export interface SnapGridSettings {
  readonly snapSpacing: Vec2;
  readonly gridSpacing: Vec2;
  readonly gridMajor: number;
  /** GRIDDISPLAY (`edit/snap-grid.ts` GRID_DISPLAY bits); absent keeps the viewport's. */
  readonly gridDisplay?: number;
}

/** A dialog open while the command waits; Esc (or Cancel) cancels the command. */
export interface DialogPrompt extends PromptBase {
  readonly kind: 'dialog';
  readonly dialog: DialogRequest;
}

export type Prompt =
  | PointPrompt
  | DistancePrompt
  | AnglePrompt
  | KeywordPrompt
  | StringPrompt
  | IntegerPrompt
  | RealPrompt
  | SelectionPrompt
  | DialogPrompt;

export type PromptKind = Prompt['kind'];

/**
 * An answer. `enter` is Enter (or Space) on empty input at a prompt without a default; Esc is
 * not an answer: it cancels the command (`PromptBus.cancel`). Angles are radians, counter-
 * clockwise from world +X, whatever ANGBASE and ANGDIR say about how they were typed.
 */
export type PromptAnswer =
  | {
      readonly kind: 'point';
      readonly point: Vec2;
      /** A click made with Shift held (TRIM's shift-select to extend, M3-02 part 2). */
      readonly shift?: true;
      /** Picked with Ctrl held, at a prompt that takes it (`switchDirection`, M3-01 part 6). */
      readonly ctrl?: true;
      /**
       * A deferred TAN or PER pick (M3-01 part 2), only at a prompt that takes it (`deferred`):
       * `point` is where the object was picked, which the command solves from.
       */
      readonly deferred?: DeferredPick;
      /**
       * The path a press was dragged along, `point` (where it was let go) its last point, at a
       * prompt that takes it (`rubberBand.freehand`, M3-12 part 6).
       */
      readonly freehand?: readonly Vec2[];
    }
  | {
      readonly kind: 'distance';
      readonly value: number;
      /**
       * The second point when the distance was given by points (POLYGON, M3-01 part 3: a radius
       * picked turns the polygon, a typed one does not).
       */
      readonly to?: Vec2;
      /** Picked with Ctrl held, at a prompt that takes it (`switchDirection`). */
      readonly ctrl?: true;
    }
  | {
      readonly kind: 'angle';
      readonly value: number;
      /** Picked with Ctrl held, at a prompt that takes it (`switchDirection`). */
      readonly ctrl?: true;
    }
  | { readonly kind: 'keyword'; readonly keyword: string }
  | {
      readonly kind: 'string';
      readonly value: string;
      /** From an in-place MTEXT editor: the whole contents, not one typed line (M2-07). */
      readonly editor?: true;
      /**
       * From the MTEXT editor: the columns it closed with, null for none (M2-07 part 3).
       * Undefined: as requested.
       */
      readonly columns?: TextEditorColumns | null;
      /** From a table cell's editor: the cell it moves to next (M4-05 part 2). */
      readonly cell?: TableCellMove;
    }
  | { readonly kind: 'number'; readonly value: number }
  | {
      readonly kind: 'selection';
      readonly ids: readonly EntityId[];
      /**
       * The last window or crossing window the selection was made with (STRETCH stretches
       * what lies in it, M2-06); none when every object was picked or came from a set.
       */
      readonly window?: SelectionWindow;
      /** Where the last pick that took an object was made, when one did (M2-11). */
      readonly pick?: Vec2;
      /** How the objects were taken, step by step, when picks or windows took any (M2-27). */
      readonly takes?: readonly SelectionTake[];
    }
  | {
      readonly kind: 'dialog';
      /**
       * OK closes the dialog with its changes; Apply makes them and keeps it open; Select block
       * makes them and picks another block; `mtext` makes them and opens the MTEXT editor on the
       * multiline attribute `target` (the value's `...` button).
       */
      readonly action: 'ok' | 'apply' | 'select' | 'mtext';
      readonly attributes?: readonly AttributePatch[];
      /** Edit Attribute Definition's fields. */
      readonly attdef?: { readonly tag: string; readonly prompt: string; readonly value: string };
      /** Property Settings' checkboxes as OK closed it. */
      readonly matchprop?: MatchSettings;
      /** Point Style's PDMODE and PDSIZE as OK closed it (negative: relative to the screen). */
      readonly pointStyle?: { readonly mode: number; readonly size: number };
      /** Delete Duplicate Objects' settings as OK closed it. */
      readonly overkill?: OverkillSettings;
      /** Drafting Settings' Snap and Grid tab as OK closed it (M3-06 part 2). */
      readonly snapGrid?: SnapGridSettings;
      /** Quick Select's criteria as OK (or Select objects) closed it. */
      readonly qselect?: QuickSelectCriteria;
      /** Select Similar Settings' checkboxes as OK closed it, SELECTSIMILARMODE's bits. */
      readonly selectSimilar?: number;
      /** An Object Grouping button (CLASSICGROUP, M3-08), with Include Unnamed as it was. */
      readonly grouping?: GroupingAction;
      readonly includeUnnamed?: boolean;
      /**
       * Drawing Units' settings as OK (or Direction Control's Pick an angle, `select`) closed it.
       */
      readonly units?: UnitsSettings;
      /** Insert Table's settings as OK closed it (TABLE, M4-05 part 2). */
      readonly table?: InsertTableSettings;
      /** A Dimension Style Manager action (DIMSTYLE, M4-03), sent with `apply`. */
      readonly dimstyle?: DimStyleAction;
      /** A Text Style dialog action (STYLE, M4-04), sent with `apply`. */
      readonly textstyle?: TextStyleAction;
      /** The Object Selection Filters' list as Apply (or Add Selected Object) closed it. */
      readonly filter?: { readonly list: readonly FilterItem[]; readonly name: string };
      readonly target?: Handle;
    }
  | { readonly kind: 'enter' }
  /** Esc at a prompt that takes it (`escape`). */
  | { readonly kind: 'escape' };

/** The answer kinds each prompt kind takes, besides `keyword` (when it has options) and `enter`. */
export const ANSWER_KINDS: { readonly [K in PromptKind]: readonly PromptAnswer['kind'][] } = {
  point: ['point'],
  distance: ['distance'],
  angle: ['angle'],
  keyword: [],
  string: ['string'],
  integer: ['number'],
  real: ['number'],
  selection: ['selection'],
  dialog: ['dialog'],
};

/** Whether an answer suits a prompt (the bus refuses others before the command sees them). */
export function answerFits(prompt: Prompt, answer: PromptAnswer): boolean {
  if (answer.kind === 'enter') return true;
  if (answer.kind === 'escape') return prompt.escape === true;
  if (answer.kind === 'keyword') {
    if (prompt.ctrlCycles && answer.keyword === GRIP_CYCLE) return true;
    return [...(prompt.options ?? []), ...(prompt.hiddenOptions ?? [])].some(
      (o) => o.toUpperCase() === answer.keyword.toUpperCase(),
    );
  }
  if (answer.kind === 'string' && 'arbitrary' in prompt && prompt.arbitrary) return true;
  if (answer.kind === 'point' && prompt.kind === 'string' && prompt.pick) return true;
  if (!ANSWER_KINDS[prompt.kind].includes(answer.kind)) return false;
  return prompt.kind !== 'integer' || (answer.kind === 'number' && Number.isInteger(answer.value));
}

/**
 * The letters a drafter may type for a keyword: its capital letters ("eXit" → "X", "LAst" →
 * "LA"); a keyword written all in lower case is typed whole.
 */
export function keywordShortcut(keyword: string): string {
  const caps = [...keyword].filter((c) => c !== c.toLowerCase()).join('');
  return caps === '' ? keyword.toUpperCase() : caps;
}

/**
 * The option the input names, or undefined. AutoCAD takes the capital letters or the keyword
 * typed out at least as far as its last capital ("eXit": X, EX, EXI or EXIT; "Close": C to
 * CLOSE), without regard to case. Its documentation says "the uppercase letters or the whole
 * keyword"; the in-between prefixes are what AutoCAD 2024 accepts in practice.
 */
export function matchKeyword(input: string, options: readonly string[]): string | undefined {
  const typed = input.trim().toUpperCase();
  if (typed === '') return undefined;
  for (const option of options) {
    if (typed === keywordShortcut(option)) return option;
  }
  for (const option of options) {
    const full = option.toUpperCase();
    let lastCap = -1;
    [...option].forEach((c, i) => {
      if (c !== c.toLowerCase()) lastCap = i;
    });
    if (full.startsWith(typed) && typed.length >= Math.max(lastCap + 1, 1)) return option;
  }
  return undefined;
}

/**
 * An answer as the command line echoes it, and as a prompt shows it as its default, in the
 * drawing's units (M2-35 part 17, `units.ts`): points and distances by LUNITS and LUPREC, angles
 * by AUNITS and AUPREC (AutoCAD's ROTATE shows `<0>`), plain numbers with LUPREC decimals. A
 * whole number in decimal units shows as it was typed, without places.
 */
export function formatAnswer(answer: PromptAnswer, units: DrawingUnits = DECIMAL_UNITS): string {
  switch (answer.kind) {
    case 'point':
      return `${formatDistance(answer.point.x, units)},${formatDistance(answer.point.y, units)}`;
    case 'distance':
      return units.lunits === 2 && Number.isInteger(answer.value)
        ? formatNumber(answer.value, 0)
        : formatDistance(answer.value, units);
    case 'number':
      return formatNumber(answer.value, Number.isInteger(answer.value) ? 0 : units.luprec);
    case 'angle':
      return formatAngle(answer.value, units);
    case 'keyword':
      return answer.keyword;
    case 'string':
      return answer.value;
    case 'selection':
      return `${answer.ids.length} found`;
    case 'dialog':
    case 'enter':
    case 'escape':
      return '';
  }
}

/** The prompt line: `Specify next point or [Undo/Close] <10.0000>:` (AutoCAD's layout). */
export function formatPrompt(prompt: Prompt, units: DrawingUnits = DECIMAL_UNITS): string {
  let text = prompt.message;
  // An option-only prompt (-HATCH Origin's "[Use current origin/Set new origin]") starts with them.
  if (prompt.options && prompt.options.length > 0) {
    text += `${text ? ' ' : ''}[${prompt.options.join('/')}]`;
  }
  if (prompt.default) {
    const d = prompt.default;
    let value: string;
    if (d.kind !== 'distance' && d.kind !== 'number') value = formatAnswer(d, units);
    else if (prompt.kind === 'integer') value = formatNumber(d.value, 0);
    else if (prompt.kind === 'real') value = formatNumber(d.value, units.luprec);
    else value = formatDistance(d.value, units);
    text += ` <${value}>`;
  } else if (prompt.defaultLabel) text += ` <${prompt.defaultLabel}>`;
  return `${text}:`;
}
