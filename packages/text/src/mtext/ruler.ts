// The MTEXT editor's ruler (M2-07 part 3): a paragraph's first-line indent, its left indent and
// its tab stops, read from and written to the paragraph's `\p` values (`MTextParagraph.codes`).
// As in AutoCAD's editor, the values are in the MTEXT's own height units, which is how layout
// reads them (`layoutMText`).
//
// A change appends one value with the keys that differ (`\pi1,l2,t4,c8;`), or replaces the last
// value when that one holds only ruler keys (an earlier ruler change), so dragging a marker
// again and again does not pile values up. Every other key of the chain (alignment, spacing,
// bullets) stays as written.
//
// M2-26 part 3: the right indent (`r`, only in the extended `\px` form, so a value holding it
// starts with `x`, and written before `t`, after which `r` is a right tab stop), decimal tab
// stops (`D<symbol>n`) and the paragraph alignment the Paragraph dialog sets (`withAlignment`).
import { paragraphKeys, paragraphStyleOf, type MTextAlign, type MTextTabStop } from './parse';

export interface MTextRuler {
  /** First-line indent, relative to the left indent. */
  readonly indentFirst: number;
  readonly indentLeft: number;
  /** From the box's right edge (the column's, with columns). */
  readonly indentRight: number;
  readonly tabs: readonly MTextTabStop[];
}

/** The ruler of a paragraph whose `\p` values are `codes`. */
export function rulerOf(codes: readonly string[]): MTextRuler {
  const s = paragraphStyleOf(codes);
  return {
    indentFirst: s.indentFirst,
    indentLeft: s.indentLeft,
    indentRight: s.indentRight,
    tabs: s.tabs,
  };
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Whether a tab-list token is a stop: n, cn, rn or D<symbol>n. */
const isStop = (tok: string): boolean =>
  /^D./s.test(tok) ? NUMBER.test(tok.slice(2)) : NUMBER.test(tok.replace(/^[cr]/, ''));

/** Whether a `\p` value sets nothing but indents and tab stops. */
function rulerOnly(value: string): boolean {
  let inTabs = false;
  return paragraphKeys(value).every((tok) => {
    // As the parser reads it: in a tab list, `r5` is a right stop, not a right indent.
    if (inTabs && isStop(tok)) return true;
    inTabs = false;
    if (/^[ilr]/.test(tok)) return NUMBER.test(tok.slice(1));
    if (tok.startsWith('t')) {
      inTabs = tok !== 'tz';
      return tok === 'tz' || isStop(tok.slice(1));
    }
    return false;
  });
}

/** A number as MTEXT writes it: no exponent for the sizes drawings use. */
const num = (v: number): string => String(Number(v.toPrecision(12)));

const KIND_PREFIX = { left: '', center: 'c', right: 'r' } as const;

const stop = (t: MTextTabStop): string =>
  t.kind === 'decimal'
    ? `D${t.decimal === ' ' || t.decimal === undefined ? '_' : t.decimal}${num(t.at)}`
    : `${KIND_PREFIX[t.kind]}${num(t.at)}`;

const sameTabs = (a: readonly MTextTabStop[], b: readonly MTextTabStop[]): boolean =>
  a.length === b.length &&
  a.every((t, i) => t.at === b[i]!.at && t.kind === b[i]!.kind && t.decimal === b[i]!.decimal);

/** The `\p` values with the ruler set; the values unchanged when it already is. */
export function withRuler(codes: readonly string[], ruler: MTextRuler): readonly string[] {
  if (sameRuler(rulerOf(codes), ruler)) return codes;
  const last = codes.at(-1);
  const head = last !== undefined && rulerOnly(last) ? codes.slice(0, -1) : codes;
  const now = rulerOf(head);
  const keys: string[] = [];
  if (ruler.indentFirst !== now.indentFirst) keys.push(`i${num(ruler.indentFirst)}`);
  if (ruler.indentLeft !== now.indentLeft) keys.push(`l${num(ruler.indentLeft)}`);
  const right = ruler.indentRight !== now.indentRight;
  if (right) keys.push(`r${num(ruler.indentRight)}`);
  if (!sameTabs(ruler.tabs, now.tabs)) {
    const tabs = [...ruler.tabs].sort((a, b) => a.at - b.at);
    keys.push(tabs.length === 0 ? 'tz' : `t${tabs.map(stop).join(',')}`);
  }
  return keys.length === 0 ? head : [...head, `${right ? 'x' : ''}${keys.join(',')}`];
}

export function sameRuler(a: MTextRuler, b: MTextRuler): boolean {
  return (
    a.indentFirst === b.indentFirst &&
    a.indentLeft === b.indentLeft &&
    a.indentRight === b.indentRight &&
    sameTabs(a.tabs, b.tabs)
  );
}

/** A paragraph's own alignment; undefined when its attachment point aligns it. */
export const alignOf = (codes: readonly string[]): MTextAlign | undefined =>
  paragraphStyleOf(codes).align;

const ALIGN_LETTER: Readonly<Record<MTextAlign, string>> = {
  left: 'l',
  right: 'r',
  center: 'c',
  justified: 'j',
  distributed: 'd',
};

/**
 * The `\p` values with the paragraph aligned (undefined: by the attachment point, `q*`), as
 * the Paragraph dialog's Paragraph Alignment sets it. An alignment value of its own at the
 * chain's end is replaced rather than another appended.
 */
export function withAlignment(
  codes: readonly string[],
  align: MTextAlign | undefined,
): readonly string[] {
  if (alignOf(codes) === align) return codes;
  const last = codes.at(-1);
  const head = last !== undefined && /^x?q.$/.test(last) ? codes.slice(0, -1) : codes;
  if (alignOf(head) === align) return head;
  return [...head, `q${align ? ALIGN_LETTER[align] : '*'}`];
}
