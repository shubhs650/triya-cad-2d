// DIMSTYLE's Dimension Style Manager (M4-03), with AutoCAD 2024's structure and labels (AutoCAD
// Help, "Dimension Style Manager", "Create New Dimension Style Dialog Box", "New, Modify, and
// Override Dimension Style Dialog Boxes"; UI_SPEC.md §7):
//
//   Current dimstyle: <name>
//   Styles (the current one's "<style overrides>" under it) | Description
//   List: All styles / Styles in use
//   Set Current, New..., Modify..., Override..., Close
//
// The list's shortcut menu (right-click, Shift+F10 or the menu key) has Set current, Rename and
// Delete, and Save to current style on the overrides; F2 renames and Delete deletes, as in a
// Windows list. Each action is made at once and the engine opens the manager again; Close (and
// Esc) only closes it, everything done being one undo step.
//
// New... asks Create New Dimension Style (New Style Name, Start With, Use for) and Continue opens
// New Dimension Style; Modify... and Override... open the same seven tabs on the selected style
// (Override on the current one, with its overrides). Their fields are the engine's
// (`DIMSTYLE_FIELDS`); OK sends the style's DIMVARs and the engine writes what changed.
//
// Part 2: Use for makes the Start With style's sub-style for one kind of dimension, which the
// list shows under its parent by that kind's name (Modify and Delete act on it alone); Compare...
// opens Compare Dimension Styles (Compare, With and the variables they set differently, or every
// variable of one style With <none>); the fields AutoCAD keeps in xdata (Break size, Jog height
// factor, sub-units, Tolerance alignment) are on their tabs, greyed in Override, as the header has
// no variable for them. Part 3: the preview image (StylePreview) and Import... (ImportStyles).
import {
  DIMSTYLE_FIELDS,
  DIMSTYLE_TABS,
  DIMSTYLE_USES,
  compareDimStyles,
  copyDimStyles,
  dialogVars,
  dimStyleOffers,
  fieldOptions,
  isDimStyleXdataVar,
  setField,
  type DimStyleUse,
  type DialogRequest,
  type DimStyleAction,
  type DimStyleField,
  type DimStyleLists,
  type DimStyleTab,
  type DimStyleOffer,
  type DimStylePreview,
  type DimStyleVars,
  type Clipboard,
  type DocumentModel,
  type PromptAnswer,
} from '@triya/engine';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { controllersOf } from './canvas/registry';
import { drawingFileModel, type StyleSource } from './dimstyle-import';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'dimstyle' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const OVERRIDES = '<style overrides>';

type Editing =
  | { readonly mode: 'create' }
  | { readonly mode: 'compare' }
  | { readonly mode: 'import' }
  | {
      readonly mode: 'new' | 'modify' | 'override';
      readonly name: string;
      readonly from?: string;
      readonly use?: DimStyleUse;
      readonly vars: DimStyleVars;
    };

/** A sub-style's kind as the list and titles name it ("Linear"). */
const useLabel = (use: DimStyleUse | undefined): string =>
  DIMSTYLE_USES.find((u) => u.value === use)?.label.replace(/ dimensions$/, '') ?? '';

/** How a referenced record reads in Compare: by the dialog's own lists. */
function listNames(lists: DimStyleLists) {
  return (name: string, handle: string): string => {
    const list =
      name === 'DIMTXSTY'
        ? lists.textStyles
        : name === 'DIMLTYPE' || name === 'DIMLTEX1' || name === 'DIMLTEX2'
          ? lists.linetypes
          : lists.arrowheads;
    return list.find((o) => o.value === handle)?.label ?? handle;
  };
}

/** A DIMVAR's label in the dialog, for the overrides' description. */
function varLabel(name: string): string {
  const f = DIMSTYLE_FIELDS.find((x) => x.vars[0] === name && !x.key.includes('.'));
  return f ? f.label : name;
}

function shownValue(v: unknown): string {
  if (typeof v === 'number') return String(Number(v.toPrecision(8)));
  return String(v);
}

export function DimStyleDialog({
  doc,
  request,
  sources = [],
}: {
  doc: number;
  request: Request;
  /** The other open drawings, which Import... can read styles from. */
  sources?: readonly StyleSource[];
}) {
  const [selected, setSelected] = useState(request.selected);
  const [list, setList] = useState<'all' | 'used'>('all');
  const [editing, setEditing] = useState<Editing>();
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [confirm, setConfirm] = useState<string>();
  const send = (dimstyle: DimStyleAction) =>
    answer(doc, { kind: 'dialog', action: 'apply', dimstyle });
  const close = () => answer(doc, { kind: 'dialog', action: 'ok' });
  const hasOverrides = Object.keys(request.overrides).length > 0;
  const shownStyle = (name: string) => {
    const s = request.styles.find((x) => x.name === name);
    return !!s && (list === 'all' || s.used || s.name === request.current);
  };
  // A sub-style shows with its parent.
  const styles = request.styles.filter((s) => shownStyle(s.parent ?? s.name));
  const rows: string[] = styles.flatMap((s) =>
    s.name === request.current && hasOverrides ? [s.name, OVERRIDES] : [s.name],
  );
  const onOverrides = selected === OVERRIDES;
  const style = request.styles.find((s) => s.name === (onOverrides ? request.current : selected));
  const isSub = style?.parent !== undefined;
  const currentStyle = request.styles.find((s) => s.name === request.current);

  const setCurrent = (name: string) => {
    // AutoCAD asks before another style's Set Current discards the overrides.
    if (hasOverrides && name !== request.current) setConfirm(name);
    else void send({ op: 'current', name });
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = rows.indexOf(selected);
      const next =
        rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) setSelected(next);
    } else if (e.key === 'F2' && style && !onOverrides && !isSub) {
      e.preventDefault();
      setRenaming(style.name);
    } else if (e.key === 'Delete' && style && !onOverrides) {
      e.preventDefault();
      void send({ op: 'delete', name: style.name });
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = (e.target as HTMLElement).getBoundingClientRect();
      setMenu({ x: r.left + 16, y: r.top + 16 });
    }
  };
  const contextMenu = (e: MouseEvent, row: string) => {
    e.preventDefault();
    setSelected(row);
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const description = onOverrides
    ? `${request.current} + ${Object.entries(request.overrides)
        .map(([n, v]) => `${varLabel(n)} = ${shownValue(v)}`)
        .join(', ')}`
    : style?.parent !== undefined
      ? `${style.parent}: ${useLabel(style.use)}`
      : (style?.name ?? '');

  // The preview shows the style selected as the drawing draws it (a sub-style its kind alone),
  // the overrides on the current style's DIMVARs.
  const previewTitle = onOverrides ? `${request.current} ${OVERRIDES}` : description;
  const managerPreview: DimStylePreview | undefined = !style
    ? undefined
    : onOverrides
      ? { vars: dialogVars({ ...style.vars, ...request.overrides }) }
      : { style: style.name, ...(style.use && { use: style.use }) };

  return (
    <Modal
      label="Dimension Style Manager"
      className="dimstyle-manager"
      onOk={close}
      onCancel={close}
    >
      <p className="dimstyle-current">
        Current dimstyle: <strong data-testid="dimstyle-current">{request.current}</strong>
      </p>
      <div className="dimstyle-body">
        <div className="dimstyle-left">
          <span id={`${doc}-dimstyle-styles`}>Styles:</span>
          <ul
            role="listbox"
            aria-labelledby={`${doc}-dimstyle-styles`}
            className="dimstyle-list"
            tabIndex={0}
            onKeyDown={keys}
          >
            {rows.map((r) => {
              const sub = request.styles.find((x) => x.name === r && x.parent !== undefined);
              return (
                <li
                  key={r}
                  role="option"
                  aria-selected={r === selected}
                  aria-label={sub ? `${sub.parent}: ${useLabel(sub.use)}` : undefined}
                  className={
                    r === OVERRIDES ? 'dimstyle-overrides' : sub ? 'dimstyle-substyle' : undefined
                  }
                  onClick={() => setSelected(r)}
                  onDoubleClick={() => r !== OVERRIDES && !sub && setRenaming(r)}
                  onContextMenu={(e) => contextMenu(e, r)}
                >
                  {renaming === r ? (
                    <RenameInput
                      name={r}
                      onDone={(to) => {
                        setRenaming(undefined);
                        if (to !== undefined && to !== r) void send({ op: 'rename', name: r, to });
                      }}
                    />
                  ) : (
                    <>
                      {r === request.current && <span aria-label="current">▸ </span>}
                      {sub ? useLabel(sub.use) : r}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="cad-dialog-field">
            <span>List:</span>
            <select value={list} onChange={(e) => setList(e.target.value as 'all' | 'used')}>
              <option value="all">All styles</option>
              <option value="used">Styles in use</option>
            </select>
          </label>
        </div>
        <div className="dimstyle-right">
          <span>Preview of: {previewTitle}</span>
          <StylePreview doc={doc} preview={managerPreview} size={MANAGER_PREVIEW} />
          <span>Description</span>
          <p className="dimstyle-description" data-testid="dimstyle-description">
            {description}
          </p>
          <div className="dimstyle-buttons">
            <button
              type="button"
              disabled={!style || onOverrides || isSub || style.name === request.current}
              onClick={() => style && setCurrent(style.name)}
            >
              Set Current
            </button>
            <button type="button" disabled={!style} onClick={() => setEditing({ mode: 'create' })}>
              New...
            </button>
            <button
              type="button"
              disabled={!style || onOverrides}
              onClick={() =>
                style &&
                setEditing({ mode: 'modify', name: style.name, vars: dialogVars(style.vars) })
              }
            >
              Modify...
            </button>
            <button
              type="button"
              disabled={!currentStyle || (style !== undefined && style.name !== request.current)}
              onClick={() =>
                currentStyle &&
                setEditing({
                  mode: 'override',
                  name: currentStyle.name,
                  vars: dialogVars({ ...currentStyle.vars, ...request.overrides }),
                })
              }
            >
              Override...
            </button>
            <button type="button" disabled={!style} onClick={() => setEditing({ mode: 'compare' })}>
              Compare...
            </button>
            <button type="button" onClick={() => setEditing({ mode: 'import' })}>
              Import...
            </button>
          </div>
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
      {menu && (
        <StyleMenu
          at={menu}
          overrides={onOverrides}
          substyle={isSub}
          onClose={() => setMenu(undefined)}
          onCurrent={() => style && setCurrent(style.name)}
          onRename={() => style && setRenaming(style.name)}
          onDelete={() => style && void send({ op: 'delete', name: style.name })}
          onSave={() => void send({ op: 'save-overrides' })}
        />
      )}
      {confirm !== undefined && (
        <Modal
          label="Dimension Style - Set Current"
          onOk={() => void send({ op: 'current', name: confirm })}
          onCancel={() => setConfirm(undefined)}
        >
          <p>Making another style current will discard the style overrides. Continue?</p>
          <div className="cad-dialog-buttons">
            <button type="button" onClick={() => void send({ op: 'current', name: confirm })}>
              OK
            </button>
            <button type="button" onClick={() => setConfirm(undefined)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
      {editing?.mode === 'create' && style && (
        <CreateNewStyle
          styles={request.styles.filter((s) => s.parent === undefined).map((s) => s.name)}
          from={style.parent ?? style.name}
          onCancel={() => setEditing(undefined)}
          onContinue={(name, from, use) => {
            // A sub-style there is already opens as it is: Continue edits it.
            const child =
              use === 'all'
                ? undefined
                : request.styles.find((s) => s.parent === from && s.use === use);
            const base = child ?? request.styles.find((s) => s.name === from)!;
            setEditing({ mode: 'new', name, from, use, vars: dialogVars(base.vars) });
          }}
        />
      )}
      {editing?.mode === 'compare' && style && (
        <CompareStyles
          styles={request.styles}
          compare={style.name}
          lists={request.lists}
          onClose={() => setEditing(undefined)}
        />
      )}
      {editing?.mode === 'import' && (
        <ImportStyles
          sources={sources}
          have={request.styles.map((s) => s.name)}
          onCancel={() => setEditing(undefined)}
          onImport={(styles) => void send({ op: 'import', styles })}
        />
      )}
      {editing &&
        editing.mode !== 'create' &&
        editing.mode !== 'compare' &&
        editing.mode !== 'import' && (
          <StyleEditor
            title={
              editing.mode === 'new'
                ? `New Dimension Style: ${
                    editing.use && editing.use !== 'all'
                      ? `${editing.from}: ${useLabel(editing.use)}`
                      : editing.name
                  }`
                : editing.mode === 'modify'
                  ? `Modify Dimension Style: ${editing.name}`
                  : `Override Current Style: ${editing.name}`
            }
            doc={doc}
            vars={editing.vars}
            lists={request.lists}
            {...(editing.mode === 'new' &&
              editing.use &&
              editing.use !== 'all' && { use: editing.use })}
            {...(editing.mode === 'modify' && {
              use: request.styles.find((s) => s.name === editing.name)?.use,
            })}
            override={editing.mode === 'override'}
            onCancel={() => setEditing(undefined)}
            onOk={(vars) => {
              if (editing.mode === 'new') {
                void send({
                  op: 'new',
                  name: editing.name,
                  from: editing.from!,
                  vars,
                  ...(editing.use && editing.use !== 'all' && { use: editing.use }),
                });
              } else if (editing.mode === 'modify') {
                void send({ op: 'modify', name: editing.name, vars });
              } else {
                void send({ op: 'override', vars });
              }
            }}
          />
        )}
    </Modal>
  );
}

/** The preview pictures' sizes in CSS pixels. */
const MANAGER_PREVIEW = { width: 240, height: 170 };
const EDITOR_PREVIEW = { width: 300, height: 190 };
/** How long the preview waits for typing to pause before it is drawn again. */
const PREVIEW_DELAY_MS = 60;

/**
 * The preview image (M4-03 part 3): drawn by the drawing's renderer (the engine's sample drawing
 * in the style) and shown on a `bitmaprenderer` canvas, as no 2D drawing happens outside the
 * renderer. It keeps its last picture until the next one arrives.
 */
function StylePreview({
  doc,
  preview,
  size,
}: {
  doc: number;
  preview: DimStylePreview | undefined;
  size: { readonly width: number; readonly height: number };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = preview ? JSON.stringify(preview) : '';
  useEffect(() => {
    if (!preview) return;
    let live = true;
    const timer = setTimeout(() => {
      const controller = controllersOf(doc)[0];
      void controller?.dimStylePreview(preview, size).then((bitmap) => {
        const c = canvas.current;
        if (!live || !c || !bitmap) {
          bitmap?.close();
          return;
        }
        c.width = bitmap.width;
        c.height = bitmap.height;
        c.getContext('bitmaprenderer')?.transferFromImageBitmap(bitmap);
        c.dataset['drawn'] = key;
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` stands for the preview's content, which is a new object each render.
  }, [doc, key, size]);
  return (
    <canvas
      ref={canvas}
      className="dimstyle-preview"
      role="img"
      aria-label="Preview"
      data-testid="dimstyle-preview"
      style={{ width: size.width, height: size.height }}
    />
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

function StyleMenu(props: {
  at: { x: number; y: number };
  overrides: boolean;
  /** A sub-style is neither made current nor renamed. */
  substyle: boolean;
  onClose: () => void;
  onCurrent: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const item = (label: string, act: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        props.onClose();
        act();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      role="menu"
      aria-label="Style"
      className="dimstyle-menu"
      style={{ left: props.at.x, top: props.at.y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          props.onClose();
        }
      }}
      onMouseLeave={props.onClose}
    >
      {props.overrides ? (
        item('Save to current style', props.onSave)
      ) : (
        <>
          {!props.substyle && item('Set current', props.onCurrent)}
          {!props.substyle && item('Rename', props.onRename)}
          {item('Delete', props.onDelete)}
        </>
      )}
    </div>
  );
}

function CreateNewStyle(props: {
  styles: readonly string[];
  from: string;
  onCancel: () => void;
  onContinue: (name: string, from: string, use: DimStyleUse) => void;
}) {
  const id = useId();
  const [name, setName] = useState(`Copy of ${props.from}`);
  const [from, setFrom] = useState(props.from);
  const [use, setUse] = useState<DimStyleUse>('all');
  // A sub-style is named after its Start With style: the name is not typed.
  const sub = use !== 'all';
  const go = () => {
    if (sub || name.trim() !== '') props.onContinue(name.trim(), from, use);
  };
  return (
    <Modal
      label="Create New Dimension Style"
      className="dimstyle-create"
      onOk={go}
      onCancel={props.onCancel}
    >
      <label className="cad-dialog-field">
        <span>New Style Name:</span>
        <input
          type="text"
          value={sub ? `${from}: ${useLabel(use)}` : name}
          maxLength={255}
          disabled={sub}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="cad-dialog-field">
        <span>Start With:</span>
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          {props.styles.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label
        className="cad-dialog-check"
        title="Making a style annotative is not supported (DEC-013)"
      >
        <input type="checkbox" checked={false} disabled readOnly /> Annotative
      </label>
      <label className="cad-dialog-field" htmlFor={`${id}-use`}>
        <span>Use for:</span>
        <select
          id={`${id}-use`}
          value={use}
          onChange={(e) => setUse(e.target.value as DimStyleUse)}
        >
          {DIMSTYLE_USES.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={go} disabled={!sub && name.trim() === ''}>
          Continue
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

let lastTab: DimStyleTab = 'lines';

/** New, Modify or Override Dimension Style: AutoCAD's seven tabs over the style's DIMVARs. */
function StyleEditor(props: {
  title: string;
  doc: number;
  vars: DimStyleVars;
  /** A sub-style's kind: the preview shows it alone. */
  use?: DimStyleUse | undefined;
  lists: DimStyleLists;
  /** Override: the fields AutoCAD keeps in the style's xdata are greyed. */
  override: boolean;
  onCancel: () => void;
  onOk: (vars: DimStyleVars) => void;
}) {
  const [tab, setTabState] = useState<DimStyleTab>(lastTab);
  const [vars, setVars] = useState(props.vars);
  const setTab = (t: DimStyleTab) => {
    lastTab = t;
    setTabState(t);
  };
  const fields = DIMSTYLE_FIELDS.filter((f) => f.tab === tab);
  const groups = [...new Set(fields.map((f) => f.group))];
  const label = DIMSTYLE_TABS.find((t) => t.id === tab)!.label;
  // AutoCAD's sample image, at the top right of every tab, following each change.
  const preview = (
    <div key="preview" className="dimstyle-editor-preview">
      <StylePreview
        doc={props.doc}
        preview={{ vars, sizedBy: props.vars, ...(props.use && { use: props.use }) }}
        size={EDITOR_PREVIEW}
      />
    </div>
  );
  return (
    <Modal
      label={props.title}
      className="dimstyle-editor"
      onOk={() => props.onOk(vars)}
      onCancel={props.onCancel}
    >
      <div role="tablist" className="cad-dialog-tabs">
        {DIMSTYLE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="cad-dialog-panel dimstyle-tab" aria-label={label}>
        {groups.map((g, i) => [
          i === 1 && preview,
          <fieldset key={g}>
            <legend>{g}</legend>
            {fields
              .filter((f) => f.group === g)
              .map((f) => (
                <Field
                  key={f.key}
                  field={f}
                  vars={vars}
                  lists={props.lists}
                  locked={props.override && isDimStyleXdataVar(f.vars[0]!)}
                  onChange={(value) => setVars((v) => setField(v, f.key, value))}
                />
              ))}
          </fieldset>,
        ])}
        {groups.length < 2 && preview}
        {tab === 'fit' && (
          <label
            className="cad-dialog-check"
            title="Making a style annotative is not supported (DEC-013)"
          >
            <input type="checkbox" checked={false} disabled readOnly /> Annotative
          </label>
        )}
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => props.onOk(vars)}>
          OK
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function Field({
  field: f,
  vars,
  lists,
  locked,
  onChange,
}: {
  field: DimStyleField;
  vars: DimStyleVars;
  lists: DimStyleLists;
  locked: boolean;
  onChange: (value: string | number | boolean) => void;
}) {
  const disabled = locked || (f.enabled ? !f.enabled(vars) : false);
  const value = f.get(vars);
  if (f.kind === 'check') {
    return (
      <label className="cad-dialog-check">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {f.label}
      </label>
    );
  }
  if (f.kind === 'radio') {
    return (
      <div role="radiogroup" aria-label={f.label} className="dimstyle-radios">
        {fieldOptions(f, lists, vars).map((o) => (
          <label key={o.value} className="cad-dialog-check">
            <input
              type="radio"
              name={f.key}
              checked={String(value) === o.value}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    );
  }
  if (f.kind === 'choice') {
    const options = fieldOptions(f, lists, vars);
    return (
      <label className="cad-dialog-field">
        <span>{f.label}:</span>
        <select
          value={String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {!options.some((o) => o.value === String(value)) && (
            <option value={String(value)}>{String(value)}</option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <TextField
      label={f.label}
      value={value}
      disabled={disabled}
      numeric={f.kind === 'number'}
      onChange={onChange}
    />
  );
}

/**
 * A typed number or text: each keystroke the field takes is set at once, and a value it refuses
 * shows until the field loses focus, when it goes back to the style's.
 */
function TextField(props: {
  label: string;
  value: string | number | boolean;
  disabled: boolean;
  numeric: boolean;
  onChange: (value: string) => void;
}) {
  const shown =
    typeof props.value === 'number'
      ? String(Number(props.value.toPrecision(10)))
      : String(props.value);
  const [text, setText] = useState<string>();
  return (
    <label className="cad-dialog-field">
      <span>{props.label}:</span>
      <input
        type="text"
        inputMode={props.numeric ? 'decimal' : undefined}
        value={text ?? shown}
        disabled={props.disabled}
        onChange={(e) => {
          setText(e.target.value);
          props.onChange(e.target.value);
        }}
        onBlur={() => setText(undefined)}
      />
    </label>
  );
}

const NONE = '';

/**
 * Compare Dimension Styles: the variables Compare and With set differently (Description,
 * Variable and each style's value), or every variable of Compare when With is <none>, with a
 * count and AutoCAD's Copy to clipboard.
 */
/**
 * Import Dimension Styles (M4-03 part 3, Triya's: AutoCAD drags them in from DesignCenter): From
 * another open drawing or a drawing file (Browse...), the styles it has, each with its sub-styles
 * under it; a style this drawing has already by that name is shown greyed, as the import would
 * ignore it as a duplicate. Import brings the checked ones in with what they use.
 */
function ImportStyles(props: {
  sources: readonly StyleSource[];
  /** This drawing's styles, by name. */
  have: readonly string[];
  onCancel: () => void;
  onImport: (styles: Clipboard) => void;
}) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<{ name: string; model: DocumentModel }>();
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<string>();
  const have = new Set(props.have.map((n) => n.toUpperCase()));
  const offers: readonly DimStyleOffer[] = source ? dimStyleOffers(source.model) : [];
  const duplicate = (o: DimStyleOffer) => have.has((o.parent ?? o.name).toUpperCase());
  const parents = offers.filter((o) => o.parent === undefined && !duplicate(o));
  const pick = (name: string, model: () => DocumentModel | Promise<DocumentModel>) => {
    setStatus(`Reading ${name}…`);
    setChecked(new Set());
    void Promise.resolve()
      .then(model)
      .then(
        (m) => {
          setSource({ name, model: m });
          setStatus(undefined);
        },
        (e: unknown) => {
          setSource(undefined);
          setStatus(`${name} could not be read: ${e instanceof Error ? e.message : String(e)}`);
        },
      );
  };
  const go = () => {
    if (!source || checked.size === 0) return;
    props.onImport(copyDimStyles(source.model, [...checked], props.have));
  };
  return (
    <Modal
      label="Import Dimension Styles"
      className="dimstyle-import"
      onOk={go}
      onCancel={props.onCancel}
    >
      <div className="cad-dialog-field">
        <label htmlFor={`${id}-from`}>From drawing:</label>
        <select
          id={`${id}-from`}
          value={props.sources.find((s) => s.name === source?.name)?.id ?? ''}
          onChange={(e) => {
            const s = props.sources.find((x) => String(x.id) === e.target.value);
            if (s) pick(s.name, s.model);
          }}
        >
          <option value="" disabled>
            {source && !props.sources.some((s) => s.name === source.name)
              ? source.name
              : props.sources.length > 0
                ? 'Choose an open drawing'
                : 'No other drawing is open'}
          </option>
          {props.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => file.current?.click()}>
          Browse...
        </button>
        <input
          ref={file}
          type="file"
          accept=".dwg,.dxf"
          hidden
          aria-label="Drawing to import from"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) pick(f.name, () => drawingFileModel(f));
          }}
        />
      </div>
      <span id={`${id}-styles`}>Dimension styles:</span>
      <ul className="dimstyle-import-list" aria-labelledby={`${id}-styles`}>
        {offers.map((o) => (
          <li key={o.name} className={o.parent !== undefined ? 'dimstyle-substyle' : undefined}>
            {o.parent === undefined ? (
              <label className="cad-dialog-check">
                <input
                  type="checkbox"
                  disabled={duplicate(o)}
                  checked={checked.has(o.name)}
                  onChange={(e) => {
                    const next = new Set(checked);
                    if (e.target.checked) next.add(o.name);
                    else next.delete(o.name);
                    setChecked(next);
                  }}
                />
                {o.name}
                {duplicate(o) && (
                  <span className="dimstyle-import-note"> (already in this drawing)</span>
                )}
              </label>
            ) : (
              <span>{useLabel(o.use)}</span>
            )}
          </li>
        ))}
      </ul>
      <p role="status" className="dimstyle-note">
        {status ?? (source && offers.length === 0 ? `${source.name} has no dimension styles.` : '')}
      </p>
      <div className="cad-dialog-buttons">
        <button
          type="button"
          disabled={parents.length === 0}
          onClick={() =>
            setChecked(
              checked.size === parents.length ? new Set() : new Set(parents.map((o) => o.name)),
            )
          }
        >
          {checked.size === parents.length && parents.length > 0 ? 'Clear All' : 'Select All'}
        </button>
        <button type="button" disabled={!source || checked.size === 0} onClick={go}>
          Import
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function CompareStyles(props: {
  styles: readonly { readonly name: string; readonly vars: DimStyleVars }[];
  compare: string;
  lists: DimStyleLists;
  onClose: () => void;
}) {
  const id = useId();
  const [a, setA] = useState(props.compare);
  const [b, setB] = useState(NONE);
  const varsOf = (name: string) => props.styles.find((s) => s.name === name)?.vars;
  const rows = compareDimStyles(
    varsOf(a) ?? {},
    b === NONE ? undefined : varsOf(b),
    listNames(props.lists),
  );
  const same = b !== NONE && rows.length === 0;
  const copy = () => {
    const lines = rows.map((r) => [r.description, r.variable, ...r.values].join('\t'));
    void navigator.clipboard?.writeText(lines.join('\n')).catch(() => undefined);
  };
  const options = (withNone: boolean) => (
    <>
      {withNone && <option value={NONE}>&lt;none&gt;</option>}
      {props.styles.map((s) => (
        <option key={s.name} value={s.name}>
          {s.name}
        </option>
      ))}
    </>
  );
  return (
    <Modal
      label="Compare Dimension Styles"
      className="dimstyle-compare"
      onOk={props.onClose}
      onCancel={props.onClose}
    >
      <label className="cad-dialog-field">
        <span>Compare:</span>
        <select value={a} onChange={(e) => setA(e.target.value)}>
          {options(false)}
        </select>
      </label>
      <label className="cad-dialog-field">
        <span>With:</span>
        <select value={b} onChange={(e) => setB(e.target.value)}>
          {options(true)}
        </select>
      </label>
      <p id={`${id}-summary`} role="status" data-testid="dimstyle-compare-summary">
        {same
          ? 'The two styles are identical.'
          : b === NONE
            ? `All properties of ${a}:`
            : `Found ${rows.length} ${rows.length === 1 ? 'difference' : 'differences'}:`}
      </p>
      <div className="dimstyle-compare-table">
        <table aria-describedby={`${id}-summary`}>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col">Variable</th>
              <th scope="col">{a}</th>
              {b !== NONE && <th scope="col">{b}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variable}>
                <td>{r.description}</td>
                <td>{r.variable}</td>
                {r.values.map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={copy} disabled={rows.length === 0}>
          Copy to Clipboard
        </button>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
