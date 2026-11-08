// Prompts and answers of the command engine (M2-01, ARCHITECTURE.md §5.1). A command yields a
// `Prompt` and receives a `PromptAnswer`; the command line, Dynamic Input, the Ctrl+K palette and
// tests are front-ends that turn typed text or picks into answers on the `PromptBus`.
import type { Vec2 } from '../geom/types';
import type { EntityId } from '../model/entity-ids';

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
}

/** A point; with `rubberBand` the front-end draws a line from it and a number is a direct distance. */
export interface PointPrompt extends PromptBase {
  readonly kind: 'point';
  /** With `box`, a rectangle with its corners at `from` and the cursor (a window's corners). */
  readonly rubberBand?: { readonly from: Vec2; readonly box?: boolean };
  /**
   * Text that is neither a point nor an option answers `{ kind: 'string' }` instead of being
   * refused (AutoCAD's "arbitrary input", initget bit 128): ZOOM's `2x` and `0.5xp`.
   */
  readonly arbitrary?: boolean;
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

/** Free text; without `spaces` a space ends the input (the front-end's job, as Space is Enter). */
export interface StringPrompt extends PromptBase {
  readonly kind: 'string';
  readonly spaces?: boolean;
}

export interface IntegerPrompt extends PromptBase {
  readonly kind: 'integer';
}

export interface RealPrompt extends PromptBase {
  readonly kind: 'real';
}

/** "Select objects": the selection front-end (M2-03) answers with the chosen entities. */
export interface SelectionPrompt extends PromptBase {
  readonly kind: 'selection';
}

export type Prompt =
  | PointPrompt
  | DistancePrompt
  | AnglePrompt
  | KeywordPrompt
  | StringPrompt
  | IntegerPrompt
  | RealPrompt
  | SelectionPrompt;

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
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'selection'; readonly ids: readonly EntityId[] }
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
};

/** Whether an answer suits a prompt (the bus refuses others before the command sees them). */
export function answerFits(prompt: Prompt, answer: PromptAnswer): boolean {
  if (answer.kind === 'enter') return true;
  if (answer.kind === 'keyword') {
    return (prompt.options ?? []).some((o) => o.toUpperCase() === answer.keyword.toUpperCase());
  }
  if (answer.kind === 'string' && 'arbitrary' in prompt && prompt.arbitrary) return true;
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

/** An answer as the command line echoes it, and as a prompt shows it as its default. */
export function formatAnswer(answer: PromptAnswer, precision = 4): string {
  switch (answer.kind) {
    case 'point':
      return `${formatNumber(answer.point.x, precision)},${formatNumber(answer.point.y, precision)}`;
    case 'distance':
    case 'number':
      return formatNumber(answer.value, Number.isInteger(answer.value) ? 0 : precision);
    case 'angle':
      return formatNumber((answer.value * 180) / Math.PI, Math.min(precision, 4));
    case 'keyword':
      return answer.keyword;
    case 'string':
      return answer.value;
    case 'selection':
      return `${answer.ids.length} found`;
    case 'enter':
      return '';
  }
}

/** The prompt line: `Specify next point or [Undo/Close] <10.0000>:` (AutoCAD's layout). */
export function formatPrompt(prompt: Prompt, precision = 4): string {
  let text = prompt.message;
  if (prompt.options && prompt.options.length > 0) text += ` [${prompt.options.join('/')}]`;
  if (prompt.default) {
    const value =
      prompt.default.kind === 'distance' || prompt.default.kind === 'number'
        ? formatNumber(prompt.default.value, prompt.kind === 'integer' ? 0 : precision)
        : formatAnswer(prompt.default, precision);
    text += ` <${value}>`;
  } else if (prompt.defaultLabel) text += ` <${prompt.defaultLabel}>`;
  return `${text}:`;
}
