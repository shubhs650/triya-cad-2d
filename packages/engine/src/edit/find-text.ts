// FIND's text search (M4-09 part 2; AutoCAD 2024 Help, "Find and Replace Dialog Box"): the text
// an object holds, read as it shows, matched as the dialog's options say, and replaced back in
// the stored string with the stored formatting kept.
//
// Text is stored with codes: a TEXT's `%%d`, an MTEXT's `\P`, `{\fArial|b1;...}` and `\S1/2;`,
// a dimension's `<>` for its measurement. The search reads what shows ("Ø25", a line break,
// "1/2"), so each stored string is cut into tokens, each a run of the stored string with the
// characters it shows (none for a code). A match is a run of shown characters; replacing it puts
// the replacement where its first token was and keeps every code inside it after the
// replacement, so `{` and `}` stay paired and the formatting around it is kept.
//
// Where AutoCAD's documentation is silent (the most common drafter expectation is taken):
// - A stack (`\S1/2;`), a field (`%<...>%`) and a dimension's measurement (`<>`, `[]`) are one
//   piece: a match takes all of it or none of it, and a measurement or field is never matched
//   (replacing it would lose the value it shows).
// - With Use wildcards, `*` is any run of characters other than spaces and line breaks and `?`
//   any one character, matched anywhere in the text (as a word processor's wildcard search
//   does); `#`, `@`, `.`, `[...]`, `[~...]` and `` ` `` as AutoCAD's WCMATCH reads them.
// - Whole words: a match with no letter, digit or underscore directly before or after it.
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { DocumentModel } from '../model/document';
import type { Entity, EntityGeometry, InsertAttribute, Xdata } from '../model/types';

/** The Find and Replace dialog's Text Types, in its order. */
export type FindTextType =
  'attribute' | 'dimension' | 'text' | 'table' | 'hyperlinkDescription' | 'hyperlink';

export const FIND_TEXT_TYPES: readonly FindTextType[] = [
  'attribute',
  'dimension',
  'text',
  'table',
  'hyperlinkDescription',
  'hyperlink',
];

/** The dialog's Search Options and Text Types. */
export interface FindOptions {
  readonly matchCase: boolean;
  readonly wholeWords: boolean;
  readonly wildcards: boolean;
  /** Search blocks: the text of the blocks the objects searched reference. */
  readonly searchBlocks: boolean;
  /** Ignore hidden items: text on layers off or frozen, invisible objects and attributes. */
  readonly ignoreHidden: boolean;
  readonly matchDiacritics: boolean;
  /** Match half/full width forms: off, a full-width "Ａ" finds "A". */
  readonly matchWidth: boolean;
  readonly types: readonly FindTextType[];
}

/** AutoCAD 2024's defaults: Search blocks and Ignore hidden items on, every text type. */
export const DEFAULT_FIND_OPTIONS: FindOptions = {
  matchCase: false,
  wholeWords: false,
  wildcards: false,
  searchBlocks: true,
  ignoreHidden: true,
  matchDiacritics: false,
  matchWidth: false,
  types: FIND_TEXT_TYPES,
};

/** Where in an object a piece of text is stored. */
export type TextSlot =
  | { readonly kind: 'value' }
  | { readonly kind: 'contents' }
  | { readonly kind: 'attribute'; readonly handle: Handle }
  | { readonly kind: 'dimension' }
  | { readonly kind: 'mleader' }
  | { readonly kind: 'cell'; readonly row: number; readonly column: number }
  /** The PE_URL xdata's 1000 strings: 0 the URL, 1 the description. */
  | { readonly kind: 'hyperlink'; readonly index: 0 | 1 };

/** How a stored string is coded: as typed, a TEXT's, an MTEXT's or a dimension's. */
export type TextSyntax = 'plain' | 'text' | 'mtext' | 'dimension';

/** One piece of text an object holds. */
export interface FoundText {
  readonly id: EntityId;
  readonly slot: TextSlot;
  readonly type: FindTextType;
  readonly raw: string;
  readonly syntax: TextSyntax;
}

/** A run of the stored string and what it shows; `atom` runs are matched whole or not at all. */
export interface TextToken {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly atom?: true;
}

/** Shown in place of a measurement or field, which nothing matches. */
const OPAQUE = '￼';

const PERCENT: Readonly<Record<string, string>> = { d: '°', p: '±', c: 'Ø', '%': '%' };
const TOGGLES = new Set(['u', 'o', 'k']);
const MTEXT_TOGGLES = new Set('LlOoKk');
const MTEXT_ARGUMENTS = new Set('fFHWQTACcp');

/** The stored string cut into tokens (`TextToken`). */
export function textTokens(raw: string, syntax: TextSyntax): TextToken[] {
  const out: TextToken[] = [];
  const char = (start: number, end: number, text: string, atom?: true) =>
    out.push({ start, end, text, ...(atom && { atom }) });
  const coded = syntax === 'mtext' || syntax === 'dimension';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i]!;
    if (syntax === 'plain') {
      char(i, i + 1, c);
      i++;
      continue;
    }
    if (c === '%' && raw[i + 1] === '%' && i + 2 < raw.length) {
      const k = raw[i + 2]!.toLowerCase();
      if (PERCENT[k] !== undefined) {
        char(i, i + 3, PERCENT[k]!);
        i += 3;
        continue;
      }
      if (syntax === 'text' && TOGGLES.has(k)) {
        char(i, i + 3, '');
        i += 3;
        continue;
      }
      const digits = /^\d{3}/.exec(raw.slice(i + 2));
      if (digits) {
        char(i, i + 5, String.fromCharCode(Number(digits[0])));
        i += 5;
        continue;
      }
    }
    if (coded && c === '%' && raw[i + 1] === '<') {
      const end = raw.indexOf('>%', i + 2);
      if (end >= 0) {
        char(i, end + 2, OPAQUE, true);
        i = end + 2;
        continue;
      }
    }
    if (
      syntax === 'dimension' &&
      ((c === '<' && raw[i + 1] === '>') || (c === '[' && raw[i + 1] === ']'))
    ) {
      char(i, i + 2, OPAQUE, true);
      i += 2;
      continue;
    }
    if (!coded) {
      char(i, i + 1, c);
      i++;
      continue;
    }
    if (c === '{' || c === '}') {
      char(i, i + 1, '');
      i++;
      continue;
    }
    if (c !== '\\' || i + 1 >= raw.length) {
      char(i, i + 1, c);
      i++;
      continue;
    }
    const n = raw[i + 1]!;
    if (n === 'P' || n === 'N' || n === 'X') char(i, i + 2, '\n');
    else if (n === '~') char(i, i + 2, ' ');
    else if (n === '\\' || n === '{' || n === '}') char(i, i + 2, n);
    else if (MTEXT_TOGGLES.has(n)) char(i, i + 2, '');
    else if (MTEXT_ARGUMENTS.has(n)) {
      const end = raw.indexOf(';', i + 2);
      const to = end < 0 ? raw.length : end + 1;
      char(i, to, '');
      i = to;
      continue;
    } else if (n === 'S') {
      let j = i + 2;
      let shown = '';
      while (j < raw.length && raw[j] !== ';') {
        if (raw[j] === '\\' && j + 1 < raw.length) {
          shown += raw[j + 1];
          j += 2;
          continue;
        }
        // The three stack kinds show as a fraction.
        shown += raw[j] === '^' || raw[j] === '#' ? '/' : raw[j];
        j++;
      }
      const to = Math.min(raw.length, j + 1);
      char(i, to, shown, true);
      i = to;
      continue;
    } else if (n === 'U' && raw[i + 2] === '+' && /^[0-9A-Fa-f]{4}/.test(raw.slice(i + 3))) {
      char(i, i + 7, String.fromCharCode(parseInt(raw.slice(i + 3, i + 7), 16)));
      i += 7;
      continue;
    } else {
      // An unknown code shows as it is stored, as the MTEXT parser draws it.
      char(i, i + 1, c);
      i++;
      continue;
    }
    i += 2;
  }
  return out;
}

/** The text a stored string shows. */
export const shownText = (raw: string, syntax: TextSyntax): string =>
  textTokens(raw, syntax)
    .map((t) => t.text)
    .join('');

/** A match: shown characters [start, end). */
export interface TextMatch {
  readonly start: number;
  readonly end: number;
}

/** One character as the options compare it (the same length, so indices stay put). */
function fold(c: string, o: FindOptions): string {
  let f = c;
  if (!o.matchWidth) {
    const code = f.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) f = String.fromCharCode(code - 0xfee0);
    else if (code === 0x3000) f = ' ';
  }
  if (!o.matchDiacritics) {
    const base = f.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (base.length === 1) f = base;
  }
  if (!o.matchCase) {
    const lower = f.toLowerCase();
    if (lower.length === 1) f = lower;
  }
  return f;
}

const folded = (s: string, o: FindOptions) => [...s].map((c) => fold(c, o)).join('');

const WORD = /[\p{L}\p{N}_]/u;

/** The regular expression a wildcard pattern reads as (see the header). */
function wildcardRegex(pattern: string): RegExp {
  const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '`' && i + 1 < pattern.length) re += esc(pattern[++i]!);
    else if (c === '*') re += `[^\\s${OPAQUE}]*`;
    else if (c === '?') re += `[^\\n${OPAQUE}]`;
    else if (c === '#') re += '[0-9]';
    else if (c === '@') re += '\\p{L}';
    else if (c === '.') re += `[^\\p{L}\\p{N}${OPAQUE}]`;
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end < 0) {
        re += esc(c);
        continue;
      }
      let set = pattern.slice(i + 1, end);
      const not = set.startsWith('~') && set.length > 1;
      if (not) set = set.slice(1);
      re += `[${not ? '^' : ''}${set.replace(/[\\\]^[]/g, '\\$&')}]`;
      i = end;
    } else re += esc(c);
  }
  return new RegExp(re, 'gu');
}

/** Every match of `find` in the tokens' shown text, left to right, none overlapping. */
export function matchTokens(
  tokens: readonly TextToken[],
  find: string,
  o: FindOptions,
): TextMatch[] {
  if (find === '') return [];
  // Which token each shown character comes from, and where each token's characters start.
  const owner: number[] = [];
  const first: number[] = [];
  let shown = '';
  tokens.forEach((t, k) => {
    first.push(shown.length);
    for (let n = 0; n < t.text.length; n++) owner.push(k);
    shown += t.text;
  });
  const hay = folded(shown, o);
  const whole = (s: number, e: number) =>
    !o.wholeWords ||
    ((s === 0 || !WORD.test(hay[s - 1]!)) && (e >= hay.length || !WORD.test(hay[e]!)));
  // A match starts at a token's first character and ends at a token's last.
  const aligned = (s: number, e: number) => {
    const a = tokens[owner[s]!]!;
    const b = owner[e - 1]!;
    return first[owner[s]!] === s && first[b]! + tokens[b]!.text.length === e && a.text !== '';
  };
  const out: TextMatch[] = [];
  if (o.wildcards) {
    const re = wildcardRegex(folded(find, o));
    re.lastIndex = 0;
    for (let m = re.exec(hay); m; m = re.exec(hay)) {
      const s = m.index;
      const e = s + m[0].length;
      if (e > s && aligned(s, e) && whole(s, e)) {
        out.push({ start: s, end: e });
        re.lastIndex = e;
      } else re.lastIndex = s + 1;
    }
    return out;
  }
  const needle = folded(find, o);
  for (let s = hay.indexOf(needle); s >= 0;) {
    const e = s + needle.length;
    if (!hay.slice(s, e).includes(OPAQUE) && aligned(s, e) && whole(s, e)) {
      out.push({ start: s, end: e });
      s = hay.indexOf(needle, e);
    } else s = hay.indexOf(needle, s + 1);
  }
  return out;
}

/** The matches of `find` in a stored string. */
export const findInText = (raw: string, syntax: TextSyntax, find: string, o: FindOptions) =>
  matchTokens(textTokens(raw, syntax), find, o);

/** `text` as an MTEXT or a dimension stores it: backslashes and braces escaped. */
const stored = (text: string, syntax: TextSyntax) =>
  syntax === 'mtext' || syntax === 'dimension' ? text.replace(/[\\{}]/g, '\\$&') : text;

/**
 * The stored string with `matches` (shown characters, none overlapping) replaced by
 * `replacement`; the codes inside each match are kept after its replacement.
 */
export function replaceInText(
  raw: string,
  syntax: TextSyntax,
  matches: readonly TextMatch[],
  replacement: string,
): string {
  const tokens = textTokens(raw, syntax);
  const at: number[] = [];
  tokens.forEach((t, k) => {
    for (let n = 0; n < t.text.length; n++) at.push(k);
  });
  let out = raw;
  for (const m of [...matches].sort((a, b) => b.start - a.start)) {
    const from = at[m.start]!;
    const to = at[m.end - 1]!;
    const codes = tokens
      .slice(from, to + 1)
      .filter((t) => t.text === '')
      .map((t) => raw.slice(t.start, t.end))
      .join('');
    out =
      out.slice(0, tokens[from]!.start) +
      stored(replacement, syntax) +
      codes +
      out.slice(tokens[to]!.end);
  }
  return out;
}

/** The text a results list shows: line breaks as spaces, a measurement or field as stored. */
export function displayText(
  raw: string,
  syntax: TextSyntax,
  match?: TextMatch,
): { text: string; start: number; end: number } {
  let text = '';
  let start = 0;
  let end = 0;
  let shown = 0;
  for (const t of textTokens(raw, syntax)) {
    if (match && shown === match.start) start = text.length;
    text += t.text === OPAQUE ? raw.slice(t.start, t.end) : t.text.replace(/\n/g, ' ');
    shown += t.text.length;
    if (match && shown === match.end) end = text.length;
  }
  return { text, start, end };
}

// ── What an object holds ───────────────────────────────────────────────────────────────────

const DIMENSIONS = new Set(['DIMENSION', 'ARC_DIMENSION', 'LARGE_RADIAL_DIMENSION']);
/** MULTILEADER DXF 172: its content is MTEXT. */
const MLEADER_MTEXT = 2;
const INVISIBLE = 1;
const CONSTANT = 2;

function hyperlinkApp(model: DocumentModel): Handle | undefined {
  for (const r of model.tables.appIds.values())
    if (r.name.toUpperCase() === 'PE_URL') return r.handle;
  return undefined;
}

/** The PE_URL xdata's 1000 strings, with where each sits in its values. */
function hyperlinkStrings(model: DocumentModel, xdata: Xdata | undefined) {
  const app = hyperlinkApp(model);
  const values = app === undefined ? undefined : xdata?.find((a) => a.appId === app)?.values;
  return (values ?? []).flatMap((v, at) =>
    v.code === 1000 && typeof v.value === 'string' ? [{ at, value: v.value }] : [],
  );
}

/** Whether an object is hidden: invisible, or on a layer that is off or frozen. */
export function hiddenEntity(model: DocumentModel, e: Pick<Entity, 'layer' | 'visible'>): boolean {
  const layer = model.tables.layers.get(e.layer);
  return !e.visible || (layer !== undefined && (!layer.on || layer.frozen));
}

/** Whether an object is on a locked layer (FIND finds its text but leaves it as it is). */
export function lockedEntity(model: DocumentModel, e: Pick<Entity, 'layer'>): boolean {
  return model.tables.layers.get(e.layer)?.locked ?? false;
}

/** The pieces of text `e` holds of the types `o` searches, in the order AutoCAD lists them. */
export function textPiecesOf(model: DocumentModel, e: Entity, o: FindOptions): FoundText[] {
  const types = new Set(o.types);
  const out: FoundText[] = [];
  const add = (slot: TextSlot, type: FindTextType, raw: string, syntax: TextSyntax) => {
    if (types.has(type) && raw !== '') out.push({ id: e.id, slot, type, raw, syntax });
  };
  const g = e.geom;
  if (g.kind === 'TEXT') add({ kind: 'value' }, 'text', g.value, 'text');
  else if (g.kind === 'MTEXT') add({ kind: 'contents' }, 'text', g.contents, 'mtext');
  else if (g.kind === 'INSERT') {
    for (const a of g.attributes) {
      if ((a.flags & CONSTANT) !== 0) continue;
      if (o.ignoreHidden && ((a.flags & INVISIBLE) !== 0 || hiddenEntity(model, a))) continue;
      const slot = { kind: 'attribute', handle: a.handle } as const;
      if (a.mtext) add(slot, 'attribute', a.mtext.contents, 'mtext');
      else add(slot, 'attribute', a.value, 'text');
    }
  } else if (DIMENSIONS.has(g.kind) && 'text' in g && typeof g.text === 'string') {
    add({ kind: 'dimension' }, 'dimension', g.text, 'dimension');
  } else if (g.kind === 'MULTILEADER' && g.contentType === MLEADER_MTEXT && g.text) {
    add({ kind: 'mleader' }, 'dimension', g.text.content, 'mtext');
  } else if (g.kind === 'ACAD_TABLE') {
    g.cells.forEach((row, i) =>
      row.forEach((c, j) => {
        if (c.type === 'text' && !c.merged) {
          add({ kind: 'cell', row: i, column: j }, 'table', c.text, 'mtext');
        }
      }),
    );
  }
  const link = hyperlinkStrings(model, e.xdata);
  if (link[1]) add({ kind: 'hyperlink', index: 1 }, 'hyperlinkDescription', link[1].value, 'plain');
  if (link[0]) add({ kind: 'hyperlink', index: 0 }, 'hyperlink', link[0].value, 'plain');
  return out;
}

/** The text stored in `slot` of `e` now; undefined when it holds none. */
export function slotText(model: DocumentModel, e: Entity, slot: TextSlot): string | undefined {
  const g = e.geom;
  switch (slot.kind) {
    case 'value':
      return g.kind === 'TEXT' ? g.value : undefined;
    case 'contents':
      return g.kind === 'MTEXT' ? g.contents : undefined;
    case 'attribute': {
      if (g.kind !== 'INSERT') return undefined;
      const a = g.attributes.find((x) => x.handle === slot.handle);
      return a ? (a.mtext ? a.mtext.contents : a.value) : undefined;
    }
    case 'dimension':
      return 'dimType' in g && 'text' in g && typeof g.text === 'string' ? g.text : undefined;
    case 'mleader':
      return g.kind === 'MULTILEADER' ? g.text?.content : undefined;
    case 'cell':
      return g.kind === 'ACAD_TABLE' ? g.cells[slot.row]?.[slot.column]?.text : undefined;
    case 'hyperlink':
      return hyperlinkStrings(model, e.xdata)[slot.index]?.value;
  }
}

/**
 * What `e` changes to with `slot` holding `raw`: its geometry, or for a hyperlink its xdata. A
 * table cell's rows are fitted and its block drawn again by the caller, a dimension's too.
 */
export function withSlotText(
  model: DocumentModel,
  e: Entity,
  slot: TextSlot,
  raw: string,
): { geom?: EntityGeometry; xdata?: Xdata } {
  const g = e.geom;
  switch (slot.kind) {
    case 'value':
      return { geom: { ...g, value: raw } as EntityGeometry };
    case 'contents':
      return { geom: { ...g, contents: raw } as EntityGeometry };
    case 'attribute': {
      if (g.kind !== 'INSERT') return {};
      const attributes = g.attributes.map((a): InsertAttribute =>
        a.handle !== slot.handle
          ? a
          : a.mtext
            ? { ...a, mtext: { ...a.mtext, contents: raw } }
            : { ...a, value: raw },
      );
      return { geom: { ...g, attributes } };
    }
    case 'dimension': {
      // `<>` alone, or nothing, is the measurement alone, stored empty (as TEXTEDIT stores it).
      const t = raw.trim();
      return { geom: { ...g, text: t === '<>' || t === '' ? '' : raw } as EntityGeometry };
    }
    case 'mleader':
      return g.kind === 'MULTILEADER' && g.text
        ? { geom: { ...g, text: { ...g.text, content: raw } } }
        : {};
    case 'cell': {
      if (g.kind !== 'ACAD_TABLE') return {};
      const cells = g.cells.map((row, i) =>
        i !== slot.row ? row : row.map((c, j) => (j === slot.column ? { ...c, text: raw } : c)),
      );
      return { geom: { ...g, cells } };
    }
    case 'hyperlink': {
      const app = hyperlinkApp(model);
      const at = hyperlinkStrings(model, e.xdata)[slot.index]?.at;
      if (app === undefined || at === undefined) return {};
      const xdata = (e.xdata ?? []).map((a) =>
        a.appId !== app
          ? a
          : { ...a, values: a.values.map((v, k) => (k === at ? { code: 1000, value: raw } : v)) },
      );
      return { xdata };
    }
  }
}

/** The syntax `slot` of `e` is stored in. */
export function slotSyntax(e: Entity, slot: TextSlot): TextSyntax {
  switch (slot.kind) {
    case 'value':
      return 'text';
    case 'attribute': {
      const a =
        e.geom.kind === 'INSERT'
          ? e.geom.attributes.find((x) => x.handle === slot.handle)
          : undefined;
      return a?.mtext ? 'mtext' : 'text';
    }
    case 'dimension':
      return 'dimension';
    case 'hyperlink':
      return 'plain';
    default:
      return 'mtext';
  }
}

/** Same slot. */
export const sameSlot = (a: TextSlot, b: TextSlot): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
