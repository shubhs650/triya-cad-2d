// Prompts and answers of the command engine (M2-01, ARCHITECTURE.md §5.1). A command yields a
// `Prompt` and receives a `PromptAnswer`; the command line, Dynamic Input, the Ctrl+K palette and
// tests are front-ends that turn typed text or picks into answers on the `PromptBus`.
import type { Vec2 } from '../geom/types';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Color, LinetypeRef, Lineweight } from '../model/types';
import type { DragPreview } from './drag';

/** A selection window's corners as the drafter gave them. */
export interface SelectionWindow {
  readonly a: Vec2;
  readonly b: Vec2;
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
  readonly height: number;
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
  /** DXF 72/73 (justification), shown and not changed here. */
  readonly halign: number;
  readonly valign: number;
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
  | { readonly kind: 'enter' };

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

/** Number formatting for prompts: `precision` decimals (LUPREC, 4 unless the drawing says). */
export function formatNumber(value: number, precision = 4): string {
  const s = value.toFixed(precision);
  return s === `-${(0).toFixed(precision)}` ? s.slice(1) : s;
}

/**
 * An answer as the command line echoes it, and as a prompt shows it as its default. Angles show
 * in degrees to `anglePrecision` places (AUPREC in the bus; AutoCAD's ROTATE shows `<0>`).
 */
export function formatAnswer(
  answer: PromptAnswer,
  precision = 4,
  anglePrecision = Math.min(precision, 4),
): string {
  switch (answer.kind) {
    case 'point':
      return `${formatNumber(answer.point.x, precision)},${formatNumber(answer.point.y, precision)}`;
    case 'distance':
    case 'number':
      return formatNumber(answer.value, Number.isInteger(answer.value) ? 0 : precision);
    case 'angle':
      return formatNumber((answer.value * 180) / Math.PI, anglePrecision);
    case 'keyword':
      return answer.keyword;
    case 'string':
      return answer.value;
    case 'selection':
      return `${answer.ids.length} found`;
    case 'dialog':
    case 'enter':
      return '';
  }
}

/** The prompt line: `Specify next point or [Undo/Close] <10.0000>:` (AutoCAD's layout). */
export function formatPrompt(
  prompt: Prompt,
  precision = 4,
  anglePrecision = Math.min(precision, 4),
): string {
  let text = prompt.message;
  if (prompt.options && prompt.options.length > 0) text += ` [${prompt.options.join('/')}]`;
  if (prompt.default) {
    const value =
      prompt.default.kind === 'distance' || prompt.default.kind === 'number'
        ? formatNumber(prompt.default.value, prompt.kind === 'integer' ? 0 : precision)
        : formatAnswer(prompt.default, precision, anglePrecision);
    text += ` <${value}>`;
  } else if (prompt.defaultLabel) text += ` <${prompt.defaultLabel}>`;
  return `${text}:`;
}
