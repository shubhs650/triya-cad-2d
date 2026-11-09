// The attribute dialogs (M2-12), with AutoCAD's structure and labels (UI_SPEC.md §7):
//
// - Enhanced Attribute Editor (EATTEDIT, a double click on a block reference with attributes):
//   the block and the selected tag at the top, Select block beside them; tabs Attribute (Tag,
//   Prompt, Value list and the Value field, with `...` opening the MTEXT editor on a multiline
//   attribute), Text Options (Text Style, Justification, Height, Rotation, Backwards, Upside
//   down, Width Factor, Oblique Angle) and Properties (Layer, Linetype, Color, Lineweight);
//   Apply, OK, Cancel.
// - Edit Attributes (ATTEDIT): the block name, each attribute's prompt and value, eight to a
//   page with Previous and Next; OK, Cancel.
// - Edit Attribute Definition (TEXTEDIT or a double click on an ATTDEF): Tag, Prompt, Default.
//
// Each is the command's prompt (`DialogPrompt`): it opens while the engine waits at it and
// answers with what changed. Enter is OK, Esc is Cancel, which cancels the command; changes
// already applied stay, as in AutoCAD. A multiline value shows its lines in a text area; its
// `\P` paragraph breaks are the area's line breaks.
import {
  type AttributeEntry,
  type AttributePatch,
  type Color,
  type DialogPrompt,
  type DialogRequest,
  type Lineweight,
  type LinetypeRef,
  type PromptAnswer,
} from '@triya/engine';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { commandLines } from './command-line';
import { engines } from './engine/registry';

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });
const cancel = (doc: number) => engines.command(doc, { kind: 'cancel' });

/** A multiline value as its text area shows it: one line per `\P` paragraph. */
const shownValue = (v: string, multiline: boolean) => (multiline ? v.replace(/\\P/g, '\n') : v);
const storedValue = (v: string, multiline: boolean) =>
  multiline ? v.replace(/\r?\n/g, '\\P') : v.replace(/\r?\n/g, ' ');

export function AttributeDialogs({ doc }: { doc: { id: number } | undefined }) {
  useSyncExternalStore(commandLines.subscribe, commandLines.version);
  const prompt = doc ? commandLines.get(doc.id).prompt : undefined;
  if (!doc || prompt?.kind !== 'dialog') return null;
  const d = (prompt as DialogPrompt).dialog;
  const key = JSON.stringify(d);
  switch (d.type) {
    case 'eattedit':
      return <EnhancedAttributeEditor key={key} doc={doc.id} request={d} />;
    case 'attedit':
      return <EditAttributes key={key} doc={doc.id} request={d} />;
    case 'attdef':
      return <EditAttributeDefinition key={key} doc={doc.id} request={d} />;
  }
}

/**
 * A modal dialog: Esc (the dialog's own cancel) is Cancel, Enter outside a text area or a
 * button is OK. Keys stay in it: the command line and Dynamic Input do not see them.
 */
function Modal({
  label,
  className,
  onOk,
  onCancel,
  children,
}: {
  label: string;
  className?: string;
  onOk: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`cad-dialog ${className ?? ''}`}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        const t = e.target as HTMLElement;
        if (
          e.key === 'Enter' &&
          !(t instanceof HTMLTextAreaElement) &&
          !(t instanceof HTMLButtonElement) &&
          t.getAttribute('role') !== 'tab'
        ) {
          e.preventDefault();
          onOk();
        }
      }}
    >
      <h2 className="cad-dialog-title">{label}</h2>
      {children}
    </dialog>
  );
}

/** DXF 72/73 as AutoCAD's justification names. */
function justification(h: number, v: number): string {
  if (v === 0) return ['Left', 'Center', 'Right', 'Aligned', 'Middle', 'Fit'][h] ?? 'Left';
  const row = ['', 'Bottom', 'Middle', 'Top'][v] ?? '';
  return `${row} ${['left', 'center', 'right'][h] ?? 'left'}`;
}

const COLORS: readonly [string, Color][] = [
  ['ByLayer', { kind: 'byLayer' }],
  ['ByBlock', { kind: 'byBlock' }],
  ['Red', { kind: 'aci', index: 1 }],
  ['Yellow', { kind: 'aci', index: 2 }],
  ['Green', { kind: 'aci', index: 3 }],
  ['Cyan', { kind: 'aci', index: 4 }],
  ['Blue', { kind: 'aci', index: 5 }],
  ['Magenta', { kind: 'aci', index: 6 }],
  ['White', { kind: 'aci', index: 7 }],
];

const colorKey = (c: Color) => JSON.stringify(c);

function colorLabel(c: Color): string {
  const named = COLORS.find(([, v]) => colorKey(v) === colorKey(c));
  if (named) return named[0];
  return c.kind === 'aci' ? `Color ${c.index}` : c.kind === 'rgb' ? `${c.r},${c.g},${c.b}` : '';
}

/** AutoCAD's lineweights, hundredths of a millimetre. */
const LINEWEIGHTS = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200,
  211,
];

const lineweightLabel = (w: Lineweight) =>
  typeof w === 'number' ? `${(w / 100).toFixed(2)} mm` : w;

const deg = (r: number) => Number(((r * 180) / Math.PI).toPrecision(10));
const rad = (d: number) => (d * Math.PI) / 180;
const shown = (v: number) => Number(v.toPrecision(10));

/** The fields of `now` that differ from `was`, as the patch the dialog answers with. */
function patchOf(was: AttributeEntry, now: AttributeEntry): AttributePatch | undefined {
  const keys = [
    'value',
    'style',
    'height',
    'rotation',
    'widthFactor',
    'oblique',
    'backward',
    'upsideDown',
    'layer',
    'linetype',
    'lineweight',
  ] as const;
  const p: Record<string, unknown> = {};
  for (const k of keys) if (now[k] !== was[k]) p[k] = now[k];
  if (colorKey(now.color) !== colorKey(was.color)) p['color'] = now.color;
  return Object.keys(p).length > 0 ? ({ handle: now.handle, ...p } as AttributePatch) : undefined;
}

type Eattedit = Extract<DialogRequest, { type: 'eattedit' }>;
type Tab = 'attribute' | 'text' | 'properties';

function EnhancedAttributeEditor({ doc, request }: { doc: number; request: Eattedit }) {
  const [rows, setRows] = useState<readonly AttributeEntry[]>(request.attributes);
  const [selected, setSelected] = useState(request.selected ?? request.attributes[0]?.handle);
  const [tab, setTab] = useState<Tab>('attribute');
  const row = rows.find((r) => r.handle === selected) ?? rows[0];
  const patches = () =>
    rows
      .map((r, i) => patchOf(request.attributes[i]!, r))
      .filter((p): p is AttributePatch => p !== undefined);
  const dirty = patches().length > 0;
  const set = (patch: Partial<AttributeEntry>) =>
    setRows((rs) => rs.map((r) => (r.handle === row?.handle ? { ...r, ...patch } : r)));
  const send = (action: 'ok' | 'apply' | 'select' | 'mtext') =>
    answer(doc, {
      kind: 'dialog',
      action,
      attributes: patches(),
      ...(row && { target: row.handle }),
    });
  const num = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    valid: (v: number) => boolean = Number.isFinite,
  ) => (
    <label className="cad-dialog-field">
      <span>{label}:</span>
      <input
        type="number"
        step="any"
        defaultValue={shown(value)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && valid(v)) onChange(v);
        }}
      />
    </label>
  );
  const TABS: readonly [Tab, string][] = [
    ['attribute', 'Attribute'],
    ['text', 'Text Options'],
    ['properties', 'Properties'],
  ];
  return (
    <Modal
      label="Enhanced Attribute Editor"
      className="eattedit"
      onOk={() => send('ok')}
      onCancel={() => cancel(doc)}
    >
      <div className="eattedit-head">
        <div>
          <div>
            Block: <strong data-testid="eattedit-block">{request.block}</strong>
          </div>
          <div>
            Tag: <strong data-testid="eattedit-tag">{row?.tag}</strong>
          </div>
        </div>
        <button type="button" onClick={() => send('select')}>
          Select block
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
      {/* Uncontrolled fields are keyed by the attribute, so they show its values when it changes. */}
      <div role="tabpanel" className="cad-dialog-panel" key={tab}>
        {tab === 'attribute' && (
          <>
            <table className="eattedit-list">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>Prompt</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody
                role="listbox"
                aria-label="Attributes"
                tabIndex={0}
                onKeyDown={(e) => {
                  const i = rows.findIndex((r) => r.handle === row?.handle);
                  const next =
                    e.key === 'ArrowDown'
                      ? rows[i + 1]
                      : e.key === 'ArrowUp'
                        ? rows[i - 1]
                        : undefined;
                  if (next) {
                    e.preventDefault();
                    setSelected(next.handle);
                  }
                }}
              >
                {rows.map((r) => (
                  <tr
                    key={r.handle}
                    role="option"
                    aria-selected={r.handle === row?.handle}
                    onClick={() => setSelected(r.handle)}
                  >
                    <td>{r.tag}</td>
                    <td>{r.prompt}</td>
                    <td>{shownValue(r.value, r.multiline).replace(/\n/g, ' ¶ ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {row && (
              <label key={row.handle} className="cad-dialog-field eattedit-value">
                <span>Value:</span>
                {row.multiline ? (
                  <textarea
                    rows={3}
                    defaultValue={shownValue(row.value, true)}
                    onChange={(e) => set({ value: storedValue(e.target.value, true) })}
                  />
                ) : (
                  <input
                    type="text"
                    defaultValue={row.value}
                    onChange={(e) => set({ value: storedValue(e.target.value, false) })}
                  />
                )}
                {row.multiline && (
                  <button
                    type="button"
                    title="Edit the value in the multiline text editor"
                    onClick={() => send('mtext')}
                  >
                    ...
                  </button>
                )}
              </label>
            )}
          </>
        )}
        {tab === 'text' && row && (
          <div className="cad-dialog-grid">
            <label className="cad-dialog-field">
              <span>Text Style:</span>
              <select value={row.style} onChange={(e) => set({ style: e.target.value })}>
                {request.styles.map((s) => (
                  <option key={s.handle} value={s.handle}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="cad-dialog-field">
              <span>Justification:</span>
              {/* Changing it moves the text's alignment points: a later task (M2-27). */}
              <select disabled value="j">
                <option value="j">{justification(row.halign, row.valign)}</option>
              </select>
            </label>
            {num(
              'Height',
              row.height,
              (v) => set({ height: v }),
              (v) => v > 0,
            )}
            {num('Rotation', deg(row.rotation), (v) => set({ rotation: rad(v) }))}
            {num(
              'Width Factor',
              row.widthFactor,
              (v) => set({ widthFactor: v }),
              (v) => v > 0,
            )}
            {num(
              'Oblique Angle',
              deg(row.oblique),
              (v) => set({ oblique: rad(v) }),
              (v) => Math.abs(v) <= 85,
            )}
            <label className="cad-dialog-check">
              <input
                type="checkbox"
                checked={row.backward}
                onChange={(e) => set({ backward: e.target.checked })}
              />
              Backwards
            </label>
            <label className="cad-dialog-check">
              <input
                type="checkbox"
                checked={row.upsideDown}
                onChange={(e) => set({ upsideDown: e.target.checked })}
              />
              Upside down
            </label>
          </div>
        )}
        {tab === 'properties' && row && (
          <div className="cad-dialog-grid">
            <label className="cad-dialog-field">
              <span>Layer:</span>
              <select value={row.layer} onChange={(e) => set({ layer: e.target.value })}>
                {request.layers.map((l) => (
                  <option key={l.handle} value={l.handle}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="cad-dialog-field">
              <span>Linetype:</span>
              <select
                value={row.linetype}
                onChange={(e) => set({ linetype: e.target.value as LinetypeRef })}
              >
                <option value="ByLayer">ByLayer</option>
                <option value="ByBlock">ByBlock</option>
                {request.linetypes
                  .filter((l) => !/^by(layer|block)$/i.test(l.name))
                  .map((l) => (
                    <option key={l.handle} value={l.handle}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="cad-dialog-field">
              <span>Color:</span>
              <select
                value={colorKey(row.color)}
                onChange={(e) => set({ color: JSON.parse(e.target.value) as Color })}
              >
                {!COLORS.some(([, c]) => colorKey(c) === colorKey(row.color)) && (
                  <option value={colorKey(row.color)}>{colorLabel(row.color)}</option>
                )}
                {COLORS.map(([label, c]) => (
                  <option key={label} value={colorKey(c)}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cad-dialog-field">
              <span>Lineweight:</span>
              <select
                value={String(row.lineweight)}
                onChange={(e) => {
                  const v = e.target.value;
                  set({ lineweight: /^\d+$/.test(v) ? Number(v) : (v as Lineweight) });
                }}
              >
                {(['ByLayer', 'ByBlock', 'Default', ...LINEWEIGHTS] as Lineweight[]).map((w) => (
                  <option key={String(w)} value={String(w)}>
                    {lineweightLabel(w)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" disabled={!dirty} onClick={() => send('apply')}>
          Apply
        </button>
        <button type="button" onClick={() => send('ok')}>
          OK
        </button>
        <button type="button" onClick={() => cancel(doc)}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

type Attedit = Extract<DialogRequest, { type: 'attedit' }>;

/** Attributes the Edit Attributes dialog shows at once, as AutoCAD's does. */
const PAGE = 8;

function EditAttributes({ doc, request }: { doc: number; request: Attedit }) {
  const [values, setValues] = useState(() => request.attributes.map((a) => a.value));
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(request.attributes.length / PAGE));
  const ok = () =>
    answer(doc, {
      kind: 'dialog',
      action: 'ok',
      attributes: request.attributes
        .map((a, i) => ({ handle: a.handle, value: values[i]! }))
        .filter((p, i) => p.value !== request.attributes[i]!.value),
    });
  return (
    <Modal label="Edit Attributes" className="attedit" onOk={ok} onCancel={() => cancel(doc)}>
      <div>
        Block name: <strong>{request.block}</strong>
      </div>
      <div className="cad-dialog-grid attedit-rows" key={page}>
        {request.attributes.slice(page * PAGE, page * PAGE + PAGE).map((a, j) => {
          const i = page * PAGE + j;
          return (
            <label key={a.handle} className="cad-dialog-field">
              <span>{a.prompt}</span>
              {a.multiline ? (
                <textarea
                  rows={2}
                  defaultValue={shownValue(values[i]!, true)}
                  onChange={(e) => {
                    const v = storedValue(e.target.value, true);
                    setValues((vs) => vs.map((x, k) => (k === i ? v : x)));
                  }}
                />
              ) : (
                <input
                  type="text"
                  defaultValue={values[i]}
                  onChange={(e) => {
                    const v = storedValue(e.target.value, false);
                    setValues((vs) => vs.map((x, k) => (k === i ? v : x)));
                  }}
                />
              )}
            </label>
          );
        })}
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={() => cancel(doc)}>
          Cancel
        </button>
        <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </Modal>
  );
}

type Attdef = Extract<DialogRequest, { type: 'attdef' }>;

function EditAttributeDefinition({ doc, request }: { doc: number; request: Attdef }) {
  const [tag, setTag] = useState(request.tag);
  const [promptText, setPrompt] = useState(request.prompt);
  const [value, setValue] = useState(request.value);
  const send = (action: 'ok' | 'mtext') =>
    answer(doc, { kind: 'dialog', action, attdef: { tag, prompt: promptText, value } });
  return (
    <Modal
      label="Edit Attribute Definition"
      className="attdef-edit"
      onOk={() => send('ok')}
      onCancel={() => cancel(doc)}
    >
      <div className="cad-dialog-grid">
        <label className="cad-dialog-field">
          <span>Tag:</span>
          <input type="text" value={tag} onChange={(e) => setTag(e.target.value)} />
        </label>
        <label className="cad-dialog-field">
          <span>Prompt:</span>
          <input type="text" value={promptText} onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <label className="cad-dialog-field">
          <span>Default:</span>
          {request.multiline ? (
            <textarea
              rows={3}
              value={shownValue(value, true)}
              onChange={(e) => setValue(storedValue(e.target.value, true))}
            />
          ) : (
            <input type="text" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
          {request.multiline && (
            <button
              type="button"
              title="Edit the default in the multiline text editor"
              onClick={() => send('mtext')}
            >
              ...
            </button>
          )}
        </label>
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => send('ok')}>
          OK
        </button>
        <button type="button" onClick={() => cancel(doc)}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
