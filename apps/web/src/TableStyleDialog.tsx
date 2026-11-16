// TABLESTYLE's Table Style dialog (M4-05 part 5), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Table Style Dialog Box", "Create New Table Style Dialog Box", "New and Modify
// Table Style Dialog Boxes"; UI_SPEC.md §7):
//
//   Current table style: <name>
//   Styles | Preview of: <name>                 | Set Current
//   List   | Description                        | New...  Modify...  Delete
//                                                                    Close
//
// New... asks the New Style Name and the style to Start With, then opens New Table Style on its
// settings; Modify... opens Modify Table Style. That dialog has the table direction, a preview,
// the Cell styles list (Data, Header, Title) and the chosen cell style's General, Text and
// Borders tabs; OK sends the settings and the engine opens the Table Style dialog again. The
// list's shortcut menu (right-click, Shift+F10 or the menu key) has Set current, Rename and
// Delete; F2 renames and Delete deletes, as in a Windows list. Close (and Esc) closes it,
// everything done being one undo step.
//
// Shown greyed, for the reasons the engine gives (commands/tablestyle.ts): Select table to start
// from, Create and Manage Cell Styles (M1-99), Format, Type, Merge cells on row/column creation,
// Text angle, the border Linetype, Double line and Spacing (the file's table style has no place
// for them), and Help, as Triya's other dialogs leave it. The margins are the style's, the same
// on each cell style. Colours are index colours, which a DXF table style holds.
import {
  LINEWEIGHTS,
  TABLE_CELL_STYLES,
  tableStylePreview,
  tableStyleProblem,
  type Color,
  type DialogRequest,
  type Lineweight,
  type PromptAnswer,
  type TableCellBorder,
  type TableCellStyleName,
  type TableCellStyleSettings,
  type TableStyleAction,
  type TableStyleSettings,
} from '@triya/engine';
import { aciRgb } from '@triya/render';
import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'tablestyle' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const CELL_LABELS: Readonly<Record<TableCellStyleName, string>> = {
  data: 'Data',
  header: 'Header',
  title: 'Title',
};

const ALIGNMENTS = [
  'Top Left',
  'Top Center',
  'Top Right',
  'Middle Left',
  'Middle Center',
  'Middle Right',
  'Bottom Left',
  'Bottom Center',
  'Bottom Right',
];

const ACI_NAMES = ['', 'Red', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta', 'White'];

/** A colour as a list value: `byBlock`, `byLayer`, `aci:n`; `none` for no fill. */
const colorValue = (c: Color | null): string =>
  c === null ? 'none' : c.kind === 'aci' ? `aci:${c.index}` : c.kind === 'rgb' ? 'rgb' : c.kind;

const colorOf = (v: string): Color | null =>
  v === 'none'
    ? null
    : v === 'byBlock' || v === 'byLayer'
      ? { kind: v }
      : { kind: 'aci', index: Number(v.slice(4)) };

/** ByBlock, ByLayer and the seven named colours, with `current` when it is another. */
function colorOptions(current: Color | null, none: boolean): [string, string][] {
  const out: [string, string][] = none ? [['none', 'None']] : [];
  out.push(['byBlock', 'ByBlock'], ['byLayer', 'ByLayer']);
  for (let n = 1; n <= 7; n++) out.push([`aci:${n}`, ACI_NAMES[n]!]);
  const v = colorValue(current);
  if (!out.some(([k]) => k === v)) {
    out.push([v, current?.kind === 'aci' ? `Color ${current.index}` : 'True color']);
  }
  return out;
}

const lineweightLabel = (w: Lineweight): string =>
  typeof w === 'number' ? `${(w / 100).toFixed(2)} mm` : String(w);

const LINEWEIGHT_OPTIONS: readonly Lineweight[] = ['ByBlock', 'ByLayer', ...LINEWEIGHTS];

/** AutoCAD's next free `Copy of <name>` name. */
function copyName(names: readonly string[], from: string): string {
  const taken = new Set(names.map((n) => n.toUpperCase()));
  let name = `Copy of ${from}`;
  for (let n = 2; taken.has(name.toUpperCase()); n++) name = `Copy of ${from} (${n})`;
  return name;
}

export function TableStyleDialog({ doc, request }: { doc: number; request: Request }) {
  const [selected, setSelected] = useState(request.selected);
  const [list, setList] = useState<'all' | 'used'>('all');
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [naming, setNaming] = useState(false);
  const [editing, setEditing] = useState<{ name: string; from: string; isNew: boolean }>();
  const id = useId();

  const send = (tablestyle: TableStyleAction) =>
    answer(doc, { kind: 'dialog', action: 'apply', tablestyle });
  const close = () => answer(doc, { kind: 'dialog', action: 'ok' });
  const styles = request.styles.filter(
    (s) => list === 'all' || s.used || s.name === request.current,
  );
  const style = request.styles.find((s) => s.name === selected);

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const names = styles.map((s) => s.name);
      const i = names.indexOf(selected);
      const next =
        names[Math.max(0, Math.min(names.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) setSelected(next);
    } else if (e.key === 'F2' && style) {
      e.preventDefault();
      setRenaming(style.name);
    } else if (e.key === 'Delete' && style) {
      e.preventDefault();
      void send({ op: 'delete', name: style.name });
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = (e.target as HTMLElement).getBoundingClientRect();
      setMenu({ x: r.left + 16, y: r.top + 16 });
    }
  };
  const contextMenu = (e: MouseEvent, name: string) => {
    e.preventDefault();
    setSelected(name);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const editorFrom = editing && request.styles.find((s) => s.name === editing.from);

  return (
    <Modal label="Table Style" className="tablestyle-dialog" onOk={close} onCancel={close}>
      <p className="dimstyle-current">
        Current table style: <strong data-testid="tablestyle-current">{request.current}</strong>
      </p>
      <div className="dimstyle-body">
        <div className="dimstyle-left">
          <span id={`${id}-styles`}>Styles:</span>
          <ul
            role="listbox"
            aria-labelledby={`${id}-styles`}
            className="dimstyle-list"
            tabIndex={0}
            onKeyDown={keys}
          >
            {styles.map((s) => (
              <li
                key={s.name}
                role="option"
                aria-selected={s.name === selected}
                onClick={() => setSelected(s.name)}
                onDoubleClick={() => setRenaming(s.name)}
                onContextMenu={(e) => contextMenu(e, s.name)}
              >
                {renaming === s.name ? (
                  <RenameInput
                    name={s.name}
                    onDone={(to) => {
                      setRenaming(undefined);
                      if (to !== undefined && to !== s.name)
                        void send({ op: 'rename', name: s.name, to });
                    }}
                  />
                ) : (
                  <>
                    {s.name === request.current && <span aria-label="current">▸ </span>}
                    {s.name}
                  </>
                )}
              </li>
            ))}
          </ul>
          <label className="cad-dialog-field">
            <span className="visually-hidden">List</span>
            <select
              aria-label="List"
              value={list}
              onChange={(e) => setList(e.target.value as 'all' | 'used')}
            >
              <option value="all">All styles</option>
              <option value="used">Styles in use</option>
            </select>
          </label>
        </div>
        <div className="dimstyle-right">
          <span>Preview of: {style?.name ?? ''}</span>
          {style && <TablePreview settings={style.settings} label={`Preview of ${style.name}`} />}
          <span>Description</span>
          <p className="dimstyle-description" data-testid="tablestyle-description">
            {style?.settings.description ?? ''}
          </p>
        </div>
        <div className="dimstyle-buttons">
          <button
            type="button"
            disabled={!style || style.name === request.current}
            onClick={() => style && void send({ op: 'current', name: style.name })}
          >
            Set Current
          </button>
          <button
            type="button"
            disabled={request.styles.length === 0}
            onClick={() => setNaming(true)}
          >
            New...
          </button>
          <button
            type="button"
            disabled={!style}
            onClick={() =>
              style && setEditing({ name: style.name, from: style.name, isNew: false })
            }
          >
            Modify...
          </button>
          <button
            type="button"
            disabled={!style}
            onClick={() => style && void send({ op: 'delete', name: style.name })}
          >
            Delete
          </button>
        </div>
      </div>
      {request.note !== undefined && (
        <p className="dimstyle-note" role="status">
          {request.note}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
      {menu && style && (
        <div
          role="menu"
          aria-label="Style"
          className="dimstyle-menu"
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setMenu(undefined);
            }
          }}
          onMouseLeave={() => setMenu(undefined)}
        >
          {(
            [
              ['Set current', () => void send({ op: 'current', name: style.name })],
              ['Rename', () => setRenaming(style.name)],
              ['Delete', () => void send({ op: 'delete', name: style.name })],
            ] as const
          ).map(([label, act]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(undefined);
                act();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {naming && style && (
        <CreateNewTableStyle
          suggested={copyName(
            request.styles.map((s) => s.name),
            style.name,
          )}
          styles={request.styles.map((s) => s.name)}
          startWith={style.name}
          onCancel={() => setNaming(false)}
          onContinue={(name, from) => {
            setNaming(false);
            setEditing({ name, from, isNew: true });
          }}
        />
      )}
      {editing && editorFrom && (
        <TableStyleEditor
          title={`${editing.isNew ? 'New' : 'Modify'} Table Style: ${editing.name}`}
          settings={editorFrom.settings}
          textStyles={request.textStyles}
          onCancel={() => setEditing(undefined)}
          onOk={(settings) => {
            setEditing(undefined);
            void send(
              editing.isNew
                ? { op: 'new', name: editing.name, settings }
                : { op: 'modify', name: editing.name, settings },
            );
          }}
        />
      )}
    </Modal>
  );
}

/** "Create New Table Style": New Style Name, Start With, Continue, Cancel. */
function CreateNewTableStyle(props: {
  suggested: string;
  styles: readonly string[];
  startWith: string;
  onCancel: () => void;
  onContinue: (name: string, from: string) => void;
}) {
  const [name, setName] = useState(props.suggested);
  const [from, setFrom] = useState(props.startWith);
  const ok = () => name.trim() !== '' && props.onContinue(name.trim(), from);
  return (
    <Modal label="Create New Table Style" onOk={ok} onCancel={props.onCancel}>
      <label className="cad-dialog-field">
        <span>New Style Name:</span>
        <input
          type="text"
          autoFocus
          value={name}
          maxLength={255}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="cad-dialog-field">
        <span>Start With:</span>
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          {props.styles.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" disabled={name.trim() === ''} onClick={ok}>
          Continue
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

type Tab = 'general' | 'text' | 'borders';
const TABS: readonly [Tab, string][] = [
  ['general', 'General'],
  ['text', 'Text'],
  ['borders', 'Borders'],
];

/** The border buttons: which edges (top, inside horizontal, bottom, left, inside vertical, right). */
const BORDER_SETS: readonly [string, readonly number[]][] = [
  ['All Borders', [0, 1, 2, 3, 4, 5]],
  ['Outside Borders', [0, 2, 3, 5]],
  ['Inside Borders', [1, 4]],
  ['Bottom Border', [2]],
  ['Left Border', [3]],
  ['Top Border', [0]],
  ['Right Border', [5]],
  ['No Borders', []],
];

/** The New and Modify Table Style dialog. */
function TableStyleEditor(props: {
  title: string;
  settings: TableStyleSettings;
  textStyles: readonly string[];
  onOk: (s: TableStyleSettings) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(props.settings);
  const [cellStyle, setCellStyle] = useState<TableCellStyleName>('data');
  const [tab, setTab] = useState<Tab>('general');
  const c = s[cellStyle];
  const first = c.borders.find((b) => b.visible) ?? c.borders[0]!;
  const [lineweight, setLineweight] = useState<Lineweight>(first.lineweight);
  const [borderColor, setBorderColor] = useState<Color>(first.color);
  const problem = tableStyleProblem(s, props.textStyles);
  const set = (patch: Partial<TableCellStyleSettings>) =>
    setS({ ...s, [cellStyle]: { ...c, ...patch } });
  const ok = () => !problem && props.onOk(s);
  const borders = (edges: readonly number[]) => {
    const none = edges.length === 0;
    set({
      borders: c.borders.map((b, k): TableCellBorder =>
        none
          ? { ...b, visible: false }
          : edges.includes(k)
            ? { lineweight, color: borderColor, visible: true }
            : b,
      ),
    });
  };
  return (
    <Modal label={props.title} className="tablestyle-editor" onOk={ok} onCancel={props.onCancel}>
      <div className="tablestyle-editor-body">
        <div className="tablestyle-editor-left">
          <fieldset>
            <legend>Starting table</legend>
            <button type="button" disabled title="Not available yet">
              Select table to start from
            </button>
          </fieldset>
          <fieldset>
            <legend>General</legend>
            <label className="cad-dialog-field">
              <span>Table direction:</span>
              <select
                value={s.up ? 'up' : 'down'}
                onChange={(e) => setS({ ...s, up: e.target.value === 'up' })}
              >
                <option value="down">Down</option>
                <option value="up">Up</option>
              </select>
            </label>
          </fieldset>
          <TablePreview settings={s} label="Table preview" />
        </div>
        <div className="tablestyle-editor-right">
          <fieldset>
            <legend>Cell styles</legend>
            <label className="cad-dialog-field">
              <span className="visually-hidden">Cell styles</span>
              <select
                aria-label="Cell styles"
                value={cellStyle}
                onChange={(e) => {
                  const n = e.target.value as TableCellStyleName;
                  const b = s[n].borders.find((x) => x.visible) ?? s[n].borders[0]!;
                  setCellStyle(n);
                  setLineweight(b.lineweight);
                  setBorderColor(b.color);
                }}
              >
                {TABLE_CELL_STYLES.map((n) => (
                  <option key={n} value={n}>
                    {CELL_LABELS[n]}
                  </option>
                ))}
              </select>
            </label>
            <div role="tablist" className="cad-dialog-tabs">
              {TABS.map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              className="cad-dialog-panel tablestyle-tab"
              aria-label={TABS.find(([t]) => t === tab)![1]}
            >
              {tab === 'general' && (
                <>
                  <fieldset>
                    <legend>Properties</legend>
                    <ColorField
                      label="Fill color"
                      value={c.fill}
                      none
                      onChange={(fill) => set({ fill })}
                    />
                    <label className="cad-dialog-field">
                      <span>Alignment:</span>
                      <select
                        value={c.alignment}
                        onChange={(e) => set({ alignment: Number(e.target.value) })}
                      >
                        {ALIGNMENTS.map((a, k) => (
                          <option key={a} value={k + 1}>
                            {a}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="cad-dialog-field">
                      <span>Format:</span>
                      <button type="button" disabled>
                        General
                      </button>
                    </label>
                    <label className="cad-dialog-field">
                      <span>Type:</span>
                      <select disabled value={cellStyle === 'data' ? 'Data' : 'Label'}>
                        <option>Data</option>
                        <option>Label</option>
                      </select>
                    </label>
                  </fieldset>
                  <fieldset>
                    <legend>Margins</legend>
                    <NumberField
                      label="Horizontal"
                      value={s.horizontalMargin}
                      onChange={(horizontalMargin) => setS({ ...s, horizontalMargin })}
                    />
                    <NumberField
                      label="Vertical"
                      value={s.verticalMargin}
                      onChange={(verticalMargin) => setS({ ...s, verticalMargin })}
                    />
                  </fieldset>
                  <label className="cad-dialog-check">
                    <input type="checkbox" disabled checked={cellStyle === 'title'} readOnly />
                    Merge cells on row/column creation
                  </label>
                </>
              )}
              {tab === 'text' && (
                <fieldset>
                  <legend>Properties</legend>
                  <label className="cad-dialog-field">
                    <span>Text style:</span>
                    <select
                      value={c.textStyle}
                      onChange={(e) => set({ textStyle: e.target.value })}
                    >
                      {!props.textStyles.includes(c.textStyle) && <option>{c.textStyle}</option>}
                      {props.textStyles.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    label="Text height"
                    value={c.textHeight}
                    onChange={(textHeight) => set({ textHeight })}
                  />
                  <ColorField
                    label="Text color"
                    value={c.textColor}
                    onChange={(textColor) => textColor && set({ textColor })}
                  />
                  <label className="cad-dialog-field">
                    <span>Text angle:</span>
                    <input type="text" disabled value="0" readOnly />
                  </label>
                </fieldset>
              )}
              {tab === 'borders' && (
                <fieldset>
                  <legend>Properties</legend>
                  <label className="cad-dialog-field">
                    <span>Lineweight:</span>
                    <select
                      value={String(lineweight)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLineweight(v === 'ByBlock' || v === 'ByLayer' ? v : Number(v));
                      }}
                    >
                      {LINEWEIGHT_OPTIONS.map((w) => (
                        <option key={String(w)} value={String(w)}>
                          {lineweightLabel(w)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cad-dialog-field">
                    <span>Linetype:</span>
                    <select disabled value="ByBlock">
                      <option>ByBlock</option>
                    </select>
                  </label>
                  <ColorField
                    label="Color"
                    value={borderColor}
                    onChange={(v) => v && setBorderColor(v)}
                  />
                  <label className="cad-dialog-check">
                    <input type="checkbox" disabled readOnly checked={false} />
                    Double line
                  </label>
                  <label className="cad-dialog-field">
                    <span>Spacing:</span>
                    <input type="text" disabled value="0.045" readOnly />
                  </label>
                  <div className="tablestyle-borders" role="group" aria-label="Borders">
                    {BORDER_SETS.map(([label, edges]) => (
                      <button key={label} type="button" onClick={() => borders(edges)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="tablestyle-hint">
                    Choose the properties, then a border button to apply them.
                  </p>
                </fieldset>
              )}
            </div>
          </fieldset>
        </div>
      </div>
      {problem !== undefined && (
        <p className="dimstyle-note" role="status">
          {problem}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" disabled={!!problem} onClick={ok}>
          OK
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function ColorField(props: {
  label: string;
  value: Color | null;
  none?: boolean;
  onChange: (c: Color | null) => void;
}) {
  return (
    <label className="cad-dialog-field">
      <span>{props.label}:</span>
      <select
        value={colorValue(props.value)}
        onChange={(e) => props.onChange(colorOf(e.target.value))}
      >
        {colorOptions(props.value, !!props.none).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A CSS colour for `c` in the preview; ByBlock and ByLayer draw in the text colour. */
function cssColor(c: Color | undefined): string {
  if (!c || c.kind === 'byBlock' || c.kind === 'byLayer') return 'currentColor';
  if (c.kind === 'rgb') return `rgb(${c.r},${c.g},${c.b})`;
  // ACI 7 follows the background, as on the canvas.
  if (c.index === 7) return 'currentColor';
  const [r, g, b] = aciRgb(c.index);
  return `rgb(${r},${g},${b})`;
}

const ANCHORS = ['start', 'middle', 'end'] as const;
const BASELINES = ['hanging', 'central', 'alphabetic'] as const;

/** The style's sample table, drawn by the table engine (lines, fills and the cells' words). */
function TablePreview({ settings, label }: { settings: TableStyleSettings; label: string }) {
  const p = tableStylePreview(settings);
  const pad = p.width * 0.04;
  const h = p.maxY - p.minY;
  return (
    <svg
      className="tablestyle-preview"
      role="img"
      aria-label={label}
      data-testid="tablestyle-preview"
      viewBox={`${-pad} ${-p.maxY - pad} ${p.width + 2 * pad} ${h + 2 * pad}`}
    >
      {p.parts.map((part, k) => {
        const g = part.geom;
        const color = cssColor(part.color);
        if (g.kind === 'LINE') {
          const w = typeof part.lineweight === 'number' ? Math.max(1, part.lineweight / 25) : 1;
          return (
            <line
              key={k}
              x1={g.start.x}
              y1={-g.start.y}
              x2={g.end.x}
              y2={-g.end.y}
              stroke={color}
              strokeWidth={w}
              vectorEffect="non-scaling-stroke"
            />
          );
        }
        if (g.kind === 'SOLID') {
          const [a, b, c, d] = g.corners;
          const pts = [a, b, d, c].map((q) => `${q!.x},${-q!.y}`).join(' ');
          return <polygon key={k} points={pts} fill={color} opacity={0.6} />;
        }
        if (g.kind === 'MTEXT') {
          const at = Math.min(Math.max(g.attachment, 1), 9) - 1;
          return (
            <text
              key={k}
              x={g.position.x}
              y={-g.position.y}
              fontSize={g.height}
              fill={color}
              textAnchor={ANCHORS[at % 3]}
              dominantBaseline={BASELINES[Math.floor(at / 3)]}
            >
              {g.contents}
            </text>
          );
        }
        return null;
      })}
    </svg>
  );
}

function RenameInput({ name, onDone }: { name: string; onDone: (to?: string) => void }) {
  const [text, setText] = useState(name);
  return (
    <input
      type="text"
      aria-label="New name"
      autoFocus
      value={text}
      maxLength={255}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text.trim())}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onDone(text.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onDone(undefined);
        }
      }}
    />
  );
}

/** A typed number, set as each keystroke makes one; text that is not one shows until blur. */
function NumberField(props: { label: string; value: number; onChange: (v: number) => void }) {
  const shown = String(Number(props.value.toPrecision(10)));
  const [text, setText] = useState<string>();
  return (
    <label className="cad-dialog-field">
      <span>{props.label}:</span>
      <input
        type="text"
        inputMode="decimal"
        value={text ?? shown}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(v)) props.onChange(v);
        }}
        onBlur={() => setText(undefined)}
      />
    </label>
  );
}
