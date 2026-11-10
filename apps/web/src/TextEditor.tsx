// The in-place text editors (M2-07): where the drawing's TEXT or MTEXT command asks for its
// text, the editor opens on the canvas at the text's place, turned and sized as the text will
// be. TEXT takes one line per Enter, as AutoCAD's in-place TEXT editor does (an empty line ends
// it). MTEXT's editor carries AutoCAD's Text Formatting toolbar (UI_SPEC.md §7: Bold, Italic,
// Underline, Overline, Strikethrough, Stack, Color, Height, OK); Ctrl+Enter or a click outside
// it keeps the text, Esc drops it. Its contents are formatted spans, written as MTEXT format
// codes (`writeMText`) when it closes.
//
// TEXTEDIT and a double click (M2-07 part 2) open the same editors on an existing text: the
// request carries its `value`. TEXT's line then holds the value, selected, and Enter or a click
// outside answers once with the whole line. MTEXT's editor holds the contents as spans
// (`contentOf`), keeping what it has no control for; a close that changed nothing answers with
// the contents as they were. While TEXT is placing lines, a click on the canvas places the line
// typed so far and starts the next where the click was (the engine takes the click's point).
// Typing `1/2 ` stacks the fraction (AutoStack); the Font list sets a run's font.
//
// Columns and the ruler (M2-07 part 3): the Columns menu (No Columns, Dynamic Columns, Static
// Columns, Insert Column Break, Column Settings) sets the MTEXT's columns, which the editor
// shows as CSS columns and answers with (`columns`; a dynamic MTEXT's count is laid out with
// the drawing's fonts, as the renderer will). Alt+Enter breaks the column. The ruler above the
// box shows the paragraph's first-line and left indents and its tab stops: drag a marker, click
// to add a tab stop, drag a tab stop off to remove it. They are written as the paragraph's `\p`
// values (`withRuler`) and the editor indents its paragraphs by them.
//
// Manual heights and reversed flow (M2-26): Column Settings' Dynamic Columns take Auto Height
// (one height) or Manual Height (each column its own, AutoCAD's "Column Settings Dialog Box").
// Each column shows its frame with a handle on its bottom edge, dragged (or moved with the
// arrow keys) to set that column's height, or with one height the columns' height. CSS columns
// are all one height, so a column shorter than the tallest ends at a forced column break the
// editor puts before the first line past its height (`fitColumns`, a `data-fit` element the
// spans never hold). A drawing's columns set right to left (DXF 74) show right to left.
//
// The editor's DOM is the record of what was typed: one <div> per paragraph, plain runs as
// <span data-fmt>, paragraph breaks as <br> ending their paragraph, stacks, fields and
// double-byte characters as uneditable atoms. Typing, pasting, Enter and the
// toolbar are applied to the spans (text-editor.ts) and the DOM repainted from them, so the
// DOM never takes a shape the spans cannot hold.
import type { StringPrompt, TextEditorColumns, TextEditorRequest } from '@triya/engine';
import { aciRgb, worldToScreen, type FontSources } from '@triya/render';
import {
  contentOf,
  dynamicColumnCount,
  fontMeasure,
  mtextBase,
  parseMText,
  alignOf,
  rulerOf,
  sameContent,
  SHX_EQUIVALENTS,
  withAlignment,
  withRuler,
  writeMText,
  type MTextAlign,
  type MTextContent,
  type MTextFormat,
  type MTextRuler,
  type MTextSpan,
  type MTextTabStop,
} from '@triya/text';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { controllerOf } from './canvas/registry';
import type { CanvasController } from './canvas/controller';
import { commandLines } from './command-line';
import { engines } from './engine/registry';
import { appFonts } from './fonts';
import {
  autoStack,
  formatAt,
  formatRange,
  hasFormat,
  insertSpans,
  mapParagraphs,
  paragraphAt,
  paragraphCodes,
  paragraphIndex,
  removeRange,
  toggleStack,
  type FormatPatch,
} from './text-editor';

/** Cap height to CSS font size: the cap height of the sans-serif faces the editor shows in. */
const CAP_HEIGHT = 0.7;

/** The colours the toolbar offers, as AutoCAD's Color list starts. */
const COLORS: readonly { readonly label: string; readonly index?: number }[] = [
  { label: 'ByLayer' },
  { label: 'Red', index: 1 },
  { label: 'Yellow', index: 2 },
  { label: 'Green', index: 3 },
  { label: 'Cyan', index: 4 },
  { label: 'Blue', index: 5 },
  { label: 'Magenta', index: 6 },
  { label: 'White', index: 7 },
];

/** The fonts the Font list offers besides the style's: AutoCAD's SHX fonts, drawn by the bundled ones. */
const SHX_FONTS: readonly string[] = Object.keys(SHX_EQUIVALENTS)
  .map((n) => `${n}.shx`)
  .sort();

export function TextEditor({
  doc,
  fonts = [],
  sources,
}: {
  doc: { id: number; block: string } | undefined;
  /** The user's font files (M1-38), offered in the Font list too. */
  fonts?: readonly string[];
  /** The renderers' fonts, to lay out dynamic columns as they draw (M2-07 part 3). */
  sources?: FontSources;
}) {
  useSyncExternalStore(commandLines.subscribe, commandLines.version);
  const prompt = doc ? commandLines.get(doc.id).prompt : undefined;
  const request = prompt?.kind === 'string' ? (prompt as StringPrompt).editor : undefined;
  const controller = doc && request ? controllerOf(doc.id, doc.block) : undefined;
  if (!doc || !request || !controller) return null;
  // TEXT's line editor is one input for all the lines, so typing runs on while the engine
  // places a line and asks for the next.
  const key =
    request.kind === 'text' && request.value === undefined ? 'text' : JSON.stringify(request);
  return request.kind === 'text' ? (
    <TextLine key={key} doc={doc.id} request={request} controller={controller} />
  ) : (
    <MTextBox
      key={key}
      doc={doc.id}
      request={request}
      controller={controller}
      fonts={fonts}
      sources={sources}
    />
  );
}

interface Placement {
  readonly left: number;
  readonly top: number;
  /** Drawing units to CSS px. */
  readonly scale: number;
}

/**
 * Where on the page the request's point is, kept up as the view pans and zooms (checked each
 * frame while the editor is open; it is open for one command only).
 */
function usePlacement(controller: CanvasController, request: TextEditorRequest): Placement {
  // TEXT's line editor stays open from line to line; each line moves it.
  const current = useRef(request);
  current.current = request;
  const place = (): Placement => {
    const view = controller.view;
    const rect = controller.canvas.getBoundingClientRect();
    if (!view) return { left: rect.left, top: rect.top, scale: 1 };
    const p = worldToScreen(view, rect.width, rect.height, current.current.position);
    return { left: rect.left + p.x, top: rect.top + p.y, scale: view.scale };
  };
  const [placement, setPlacement] = useState(place);
  useEffect(() => {
    let frame = 0;
    let last = placement;
    const tick = () => {
      const next = place();
      if (next.left !== last.left || next.top !== last.top || next.scale !== last.scale) {
        last = next;
        setPlacement(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return placement;
}

/** The box's CSS: at the point, turned with the text, anchored by the attachment point. */
function boxStyle(p: Placement, request: TextEditorRequest): CSSProperties {
  const col = (request.attachment - 1) % 3;
  const row = Math.floor((request.attachment - 1) / 3);
  return {
    left: p.left,
    top: p.top,
    transform: `rotate(${-request.rotation}rad) translate(${-50 * col}%, ${-50 * row}%)`,
    fontSize: `${(request.height * p.scale) / CAP_HEIGHT}px`,
    ...(request.width > 0 && { width: `${request.width * p.scale}px` }),
  };
}

const cancel = (doc: number) => engines.command(doc, { kind: 'cancel' });

/** TEXT's in-place line: Enter places it and moves below for the next; Enter on none ends. */
function TextLine({
  doc,
  request,
  controller,
}: {
  doc: number;
  request: TextEditorRequest;
  controller: CanvasController;
}) {
  const placement = usePlacement(controller, request);
  const editing = request.value !== undefined;
  const [value, setValue] = useState(request.value ?? '');
  const input = useRef<HTMLInputElement>(null);
  const typed = useRef(value);
  typed.current = value;
  const done = useRef(false);
  /** TEXTEDIT: the whole line, once. */
  const keep = () => {
    if (done.current) return;
    done.current = true;
    engines.command(doc, {
      kind: 'answer',
      answer: { kind: 'string', value: typed.current, editor: true },
    });
  };
  useEffect(() => {
    if (editing) input.current?.select();
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || input.current?.contains(e.target)) return;
      if (editing) {
        keep();
        return;
      }
      // Placing TEXT: the line typed so far is placed before the click reaches the engine,
      // which starts the next line at the click.
      if (e.button === 0 && e.target.closest('.drawing-canvas') && typed.current !== '') {
        engines.command(doc, {
          kind: 'answer',
          answer: { kind: 'string', value: typed.current },
        });
        typed.current = '';
        setValue('');
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
  return (
    <div className="text-editor text-line" style={boxStyle(placement, request)}>
      <input
        ref={input}
        aria-label="Text"
        autoFocus
        value={value}
        size={Math.max(4, value.length + 1)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            if (editing) return keep();
            engines.command(doc, {
              kind: 'answer',
              answer: value === '' ? { kind: 'enter' } : { kind: 'string', value },
            });
            setValue('');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel(doc);
          }
        }}
      />
    </div>
  );
}

// ---- MTEXT ----

/** CSS of a run's format; heights relative to the box's (1em is the entity's height). */
function runStyle(f: MTextFormat, height: number): CSSProperties {
  const lines = [f.underline && 'underline', f.overline && 'overline', f.strike && 'line-through']
    .filter(Boolean)
    .join(' ');
  const color =
    f.color?.kind === 'aci'
      ? `rgb(${aciRgb(f.color.index).join(',')})`
      : f.color
        ? `rgb(${f.color.r},${f.color.g},${f.color.b})`
        : undefined;
  return {
    ...(f.bold && { fontWeight: 700 }),
    ...(f.italic && { fontStyle: 'italic' }),
    ...(lines && { textDecorationLine: lines }),
    ...(color && { color }),
    ...(f.height !== undefined && { fontSize: `${f.height / height}em` }),
  };
}

function applyStyle(el: HTMLElement, style: CSSProperties): void {
  for (const [k, v] of Object.entries(style)) {
    (el.style as unknown as Record<string, string>)[k] = String(v);
  }
}

/** The decoders of the big-font code pages a browser has (Johab has none). */
const MBCS_ENCODINGS: Readonly<Record<number, string>> = {
  932: 'shift_jis',
  950: 'big5',
  949: 'euc-kr',
  936: 'gbk',
};

/** A double-byte character as the browser can show it; `?` when it cannot. */
function mbcsText(codepage: number, code: number): string {
  const encoding = MBCS_ENCODINGS[codepage];
  if (!encoding) return '?';
  try {
    return new TextDecoder(encoding).decode(new Uint8Array([code >> 8, code & 0xff]));
  } catch {
    return '?';
  }
}

/** CSS text-align for a paragraph's own alignment (M2-26 part 3). */
const TEXT_ALIGN: Readonly<Record<MTextAlign, string>> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justified: 'justify',
  distributed: 'justify',
};

/**
 * A paragraph's <div>, indented by its ruler (in text heights; one is CAP_HEIGHT em) and
 * aligned as its `\p` values say. Its tab stops ride along for `layoutTabs`.
 */
function paragraphBox(codes: readonly string[], columnBreak: boolean): HTMLElement {
  const div = document.createElement('div');
  div.className = 'mtext-para';
  const r = rulerOf(codes);
  if (r.indentLeft !== 0) div.style.paddingLeft = `${r.indentLeft * CAP_HEIGHT}em`;
  if (r.indentFirst !== 0) div.style.textIndent = `${r.indentFirst * CAP_HEIGHT}em`;
  if (r.indentRight !== 0) div.style.paddingRight = `${r.indentRight * CAP_HEIGHT}em`;
  const align = alignOf(codes);
  if (align) div.style.textAlign = TEXT_ALIGN[align];
  // Distributed spreads the last line too.
  if (align === 'distributed') div.style.textAlignLast = 'justify';
  if (r.tabs.length > 0) div.dataset['tabs'] = JSON.stringify(r.tabs);
  if (columnBreak) div.style.breakBefore = 'column';
  return div;
}

/** A run's element: its text, with each tab character in a span of its own (`layoutTabs`). */
function runElements(text: string, style: CSSProperties, format: MTextFormat): HTMLElement[] {
  return text
    .split(/(\t)/)
    .filter((t) => t !== '')
    .map((t) => {
      const el = document.createElement('span');
      applyStyle(el, style);
      el.dataset['fmt'] = JSON.stringify(format);
      if (t === '\t') el.className = 'mtext-tab';
      el.textContent = t;
      return el;
    });
}

/** The editor's DOM for the spans; `first` is the first paragraph's `\p` values. */
function paint(
  root: HTMLElement,
  spans: readonly MTextSpan[],
  height: number,
  first: readonly string[],
): void {
  const paragraphs: HTMLElement[] = [paragraphBox(first, false)];
  for (const s of spans) {
    const box = paragraphs.at(-1)!;
    if (s.type === 'break') {
      const br = document.createElement('br');
      // What the break keeps: its kind and the next paragraph's `\p` values.
      br.dataset['para'] = JSON.stringify(s.paragraph ?? []);
      if (s.end) br.dataset['end'] = s.end;
      box.append(br);
      paragraphs.push(paragraphBox(s.paragraph ?? [], s.end === 'column'));
      continue;
    }
    if (s.type === 'text') {
      box.append(...runElements(s.text, runStyle(s.format, height), s.format));
      continue;
    }
    const el = document.createElement('span');
    applyStyle(el, runStyle(s.format, height));
    if (s.type === 'stack') {
      el.dataset['stack'] = JSON.stringify(s);
      el.contentEditable = 'false';
      el.className = `mtext-stack mtext-stack-${s.kind}`;
      const up = document.createElement('span');
      up.textContent = s.upper;
      const down = document.createElement('span');
      down.textContent = s.lower;
      el.append(up, down);
    } else if (s.type === 'mbcs') {
      el.dataset['mbcs'] = JSON.stringify(s);
      el.contentEditable = 'false';
      el.textContent = mbcsText(s.codepage, s.code);
    } else {
      el.dataset['field'] = JSON.stringify(s);
      el.contentEditable = 'false';
      el.className = 'mtext-field';
      el.textContent = '----';
    }
    box.append(el);
  }
  // An empty paragraph shows no line by itself.
  const last = paragraphs.at(-1)!;
  if (last.childNodes.length === 0) {
    const filler = document.createElement('br');
    filler.dataset['filler'] = '';
    last.append(filler);
  }
  root.replaceChildren(...paragraphs);
}

const isAtom = (n: Node): boolean =>
  n instanceof HTMLElement &&
  (n.dataset['stack'] !== undefined ||
    n.dataset['field'] !== undefined ||
    n.dataset['mbcs'] !== undefined);
const isFiller = (n: Node): boolean =>
  n instanceof HTMLElement && n.dataset['filler'] !== undefined;
/** A forced column break where a manual-height column ends (`fitColumns`); not text. */
const isFit = (n: Node): boolean => n instanceof HTMLElement && n.dataset['fit'] !== undefined;

/** The spans the editor's DOM holds (it may hold what the browser typed itself, e.g. IME). */
function read(root: HTMLElement): MTextSpan[] {
  const out: MTextSpan[] = [];
  // A break the browser made takes the values of the paragraph it was made in.
  let codes: readonly string[] = JSON.parse(root.dataset['para'] ?? '[]') as string[];
  const browserBreak = (): MTextSpan => ({
    type: 'break',
    ...(codes.length > 0 && { paragraph: codes }),
  });
  const walk = (node: Node, format: MTextFormat): void => {
    for (const child of node.childNodes) {
      if (child instanceof Text) {
        const parts = child.data.replace(/\r/g, '').split('\n');
        parts.forEach((text, i) => {
          if (i > 0) out.push(browserBreak());
          out.push({ type: 'text', text, format });
        });
      } else if (!(child instanceof HTMLElement) || isFiller(child) || isFit(child)) {
        continue;
      } else if (child.tagName === 'BR') {
        const para = child.dataset['para'];
        if (para === undefined) {
          out.push(browserBreak());
          continue;
        }
        codes = JSON.parse(para) as string[];
        const end = child.dataset['end'];
        out.push({
          type: 'break',
          ...((end === 'column' || end === 'dimline') && { end }),
          ...(codes.length > 0 && { paragraph: codes }),
        });
      } else if (isAtom(child)) {
        const data = child.dataset['stack'] ?? child.dataset['field'] ?? child.dataset['mbcs']!;
        out.push(JSON.parse(data) as MTextSpan);
      } else {
        // A block the browser made is a paragraph.
        const block = child.tagName === 'DIV' || child.tagName === 'P';
        if (block && out.length > 0 && out.at(-1)?.type !== 'break') out.push(browserBreak());
        const own = child.dataset['fmt'];
        walk(child, own ? (JSON.parse(own) as MTextFormat) : format);
      }
    }
  };
  walk(root, {});
  return insertSpans(out, 0, []);
}

/** The unit offset of a DOM position in the editor. */
function offsetOf(root: HTMLElement, container: Node, offset: number): number {
  let count = 0;
  const visit = (node: Node): boolean => {
    if (node === container && node instanceof Text) {
      count += offset;
      return true;
    }
    if (node === container) {
      const kids = [...node.childNodes];
      for (let i = 0; i < kids.length; i++) {
        if (i === offset) return true;
        if (visit(kids[i]!)) return true;
      }
      return true;
    }
    if (node instanceof Text) {
      count += node.length;
      return false;
    }
    if (isFiller(node) || isFit(node)) return false;
    if (isAtom(node) || (node instanceof HTMLElement && node.tagName === 'BR')) {
      if (node.contains(container)) return true;
      count += 1;
      return false;
    }
    for (const k of node.childNodes) if (visit(k)) return true;
    return false;
  };
  visit(root);
  return count;
}

/** The DOM position of a unit offset in the editor. */
function pointOf(root: HTMLElement, unit: number): [Node, number] {
  let count = 0;
  let found: [Node, number] | undefined;
  const visit = (node: Node): void => {
    for (const k of node.childNodes) {
      if (found) return;
      if (k instanceof Text) {
        if (unit <= count + k.length) {
          found = [k, unit - count];
          return;
        }
        count += k.length;
      } else if (isFit(k)) {
        continue;
      } else if (isFiller(k)) {
        // The empty last paragraph.
        if (unit === count) found = [node, [...node.childNodes].indexOf(k)];
        continue;
      } else if (isAtom(k) || (k instanceof HTMLElement && k.tagName === 'BR')) {
        const at = [...node.childNodes].indexOf(k);
        if (unit === count) {
          found = [node, at];
          return;
        }
        count += 1;
        // After a paragraph's break the caret goes to the next paragraph's start.
        const ends = k === node.lastChild && node instanceof HTMLElement && node !== root;
        if (unit === count && k instanceof HTMLElement && k.tagName === 'BR' && !ends) {
          found = [node, at + 1];
          return;
        }
      } else visit(k);
    }
  };
  visit(root);
  if (found) return found;
  const kids = [...root.childNodes].filter((n) => !isFiller(n));
  return [root, kids.length];
}

function selectionIn(root: HTMLElement): [number, number] | undefined {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return undefined;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return undefined;
  return [
    offsetOf(root, r.startContainer, r.startOffset),
    offsetOf(root, r.endContainer, r.endOffset),
  ];
}

function select(root: HTMLElement, a: number, b: number): void {
  const sel = document.getSelection();
  if (!sel) return;
  const [n1, o1] = pointOf(root, a);
  const [n2, o2] = pointOf(root, b);
  const r = document.createRange();
  r.setStart(n1, o1);
  r.setEnd(n2, o2);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** How the editor laid out the columns: the content box in the editor's box, CSS px. */
interface Fitted {
  /** The content's top-left inside the editor's border and padding. */
  readonly left: number;
  readonly top: number;
  /** The content box's width (the box's columns; dynamic columns run on past it). */
  readonly width: number;
  /** How many columns the text reaches (at least a static MTEXT's count). */
  readonly count: number;
}

const sameFitted = (a: Fitted | undefined, b: Fitted): boolean =>
  !!a && a.left === b.left && a.top === b.top && a.width === b.width && a.count === b.count;

/** The tallest column, which the editor's CSS columns all take. */
const tallest = (c: TextEditorColumns): number =>
  c.type === 2 && c.heights && c.heights.length > 0 ? Math.max(...c.heights) : c.height;

/** A column's height: its own with manual heights (past the list, the last one's), else all one. */
const columnHeight = (c: TextEditorColumns, i: number): number =>
  c.type === 2 && c.heights && c.heights.length > 0
    ? c.heights[Math.min(i, c.heights.length - 1)]!
    : c.height;

/** Where column `i` starts from the content's left edge, px: right to left when reversed. */
const columnLeft = (c: TextEditorColumns, f: Fitted, i: number, scale: number): number =>
  c.flowReversed
    ? f.width - (i + 1) * c.width * scale - i * c.gutter * scale
    : i * (c.width + c.gutter) * scale;

/** One unit of the text in reading order: a character of a text node, or an atom. */
type Unit = { readonly text: Text; readonly at: number } | { readonly atom: HTMLElement };

function* unitsOf(node: Node): Generator<Unit> {
  for (const k of node.childNodes) {
    if (k instanceof Text) for (let at = 0; at < k.length; at++) yield { text: k, at };
    else if (isAtom(k)) yield { atom: k as HTMLElement };
    else if (k instanceof HTMLElement && !isFit(k) && !isFiller(k)) yield* unitsOf(k);
  }
}

/**
 * Lays the text into manual column heights (M2-26). The editor's CSS columns are all as tall
 * as the tallest column, so each shorter column gets a forced column break before the first
 * line that ends past its height, as the renderer's layout moves that line on (a column keeps
 * at least one line, as a line taller than its column cannot move anywhere better). Measured
 * with the box unturned, column by column, as each break moves the text after it. The caret
 * is kept by unit offsets.
 */
function fitColumns(root: HTMLElement, c: TextEditorColumns | null, scale: number): Fitted {
  const sel = document.activeElement === root ? selectionIn(root) : undefined;
  for (const el of [...root.querySelectorAll('[data-fit]')]) {
    const parent = el.parentNode;
    el.remove();
    parent?.normalize();
  }
  const cs = getComputedStyle(root);
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padTop = parseFloat(cs.paddingTop) || 0;
  const fitted = {
    left: root.offsetLeft + root.clientLeft + padLeft,
    top: root.offsetTop + root.clientTop + padTop,
    width: root.clientWidth - padLeft - (parseFloat(cs.paddingRight) || 0),
  };
  if (!c || scale <= 0) return { ...fitted, count: c ? c.count : 0 };
  const box = root.parentElement!;
  const turned = box.style.transform;
  box.style.transform = 'none';
  let count = 1;
  try {
    const r = root.getBoundingClientRect();
    const x0 = r.left + root.clientLeft + padLeft;
    const y0 = r.top + root.clientTop + padTop;
    const pitch = (c.width + c.gutter) * scale;
    const columnOf = (x: number): number =>
      Math.max(0, Math.floor((c.flowReversed ? x0 + fitted.width - x : x - x0) / pitch));
    const manual = c.type === 2 && !!c.heights && c.heights.length > 0;
    const sizes = new Map<Element, number>();
    const range = document.createRange();
    /** A unit's column and the bottom of its line box (line-height is 1.4 em). */
    const place = (u: Unit): { column: number; bottom: number } => {
      let rect: DOMRect;
      let parent: Element;
      if ('atom' in u) {
        rect = u.atom.getBoundingClientRect();
        parent = u.atom;
      } else {
        range.setStart(u.text, u.at);
        range.setEnd(u.text, u.at + 1);
        rect = range.getBoundingClientRect();
        parent = u.text.parentElement!;
      }
      let size = sizes.get(parent);
      if (size === undefined) {
        size = parseFloat(getComputedStyle(parent).fontSize) || 0;
        sizes.set(parent, size);
      }
      return {
        column: columnOf((rect.left + rect.right) / 2),
        bottom: (rect.top + rect.bottom) / 2 + 0.7 * size - y0,
      };
    };
    const tall = tallest(c) * scale;
    for (let i = 0; manual && i < 1000; i++) {
      const limit = columnHeight(c, i) * scale;
      let seen = false;
      let breakAt: Unit | undefined;
      let later = false;
      for (const u of unitsOf(root)) {
        const p = place(u);
        if (p.column < i) continue;
        if (p.column > i) {
          later = true;
          break;
        }
        if (limit < tall - 0.5 && seen && p.bottom > limit + 0.5) {
          breakAt = u;
          break;
        }
        seen = true;
      }
      if (breakAt) {
        const fit = document.createElement('span');
        fit.dataset['fit'] = '';
        fit.contentEditable = 'false';
        fit.className = 'mtext-fit';
        if ('atom' in breakAt) breakAt.atom.before(fit);
        else if (breakAt.at === 0) breakAt.text.before(fit);
        else breakAt.text.splitText(breakAt.at).before(fit);
      } else if (!later) break;
    }
    for (const u of unitsOf(root)) count = Math.max(count, place(u).column + 1);
  } finally {
    box.style.transform = turned;
  }
  if (sel) select(root, sel[0], sel[1]);
  return { ...fitted, count: c.type === 1 ? Math.max(c.count, count) : count };
}

/** Default tab interval, in text heights, as layout's (`layoutMText`). */
const DEFAULT_TAB = 4;

/**
 * Lays each tab out at its paragraph's next tab stop (M2-26 part 3), as the renderer does: the
 * stop's position from the column's left edge (indents included), in text heights of `unit`
 * px; past the paragraph's own stops, every four heights. A left stop starts the text after the
 * tab there, a centre stop centres it, a right stop ends it there and a decimal stop puts its
 * first decimal symbol there (its end, when it has none): "it" is the text up to the next tab
 * or the paragraph's end. CSS has one tab size, so each tab is an inline block as wide as it
 * reaches. Measured with the box unturned, tab by tab, as each one moves those after it.
 */
function layoutTabs(root: HTMLElement, unit: number): void {
  const tabs = [...root.querySelectorAll<HTMLElement>('.mtext-tab')];
  if (tabs.length === 0 || unit <= 0) return;
  for (const t of tabs) t.style.width = '0px';
  const box = root.parentElement!;
  const turned = box.style.transform;
  box.style.transform = 'none';
  try {
    const range = document.createRange();
    for (const [i, tab] of tabs.entries()) {
      const para = tab.closest<HTMLElement>('.mtext-para');
      if (!para) continue;
      const own = JSON.parse(para.dataset['tabs'] ?? '[]') as MTextTabStop[];
      const r = tab.getBoundingClientRect();
      // The column the tab's line is in: the paragraph's fragment beside it.
      const mid = (r.top + r.bottom) / 2;
      const frags = [...para.getClientRects()];
      const frag = frags.find((f) => f.top <= mid && mid <= f.bottom) ?? frags[0]!;
      const x = (r.left - frag.left) / unit;
      const stop = own.find((s) => s.at > x + 1e-6) ?? {
        at: (Math.floor(x / DEFAULT_TAB + 1e-6) + 1) * DEFAULT_TAB,
        kind: 'left' as const,
      };
      let w = 0;
      if (stop.kind !== 'left') {
        // The text after the tab, to the next tab in the paragraph or its end.
        const next = tabs[i + 1];
        range.setStartAfter(tab);
        if (next && para.contains(next)) range.setEndBefore(next);
        else range.setEnd(para, para.childNodes.length);
        if (stop.kind === 'decimal') {
          const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
          walker.currentNode = tab;
          for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
            if (range.comparePoint(n, 0) > 0) break;
            const at = n.data.indexOf(stop.decimal ?? '.');
            if (at >= 0) {
              range.setEnd(n, at);
              break;
            }
          }
        }
        // On the tab's line, from the tab (0 wide now) to the text's far end.
        let end = r.right;
        for (const q of range.getClientRects())
          if (q.width > 0 && q.bottom > r.top && q.top < r.bottom) end = Math.max(end, q.right);
        w = (end - r.right) / unit;
        if (stop.kind === 'center') w /= 2;
      }
      tab.style.width = `${Math.max(0, stop.at - x - w) * unit}px`;
    }
  } finally {
    box.style.transform = turned;
  }
}

type Toggle = 'bold' | 'italic' | 'underline' | 'overline' | 'strike';

const TOGGLES: readonly { key: Toggle; label: string; glyph: string; shortcut?: string }[] = [
  { key: 'bold', label: 'Bold', glyph: 'B', shortcut: 'b' },
  { key: 'italic', label: 'Italic', glyph: 'I', shortcut: 'i' },
  { key: 'underline', label: 'Underline', glyph: 'U', shortcut: 'u' },
  { key: 'overline', label: 'Overline', glyph: 'O' },
  { key: 'strike', label: 'Strikethrough', glyph: 'S' },
];

/** MTEXT's in-place editor and its Text Formatting toolbar. */
function MTextBox({
  doc,
  request,
  controller,
  fonts,
  sources,
}: {
  doc: number;
  request: TextEditorRequest;
  controller: CanvasController;
  fonts: readonly string[];
  sources: FontSources | undefined;
}) {
  const placement = usePlacement(controller, request);
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const base = mtextBase(
    {
      font: request.fontFile,
      trueTypeFlags: request.trueTypeFlags,
      ...(request.widthFactor !== undefined && { widthFactor: request.widthFactor }),
      ...(request.obliqueAngle !== undefined && { obliqueAngle: request.obliqueAngle }),
    },
    request.height,
  );
  const font = base.font;
  /** TEXTEDIT: the contents being edited, as spans. */
  const initial = useRef<MTextContent | undefined>(undefined);
  if (request.value !== undefined && !initial.current) {
    initial.current = contentOf(parseMText(request.value, base), base);
  }
  /** The first paragraph's `\p` values (none for new text); the ruler changes them. */
  const first = useRef<readonly string[]>(initial.current?.paragraph ?? []);
  /** The columns the editor shows and answers with (M2-07 part 3). */
  const [columns, setColumnsState] = useState<TextEditorColumns | null>(request.columns ?? null);
  const columnsNow = useRef(columns);
  const setColumns = (c: TextEditorColumns | null) => {
    columnsNow.current = c;
    setColumnsState(c);
  };
  const [ruler, setRulerShown] = useState<MTextRuler>(rulerOf(first.current));
  /** The columns as laid out, for their frames and height handles (M2-26). */
  const [fitted, setFitted] = useState<Fitted | undefined>(undefined);
  const scaleNow = useRef(placement.scale);
  scaleNow.current = placement.scale;
  const refit = () => {
    layoutTabs(root.current!, request.height * scaleNow.current);
    const f = fitColumns(root.current!, columnsNow.current, scaleNow.current);
    setFitted((was) => (sameFitted(was, f) ? was : f));
  };
  const [menu, setMenu] = useState<'columns' | 'settings' | 'paragraph' | undefined>(undefined);
  /** The kind of tab stop a click on the ruler adds, and the decimal style (M2-26 part 3). */
  const [tabKind, setTabKind] = useState<TabKind>('left');
  const [decimal, setDecimal] = useState('.');
  /** The paragraph alignment at the caret, for the Paragraph dialog. */
  const [align, setAlignShown] = useState<MTextAlign | undefined>(alignOf(first.current));
  /** The format typing takes next, when a toolbar change was made with nothing selected. */
  const pending = useRef<MTextFormat | undefined>(undefined);
  /** The last selection in the editor, for the toolbar's fields, which take the focus. */
  const lastSel = useRef<[number, number]>([0, 0]);
  const [shown, setShown] = useState<MTextFormat>({});
  const done = useRef(false);

  const spans = () => read(root.current!);
  /**
   * The editor's selection: as the document has it (focusing a toolbar field keeps it there),
   * else as last seen. `selectionchange` comes a task later, so it may not have been seen yet.
   */
  const selection = (): [number, number] => selectionIn(root.current!) ?? lastSel.current;
  const refresh = () => {
    const [a, b] = selection();
    const s = spans();
    const f =
      pending.current ??
      (a === b
        ? formatAt(s, a)
        : TOGGLES.reduce<MTextFormat>(
            (acc, t) => (hasFormat(s, a, b, t.key) ? { ...acc, [t.key]: true } : acc),
            formatAt(s, a + 1),
          ));
    setShown(f);
    const codes = paragraphCodes(s, first.current)[paragraphIndex(s, a)] ?? [];
    setRulerShown(rulerOf(codes));
    setAlignShown(alignOf(codes));
  };
  const commit = (next: MTextSpan[], a: number, b = a) => {
    paint(root.current!, next, request.height, first.current);
    refit();
    root.current!.focus();
    select(root.current!, a, b);
    lastSel.current = [a, b];
    refresh();
  };
  const finish = () => {
    if (done.current) return;
    done.current = true;
    const now = spans();
    const old = initial.current;
    const value =
      old &&
      request.value !== undefined &&
      sameContent(old, { paragraph: first.current, spans: now }, font)
        ? request.value
        : writeMText(now, font, first.current);
    const c = columnsNow.current;
    // Dynamic columns: as many as the text takes, laid out with the renderers' fonts. Columns
    // past manual heights take the last one's (the engine fills the list the same way).
    const counted = c?.heights?.length ? { ...c, height: c.heights.at(-1)! } : c;
    const answered =
      c?.type === 2
        ? {
            ...c,
            count: dynamicColumnCount(
              parseMText(value, base),
              fontMeasure(appFonts(sources).book),
              {
                height: request.height,
                width: c.width,
                attachment: request.attachment,
                lineSpacingStyle: request.lineSpacingStyle ?? 1,
                lineSpacing: request.lineSpacing ?? 1,
                columns: counted!,
              },
            ),
          }
        : c;
    engines.command(doc, {
      kind: 'answer',
      answer: {
        kind: 'string',
        value,
        editor: true,
        ...((answered || request.columns) && { columns: answered }),
      },
    });
  };
  /** The selection replaced by `inserted`, typed in the format at the caret. */
  const insert = (inserted: MTextSpan[]) => {
    const el = root.current!;
    const [a, b] = selectionIn(el) ?? lastSel.current;
    const s = spans();
    const format = pending.current ?? (a === b ? formatAt(s, a) : formatAt(s, a + 1));
    pending.current = undefined;
    const typed = inserted.map((x) => (x.type === 'text' ? { ...x, format } : x));
    const next = insertSpans(removeRange(s, a, b), a, typed);
    const len = typed.reduce((n, x) => n + (x.type === 'text' ? x.text.length : 1), 0);
    // AutoStack: a space typed after `1/2` stacks it.
    const stacked =
      inserted.at(-1)?.type === 'text' &&
      /^ $/.test((inserted.at(-1) as { text: string }).text.slice(-1))
        ? autoStack(next, a + len)
        : undefined;
    if (stacked) commit(stacked.spans, stacked.caret);
    else commit(next, a + len);
  };
  /** A paragraph (or column) break that keeps the formatting of the paragraph it is typed in. */
  const breakHere = (end?: 'column') => {
    const [a] = selectionIn(root.current!) ?? lastSel.current;
    const codes = paragraphAt(spans(), first.current, a);
    insert([{ type: 'break', ...(end && { end }), ...(codes.length > 0 && { paragraph: codes }) }]);
  };
  /** A change to the `\\p` values of every paragraph the selection touches. */
  const setParagraphs = (change: (codes: readonly string[]) => readonly string[]) => {
    const [a, b] = selection();
    const s = spans();
    const next = mapParagraphs(
      s,
      first.current,
      paragraphIndex(s, a),
      paragraphIndex(s, b),
      change,
    );
    first.current = next.first;
    root.current!.dataset['para'] = JSON.stringify(next.first);
    commit(next.spans, a, b);
  };
  /** The ruler's change, made to every paragraph the selection touches. */
  const setRuler = (r: MTextRuler) => setParagraphs((c) => withRuler(c, r));
  /** The Paragraph dialog's settings; the alignment only when the dialog changed it. */
  const setParagraph = (p: ParagraphSettings) => {
    setDecimal(p.decimal);
    setParagraphs((c) => {
      const ruled = withRuler(c, p.ruler);
      return p.align === align ? ruled : withAlignment(ruled, p.align);
    });
  };

  useEffect(() => {
    const el = root.current!;
    el.dataset['para'] = JSON.stringify(first.current);
    paint(el, initial.current?.spans ?? [], request.height, first.current);
    if (initial.current) {
      el.focus();
      const end = initial.current.spans.reduce(
        (n, x) => n + (x.type === 'text' ? x.text.length : 1),
        0,
      );
      select(el, end, end);
      lastSel.current = [end, end];
    }
    el.focus();
    if (!initial.current) select(el, 0, 0);
    const onSelection = () => {
      const s = selectionIn(el);
      if (!s) return;
      const moved = s[0] !== lastSel.current[0] || s[1] !== lastSel.current[1];
      lastSel.current = s;
      if (moved) pending.current = undefined;
      refresh();
    };
    const replace = insert;
    const asSpans = (text: string): MTextSpan[] =>
      text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .flatMap((t, i): MTextSpan[] => [
          ...(i > 0 ? [{ type: 'break' } as const] : []),
          { type: 'text', text: t, format: {} },
        ]);
    const onBeforeInput = (e: InputEvent) => {
      switch (e.inputType) {
        case 'insertText':
        case 'insertReplacementText':
          e.preventDefault();
          replace(asSpans(e.data ?? e.dataTransfer?.getData('text/plain') ?? ''));
          return;
        case 'insertFromPaste':
        case 'insertFromDrop':
          e.preventDefault();
          replace(asSpans(e.dataTransfer?.getData('text/plain') ?? ''));
          return;
        case 'insertParagraph':
        case 'insertLineBreak':
          e.preventDefault();
          breakHere();
          return;
        case 'deleteContentBackward':
        case 'deleteContentForward': {
          const sel = selectionIn(el);
          if (!sel) return;
          e.preventDefault();
          let [a, b] = sel;
          const s = spans();
          if (a === b) {
            if (e.inputType === 'deleteContentBackward') a = Math.max(0, a - 1);
            else b = b + 1;
          }
          commit(removeRange(s, a, b), a);
          return;
        }
        default:
          // Word deletes, IME composition: the browser edits the DOM, which `read` takes back.
          return;
      }
    };
    // A click anywhere but the editor and its toolbar keeps the text, as in AutoCAD.
    const onOutside = (e: PointerEvent) => {
      if (frame.current && e.target instanceof Node && !frame.current.contains(e.target)) finish();
    };
    // What the browser typed itself (IME, word deletes) moves the text past the columns' ends.
    const onInput = () => refit();
    document.addEventListener('selectionchange', onSelection);
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('input', onInput);
    document.addEventListener('pointerdown', onOutside, true);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('input', onInput);
      document.removeEventListener('pointerdown', onOutside, true);
    };
  }, []);

  // New columns or a new zoom lay the text out again.
  useEffect(refit, [columns, placement.scale]);

  const change = (patch: FormatPatch) => {
    const [a, b] = selection();
    const s = spans();
    if (a === b) {
      const f = { ...(pending.current ?? formatAt(s, a)) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === false) delete f[k];
        else f[k] = v;
      }
      pending.current = f as MTextFormat;
      root.current!.focus();
      select(root.current!, a, a);
      refresh();
      return;
    }
    commit(formatRange(s, a, b, patch), a, b);
  };
  const toggle = (key: Toggle) => {
    const [a, b] = selection();
    const s = spans();
    const on = a === b ? !!(pending.current ?? formatAt(s, a))[key] : hasFormat(s, a, b, key);
    change({ [key]: !on });
  };
  const ttf = (shown.font ?? font).kind === 'ttf';

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finish();
    } else if (e.key === 'Enter' && e.altKey) {
      // AutoCAD's Insert Column Break.
      e.preventDefault();
      breakHere('column');
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      // A tab character, as AutoCAD's editor types it (Esc or Ctrl+Enter leave the editor).
      if (e.target !== root.current) return;
      e.preventDefault();
      insert([{ type: 'text', text: '\t', format: {} }]);
    } else if (e.key === 'Escape' && menu) {
      e.preventDefault();
      setMenu(undefined);
      root.current!.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done.current = true;
      cancel(doc);
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const t = TOGGLES.find((x) => x.shortcut === e.key.toLowerCase());
      if (t && (ttf || (t.key !== 'bold' && t.key !== 'italic'))) {
        e.preventDefault();
        toggle(t.key);
      }
    }
  };

  const colorIndex = shown.color?.kind === 'aci' ? shown.color.index : undefined;
  const style = boxStyle(placement, request);
  // The toolbar sits above the insertion point, upright and at the chrome's size; the text box
  // turns and scales with the text.
  return (
    <div
      ref={frame}
      className="text-editor mtext-editor"
      style={{ left: style.left, top: style.top }}
      onKeyDown={onKeyDown}
    >
      <div
        className="mtext-toolbar"
        role="toolbar"
        aria-label="Text Formatting"
        onMouseDown={(e) => {
          // Buttons keep the editor's selection; the fields take the focus.
          if (e.target instanceof HTMLButtonElement) e.preventDefault();
        }}
      >
        {TOGGLES.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-label={t.label}
            title={t.shortcut ? `${t.label} (Ctrl+${t.shortcut.toUpperCase()})` : t.label}
            aria-pressed={!!shown[t.key]}
            disabled={!ttf && (t.key === 'bold' || t.key === 'italic')}
            className={`mtext-tool mtext-tool-${t.key}`}
            onClick={() => toggle(t.key)}
          >
            {t.glyph}
          </button>
        ))}
        <button
          type="button"
          aria-label="Stack"
          title="Stack: select text with /, # or ^"
          className="mtext-tool"
          onClick={() => {
            const [a, b] = selection();
            const r = toggleStack(spans(), a, b);
            commit(r.spans, r.caret);
          }}
        >
          a⁄b
        </button>
        <select
          aria-label="Font"
          title="Font"
          value={shown.font?.name ?? ''}
          onChange={(e) => {
            const name = e.target.value;
            if (name === '') return change({ font: undefined, bold: undefined, italic: undefined });
            const kind = /\.(ttf|otf|ttc)$/i.test(name) ? 'ttf' : 'shx';
            change({
              font: { name, kind },
              ...(kind === 'shx' && { bold: undefined, italic: undefined }),
            });
          }}
        >
          <option value="">{request.fontFile || 'Style font'}</option>
          {[...new Set([...SHX_FONTS, ...fonts, ...(shown.font ? [shown.font.name] : [])])]
            .filter((n) => n.toLowerCase() !== request.fontFile.toLowerCase())
            .map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
        </select>
        <input
          aria-label="Height"
          title="Height"
          type="number"
          min={0}
          step="any"
          className="mtext-height"
          key={shown.height ?? request.height}
          defaultValue={shown.height ?? request.height}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const v = Number((e.target as HTMLInputElement).value);
            if (v > 0) change({ height: v === request.height ? undefined : v });
          }}
        />
        <select
          aria-label="Color"
          title="Color"
          value={colorIndex === undefined ? 'ByLayer' : String(colorIndex)}
          onChange={(e) => {
            const v = e.target.value;
            change({ color: v === 'ByLayer' ? undefined : { kind: 'aci', index: Number(v) } });
          }}
        >
          {COLORS.map((c) => (
            <option key={c.label} value={c.index === undefined ? 'ByLayer' : String(c.index)}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Paragraph"
          title="Paragraph"
          aria-haspopup="dialog"
          aria-expanded={menu === 'paragraph'}
          className="mtext-tool"
          onClick={() => setMenu(menu === 'paragraph' ? undefined : 'paragraph')}
        >
          ¶
        </button>
        <button
          type="button"
          aria-label="Columns"
          title="Columns"
          aria-haspopup="menu"
          aria-expanded={menu === 'columns'}
          className="mtext-tool"
          onClick={() => setMenu(menu === 'columns' ? undefined : 'columns')}
        >
          ▥
        </button>
        <button
          type="button"
          className="mtext-ok"
          title="Close Text Editor (Ctrl+Enter)"
          onClick={finish}
        >
          OK
        </button>
        {menu === 'columns' && (
          <ColumnsMenu
            columns={columns}
            onPick={(pick) => {
              setMenu(pick === 'settings' ? 'settings' : undefined);
              if (pick === 'break') breakHere('column');
              else if (pick !== 'settings') setColumns(columnsFor(pick, columns, request, root));
              if (pick !== 'settings') root.current!.focus();
            }}
          />
        )}
      </div>
      {menu === 'settings' && (
        <ColumnSettings
          columns={columns ?? columnsFor('dynamic', null, request, root)!}
          none={!columns}
          height={request.height}
          onClose={(c) => {
            if (c !== undefined) setColumns(c);
            setMenu(undefined);
            root.current!.focus();
          }}
        />
      )}
      {menu === 'paragraph' && (
        <ParagraphDialog
          settings={{ ruler, align, decimal }}
          onClose={(p) => {
            setMenu(undefined);
            root.current!.focus();
            if (p) setParagraph(p);
          }}
        />
      )}
      <div className="mtext-box" style={{ transform: style.transform, fontSize: style.fontSize }}>
        <Ruler
          ruler={ruler}
          unit={request.height * placement.scale}
          // Over the first column when the columns run right to left.
          offset={
            columns?.flowReversed
              ? (boxWidth(request, columns) - columns.width) * placement.scale
              : 0
          }
          width={
            (columns?.flowReversed ? columns.width : boxWidth(request, columns)) * placement.scale
          }
          tabKind={tabKind}
          decimal={decimal}
          onTabKind={setTabKind}
          onChange={setRuler}
        />
        <div
          ref={root}
          // Width 0 is MTEXT's "no wrapping" (a multileader's text, M2-09): lines run on.
          className={`mtext-content${boxWidth(request, columns) > 0 ? '' : ' no-wrap'}${
            columns?.flowReversed ? ' reversed' : ''
          }`}
          role="textbox"
          aria-multiline="true"
          aria-label="Multiline text"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          style={columnStyle(request, columns, placement.scale)}
        />
        {columns && fitted && (
          <ColumnFrames
            columns={columns}
            fitted={fitted}
            scale={placement.scale}
            textHeight={request.height}
            rotation={request.rotation}
            onChange={setColumns}
          />
        )}
      </div>
    </div>
  );
}

// ---- Columns and the ruler (M2-07 part 3) ----

type ColumnsPick = 'none' | 'dynamic' | 2 | 3 | 4 | 5 | 6 | 'break' | 'settings';

/**
 * The box's width in drawing units: all the static columns, one dynamic column, else DXF 41.
 * Dynamic columns set right to left span all their columns, so the first is at the right, where
 * the renderer draws it, and the text added runs on to the left.
 */
function boxWidth(request: TextEditorRequest, c: TextEditorColumns | null): number {
  if (!c) return request.width;
  return c.type === 1 || c.flowReversed ? c.count * c.width + (c.count - 1) * c.gutter : c.width;
}

/**
 * The content's CSS: the box width, and with columns their width, gutter and height, flowing
 * into more columns past the box as dynamic columns do (and static ones overflow).
 */
function columnStyle(
  request: TextEditorRequest,
  c: TextEditorColumns | null,
  scale: number,
): CSSProperties {
  const width = boxWidth(request, c);
  return {
    ...(width > 0 && { width: `${width * scale}px` }),
    ...(c && {
      // The box's border and padding stay outside the columns: with the app's border-box
      // sizing two columns and their gutter would not fit and the browser would make one.
      boxSizing: 'content-box',
      height: `${tallest(c) * scale}px`,
      columnGap: `${c.gutter * scale}px`,
      columnFill: 'auto',
      ...(c.type === 1 ? { columnCount: c.count } : { columnWidth: `${c.width * scale}px` }),
    }),
  };
}

/**
 * The columns a menu pick sets. Static columns split the box's width, else take columns six
 * text heights wide; the gutter is five text heights ("Column Settings Dialog Box"); the height
 * is that of the text typed so far (at least five lines' worth), as the box stood when the
 * columns were set (our reading of AutoCAD's editor, which keeps the box).
 */
function columnsFor(
  pick: Exclude<ColumnsPick, 'break' | 'settings'>,
  now: TextEditorColumns | null,
  request: TextEditorRequest,
  root: { readonly current: HTMLElement | null },
): TextEditorColumns | null {
  if (pick === 'none') return null;
  if (pick === 'dynamic' && now?.type === 2) return now;
  const h = request.height;
  const flow = now?.flowReversed ? { flowReversed: true } : {};
  const gutter = now?.gutter ?? 5 * h;
  const scale = (root.current?.getBoundingClientRect().width ?? 0) / (boxWidth(request, now) || 1);
  const typed = scale > 0 ? (root.current?.scrollHeight ?? 0) / scale : 25 * h;
  const height = now?.height ?? Math.max(5 * h, Math.round(typed * 1000) / 1000);
  if (pick === 'dynamic') {
    const width = now?.width ?? (request.width > 0 ? request.width : 6 * h);
    return { type: 2, count: now?.count ?? 1, width, gutter, height, ...flow };
  }
  const total = now ? boxWidth(request, now) : request.width > 0 ? request.width : 0;
  const width = (total - (pick - 1) * gutter) / pick;
  return { type: 1, count: pick, width: width > 0 ? width : 6 * h, gutter, height, ...flow };
}

function ColumnsMenu({
  columns,
  onPick,
}: {
  columns: TextEditorColumns | null;
  onPick: (p: ColumnsPick) => void;
}) {
  const item = (label: string, pick: ColumnsPick, checked?: boolean) => (
    <button
      key={label}
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      {...(checked !== undefined && { 'aria-checked': checked })}
      onClick={() => onPick(pick)}
    >
      {label}
    </button>
  );
  return (
    <div className="mtext-menu" role="menu" aria-label="Columns">
      {item('No Columns', 'none', !columns)}
      {item('Dynamic Columns', 'dynamic', columns?.type === 2)}
      {([2, 3, 4, 5, 6] as const).map((n) =>
        item(`Static Columns: ${n}`, n, columns?.type === 1 && columns.count === n),
      )}
      {item('Insert Column Break (Alt+Enter)', 'break')}
      {item('Column Settings…', 'settings')}
    </div>
  );
}

/**
 * AutoCAD's Column Settings dialog: type (Dynamic Columns with Auto Height or Manual Height,
 * M2-26), number, height, column and gutter widths. Manual heights are each column's own,
 * dragged in the editor, so Height is off for them; choosing Manual Height gives each column
 * the height there was, and Auto Height gives all the tallest.
 */
function ColumnSettings({
  columns,
  none,
  height,
  onClose,
}: {
  /** The columns, or the defaults when there are none. */
  columns: TextEditorColumns;
  none: boolean;
  height: number;
  /** The settings, null for no columns; undefined when cancelled. */
  onClose: (c: TextEditorColumns | null | undefined) => void;
}) {
  const [type, setType] = useState<0 | 1 | 2>(none ? 0 : columns.type);
  const [count, setCount] = useState(columns.type === 1 ? columns.count : 2);
  const [colHeight, setColHeight] = useState(columns.height);
  const [manual, setManual] = useState(!!columns.heights?.length);
  const [width, setWidth] = useState(columns.width);
  const [gutter, setGutter] = useState(columns.gutter);
  const total = type === 1 ? count * width + (count - 1) * gutter : width;
  const ok = () => {
    if (type === 0) return onClose(null);
    if (!(width > 0 && gutter >= 0 && colHeight > 0 && count >= 1)) return;
    const n = type === 1 ? Math.round(count) : columns.count;
    const heights =
      type === 2 && manual
        ? columns.heights?.length
          ? columns.heights
          : Array.from({ length: Math.max(1, n) }, () => colHeight)
        : undefined;
    onClose({
      type,
      count: n,
      width,
      gutter,
      height: heights ? Math.max(...heights) : colHeight,
      ...(heights && { heights }),
      ...(columns.flowReversed && { flowReversed: true }),
    });
  };
  const num = (label: string, value: number, set: (v: number) => void, disabled = false) => (
    <label>
      {label}
      <input
        type="number"
        min={0}
        step="any"
        value={Number(value.toPrecision(10))}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
      />
    </label>
  );
  return (
    <div
      className="mtext-dialog"
      role="dialog"
      aria-label="Column Settings"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose(undefined);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          ok();
        }
      }}
    >
      <fieldset>
        <legend>Column Type</legend>
        {(
          [
            [2, 'Dynamic Columns'],
            [1, 'Static Columns'],
            [0, 'No Columns'],
          ] as const
        ).map(([v, label]) => (
          <label key={v}>
            <input
              type="radio"
              name="mtext-column-type"
              checked={type === v}
              onChange={() => setType(v)}
            />
            {label}
          </label>
        ))}
        <div className="mtext-dialog-sub" role="radiogroup" aria-label="Dynamic Columns">
          {(
            [
              [false, 'Auto Height'],
              [true, 'Manual Height'],
            ] as const
          ).map(([v, label]) => (
            <label key={label}>
              <input
                type="radio"
                name="mtext-column-height"
                checked={manual === v}
                disabled={type !== 2}
                onChange={() => setManual(v)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={type === 0}>
        <legend>Column Number</legend>
        {num('Number', count, setCount, type !== 1)}
      </fieldset>
      <fieldset disabled={type === 0}>
        <legend>Height</legend>
        {num('Height', colHeight, setColHeight, type === 2 && manual)}
      </fieldset>
      <fieldset disabled={type === 0}>
        <legend>Width</legend>
        {num('Column', width, setWidth)}
        {num('Gutter', gutter, setGutter)}
        <output aria-label="Total">Total: {Number(total.toPrecision(10))}</output>
      </fieldset>
      <p className="mtext-dialog-note">
        Gutter default: five times the text height ({5 * height}).
      </p>
      <div className="mtext-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={() => onClose(undefined)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** AutoCAD's decimal styles (the Paragraph dialog's "Specify decimal style"). */
const DECIMAL_STYLES: readonly { readonly label: string; readonly symbol: string }[] = [
  { label: 'Period', symbol: '.' },
  { label: 'Comma', symbol: ',' },
  { label: 'Space', symbol: ' ' },
];

const ALIGNMENTS: readonly { readonly align: MTextAlign; readonly label: string }[] = [
  { align: 'left', label: 'Left' },
  { align: 'center', label: 'Center' },
  { align: 'right', label: 'Right' },
  { align: 'justified', label: 'Justified' },
  { align: 'distributed', label: 'Distributed' },
];

/** What the Paragraph dialog sets. */
export interface ParagraphSettings {
  readonly ruler: MTextRuler;
  /** The paragraph's own alignment; undefined: by the attachment point. */
  readonly align: MTextAlign | undefined;
  /** The decimal style its decimal stops line up. */
  readonly decimal: string;
}

/**
 * AutoCAD's Paragraph dialog (M2-26 part 3; "Paragraph Dialog Box"): Tab (the stop's kind,
 * its position, Add, Modify, Remove, the stops, Specify decimal style), Left Indent (First line,
 * Hanging), Right Indent (Right) and Paragraph Alignment, for the paragraphs the selection
 * touches; values in text heights, as the ruler's. AutoCAD's help does not say what First line
 * and Hanging measure; they are read as where the ruler's two markers are, from the box's left
 * edge (First line the first line's start, Hanging the other lines'). Paragraph Spacing and
 * Line Spacing are left out (M2-46).
 */
function ParagraphDialog({
  settings,
  onClose,
}: {
  settings: ParagraphSettings;
  /** Undefined when cancelled. */
  onClose: (s: ParagraphSettings | undefined) => void;
}) {
  const r = settings.ruler;
  const [tabs, setTabs] = useState<readonly MTextTabStop[]>(r.tabs);
  const [kind, setKind] = useState<TabKind>('left');
  const [position, setPosition] = useState(0);
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [decimal, setDecimal] = useState(
    r.tabs.find((t) => t.kind === 'decimal')?.decimal ?? settings.decimal,
  );
  const [first, setFirst] = useState(r.indentLeft + r.indentFirst);
  const [hanging, setHanging] = useState(r.indentLeft);
  const [right, setRight] = useState(r.indentRight);
  const [aligned, setAligned] = useState(settings.align !== undefined);
  const [align, setAlign] = useState<MTextAlign>(settings.align ?? 'left');
  const stopHere = (): MTextTabStop => ({
    at: position,
    kind,
    ...(kind === 'decimal' && { decimal }),
  });
  /** The stops with one at `at` taken out (`except`: that one's index), then `t` added, sorted. */
  const put = (list: readonly MTextTabStop[], t: MTextTabStop, except?: number) =>
    [...list.filter((x, i) => i !== except && x.at !== t.at), t].sort((a, b) => a.at - b.at);
  const pick = (i: number | undefined) => {
    setPicked(i);
    const t = i === undefined ? undefined : tabs[i];
    if (!t) return;
    setKind(t.kind);
    setPosition(t.at);
    if (t.decimal) setDecimal(t.decimal);
  };
  const ok = () => {
    if (![position, first, hanging, right].every(Number.isFinite) || right < 0) return;
    onClose({
      ruler: {
        indentFirst: first - hanging,
        indentLeft: hanging,
        indentRight: right,
        // The decimal style is the paragraph's: its decimal stops all take it.
        tabs: tabs.map((t) => (t.kind === 'decimal' ? { ...t, decimal } : t)),
      },
      align: aligned ? align : undefined,
      decimal,
    });
  };
  const num = (label: string, value: number, set: (v: number) => void, min?: number) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        step="any"
        value={Number(value.toPrecision(10))}
        onChange={(e) => set(Number(e.target.value))}
      />
    </label>
  );
  return (
    <div
      className="mtext-dialog mtext-paragraph"
      role="dialog"
      aria-label="Paragraph"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose(undefined);
        } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          ok();
        }
      }}
    >
      <fieldset>
        <legend>Tab</legend>
        <div className="mtext-dialog-row" role="radiogroup" aria-label="Tab type">
          {TAB_KINDS.map((k) => (
            <label key={k}>
              <input
                type="radio"
                name="mtext-tab-kind"
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              {TAB_LABEL[k]}
            </label>
          ))}
        </div>
        <label>
          Tab position
          <input
            type="number"
            min={0}
            step="any"
            aria-label="Tab position"
            value={Number(position.toPrecision(10))}
            onChange={(e) => setPosition(Number(e.target.value))}
          />
        </label>
        <div className="mtext-dialog-row">
          <button
            type="button"
            onClick={() => {
              if (!(position >= 0)) return;
              const next = put(tabs, stopHere());
              setTabs(next);
              setPicked(next.findIndex((t) => t.at === position));
            }}
          >
            Add
          </button>
          <button
            type="button"
            disabled={picked === undefined}
            onClick={() => {
              if (picked === undefined || !(position >= 0)) return;
              const next = put(tabs, stopHere(), picked);
              setTabs(next);
              setPicked(next.findIndex((t) => t.at === position));
            }}
          >
            Modify
          </button>
          <button
            type="button"
            disabled={picked === undefined}
            onClick={() => {
              setTabs(tabs.filter((_, i) => i !== picked));
              setPicked(undefined);
            }}
          >
            Remove
          </button>
        </div>
        <ul
          className="mtext-tab-list"
          role="listbox"
          aria-label="Tab stops"
          tabIndex={0}
          onKeyDown={(e) => {
            if (tabs.length === 0) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              pick(Math.min(tabs.length - 1, Math.max(0, (picked ?? -d) + d)));
            }
          }}
        >
          {tabs.map((t, i) => (
            <li
              key={`${t.kind}${t.at}`}
              role="option"
              aria-selected={picked === i}
              onClick={() => pick(i)}
            >
              {tabName(t)}
            </li>
          ))}
        </ul>
        <label>
          Specify decimal style
          <select
            aria-label="Specify decimal style"
            value={decimal}
            onChange={(e) => setDecimal(e.target.value)}
          >
            {DECIMAL_STYLES.map((d) => (
              <option key={d.label} value={d.symbol}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend>Left Indent</legend>
        {num('First line', first, setFirst)}
        {num('Hanging', hanging, setHanging)}
      </fieldset>
      <fieldset>
        <legend>Right Indent</legend>
        {num('Right', right, setRight, 0)}
      </fieldset>
      <fieldset>
        <legend>
          <label>
            <input
              type="checkbox"
              checked={aligned}
              onChange={(e) => setAligned(e.target.checked)}
            />
            Paragraph Alignment
          </label>
        </legend>
        <div className="mtext-dialog-row" role="radiogroup" aria-label="Paragraph Alignment">
          {ALIGNMENTS.map((a) => (
            <label key={a.align}>
              <input
                type="radio"
                name="mtext-paragraph-align"
                checked={align === a.align}
                disabled={!aligned}
                onChange={() => setAlign(a.align)}
              />
              {a.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mtext-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={() => onClose(undefined)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Each column's frame, with a handle on its bottom edge (M2-26): with Manual Height one per
 * column, setting that column's height (a column the text added takes the last one's until
 * dragged); else one on the first column, setting the height of all. Dragged, or moved a text
 * height with the arrow keys; at least one text height. The drag is read along the text's own
 * y axis, so it works on turned text.
 */
function ColumnFrames({
  columns: c,
  fitted,
  scale,
  textHeight,
  rotation,
  onChange,
}: {
  columns: TextEditorColumns;
  fitted: Fitted;
  scale: number;
  textHeight: number;
  rotation: number;
  onChange: (c: TextEditorColumns) => void;
}) {
  const manual = c.type === 2 && !!c.heights?.length;
  const count = Math.max(1, fitted.count);
  const drag = useRef<{ x: number; y: number; h: number } | undefined>(undefined);
  const set = (i: number, h: number) => {
    const v = Math.max(textHeight, Math.round(h * 1000) / 1000);
    if (!manual) return onChange({ ...c, height: v });
    const heights = Array.from({ length: Math.max(count, i + 1) }, (_, k) => columnHeight(c, k));
    heights[i] = v;
    onChange({ ...c, heights, height: Math.max(...heights) });
  };
  return (
    <div className="mtext-frames" style={{ left: `${fitted.left}px`, top: `${fitted.top}px` }}>
      {Array.from({ length: count }, (_, i) => {
        const h = columnHeight(c, i);
        const handle = manual || i === 0;
        return (
          <div
            key={i}
            className="mtext-frame"
            style={{
              left: `${columnLeft(c, fitted, i, scale)}px`,
              width: `${c.width * scale}px`,
              height: `${h * scale}px`,
            }}
          >
            {handle && (
              <span
                className="mtext-frame-handle"
                role="slider"
                tabIndex={0}
                aria-label={manual ? `Column ${i + 1} height` : 'Column height'}
                aria-orientation="vertical"
                aria-valuemin={textHeight}
                aria-valuenow={h}
                title={manual ? `Column ${i + 1} height` : 'Column height'}
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  drag.current = { x: e.clientX, y: e.clientY, h };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d) return;
                  // The box is turned by −rotation: its y axis (down) is (sin r, cos r) on screen.
                  const down =
                    (e.clientX - d.x) * Math.sin(rotation) + (e.clientY - d.y) * Math.cos(rotation);
                  set(i, d.h + down / scale);
                }}
                onPointerUp={() => {
                  drag.current = undefined;
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                  e.preventDefault();
                  set(i, h + (e.key === 'ArrowUp' ? -textHeight : textHeight));
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Where a pointer is along the ruler, in text heights from the box's left edge. */
const along = (e: React.PointerEvent, unit: number): number =>
  Math.round((e.nativeEvent.offsetX / unit) * 10) / 10;

type Drag =
  | { readonly kind: 'first' }
  | { readonly kind: 'left' }
  | { readonly kind: 'right' }
  | { readonly kind: 'tab'; readonly index: number };

type TabKind = MTextTabStop['kind'];

/** The Tab Selection button's order, as AutoCAD's: left, center, right, decimal. */
const TAB_KINDS: readonly TabKind[] = ['left', 'center', 'right', 'decimal'];

const TAB_LABEL: Readonly<Record<TabKind, string>> = {
  left: 'Left',
  center: 'Center',
  right: 'Right',
  decimal: 'Decimal',
};

/** A tab stop as the ruler's value text and the Paragraph dialog's list name it. */
const tabName = (t: MTextTabStop): string => `${TAB_LABEL[t.kind]} ${t.at}`;

/**
 * The ruler: the first-line indent (the top marker), the left indent (the bottom marker), the
 * right indent (the marker at the right end, M2-26 part 3) and the tab stops of the paragraph
 * at the caret, in text heights (`unit` px each). A click on it adds a tab stop of the kind the
 * Tab Selection button at its left end shows (a click on that cycles left, center, right and
 * decimal, as in AutoCAD's ruler); a tab stop dragged off it goes. Dragging the left indent
 * leaves the first line where it is, as in AutoCAD's ruler.
 */
function Ruler({
  ruler,
  unit,
  offset,
  width,
  tabKind,
  decimal,
  onTabKind,
  onChange,
}: {
  ruler: MTextRuler;
  unit: number;
  /** From the box's left edge, px: the first column's (M2-26). */
  offset: number;
  width: number;
  /** The kind of tab stop a click adds, and a decimal one's symbol. */
  tabKind: TabKind;
  decimal: string;
  onTabKind: (k: TabKind) => void;
  onChange: (r: MTextRuler) => void;
}) {
  const [live, setLive] = useState<MTextRuler | undefined>(undefined);
  const drag = useRef<Drag | undefined>(undefined);
  const shown = live ?? ruler;
  /** The column's width in text heights: the right indent is measured in from it. */
  const span = width / unit;
  const moved = (d: Drag, at: number, off: boolean): MTextRuler => {
    if (d.kind === 'first') return { ...ruler, indentFirst: at - ruler.indentLeft };
    if (d.kind === 'left') {
      return { ...ruler, indentLeft: at, indentFirst: ruler.indentLeft + ruler.indentFirst - at };
    }
    if (d.kind === 'right') {
      return { ...ruler, indentRight: Math.max(0, Math.round((span - at) * 10) / 10) };
    }
    const tabs = ruler.tabs.filter((_, i) => i !== d.index);
    const was = ruler.tabs[d.index];
    const kind = was?.kind ?? tabKind;
    const stop: MTextTabStop = {
      at: Math.max(0, at),
      kind,
      ...(kind === 'decimal' && { decimal: was?.decimal ?? decimal }),
    };
    return { ...ruler, tabs: off ? tabs : [...tabs, stop] };
  };
  const offRuler = (e: React.PointerEvent) =>
    e.nativeEvent.offsetY < -12 ||
    e.nativeEvent.offsetY > (e.currentTarget as HTMLElement).clientHeight + 12;
  const x = (v: number) => `${v * unit}px`;
  const shownWidth = Math.max(width, 6 * unit);
  return (
    <>
      <button
        type="button"
        className={`mtext-tab-type mtext-tab-type-${tabKind}`}
        aria-label={`Tab type: ${TAB_LABEL[tabKind]}`}
        title={`Tab type: ${TAB_LABEL[tabKind]} (click to change)`}
        style={{ left: `${offset - 16}px` }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onTabKind(TAB_KINDS[(TAB_KINDS.indexOf(tabKind) + 1) % TAB_KINDS.length]!)}
      />
      <div
        className="mtext-ruler"
        role="slider"
        aria-label="Ruler"
        aria-valuetext={`First line ${shown.indentFirst}, left ${shown.indentLeft}, right ${
          shown.indentRight
        }, tabs ${shown.tabs.map((t) => (t.kind === 'left' ? t.at : tabName(t).toLowerCase())).join(' ') || 'none'}`}
        style={{
          left: `${offset}px`,
          width: `${shownWidth}px`,
          backgroundSize: `${unit}px 100%`,
        }}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const at = along(e, unit);
          const near = (v: number) => Math.abs(v - at) * unit <= 5;
          const top = e.nativeEvent.offsetY < e.currentTarget.clientHeight / 2;
          const tab = ruler.tabs.findIndex((t) => near(t.at));
          let d: Drag;
          if (tab >= 0) d = { kind: 'tab', index: tab };
          else if (top && near(ruler.indentLeft + ruler.indentFirst)) d = { kind: 'first' };
          else if (near(ruler.indentLeft)) d = { kind: 'left' };
          else if (!top && width > 0 && near(span - ruler.indentRight)) d = { kind: 'right' };
          else {
            // A new tab stop where the click was, dragged on from there.
            d = { kind: 'tab', index: ruler.tabs.length };
          }
          drag.current = d;
          e.currentTarget.setPointerCapture(e.pointerId);
          setLive(moved(d, at, false));
        }}
        onPointerMove={(e) => {
          if (drag.current) setLive(moved(drag.current, along(e, unit), offRuler(e)));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = undefined;
          setLive(undefined);
          if (d) onChange(moved(d, along(e, unit), offRuler(e)));
        }}
      >
        <span
          className="mtext-ruler-first"
          title="First line indent"
          style={{ left: x(shown.indentLeft + shown.indentFirst) }}
        />
        <span
          className="mtext-ruler-left"
          title="Paragraph indent"
          style={{ left: x(shown.indentLeft) }}
        />
        {width > 0 && (
          <span
            className="mtext-ruler-right"
            title="Right indent"
            style={{ left: x(span - shown.indentRight) }}
          />
        )}
        {shown.tabs.map((t, i) => (
          <span
            key={i}
            className={`mtext-ruler-tab mtext-ruler-tab-${t.kind}`}
            title={`${TAB_LABEL[t.kind]} tab stop ${t.at}`}
            style={{ left: x(t.at) }}
          />
        ))}
      </div>
    </>
  );
}
