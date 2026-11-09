// The MTEXT editor's ruler (M2-07 part 3): a paragraph's first-line indent, its left indent and
// its tab stops, read from and written to the paragraph's `\p` values (`MTextParagraph.codes`).
// As in AutoCAD's editor, the values are in the MTEXT's own height units, which is how layout
// reads them (`layoutMText`).
//
// A change appends one value with the keys that differ (`\pi1,l2,t4,c8;`), or replaces the last
// value when that one holds only ruler keys (an earlier ruler change), so dragging a marker
// again and again does not pile values up. Every other key of the chain (alignment, spacing,
// bullets) stays as written.
import { paragraphStyleOf, type MTextTabStop } from './parse';

export interface MTextRuler {
  /** First-line indent, relative to the left indent. */
  readonly indentFirst: number;
  readonly indentLeft: number;
  readonly tabs: readonly MTextTabStop[];
}

/** The ruler of a paragraph whose `\p` values are `codes`. */
export function rulerOf(codes: readonly string[]): MTextRuler {
  const s = paragraphStyleOf(codes);
  return { indentFirst: s.indentFirst, indentLeft: s.indentLeft, tabs: s.tabs };
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Whether a `\p` value sets nothing but indents and tab stops. */
function rulerOnly(value: string): boolean {
  let inTabs = false;
  return value.split(',').every((tok) => {
    if (/^[il]/.test(tok)) {
      inTabs = false;
      return NUMBER.test(tok.slice(1));
    }
    if (tok.startsWith('t')) {
      inTabs = tok !== 'tz';
      return tok === 'tz' || NUMBER.test(tok.slice(1).replace(/^[cr]/, ''));
    }
    return inTabs && NUMBER.test(tok.replace(/^[cr]/, ''));
  });
}

/** A number as MTEXT writes it: no exponent for the sizes drawings use. */
const num = (v: number): string => String(Number(v.toPrecision(12)));

const stop = (t: MTextTabStop): string =>
  `${t.kind === 'center' ? 'c' : t.kind === 'right' ? 'r' : ''}${num(t.at)}`;

const sameTabs = (a: readonly MTextTabStop[], b: readonly MTextTabStop[]): boolean =>
  a.length === b.length && a.every((t, i) => t.at === b[i]!.at && t.kind === b[i]!.kind);

/** The `\p` values with the ruler set; the values unchanged when it already is. */
export function withRuler(codes: readonly string[], ruler: MTextRuler): readonly string[] {
  if (sameRuler(rulerOf(codes), ruler)) return codes;
  const last = codes.at(-1);
  const head = last !== undefined && rulerOnly(last) ? codes.slice(0, -1) : codes;
  const now = rulerOf(head);
  const keys: string[] = [];
  if (ruler.indentFirst !== now.indentFirst) keys.push(`i${num(ruler.indentFirst)}`);
  if (ruler.indentLeft !== now.indentLeft) keys.push(`l${num(ruler.indentLeft)}`);
  if (!sameTabs(ruler.tabs, now.tabs)) {
    const tabs = [...ruler.tabs].sort((a, b) => a.at - b.at);
    keys.push(tabs.length === 0 ? 'tz' : `t${tabs.map(stop).join(',')}`);
  }
  return keys.length === 0 ? head : [...head, keys.join(',')];
}

export function sameRuler(a: MTextRuler, b: MTextRuler): boolean {
  return (
    a.indentFirst === b.indentFirst && a.indentLeft === b.indentLeft && sameTabs(a.tabs, b.tabs)
  );
}
