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
// The editor's DOM is the record of what was typed: plain runs as <span data-fmt>, paragraph
// breaks as <br>, stacks as uneditable <span data-stack>. Typing, pasting, Enter and the
// toolbar are applied to the spans (text-editor.ts) and the DOM repainted from them, so the
// DOM never takes a shape the spans cannot hold.
import type { StringPrompt, TextEditorRequest } from '@triya/engine';
import { aciRgb, worldToScreen } from '@triya/render';
import {
  contentOf,
  mtextBase,
  parseMText,
  sameContent,
  SHX_EQUIVALENTS,
  writeMText,
  type MTextContent,
  type MTextFormat,
  type MTextSpan,
} from '@triya/text';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { controllerOf } from './canvas/registry';
import type { CanvasController } from './canvas/controller';
import { commandLines } from './command-line';
import { engines } from './engine/registry';
import {
  autoStack,
  formatAt,
  formatRange,
  hasFormat,
  insertSpans,
  paragraphAt,
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
}: {
  doc: { id: number; block: string } | undefined;
  /** The user's font files (M1-38), offered in the Font list too. */
  fonts?: readonly string[];
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
    <MTextBox key={key} doc={doc.id} request={request} controller={controller} fonts={fonts} />
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

/** The editor's DOM for the spans. */
function paint(root: HTMLElement, spans: readonly MTextSpan[], height: number): void {
  const nodes: Node[] = [];
  for (const s of spans) {
    if (s.type === 'break') {
      const br = document.createElement('br');
      // What the break keeps: its kind and the next paragraph's `\p` values.
      br.dataset['para'] = JSON.stringify(s.paragraph ?? []);
      if (s.end) br.dataset['end'] = s.end;
      nodes.push(br);
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
    } else {
      el.dataset['field'] = JSON.stringify(s);
      el.contentEditable = 'false';
      el.className = 'mtext-field';
      el.textContent = '----';
    }
    nodes.push(el);
  }
  // A last <br> shows no empty line by itself.
  if (spans.at(-1)?.type === 'break') {
    const filler = document.createElement('br');
    filler.dataset['filler'] = '';
    nodes.push(filler);
  }
  root.replaceChildren(...nodes);
}

const isAtom = (n: Node): boolean =>
  n instanceof HTMLElement &&
  (n.dataset['stack'] !== undefined || n.dataset['field'] !== undefined);
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
        const data = child.dataset['stack'] ?? child.dataset['field']!;
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
        continue;
      } else if (isAtom(k) || (k instanceof HTMLElement && k.tagName === 'BR')) {
        const at = [...node.childNodes].indexOf(k);
        if (unit === count) {
          found = [node, at];
          return;
        }
        count += 1;
        if (unit === count && k instanceof HTMLElement && k.tagName === 'BR') {
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
}: {
  doc: number;
  request: TextEditorRequest;
  controller: CanvasController;
  fonts: readonly string[];
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
  /** The first paragraph's `\p` values (none for new text). */
  const first = initial.current?.paragraph ?? [];
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
  };
  const commit = (next: MTextSpan[], a: number, b = a) => {
    paint(root.current!, next, request.height);
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
      old && request.value !== undefined && sameContent(old, { paragraph: first, spans: now }, font)
        ? request.value
        : writeMText(now, font, first);
    engines.command(doc, { kind: 'answer', answer: { kind: 'string', value, editor: true } });
  };

  useEffect(() => {
    const el = root.current!;
    el.dataset['para'] = JSON.stringify(first);
    if (initial.current) {
      paint(el, initial.current.spans, request.height);
      el.focus();
      const end = initial.current.spans.reduce(
        (n, x) => n + (x.type === 'text' ? x.text.length : 1),
        0,
      );
      select(el, end, end);
      lastSel.current = [end, end];
    }
    el.focus();
    const onSelection = () => {
      const s = selectionIn(el);
      if (!s) return;
      const moved = s[0] !== lastSel.current[0] || s[1] !== lastSel.current[1];
      lastSel.current = s;
      if (moved) pending.current = undefined;
      refresh();
    };
    const replace = (inserted: MTextSpan[]) => {
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
          {
            // The new paragraph keeps the formatting of the one it was typed in.
            const [a] = selectionIn(el) ?? lastSel.current;
            const codes = paragraphAt(spans(), first, a);
            replace([{ type: 'break', ...(codes.length > 0 && { paragraph: codes }) }]);
          }
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
          className="mtext-ok"
          title="Close Text Editor (Ctrl+Enter)"
          onClick={finish}
        >
          OK
        </button>
      </div>
      <div
        ref={root}
        // Width 0 is MTEXT's "no wrapping" (a multileader's text, M2-09): lines run on.
        className={request.width > 0 ? 'mtext-content' : 'mtext-content no-wrap'}
        role="textbox"
        aria-multiline="true"
        aria-label="Multiline text"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        style={{
          transform: style.transform,
          fontSize: style.fontSize,
          ...(request.width > 0 && { width: style.width }),
        }}
      />
    </div>
  );
}
