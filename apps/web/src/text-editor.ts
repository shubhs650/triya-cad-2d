// The in-place MTEXT editor's contents (M2-07): formatted spans (@triya/text `MTextSpan`) and
// the edits its toolbar and keys make on them. An offset counts UTF-16 units of text and one
// unit for each paragraph break, stack and field, which is how the editor's DOM counts them
// (MTextEditor.tsx), so a selection maps straight onto the spans.
import type { MTextFormat, MTextSpan } from '@triya/text';

type Spans = readonly MTextSpan[];
/** A format change: a key given as undefined takes that format off. */
export type FormatPatch = { -readonly [K in keyof MTextFormat]?: MTextFormat[K] | undefined };

const unitLength = (s: MTextSpan): number => (s.type === 'text' ? s.text.length : 1);

export function unitsOf(spans: Spans): number {
  return spans.reduce((n, s) => n + unitLength(s), 0);
}

function sameFormat(a: MTextFormat, b: MTextFormat): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof MTextFormat>;
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

/** Empty text dropped, neighbouring text of one format joined. */
function tidy(spans: Spans): MTextSpan[] {
  const out: MTextSpan[] = [];
  for (const s of spans) {
    if (s.type === 'text') {
      if (s.text === '') continue;
      const last = out.at(-1);
      if (last?.type === 'text' && sameFormat(last.format, s.format)) {
        out[out.length - 1] = { ...last, text: last.text + s.text };
        continue;
      }
    }
    out.push(s);
  }
  return out;
}

/** The spans before and after `at`, a text run split there. */
function splitAt(spans: Spans, at: number): [MTextSpan[], MTextSpan[]] {
  const before: MTextSpan[] = [];
  const after: MTextSpan[] = [];
  let pos = 0;
  for (const s of spans) {
    const len = unitLength(s);
    if (pos + len <= at) before.push(s);
    else if (pos >= at) after.push(s);
    else if (s.type === 'text') {
      before.push({ ...s, text: s.text.slice(0, at - pos) });
      after.push({ ...s, text: s.text.slice(at - pos) });
    }
    pos += len;
  }
  return [before, after];
}

/** The spans of [a, b), with the spans before and after. */
function cut(spans: Spans, a: number, b: number): [MTextSpan[], MTextSpan[], MTextSpan[]] {
  const [head, rest] = splitAt(spans, a);
  const [mid, tail] = splitAt(rest, b - a);
  return [head, mid, tail];
}

export function insertSpans(spans: Spans, at: number, inserted: Spans): MTextSpan[] {
  const [head, tail] = splitAt(spans, at);
  return tidy([...head, ...inserted, ...tail]);
}

export function removeRange(spans: Spans, a: number, b: number): MTextSpan[] {
  const [head, , tail] = cut(spans, a, b);
  return tidy([...head, ...tail]);
}

function patched(format: MTextFormat, patch: FormatPatch): MTextFormat {
  const out: Record<string, unknown> = { ...format };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === false) delete out[k];
    else out[k] = v;
  }
  return out as MTextFormat;
}

/** Every span in [a, b) with the patch applied (paragraph breaks have no format). */
export function formatRange(spans: Spans, a: number, b: number, patch: FormatPatch): MTextSpan[] {
  const [head, mid, tail] = cut(spans, a, b);
  return tidy([
    ...head,
    ...mid.map((s) => (s.type === 'break' ? s : { ...s, format: patched(s.format, patch) })),
    ...tail,
  ]);
}

/** Whether every formatted span of [a, b) has `key` set. */
export function hasFormat(spans: Spans, a: number, b: number, key: keyof MTextFormat): boolean {
  const formatted = cut(spans, a, b)[1].flatMap((s) => (s.type === 'break' ? [] : [s.format]));
  return formatted.length > 0 && formatted.every((f) => !!f[key]);
}

/**
 * The format typing at `at` takes: that of the span before it, as in AutoCAD's editor (the
 * span after it at the start of a paragraph).
 */
export function formatAt(spans: Spans, at: number): MTextFormat {
  const [head, tail] = splitAt(spans, at);
  const before = head.at(-1);
  if (before && before.type !== 'break') return before.format;
  const after = tail[0];
  return after && after.type !== 'break' ? after.format : {};
}

const SEPARATORS = { '/': 'fraction', '#': 'diagonal', '^': 'tolerance' } as const;

/**
 * The toolbar's Stack button. A selection that is one stack is unstacked into its text
 * (`1/2`); selected text with a `/`, `#` or `^` is stacked at the first of them, taking the
 * format of its first character. Anything else is left. `caret` is where the selection's end
 * moves to.
 */
export function toggleStack(
  spans: Spans,
  a: number,
  b: number,
): { spans: MTextSpan[]; caret: number } {
  const [head, mid, tail] = cut(spans, a, b);
  if (mid.length === 1 && mid[0]!.type === 'stack') {
    const s = mid[0]!;
    const sep = Object.entries(SEPARATORS).find(([, k]) => k === s.kind)![0];
    const text = `${s.upper}${sep}${s.lower}`;
    return {
      spans: tidy([...head, { type: 'text', text, format: s.format }, ...tail]),
      caret: a + text.length,
    };
  }
  if (!mid.every((s) => s.type === 'text') || mid.length === 0)
    return { spans: [...spans], caret: b };
  const text = mid.map((s) => (s.type === 'text' ? s.text : '')).join('');
  const at = text.search(/[/#^]/);
  if (at < 0) return { spans: [...spans], caret: b };
  const format = mid[0]!.type === 'text' ? mid[0]!.format : {};
  const stack: MTextSpan = {
    type: 'stack',
    upper: text.slice(0, at),
    lower: text.slice(at + 1),
    kind: SEPARATORS[text[at] as keyof typeof SEPARATORS],
    format,
  };
  return { spans: tidy([...head, stack, ...tail]), caret: a + 1 };
}

/**
 * The `\p` values of the paragraph `at` is in: those of the break before it, or the first
 * paragraph's. A paragraph break typed there takes them, so the new paragraph keeps its
 * formatting, as in AutoCAD's editor.
 */
export function paragraphAt(spans: Spans, first: readonly string[], at: number): readonly string[] {
  let codes = first;
  let pos = 0;
  for (const s of spans) {
    if (pos >= at) break;
    if (s.type === 'break') codes = s.paragraph ?? [];
    pos += unitLength(s);
  }
  return codes;
}

/**
 * AutoStack (AutoCAD's "AutoStack Properties", defaults): numbers either side of `/`, `#` or
 * `^`, followed by the space just typed before `caret`, become a stack. `/` and `#` give a
 * diagonal fraction (AutoCAD's default for `/`), `^` a tolerance; the space stays. Undefined
 * when there is nothing to stack.
 */
export function autoStack(
  spans: Spans,
  caret: number,
): { spans: MTextSpan[]; caret: number } | undefined {
  let pos = 0;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    const len = unitLength(s);
    if (s.type === 'text' && caret > pos && caret <= pos + len) {
      const before = s.text.slice(0, caret - pos);
      const m = /(?:^|[^\w.])(\d+(?:\.\d+)?)([/#^])(\d+(?:\.\d+)?) $/.exec(before);
      if (!m) return undefined;
      const whole = m[1]!.length + 1 + m[3]!.length;
      const start = before.length - 1 - whole;
      const stack: MTextSpan = {
        type: 'stack',
        upper: m[1]!,
        lower: m[3]!,
        kind: m[2] === '^' ? 'tolerance' : 'diagonal',
        format: s.format,
      };
      const out = [
        ...spans.slice(0, i),
        { ...s, text: s.text.slice(0, start) },
        stack,
        { ...s, text: s.text.slice(start + whole) },
        ...spans.slice(i + 1),
      ];
      return { spans: tidy(out), caret: pos + start + 2 };
    }
    pos += len;
  }
  return undefined;
}

/** The paragraph `at` is in: 0 for the first, then one more after each break before it. */
export function paragraphIndex(spans: Spans, at: number): number {
  let index = 0;
  let pos = 0;
  for (const s of spans) {
    if (pos >= at) break;
    if (s.type === 'break') index++;
    pos += unitLength(s);
  }
  return index;
}

/** Each paragraph's `\p` values: the first paragraph's, then those each break carries. */
export function paragraphCodes(spans: Spans, first: readonly string[]): (readonly string[])[] {
  return [first, ...spans.flatMap((s) => (s.type === 'break' ? [s.paragraph ?? []] : []))];
}

/**
 * The ruler's edits (M2-07 part 3): the `\p` values of paragraphs `from` to `to` mapped by `f`,
 * the first paragraph's kept apart as the editor keeps them.
 */
export function mapParagraphs(
  spans: Spans,
  first: readonly string[],
  from: number,
  to: number,
  f: (codes: readonly string[]) => readonly string[],
): { spans: MTextSpan[]; first: readonly string[] } {
  let index = 0;
  const at = (codes: readonly string[]) => (index >= from && index <= to ? f(codes) : codes);
  const head = at(first);
  const out = spans.map((s): MTextSpan => {
    if (s.type !== 'break') return s;
    index++;
    const codes = at(s.paragraph ?? []);
    const { paragraph: _, ...rest } = s;
    return codes.length > 0 ? { ...rest, paragraph: codes } : rest;
  });
  return { spans: out, first: head };
}

/**
 * The field code the editor keeps a dimension's measurement under (M2-31 part 2): `<>` in a
 * dimension's text shows as the measurement itself, highlighted, one unit long like a field, as
 * AutoCAD's In-Place Text Editor shows it. No field AutoCAD writes has this code.
 */
export const MEASUREMENT = '\u0000<>';

/** The spans with each `<>` in their text made a measurement atom. */
export function withMeasurements(spans: Spans): MTextSpan[] {
  return spans.flatMap((s): MTextSpan[] => {
    if (s.type !== 'text' || !s.text.includes('<>')) return [s];
    const parts = s.text.split('<>');
    return parts.flatMap((text, i): MTextSpan[] => [
      ...(i > 0 ? [{ type: 'field' as const, code: MEASUREMENT, format: s.format }] : []),
      ...(text !== '' ? [{ ...s, text }] : []),
    ]);
  });
}

/** MTEXT contents written from the editor's spans, each measurement atom back as `<>`. */
export const measurementsWritten = (contents: string): string =>
  contents.split(`%<${MEASUREMENT}>%`).join('<>');

/** Where a key moves a table cell's editor (TABLEDIT, M4-05 part 2). */
export type CellMove = 'next' | 'previous' | 'left' | 'right' | 'up' | 'down';

/**
 * The cell a key moves the editor to from a table cell holding `spans`, the selection `a`..`b`,
 * as AutoCAD's table cell editor: Tab the next cell and Shift+Tab the previous; an arrow key
 * moves to the cell beside only from the edge of the text (Left at its start, Right at its end,
 * Up in its first paragraph, Down in its last) with nothing selected, and moves the caret
 * otherwise. Undefined: the key is the editor's own.
 */
export function cellMoveFor(
  key: string,
  shift: boolean,
  spans: Spans,
  a: number,
  b: number,
): CellMove | undefined {
  if (key === 'Tab') return shift ? 'previous' : 'next';
  if (shift || a !== b) return undefined;
  const end = unitsOf(spans);
  switch (key) {
    case 'ArrowLeft':
      return a === 0 ? 'left' : undefined;
    case 'ArrowRight':
      return a === end ? 'right' : undefined;
    case 'ArrowUp':
      return paragraphIndex(spans, a) === 0 ? 'up' : undefined;
    case 'ArrowDown':
      return paragraphIndex(spans, a) === paragraphIndex(spans, end) ? 'down' : undefined;
    default:
      return undefined;
  }
}

/** A key typed while a table cell's editor gives way to the next cell's. */
export interface CarriedKey {
  readonly key: string;
  readonly shift: boolean;
  /** Ctrl or Cmd held: Ctrl+Enter ends the editing. */
  readonly ctrl?: boolean;
}

/** What a carried key does in the next cell's editor. */
export type AheadOp =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'backspace' }
  | { readonly kind: 'break' }
  | { readonly kind: 'move'; readonly move: CellMove }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'finish' };

/**
 * Keys typed after Tab (or an arrow) left a table cell and before the next cell's editor opened
 * (M4-05 part 7): AutoCAD's cell editor keeps them, so a drafter typing a schedule row by row
 * loses nothing. They are typed into the next cell in order up to a Tab, Shift+Tab, Esc or
 * Ctrl+Enter, which moves on, cancels or ends the editing as it would have; `rest` are the keys after that, for the cell it leads
 * to. A key that does not type (an arrow, Shift alone) is dropped: where the caret was is gone.
 */
export function cellAhead(keys: readonly CarriedKey[]): {
  ops: AheadOp[];
  rest: readonly CarriedKey[];
} {
  const ops: AheadOp[] = [];
  for (let i = 0; i < keys.length; i++) {
    const { key, shift, ctrl } = keys[i]!;
    if (key === 'Enter' && ctrl) {
      ops.push({ kind: 'finish' });
      return { ops, rest: [] };
    }
    if (ctrl) continue;
    if (key === 'Tab') {
      ops.push({ kind: 'move', move: shift ? 'previous' : 'next' });
      return { ops, rest: keys.slice(i + 1) };
    }
    if (key === 'Escape') {
      ops.push({ kind: 'cancel' });
      return { ops, rest: [] };
    }
    const last = ops.at(-1);
    if (key.length === 1) {
      if (last?.kind === 'text') ops[ops.length - 1] = { kind: 'text', text: last.text + key };
      else ops.push({ kind: 'text', text: key });
    } else if (key === 'Backspace') ops.push({ kind: 'backspace' });
    else if (key === 'Enter') ops.push({ kind: 'break' });
  }
  return { ops, rest: [] };
}

/**
 * Keys typed before the MTEXT editor opened (M4-26: after MTEXT's opposite corner, or while
 * TEXTEDIT opens it on a picked MTEXT), which the command line held for the prompt not shown
 * yet: AutoCAD's editor keeps them, so they are typed into it in order, as typed into it would
 * be. Enter is a paragraph break and Tab a tab character there; Esc cancels, and the keys after
 * it (`rest`) were typed ahead of `Command:`.
 */
export function mtextAhead(keys: readonly string[]): {
  ops: AheadOp[];
  rest: readonly string[];
} {
  const ops: AheadOp[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (key === 'Escape') {
      ops.push({ kind: 'cancel' });
      return { ops, rest: keys.slice(i + 1) };
    }
    const last = ops.at(-1);
    const text = key === 'Tab' ? '\t' : key.length === 1 ? key : undefined;
    if (text !== undefined) {
      if (last?.kind === 'text') ops[ops.length - 1] = { kind: 'text', text: last.text + text };
      else ops.push({ kind: 'text', text });
    } else if (key === 'Backspace') ops.push({ kind: 'backspace' });
    else if (key === 'Enter') ops.push({ kind: 'break' });
  }
  return { ops, rest: [] };
}

// ── Fields (M4-10 part 4) ─────────────────────────────────────────────────────────────────────

/** The field span at unit `at` and its index, if there is one. */
function fieldAt(spans: Spans, at: number): number | undefined {
  let n = 0;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    if (n === at && s.type === 'field') return i;
    n += unitLength(s);
    if (n > at) return undefined;
  }
  return undefined;
}

/** Edit Field: the field at `at` with `prefix` before its code, for the engine to find. */
export function markField(spans: Spans, at: number, prefix: string): MTextSpan[] {
  const i = fieldAt(spans, at);
  return spans.map((s, j) => (j === i && s.type === 'field' ? { ...s, code: prefix + s.code } : s));
}

/** Convert Field to Text: the field at `at` as its value, in its format. */
export function fieldAsText(spans: Spans, at: number, value: string): MTextSpan[] {
  const i = fieldAt(spans, at);
  return spans.map((s, j) =>
    j === i && s.type === 'field' ? { type: 'text', text: value, format: s.format } : s,
  );
}

/**
 * TEXT's line editor's contents: text, and fields, each one atom shown by its value (`----` when
 * it has none, as AutoCAD shows a field not evaluated).
 */
export type LinePart =
  { readonly text: string } | { readonly code: string; readonly value: string };

/** The end of the field opened at `start` (`%<`), allowing nested ones; -1 if unclosed. */
function fieldEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === '%' && s[i + 1] === '<') {
      depth++;
      i++;
    } else if (s[i] === '>' && s[i + 1] === '%') {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const pushText = (out: LinePart[], text: string): void => {
  if (text === '') return;
  const last = out.at(-1);
  if (last && 'text' in last) out[out.length - 1] = { text: last.text + text };
  else out.push({ text });
};

/** What a key typed before TEXT's line editor opened does there. */
export type LineAheadOp =
  | { readonly kind: 'line'; readonly value: string }
  | { readonly kind: 'end' }
  | { readonly kind: 'cancel' };

/**
 * Keys typed before TEXT's line editor opened (M4-20), which the command line held for the
 * prompt not shown yet: AutoCAD's in-place editor keeps them, so they are typed into it in order.
 * Enter places the line typed (`line`), or on an empty line ends TEXT (`end`); Esc cancels. The
 * keys after an end or a cancel (`rest`) were typed ahead of `Command:`; `text` is the line left
 * typed. A space is typed (TEXT takes spaces); Tab types nothing. `typed`: what the editor's line
 * holds already, which the keys go on from.
 */
export function lineAhead(
  keys: readonly string[],
  typed = '',
): {
  ops: LineAheadOp[];
  text: string;
  rest: readonly string[];
} {
  const ops: LineAheadOp[] = [];
  let text = typed;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (key === 'Escape') {
      ops.push({ kind: 'cancel' });
      return { ops, text: '', rest: keys.slice(i + 1) };
    }
    if (key === 'Enter') {
      if (text === '') {
        ops.push({ kind: 'end' });
        return { ops, text, rest: keys.slice(i + 1) };
      }
      ops.push({ kind: 'line', value: text });
      text = '';
    } else if (key === 'Backspace') text = text.slice(0, -1);
    else if (key.length === 1) text += key;
  }
  return { ops, text, rest: [] };
}

/** What a key typed before TEXTEDIT's line editor opened does there. */
export type EditAheadOp = { readonly kind: 'keep' } | { readonly kind: 'cancel' };

/**
 * Keys typed before TEXTEDIT's line editor opened on a picked TEXT (M4-26), which opens with the
 * value selected: the first key that types replaces it (Backspace deletes it), as typed into the
 * editor would, and the keys after go on from there. Enter keeps the line (`keep`), Esc cancels;
 * the keys after either (`rest`) were typed ahead of the prompt that follows. `typed`: the line
 * the keys go on from, undefined while the value is still selected; `text` is the same after the
 * keys (undefined when none of them typed).
 */
export function editAhead(
  keys: readonly string[],
  typed: string | undefined,
): { op?: EditAheadOp; text: string | undefined; rest: readonly string[] } {
  let text = typed;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (key === 'Escape' || key === 'Enter') {
      return { op: { kind: key === 'Enter' ? 'keep' : 'cancel' }, text, rest: keys.slice(i + 1) };
    }
    if (key === 'Backspace') text = text === undefined ? '' : text.slice(0, -1);
    else if (key.length === 1) text = (text ?? '') + key;
  }
  return { text, rest: [] };
}

/** A line (`Rev %<\AcVar Date>%`) as its parts; with no `fields` (no Insert Field), its text. */
export function lineParts(
  value: string,
  fields: Readonly<Record<string, string>> | undefined,
): LinePart[] {
  const out: LinePart[] = [];
  if (!fields) {
    pushText(out, value);
    return out;
  }
  let i = 0;
  for (;;) {
    const at = value.indexOf('%<', i);
    const end = at < 0 ? -1 : fieldEnd(value, at);
    if (end < 0) {
      pushText(out, value.slice(i));
      return out;
    }
    pushText(out, value.slice(i, at));
    const code = value.slice(at + 2, end - 2);
    out.push({ code, value: fields[code] ?? '----' });
    i = end;
  }
}

const shownOf = (p: LinePart): string => ('text' in p ? p.text : p.value);

/** What the line editor shows. */
export const lineShown = (parts: readonly LinePart[]): string => parts.map(shownOf).join('');

/** The line as the engine takes it, each field as its code. */
export const lineValue = (parts: readonly LinePart[]): string =>
  parts.map((p) => ('text' in p ? p.text : `%<${p.code}>%`)).join('');

/**
 * The parts after the line editor's input changed to `shown`, the caret at `caret`: what was
 * typed replaces what it replaced, and a field the change reaches into goes whole, as an atom in
 * AutoCAD's editor does. The characters after the caret are the ones left as they were.
 */
export function lineEdited(parts: readonly LinePart[], shown: string, caret: number): LinePart[] {
  const old = lineShown(parts);
  let prefix = 0;
  while (prefix < old.length && prefix < shown.length && old[prefix] === shown[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < old.length &&
    suffix < shown.length &&
    old[old.length - 1 - suffix] === shown[shown.length - 1 - suffix]
  )
    suffix++;
  const q = Math.max(0, Math.min(suffix, shown.length - caret));
  const p = Math.max(0, Math.min(prefix, caret, old.length - q));
  const end = old.length - q;
  const typed = shown.slice(p, shown.length - q);
  const out: LinePart[] = [];
  const after: LinePart[] = [];
  let at = 0;
  for (const part of parts) {
    const s = shownOf(part);
    const a = at;
    const b = at + s.length;
    at = b;
    if ('text' in part) {
      pushText(out, s.slice(0, Math.max(0, Math.min(s.length, p - a))));
      const tail = s.slice(Math.max(0, Math.min(s.length, end - a)));
      if (b > end) pushText(after, tail);
      continue;
    }
    // A field the change touches (removes from, or types inside) goes whole.
    const touched = a < end && b > p ? true : a < p && p < b;
    if (touched) continue;
    if (b <= p) out.push(part);
    else after.push(part);
  }
  pushText(out, typed);
  for (const part of after) {
    if ('text' in part) pushText(out, part.text);
    else out.push(part);
  }
  return out;
}

/** The field shown across `at` (from its start up to its end), with where it is shown. */
export function lineFieldAt(
  parts: readonly LinePart[],
  at: number,
): { readonly index: number; readonly start: number; readonly end: number } | undefined {
  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const len = shownOf(part).length;
    if (!('text' in part) && at >= n && at < n + len) return { index: i, start: n, end: n + len };
    n += len;
  }
  return undefined;
}

/** The parts before and after the shown place `at`; a field across it goes before. */
export function lineSplit(parts: readonly LinePart[], at: number): [LinePart[], LinePart[]] {
  const head: LinePart[] = [];
  const tail: LinePart[] = [];
  let n = 0;
  for (const part of parts) {
    const s = shownOf(part);
    if ('text' in part && n < at && at < n + s.length) {
      head.push({ text: s.slice(0, at - n) });
      tail.push({ text: s.slice(at - n) });
    } else if (n < at) head.push(part);
    else tail.push(part);
    n += s.length;
  }
  return [head, tail];
}
