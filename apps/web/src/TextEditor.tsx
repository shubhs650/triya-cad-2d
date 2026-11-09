// The in-place text editors (M2-07): where the drawing's TEXT or MTEXT command asks for its
// text, the editor opens on the canvas at the text's place, turned and sized as the text will
// be. TEXT takes one line per Enter, as AutoCAD's in-place TEXT editor does (an empty line ends
// it). MTEXT's editor carries AutoCAD's Text Formatting toolbar (UI_SPEC.md §7: Bold, Italic,
// Underline, Overline, Strikethrough, Stack, Color, Height, OK); Ctrl+Enter or a click outside
// it keeps the text, Esc drops it. Its contents are formatted spans, written as MTEXT format
// codes (`writeMText`) when it closes. Fonts, fields and columns come with M2-07's leftovers.
//
// The editor's DOM is the record of what was typed: plain runs as <span data-fmt>, paragraph
// breaks as <br>, stacks as uneditable <span data-stack>. Typing, pasting, Enter and the
// toolbar are applied to the spans (text-editor.ts) and the DOM repainted from them, so the
// DOM never takes a shape the spans cannot hold.
import type { StringPrompt, TextEditorRequest } from '@triya/engine';
import { aciRgb, worldToScreen } from '@triya/render';
import { styleFont, writeMText, type MTextFormat, type MTextSpan } from '@triya/text';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { controllerOf } from './canvas/registry';
import type { CanvasController } from './canvas/controller';
import { commandLines } from './command-line';
import { engines } from './engine/registry';
import {
  formatAt,
  formatRange,
  hasFormat,
  insertSpans,
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

export function TextEditor({ doc }: { doc: { id: number; block: string } | undefined }) {
  useSyncExternalStore(commandLines.subscribe, commandLines.version);
  const prompt = doc ? commandLines.get(doc.id).prompt : undefined;
  const request = prompt?.kind === 'string' ? (prompt as StringPrompt).editor : undefined;
  const controller = doc && request ? controllerOf(doc.id, doc.block) : undefined;
  if (!doc || !request || !controller) return null;
  // TEXT's line editor is one input for all the lines, so typing runs on while the engine
  // places a line and asks for the next.
  const key = request.kind === 'text' ? 'text' : JSON.stringify(request);
  return request.kind === 'text' ? (
    <TextLine key={key} doc={doc.id} request={request} controller={controller} />
  ) : (
    <MTextBox key={key} doc={doc.id} request={request} controller={controller} />
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
  const [value, setValue] = useState('');
  return (
    <div className="text-editor text-line" style={boxStyle(placement, request)}>
      <input
        aria-label="Text"
        autoFocus
        value={value}
        size={Math.max(4, value.length + 1)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
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
      nodes.push(document.createElement('br'));
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
  const walk = (node: Node, format: MTextFormat): void => {
    for (const child of node.childNodes) {
      if (child instanceof Text) {
        const parts = child.data.replace(/\r/g, '').split('\n');
        parts.forEach((text, i) => {
          if (i > 0) out.push({ type: 'break' });
          out.push({ type: 'text', text, format });
        });
      } else if (!(child instanceof HTMLElement) || isFiller(child)) {
        continue;
      } else if (child.tagName === 'BR') {
        out.push({ type: 'break' });
      } else if (isAtom(child)) {
        const data = child.dataset['stack'] ?? child.dataset['field']!;
        out.push(JSON.parse(data) as MTextSpan);
      } else {
        // A block the browser made is a paragraph.
        const block = child.tagName === 'DIV' || child.tagName === 'P';
        if (block && out.length > 0 && out.at(-1)?.type !== 'break') out.push({ type: 'break' });
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
}: {
  doc: number;
  request: TextEditorRequest;
  controller: CanvasController;
}) {
  const placement = usePlacement(controller, request);
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const font = styleFont({ font: request.fontFile, trueTypeFlags: request.trueTypeFlags });
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
    const value = writeMText(spans(), font);
    engines.command(doc, { kind: 'answer', answer: { kind: 'string', value, editor: true } });
  };

  useEffect(() => {
    const el = root.current!;
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
      commit(next, a + len);
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
          replace([{ type: 'break' }]);
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
  const ttf = font.kind === 'ttf';

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
