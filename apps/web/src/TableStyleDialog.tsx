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
// Select table to start from (M4-16 part 4) sends the settings being edited; the engine asks
// "Select a table:" with the dialogs hidden and opens this dialog again with the New or Modify
// Table Style dialog on the table's formatting (`request.editing`).
//
// Cell styles of the drafter's own (M4-16 part 9): the Cell styles list has them after Data,
// Header and Title, then "Create new cell style..." and "Manage cell styles...", which the two
// buttons beside it open too: Create New Cell Style (New Style Name, Start With, Continue) and
// Manage Cell Styles (the cell styles, New..., Rename, Delete; Title, Header and Data cannot be
// renamed or deleted, nor one a table is on). They change the settings being edited, which OK
// sends.
//
// Shown greyed, for the reasons the engine gives (commands/tablestyle.ts): Remove Table (no
// table is kept in the style), Format, Type, Merge cells on row/column creation,
// Text angle (the file's table style has no place for them), and Help, as Triya's other dialogs
// leave it. The margins are the style's, the same on each cell style. Colours are index colours,
// which a DXF table style holds.
//
// The Borders tab's Linetype (ByBlock, ByLayer and the drawing's linetypes; Other... waits for
// M5-08's linetype loading), Double line and Spacing (greyed unless Double line is on) are
// applied with the other properties by a border button (M4-16 part 8).
import {
  LINEWEIGHTS,
  TABLE_CELL_STYLES,
  lineweightText,
  cellStyleNameProblem,
  tableStylePreview,
  tableStyleProblem,
  type Color,
  type DialogRequest,
  type Lineweight,
  type LineweightUnits,
  type PromptAnswer,
  type TableCellBorder,
  type TableCellStyleSettings,
  type TableStyleAction,
  type TableStyleEditing,
  type TableStyleSettings,
} from '@triya/engine';
import { aciRgb } from '@triya/render';
import { useEffect, useId, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';
import { useLineweightUnits } from './lineweight-units';

type Request = Extract<DialogRequest, { type: 'tablestyle' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** One of the three cell styles every table style holds. */
type StyleCell = (typeof TABLE_CELL_STYLES)[number];

/** The cell style the editor shows: one of the three, or a cell style of the drafter's own by its place in the list. */
type Shown = StyleCell | number;

const CELL_LABELS: Readonly<Record<StyleCell, string>> = {
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

const LINEWEIGHT_OPTIONS: readonly Lineweight[] = ['ByBlock', 'ByLayer', ...LINEWEIGHTS];

/** The Borders tab's Lineweight list, in LWUNITS' units as AutoCAD lists it (M5-12). */
export function tableLineweightOptions(units: LineweightUnits): { value: string; label: string }[] {
  return LINEWEIGHT_OPTIONS.map((w) => ({ value: String(w), label: lineweightText(w, units) }));
}

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
  const [editing, setEditing] = useState<TableStyleEditing>();
  // Opened after this dialog, so that New or Modify Table Style shows above it (each modal
  // opens on top of those before it).
  useEffect(() => {
    if (request.editing) setEditing(request.editing);
  }, [request.editing]);
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
              style && setEditing({ name: style.name, isNew: false, settings: style.settings })
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
            const settings = request.styles.find((s) => s.name === from)?.settings;
            setNaming(false);
            if (settings) setEditing({ name, isNew: true, settings });
          }}
        />
      )}
      {editing && (
        <TableStyleEditor
          title={`${editing.isNew ? 'New' : 'Modify'} Table Style: ${editing.name}`}
          settings={editing.settings}
          textStyles={request.textStyles}
          linetypes={request.linetypes}
          doubleSpacing={request.doubleSpacing}
          usedCellStyles={
            editing.isNew
              ? []
              : (request.styles.find((s) => s.name === editing.name)?.usedCellStyles ?? [])
          }
          onCancel={() => setEditing(undefined)}
          onStart={(settings) => {
            setEditing(undefined);
            void send({ op: 'start', ...editing, settings });
          }}
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
  linetypes: Request['linetypes'];
  /** Spacing's value for a border not yet double. */
  doubleSpacing: number;
  /** The ids of the style's cell styles of the drafter's own a table is on (not deleted). */
  usedCellStyles: readonly number[];
  onOk: (s: TableStyleSettings) => void;
  onCancel: () => void;
  /** Select table to start from, with the settings as they stand. */
  onStart: (s: TableStyleSettings) => void;
}) {
  const [s, setS] = useState(props.settings);
  const [cellStyle, setCellStyle] = useState<Shown>('data');
  const [tab, setTab] = useState<Tab>('general');
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const lwUnits = useLineweightUnits();
  const own = s.userCellStyles ?? [];
  const cellOf = (n: Shown, from = s): TableCellStyleSettings =>
    typeof n === 'number' ? from.userCellStyles![n]!.settings : from[n];
  const c = cellOf(cellStyle);
  const first = c.borders.find((b) => b.visible) ?? c.borders[0]!;
  const [lineweight, setLineweight] = useState<Lineweight>(first.lineweight);
  const [borderColor, setBorderColor] = useState<Color>(first.color);
  // The Linetype list's value: '' ByBlock (no linetype), 'ByLayer' or a linetype's handle.
  const [linetype, setLinetype] = useState<string>(first.linetype ?? '');
  const [double, setDouble] = useState(first.double === true);
  const [spacing, setSpacing] = useState(String(first.spacing ?? props.doubleSpacing));
  const showBorder = (b: TableCellBorder) => {
    setLineweight(b.lineweight);
    setBorderColor(b.color);
    setLinetype(b.linetype ?? '');
    setDouble(b.double === true);
    setSpacing(String(b.spacing ?? props.doubleSpacing));
  };
  const handles = props.linetypes.map((l) => l.handle);
  const problem = tableStyleProblem(s, props.textStyles, handles);
  const set = (patch: Partial<TableCellStyleSettings>) =>
    setS(
      typeof cellStyle === 'number'
        ? {
            ...s,
            userCellStyles: own.map((u, k) =>
              k === cellStyle ? { ...u, settings: { ...c, ...patch } } : u,
            ),
          }
        : { ...s, [cellStyle]: { ...c, ...patch } },
    );
  /** Shows cell style `n` of settings `from`, its first border's properties on the Borders tab. */
  const show = (n: Shown, from = s) => {
    const cell = cellOf(n, from);
    setCellStyle(n);
    showBorder(cell.borders.find((x) => x.visible) ?? cell.borders[0]!);
  };
  const cellNames = [...TABLE_CELL_STYLES.map((n) => CELL_LABELS[n]), ...own.map((u) => u.name)];
  /** The cell styles as Start With lists them, each with its settings. */
  const startWith: [string, TableCellStyleSettings][] = [
    ...TABLE_CELL_STYLES.map((n): [string, TableCellStyleSettings] => [CELL_LABELS[n], s[n]]),
    ...own.map((u): [string, TableCellStyleSettings] => [u.name, u.settings]),
  ];
  const shownName = typeof cellStyle === 'number' ? own[cellStyle]!.name : CELL_LABELS[cellStyle];
  const ok = () => !problem && props.onOk(s);
  const borders = (edges: readonly number[]) => {
    const none = edges.length === 0;
    set({
      borders: c.borders.map((b, k): TableCellBorder =>
        none
          ? { ...b, visible: false }
          : edges.includes(k)
            ? {
                lineweight,
                color: borderColor,
                visible: true,
                ...(linetype !== '' && { linetype }),
                ...(double && { double: true as const, spacing: Number(spacing) }),
              }
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
            <button type="button" onClick={() => props.onStart(s)}>
              Select table to start from
            </button>
            <button type="button" disabled title="No table is kept in the style">
              Remove Table
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
            <div className="tablestyle-cell-styles">
              <label className="cad-dialog-field">
                <span className="visually-hidden">Cell styles</span>
                <select
                  aria-label="Cell styles"
                  value={String(cellStyle)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'create') setCreating(true);
                    else if (v === 'manage') setManaging(true);
                    else show(/^\d+$/.test(v) ? Number(v) : (v as StyleCell));
                  }}
                >
                  {TABLE_CELL_STYLES.map((n) => (
                    <option key={n} value={n}>
                      {CELL_LABELS[n]}
                    </option>
                  ))}
                  {own.map((u, k) => (
                    <option key={`own-${k}`} value={k}>
                      {u.name}
                    </option>
                  ))}
                  <option value="create">Create new cell style...</option>
                  <option value="manage">Manage cell styles...</option>
                </select>
              </label>
              <button
                type="button"
                aria-label="Create a new cell style"
                title="Create a new cell style"
                onClick={() => setCreating(true)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="1.5" y="3.5" width="9" height="9" fill="none" stroke="currentColor" />
                  <path d="M13 1v6M10 4h6" stroke="currentColor" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Manage cell style list"
                title="Manage Cell Styles dialog"
                onClick={() => setManaging(true)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="1.5" y="1.5" width="13" height="13" fill="none" stroke="currentColor" />
                  <path d="M1.5 6h13M1.5 10.5h13M6 1.5v13" stroke="currentColor" />
                </svg>
              </button>
            </div>
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
                      <select
                        disabled
                        value={cellStyle === 'title' || cellStyle === 'header' ? 'Label' : 'Data'}
                      >
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
                      {tableLineweightOptions(lwUnits).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cad-dialog-field">
                    <span>Linetype:</span>
                    <select value={linetype} onChange={(e) => setLinetype(e.target.value)}>
                      <option value="">ByBlock</option>
                      <option value="ByLayer">ByLayer</option>
                      {props.linetypes.map((l) => (
                        <option key={l.handle} value={l.handle}>
                          {l.name}
                        </option>
                      ))}
                      {linetype !== '' && linetype !== 'ByLayer' && !handles.includes(linetype) && (
                        <option value={linetype}>{linetype}</option>
                      )}
                    </select>
                  </label>
                  <ColorField
                    label="Color"
                    value={borderColor}
                    onChange={(v) => v && setBorderColor(v)}
                  />
                  <label className="cad-dialog-check">
                    <input
                      type="checkbox"
                      checked={double}
                      onChange={(e) => setDouble(e.target.checked)}
                    />
                    Double line
                  </label>
                  <label className="cad-dialog-field">
                    <span>Spacing:</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      disabled={!double}
                      value={spacing}
                      onChange={(e) => setSpacing(e.target.value)}
                    />
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
      {creating && (
        <CreateNewCellStyle
          names={cellNames}
          startWith={startWith}
          from={shownName}
          onCancel={() => setCreating(false)}
          onContinue={(name, settings) => {
            setCreating(false);
            const next = { ...s, userCellStyles: [...own, { name, settings }] };
            setS(next);
            show(own.length, next);
          }}
        />
      )}
      {managing && (
        <ManageCellStyles
          own={own}
          startWith={startWith}
          from={shownName}
          used={props.usedCellStyles}
          onCancel={() => setManaging(false)}
          onOk={(kept) => {
            setManaging(false);
            const { userCellStyles: _, ...rest } = s;
            const next = kept.length > 0 ? { ...rest, userCellStyles: kept } : rest;
            setS(next);
            // The cell style shown stays shown where it is kept, else Data.
            const shown = typeof cellStyle === 'number' ? own[cellStyle] : undefined;
            const at = shown ? kept.indexOf(shown) : -1;
            const was =
              shown && at < 0 ? kept.findIndex((u) => u.id !== undefined && u.id === shown.id) : at;
            show(shown ? (was >= 0 ? was : 'data') : cellStyle, next);
          }}
        />
      )}
    </Modal>
  );
}

type OwnCellStyle = NonNullable<TableStyleSettings['userCellStyles']>[number];

/**
 * "Create New Cell Style": New Style Name and Start With (the cell styles of the table style
 * being edited), Continue and Cancel (AutoCAD Help, "Create New Cell Style Dialog Box").
 */
function CreateNewCellStyle(props: {
  /** The cell styles' names, which the new one cannot take. */
  names: readonly string[];
  startWith: readonly [string, TableCellStyleSettings][];
  /** The cell style shown, which Start With starts on. */
  from: string;
  onCancel: () => void;
  onContinue: (name: string, settings: TableCellStyleSettings) => void;
}) {
  const [name, setName] = useState(() => copyName(props.names, props.from));
  const [from, setFrom] = useState(props.from);
  const problem = cellStyleNameProblem(name.trim(), props.names);
  const ok = () => {
    const settings = props.startWith.find(([n]) => n === from)?.[1];
    if (!problem && settings) props.onContinue(name.trim(), settings);
  };
  return (
    <Modal label="Create New Cell Style" onOk={ok} onCancel={props.onCancel}>
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
          {props.startWith.map(([n]) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      {problem !== undefined && name.trim() !== '' && (
        <p className="dimstyle-note" role="status">
          {problem}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" disabled={!!problem} onClick={ok}>
          Continue
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/**
 * "Manage Cell Styles": the table style's cell styles, with New..., Rename and Delete for those
 * of the drafter's own (AutoCAD Help, "Manage Cell Styles Dialog Box"); Title, Header and Data
 * are always in a table style, and one a table is on is not deleted. OK keeps the changes.
 */
function ManageCellStyles(props: {
  own: readonly OwnCellStyle[];
  startWith: readonly [string, TableCellStyleSettings][];
  from: string;
  used: readonly number[];
  onCancel: () => void;
  onOk: (own: OwnCellStyle[]) => void;
}) {
  const [own, setOwn] = useState<OwnCellStyle[]>([...props.own]);
  // The selected list entry: 0–2 Title, Header, Data; 3 on the drafter's own.
  const [selected, setSelected] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string>();
  const fixed = ['Title', 'Header', 'Data'];
  const names = [...fixed, ...own.map((u) => u.name)];
  const mine = selected >= fixed.length ? own[selected - fixed.length] : undefined;
  const inUse = mine?.id !== undefined && props.used.includes(mine.id);
  const startWith: [string, TableCellStyleSettings][] = [
    ...props.startWith.filter(([n]) => fixed.includes(n)),
    ...own.map((u): [string, TableCellStyleSettings] => [u.name, u.settings]),
  ];
  const rename = (to: string | undefined) => {
    setRenaming(false);
    if (!mine || to === undefined || to === mine.name) return;
    const problem = cellStyleNameProblem(
      to,
      names.filter((n) => n !== mine.name),
    );
    if (problem) return setNote(problem);
    setNote(undefined);
    setOwn(own.map((u) => (u === mine ? { ...u, name: to } : u)));
  };
  return (
    <Modal label="Manage Cell Styles" onOk={() => props.onOk(own)} onCancel={props.onCancel}>
      <div className="dimstyle-body">
        <div className="dimstyle-left">
          <span id="manage-cell-styles">Cell Styles:</span>
          <ul
            role="listbox"
            aria-labelledby="manage-cell-styles"
            className="dimstyle-list"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const d = e.key === 'ArrowDown' ? 1 : -1;
                setSelected(Math.max(0, Math.min(names.length - 1, selected + d)));
              } else if (e.key === 'F2' && mine) {
                e.preventDefault();
                setRenaming(true);
              }
            }}
          >
            {names.map((n, k) => (
              <li
                key={`${k}-${n}`}
                role="option"
                aria-selected={k === selected}
                onClick={() => setSelected(k)}
              >
                {renaming && k === selected && mine ? <RenameInput name={n} onDone={rename} /> : n}
              </li>
            ))}
          </ul>
        </div>
        <div className="dimstyle-buttons">
          <button type="button" onClick={() => setCreating(true)}>
            New...
          </button>
          <button type="button" disabled={!mine} onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button
            type="button"
            disabled={!mine || inUse}
            title={inUse ? 'A table is on this cell style' : undefined}
            onClick={() => {
              setOwn(own.filter((u) => u !== mine));
              setSelected(selected - 1);
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {note !== undefined && (
        <p className="dimstyle-note" role="status">
          {note}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => props.onOk(own)}>
          OK
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      {creating && (
        <CreateNewCellStyle
          names={names}
          startWith={startWith}
          from={names[selected] ?? 'Data'}
          onCancel={() => setCreating(false)}
          onContinue={(name, settings) => {
            setCreating(false);
            setOwn([...own, { name, settings }]);
            setSelected(names.length);
          }}
        />
      )}
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
