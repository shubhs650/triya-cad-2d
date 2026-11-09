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
  rulerOf,
  sameContent,
  SHX_EQUIVALENTS,
  withRuler,
  writeMText,
  type MTextContent,
  type MTextFormat,
  type MTextRuler,
  type MTextSpan,
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

/** A paragraph's <div>, indented by its ruler (in text heights; one is CAP_HEIGHT em). */
function paragraphBox(codes: readonly string[], columnBreak: boolean): HTMLElement {
  const div = document.createElement('div');
  div.className = 'mtext-para';
  const r = rulerOf(codes);
  if (r.indentLeft !== 0) div.style.paddingLeft = `${r.indentLeft * CAP_HEIGHT}em`;
  if (r.indentFirst !== 0) div.style.textIndent = `${r.indentFirst * CAP_HEIGHT}em`;
  if (columnBreak) div.style.breakBefore = 'column';
  return div;
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
    const el = document.createElement('span');
    applyStyle(el, runStyle(s.format, height));
    if (s.type === 'text') {
      el.dataset['fmt'] = JSON.stringify(s.format);
      el.textContent = s.text;
    } else if (s.type === 'stack') {
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
      } else if (!(child instanceof HTMLElement) || isFiller(child)) {
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
    if (isFiller(node)) return false;
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
  const [menu, setMenu] = useState<'columns' | 'settings' | undefined>(undefined);
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
    setRulerShown(rulerOf(paragraphCodes(s, first.current)[paragraphIndex(s, a)] ?? []));
  };
  const commit = (next: MTextSpan[], a: number, b = a) => {
    paint(root.current!, next, request.height, first.current);
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
    // Dynamic columns: as many as the text takes, laid out with the renderers' fonts.
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
                columns: c,
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
  /** The ruler's change, made to every paragraph the selection touches. */
  const setRuler = (r: MTextRuler) => {
    const [a, b] = selection();
    const s = spans();
    const next = mapParagraphs(s, first.current, paragraphIndex(s, a), paragraphIndex(s, b), (c) =>
      withRuler(c, r),
    );
    first.current = next.first;
    root.current!.dataset['para'] = JSON.stringify(next.first);
    commit(next.spans, a, b);
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
    document.addEventListener('selectionchange', onSelection);
    el.addEventListener('beforeinput', onBeforeInput);
    document.addEventListener('pointerdown', onOutside, true);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      el.removeEventListener('beforeinput', onBeforeInput);
      document.removeEventListener('pointerdown', onOutside, true);
    };
  }, []);

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
      <div className="mtext-box" style={{ transform: style.transform, fontSize: style.fontSize }}>
        <Ruler
          ruler={ruler}
          unit={request.height * placement.scale}
          width={boxWidth(request, columns) * placement.scale}
          onChange={setRuler}
        />
        <div
          ref={root}
          // Width 0 is MTEXT's "no wrapping" (a multileader's text, M2-09): lines run on.
          className={boxWidth(request, columns) > 0 ? 'mtext-content' : 'mtext-content no-wrap'}
          role="textbox"
          aria-multiline="true"
          aria-label="Multiline text"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          style={columnStyle(request, columns, placement.scale)}
        />
      </div>
    </div>
  );
}

// ---- Columns and the ruler (M2-07 part 3) ----

type ColumnsPick = 'none' | 'dynamic' | 2 | 3 | 4 | 5 | 6 | 'break' | 'settings';

/** The box's width in drawing units: all the static columns, one dynamic column, else DXF 41. */
function boxWidth(request: TextEditorRequest, c: TextEditorColumns | null): number {
  if (!c) return request.width;
  return c.type === 1 ? c.count * c.width + (c.count - 1) * c.gutter : c.width;
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
      height: `${c.height * scale}px`,
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
  const h = request.height;
  const gutter = now?.gutter ?? 5 * h;
  const scale = (root.current?.getBoundingClientRect().width ?? 0) / (boxWidth(request, now) || 1);
  const typed = scale > 0 ? (root.current?.scrollHeight ?? 0) / scale : 25 * h;
  const height = now?.height ?? Math.max(5 * h, Math.round(typed * 1000) / 1000);
  if (pick === 'dynamic') {
    const width = now?.width ?? (request.width > 0 ? request.width : 6 * h);
    return { type: 2, count: now?.count ?? 1, width, gutter, height };
  }
  const total = now ? boxWidth(request, now) : request.width > 0 ? request.width : 0;
  const width = (total - (pick - 1) * gutter) / pick;
  return { type: 1, count: pick, width: width > 0 ? width : 6 * h, gutter, height };
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

/** AutoCAD's Column Settings dialog: type, number, height, column and gutter widths. */
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
  const [width, setWidth] = useState(columns.width);
  const [gutter, setGutter] = useState(columns.gutter);
  const total = type === 1 ? count * width + (count - 1) * gutter : width;
  const ok = () => {
    if (type === 0) return onClose(null);
    if (!(width > 0 && gutter >= 0 && colHeight > 0 && count >= 1)) return;
    onClose({
      type,
      count: type === 1 ? Math.round(count) : columns.count,
      width,
      gutter,
      height: colHeight,
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
      </fieldset>
      <fieldset disabled={type === 0}>
        <legend>Column Number</legend>
        {num('Number', count, setCount, type !== 1)}
      </fieldset>
      <fieldset disabled={type === 0}>
        <legend>Height</legend>
        {num('Height', colHeight, setColHeight)}
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

/** Where a pointer is along the ruler, in text heights from the box's left edge. */
const along = (e: React.PointerEvent, unit: number): number =>
  Math.round((e.nativeEvent.offsetX / unit) * 10) / 10;

type Drag =
  | { readonly kind: 'first' }
  | { readonly kind: 'left' }
  | { readonly kind: 'tab'; readonly index: number };

/**
 * The ruler: the first-line indent (the top marker), the left indent (the bottom marker) and
 * the tab stops of the paragraph at the caret, in text heights (`unit` px each). A click on
 * it adds a left tab stop; a tab stop dragged off it goes. Dragging the left indent leaves the
 * first line where it is, as in AutoCAD's ruler.
 */
function Ruler({
  ruler,
  unit,
  width,
  onChange,
}: {
  ruler: MTextRuler;
  unit: number;
  width: number;
  onChange: (r: MTextRuler) => void;
}) {
  const [live, setLive] = useState<MTextRuler | undefined>(undefined);
  const drag = useRef<Drag | undefined>(undefined);
  const shown = live ?? ruler;
  const moved = (d: Drag, at: number, off: boolean): MTextRuler => {
    if (d.kind === 'first') return { ...ruler, indentFirst: at - ruler.indentLeft };
    if (d.kind === 'left') {
      return { ...ruler, indentLeft: at, indentFirst: ruler.indentLeft + ruler.indentFirst - at };
    }
    const tabs = ruler.tabs.filter((_, i) => i !== d.index);
    return {
      ...ruler,
      tabs: off
        ? tabs
        : [...tabs, { at: Math.max(0, at), kind: ruler.tabs[d.index]?.kind ?? 'left' }],
    };
  };
  const offRuler = (e: React.PointerEvent) =>
    e.nativeEvent.offsetY < -12 ||
    e.nativeEvent.offsetY > (e.currentTarget as HTMLElement).clientHeight + 12;
  const x = (v: number) => `${v * unit}px`;
  return (
    <div
      className="mtext-ruler"
      role="slider"
      aria-label="Ruler"
      aria-valuetext={`First line ${shown.indentFirst}, left ${shown.indentLeft}, tabs ${
        shown.tabs.map((t) => t.at).join(' ') || 'none'
      }`}
      style={{ width: `${Math.max(width, 6 * unit)}px`, backgroundSize: `${unit}px 100%` }}
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
        else {
          // A new left tab stop where the click was, dragged on from there.
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
      {shown.tabs.map((t, i) => (
        <span
          key={i}
          className={`mtext-ruler-tab mtext-ruler-tab-${t.kind}`}
          title={`Tab stop ${t.at}`}
          style={{ left: x(t.at) }}
        />
      ))}
    </div>
  );
}
