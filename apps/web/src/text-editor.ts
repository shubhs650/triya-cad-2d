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
