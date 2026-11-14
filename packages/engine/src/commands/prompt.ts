// Prompts and answers of the command engine (M2-01, ARCHITECTURE.md §5.1). A command yields a
// `Prompt` and receives a `PromptAnswer`; the command line, Dynamic Input, the Ctrl+K palette and
// tests are front-ends that turn typed text or picks into answers on the `PromptBus`.
import type { Vec2 } from '../geom/types';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Color, LinetypeRef, Lineweight } from '../model/types';
import type { DragPreview } from './drag';
import {
  DECIMAL_UNITS,
  formatAngle,
  formatDistance,
  formatNumber,
  type DrawingUnits,
} from './units';

/** A selection window's corners as the drafter gave them. */
export interface SelectionWindow {
  readonly a: Vec2;
  readonly b: Vec2;
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
   * Esc answers `{ kind: 'escape' }` rather than cancelling the command: PLOT's window corners
   * go back to the Plot dialog, as AutoCAD's do (M2-17 part 3). A command typed or picked
   * meanwhile still cancels it.
   */
  readonly escape?: boolean;
}

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
    readonly selection?: 'auto' | 'window' | 'crossing';
  };
  /**
   * Text that is neither a point nor an option answers `{ kind: 'string' }` instead of being
   * refused (AutoCAD's "arbitrary input", initget bit 128): ZOOM's `2x` and `0.5xp`.
   */
  readonly arbitrary?: boolean;
  /**
   * A one-shot object snap override typed at the prompt before (M2-04: `END`, `MID,END`,
   * `NONe`): the OSMODE bits the front-end snaps this point with instead of the running ones;
   * 0 snaps to nothing. A click the override finds nothing at is refused (`PromptBus.pick`
   * with `missed`).
   */
  readonly osnap?: number;
  /**
   * Freehand (REVCLOUD Freehand, M2-08): the front-end answers with the cursor's point, without
   * a click, each time the cursor has moved `spacing` world units from `from`, as AutoCAD draws
   * a freehand cloud while the crosshairs are guided along its path. A click answers too.
   */
  readonly trace?: { readonly from: Vec2; readonly spacing: number };
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
   * M2-07 part 2: a text selected first, or double-clicked, is edited).
   */
  readonly pickfirst?: boolean;
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
    };

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
  | { readonly kind: 'point'; readonly point: Vec2 }
  | { readonly kind: 'distance'; readonly value: number }
  | { readonly kind: 'angle'; readonly value: number }
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
    return (prompt.options ?? []).some((o) => o.toUpperCase() === answer.keyword.toUpperCase());
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
  if (prompt.options && prompt.options.length > 0) text += ` [${prompt.options.join('/')}]`;
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
