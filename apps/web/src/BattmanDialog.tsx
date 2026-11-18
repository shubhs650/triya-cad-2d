// BATTMAN's Block Attribute Manager (M5-03 part 2), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Block Attribute Manager", "Edit Attribute Dialog Box (BATTMAN)", "Block
// Attribute Settings Dialog Box"; UI_SPEC.md §7):
//
// - Block Attribute Manager: Select block, the Block list, Sync; the selected block's attribute
//   definitions with the columns Settings chooses (a duplicate tag in red when "Emphasize
//   duplicate tags" is on); Move Up, Move Down (not for a constant definition), Edit...,
//   Remove (not for a block's only definition); "Found in drawing" and "Found in model space"
//   (or the layout's name); Settings..., OK, Cancel, Apply. A double click on a definition edits
//   it.
// - Edit Attribute: Active Block; tabs Attribute (Mode: Invisible, Constant, Verify, Preset,
//   Multiple lines, Constant and Multiple lines shown only; Data: Tag, Prompt, Default), Text
//   Options (with a multiline definition's Boundary width) and Properties, as the Enhanced
//   Attribute Editor's; Auto preview changes (M5-03 part 3), OK, Cancel.
// - Block Attribute Settings: "Display in list" (Tag always), Select All, Clear All, "Emphasize
//   duplicate tags", "Apply changes to existing references"; OK, Cancel. Kept for the next
//   BATTMAN, as AutoCAD keeps them.
//
// The manager holds Edit, Move and Remove until Apply, OK or Sync (the engine's BattmanAnswer
// carries them); another block in the Block list, or Select block, applies them first. Cancel
// drops what was not applied. With Auto preview changes on (and "Apply changes to existing
// references"), each change in Edit Attribute is sent as a `preview`, which the engine shows on
// the definitions and references at once and takes back before the next answer; AutoCAD greys
// the checkbox while "Apply changes to existing references" is off, and keeps it per user, as
// the settings are kept. Left out: the Default's Insert Field button (with M5-03's Insert
// Field), and Help, as Triya's other dialogs leave it.
import type {
  AttributeDefinitionEntry,
  AttributeDefinitionPatch,
  BattmanAnswer,
  Color,
  DialogRequest,
  Handle,
  PromptAnswer,
} from '@triya/engine';
import { useState } from 'react';
import {
  ATTACHMENTS,
  AttributeProperties,
  AttributeTextOptions,
  Modal,
  colorLabel,
  deg,
  justification,
  lineweightLabel,
  shownValue,
  storedValue,
} from './AttributeDialogs';
import { SelectColorDialog } from './SelectColorDialog';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'battman' }>;
type Entry = AttributeDefinitionEntry;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });
const cancel = (doc: number) => engines.command(doc, { kind: 'cancel' });

/** DXF 70 bits. */
const INVISIBLE = 1;
const CONSTANT = 2;
const VERIFY = 4;
const PRESET = 8;

/** The list's columns, in Block Attribute Settings' order. */
export const BATTMAN_COLUMNS = [
  'tag',
  'prompt',
  'default',
  'modes',
  'annotative',
  'style',
  'justification',
  'height',
  'rotation',
  'widthFactor',
  'oblique',
  'boundaryWidth',
  'layer',
  'linetype',
  'color',
  'lineweight',
  'plotStyle',
] as const;
export type BattmanColumn = (typeof BATTMAN_COLUMNS)[number];

const COLUMN_LABELS: Record<BattmanColumn, string> = {
  tag: 'Tag',
  prompt: 'Prompt',
  default: 'Default',
  modes: 'Modes',
  annotative: 'Annotative',
  style: 'Style',
  justification: 'Justification',
  height: 'Height',
  rotation: 'Rotation',
  widthFactor: 'Width Factor',
  oblique: 'Oblique Angle',
  boundaryWidth: 'Boundary Width',
  layer: 'Layer',
  linetype: 'Linetype',
  color: 'Color',
  lineweight: 'Lineweight',
  plotStyle: 'Plot style',
};

/** Block Attribute Settings. */
export interface BattmanSettings {
  readonly columns: readonly BattmanColumn[];
  readonly emphasizeDuplicates: boolean;
  readonly applyToExisting: boolean;
  /** Edit Attribute's "Auto preview changes" (M5-03 part 3). */
  readonly autoPreview: boolean;
}

/** AutoCAD's: Tag, Prompt, Default and Modes listed; every option on. */
export const DEFAULT_BATTMAN_SETTINGS: BattmanSettings = {
  columns: ['tag', 'prompt', 'default', 'modes'],
  emphasizeDuplicates: true,
  applyToExisting: true,
  autoPreview: true,
};

const STORAGE_KEY = 'triya.battman.settings';

/** The settings the last BATTMAN left (this browser's; the defaults when none or unreadable). */
export function loadBattmanSettings(): BattmanSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BATTMAN_SETTINGS;
    const v = JSON.parse(raw) as Partial<BattmanSettings>;
    const columns = (v.columns ?? []).filter((c): c is BattmanColumn =>
      (BATTMAN_COLUMNS as readonly string[]).includes(c),
    );
    return {
      columns: columns.includes('tag') ? columns : ['tag', ...columns],
      emphasizeDuplicates: v.emphasizeDuplicates ?? true,
      applyToExisting: v.applyToExisting ?? true,
      autoPreview: v.autoPreview ?? true,
    };
  } catch {
    return DEFAULT_BATTMAN_SETTINGS;
  }
}

function saveBattmanSettings(s: BattmanSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Private windows and blocked storage: the settings last for this session only.
  }
}

/** The Modes column: I invisible, C constant, V verify, P preset, L lock position, M multiline. */
export function modesText(e: Entry): string {
  return [
    e.flags & INVISIBLE ? 'I' : '',
    e.flags & CONSTANT ? 'C' : '',
    e.flags & VERIFY ? 'V' : '',
    e.flags & PRESET ? 'P' : '',
    e.lockPosition ? 'L' : '',
    e.multiline ? 'M' : '',
  ].join('');
}

const fixed = (v: number) => v.toFixed(4);
const nameOf = (list: readonly { handle: string; name: string }[], h: string | null) =>
  h === null ? 'ByLayer' : (list.find((r) => r.handle === h)?.name ?? h);

function cell(r: Request, e: Entry, c: BattmanColumn): string {
  switch (c) {
    case 'tag':
      return e.tag;
    case 'prompt':
      return e.prompt;
    case 'default':
      return shownValue(e.value, e.multiline).replace(/\n/g, ' ¶ ');
    case 'modes':
      return modesText(e);
    case 'annotative':
      return e.annotative ? 'Yes' : 'No';
    case 'style':
      return nameOf(r.styles, e.style);
    case 'justification':
      return e.multiline
        ? (ATTACHMENTS[(e.attachment ?? 1) - 1] ?? '')
        : justification(e.halign, e.valign);
    case 'height':
      return fixed(e.height);
    case 'rotation':
      return String(deg(e.rotation));
    case 'widthFactor':
      return fixed(e.widthFactor);
    case 'oblique':
      return String(deg(e.oblique));
    case 'boundaryWidth':
      return e.multiline ? fixed(e.boundaryWidth ?? 0) : '';
    case 'layer':
      return nameOf(r.layers, e.layer);
    case 'linetype':
      return e.linetype === 'ByLayer' || e.linetype === 'ByBlock'
        ? e.linetype
        : nameOf(r.linetypes, e.linetype);
    case 'color':
      return colorLabel(e.color);
    case 'lineweight':
      return lineweightLabel(e.lineweight);
    case 'plotStyle':
      return r.plotStyles ? nameOf(r.plotStyles, e.plotStyle) : 'ByColor';
  }
}

const PATCH_KEYS = [
  'tag',
  'prompt',
  'value',
  'flags',
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
  'halign',
  'valign',
  'attachment',
  'plotStyle',
  'boundaryWidth',
] as const;

const colorKey = (c: Color) => JSON.stringify(c);

/** What the dialog changed of one definition, or undefined. */
function patchOf(was: Entry, now: Entry): AttributeDefinitionPatch | undefined {
  const p: Record<string, unknown> = {};
  for (const k of PATCH_KEYS) if (now[k] !== was[k]) p[k] = now[k];
  if (colorKey(now.color) !== colorKey(was.color)) p['color'] = now.color;
  return Object.keys(p).length > 0
    ? ({ handle: now.handle, ...p } as AttributeDefinitionPatch)
    : undefined;
}

export function BattmanDialog({ doc, request }: { doc: number; request: Request }) {
  const [rows, setRows] = useState<readonly Entry[]>(request.attributes);
  const [removed, setRemoved] = useState<readonly Handle[]>([]);
  const [selected, setSelected] = useState(request.selected ?? request.attributes[0]?.handle);
  const [settings, setSettings] = useState(loadBattmanSettings);
  const [editing, setEditing] = useState<Entry | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const row = rows.find((r) => r.handle === selected);
  const index = row ? rows.indexOf(row) : -1;
  const original = new Map(request.attributes.map((a) => [a.handle, a]));
  const patches = rows
    .map((r) => patchOf(original.get(r.handle)!, r))
    .filter((p): p is AttributeDefinitionPatch => p !== undefined);
  const moved = rows.some((r, i) => r.handle !== request.attributes[i]?.handle);
  const dirty = patches.length > 0 || removed.length > 0 || moved;
  const tags = new Map<string, number>();
  for (const r of rows) tags.set(r.tag.toUpperCase(), (tags.get(r.tag.toUpperCase()) ?? 0) + 1);

  const state = (more: Partial<BattmanAnswer> = {}): BattmanAnswer => ({
    block: request.block,
    order: rows.map((r) => r.handle),
    removed,
    attributes: patches,
    applyToExisting: settings.applyToExisting,
    ...(selected !== undefined && { selected }),
    ...more,
  });
  const send = (action: 'ok' | 'apply' | 'select', more?: Partial<BattmanAnswer>) =>
    answer(doc, { kind: 'dialog', action, battman: state(more) });
  // Auto preview: the manager's changes with `e` as Edit Attribute has it now (none: as the
  // manager holds them), shown in the drawing until the next answer.
  const sendPreview = (e: Entry | undefined, show: boolean) => {
    const now = e ? rows.map((r) => (r.handle === e.handle ? e : r)) : rows;
    const attributes = show
      ? now
          .map((r) => patchOf(original.get(r.handle)!, r))
          .filter((p): p is AttributeDefinitionPatch => p !== undefined)
      : [];
    answer(doc, { kind: 'dialog', action: 'preview', battman: state({ attributes }) });
  };
  const preview = (e?: Entry) => {
    if (settings.autoPreview && settings.applyToExisting) sendPreview(e, true);
  };

  const move = (by: -1 | 1) => {
    if (!row) return;
    const next = [...rows];
    next.splice(index, 1);
    next.splice(index + by, 0, row);
    setRows(next);
  };
  const remove = () => {
    if (!row) return;
    setRemoved([...removed, row.handle]);
    const next = rows.filter((r) => r !== row);
    setRows(next);
    setSelected(next[Math.min(index, next.length - 1)]?.handle);
  };
  const constant = row !== undefined && (row.flags & CONSTANT) !== 0;
  const columns = BATTMAN_COLUMNS.filter((c) => settings.columns.includes(c));

  return (
    <Modal
      label="Block Attribute Manager"
      className="battman"
      onOk={() => send('ok')}
      onCancel={() => cancel(doc)}
    >
      <div className="battman-head">
        <button type="button" onClick={() => send('select')}>
          Select block
        </button>
        <label className="cad-dialog-field">
          <span>Block:</span>
          <select value={request.block} onChange={(e) => send('apply', { next: e.target.value })}>
            {request.blocks.map((b) => (
              <option key={b.handle} value={b.handle}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => send('apply', { sync: true })}>
          Sync
        </button>
      </div>
      <div className="battman-body">
        <div className="battman-list-wrap">
          <table className="eattedit-list battman-list">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{COLUMN_LABELS[c]}</th>
                ))}
              </tr>
            </thead>
            <tbody
              role="listbox"
              aria-label="Attribute definitions"
              tabIndex={0}
              onKeyDown={(e) => {
                const next =
                  e.key === 'ArrowDown'
                    ? rows[index + 1]
                    : e.key === 'ArrowUp'
                      ? rows[index - 1]
                      : undefined;
                if (next) {
                  e.preventDefault();
                  setSelected(next.handle);
                }
              }}
            >
              {rows.map((r) => {
                const duplicate =
                  settings.emphasizeDuplicates && (tags.get(r.tag.toUpperCase()) ?? 0) > 1;
                return (
                  <tr
                    key={r.handle}
                    role="option"
                    aria-selected={r.handle === selected}
                    className={duplicate ? 'battman-duplicate' : undefined}
                    onClick={() => setSelected(r.handle)}
                    onDoubleClick={() => {
                      setSelected(r.handle);
                      setEditing(r);
                    }}
                  >
                    {columns.map((c) => (
                      <td key={c}>{cell(request, r, c)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="battman-side">
          <button type="button" disabled={!row || constant || index === 0} onClick={() => move(-1)}>
            Move Up
          </button>
          <button
            type="button"
            disabled={!row || constant || index === rows.length - 1}
            onClick={() => move(1)}
          >
            Move Down
          </button>
          <button type="button" disabled={!row} onClick={() => setEditing(row)}>
            Edit...
          </button>
          <button type="button" disabled={!row || rows.length <= 1} onClick={remove}>
            Remove
          </button>
        </div>
      </div>
      <p className="battman-found" data-testid="battman-found">
        <span>Found in drawing: {request.inDrawing}</span>
        <span>
          Found in {request.space}: {request.inSpace}
        </span>
      </p>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => setSettingsOpen(true)}>
          Settings...
        </button>
        <button type="button" onClick={() => send('ok')}>
          OK
        </button>
        <button type="button" onClick={() => cancel(doc)}>
          Cancel
        </button>
        <button type="button" disabled={!dirty} onClick={() => send('apply')}>
          Apply
        </button>
      </div>
      {editing && (
        <EditAttributeDialog
          block={request.blocks.find((b) => b.handle === request.block)?.name ?? ''}
          entry={editing}
          request={request}
          autoPreview={settings.autoPreview}
          canPreview={settings.applyToExisting}
          onAutoPreview={(on, e) => {
            const next = { ...settings, autoPreview: on };
            setSettings(next);
            saveBattmanSettings(next);
            // On, the drawing shows the changes made so far at once; off, it shows them once
            // they are applied.
            sendPreview(e, on);
          }}
          onChange={preview}
          onOk={(e) => {
            setRows(rows.map((r) => (r.handle === e.handle ? e : r)));
            setEditing(undefined);
          }}
          onCancel={() => {
            setEditing(undefined);
            preview();
          }}
        />
      )}
      {settingsOpen && (
        <BlockAttributeSettings
          settings={settings}
          onOk={(s) => {
            setSettings(s);
            saveBattmanSettings(s);
            setSettingsOpen(false);
          }}
          onCancel={() => setSettingsOpen(false)}
        />
      )}
    </Modal>
  );
}

type Tab = 'attribute' | 'text' | 'properties';

/** Edit Attribute, over the manager: the definition as OK leaves it goes back to the list. */
function EditAttributeDialog({
  block,
  entry,
  request,
  autoPreview,
  canPreview,
  onAutoPreview,
  onChange,
  onOk,
  onCancel,
}: {
  block: string;
  entry: Entry;
  request: Request;
  /** "Auto preview changes", and whether it is offered ("Apply changes to existing references"). */
  autoPreview: boolean;
  canPreview: boolean;
  onAutoPreview: (on: boolean, e: Entry) => void;
  /** The definition as it now stands, for the Auto preview. */
  onChange: (e: Entry) => void;
  onOk: (e: Entry) => void;
  onCancel: () => void;
}) {
  const [e, setE] = useState(entry);
  const [tab, setTab] = useState<Tab>('attribute');
  const [pickingColor, setPickingColor] = useState(false);
  const set = (patch: Partial<Entry>) => {
    const next = { ...e, ...patch };
    setE(next);
    onChange(next);
  };
  const tag = e.tag.trim();
  const tagProblem =
    tag === '' ? 'A tag is required.' : /\s/.test(tag) ? 'A tag cannot contain spaces.' : '';
  const constant = (e.flags & CONSTANT) !== 0;
  const ok = () => {
    if (!tagProblem) onOk({ ...e, tag: tag.toUpperCase() });
  };
  const flag = (bit: number, label: string, disabled = false) => (
    <label className="matchprop-check">
      <input
        type="checkbox"
        checked={(e.flags & bit) !== 0}
        disabled={disabled}
        onChange={(x) => set({ flags: x.target.checked ? e.flags | bit : e.flags & ~bit })}
      />
      {label}
    </label>
  );
  const TABS: readonly [Tab, string][] = [
    ['attribute', 'Attribute'],
    ['text', 'Text Options'],
    ['properties', 'Properties'],
  ];
  return (
    <Modal label="Edit Attribute" className="battman-edit" onOk={ok} onCancel={onCancel}>
      <p>
        Active Block: <strong data-testid="battman-active-block">{block}</strong>
      </p>
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
      <div role="tabpanel" className="cad-dialog-panel" key={tab}>
        {tab === 'attribute' && (
          <div className="battman-edit-attribute">
            <fieldset className="block-definition-group">
              <legend>Mode</legend>
              {flag(INVISIBLE, 'Invisible')}
              {/* A definition's kind: shown, not changed (AutoCAD greys them). */}
              {flag(CONSTANT, 'Constant', true)}
              {flag(VERIFY, 'Verify', constant)}
              {flag(PRESET, 'Preset', constant)}
              <label className="matchprop-check">
                <input type="checkbox" checked={e.multiline} disabled readOnly />
                Multiple lines
              </label>
            </fieldset>
            <fieldset className="block-definition-group">
              <legend>Data</legend>
              <label className="cad-dialog-field">
                <span>Tag:</span>
                <input
                  type="text"
                  value={e.tag}
                  aria-invalid={tagProblem !== ''}
                  onChange={(x) => set({ tag: x.target.value })}
                />
              </label>
              <label className="cad-dialog-field">
                <span>Prompt:</span>
                <input
                  type="text"
                  value={e.prompt}
                  disabled={constant}
                  onChange={(x) => set({ prompt: x.target.value })}
                />
              </label>
              <label className="cad-dialog-field">
                <span>Default:</span>
                {e.multiline ? (
                  <textarea
                    rows={3}
                    value={shownValue(e.value, true)}
                    onChange={(x) => set({ value: storedValue(x.target.value, true) })}
                  />
                ) : (
                  <input
                    type="text"
                    value={e.value}
                    onChange={(x) => set({ value: storedValue(x.target.value, false) })}
                  />
                )}
              </label>
              {tagProblem && (
                <p role="alert" className="cell-block-error">
                  {tagProblem}
                </p>
              )}
            </fieldset>
          </div>
        )}
        {tab === 'text' && (
          <AttributeTextOptions
            row={e}
            set={set}
            styles={request.styles}
            boundaryWidth={{
              value: e.boundaryWidth ?? 0,
              onChange: (v) => set({ boundaryWidth: v }),
            }}
          />
        )}
        {tab === 'properties' && (
          <AttributeProperties
            row={e}
            set={set}
            layers={request.layers}
            linetypes={request.linetypes}
            plotStyles={request.plotStyles}
            onSelectColor={() => setPickingColor(true)}
          />
        )}
      </div>
      {pickingColor && (
        <SelectColorDialog
          initial={e.color}
          books={request.colorBooks ?? []}
          trueColors
          onOk={(c) => {
            setPickingColor(false);
            set({ color: c });
          }}
          onCancel={() => setPickingColor(false)}
        />
      )}
      <div className="cad-dialog-buttons battman-edit-buttons">
        <label className="matchprop-check">
          <input
            type="checkbox"
            checked={autoPreview && canPreview}
            disabled={!canPreview}
            onChange={(x) => onAutoPreview(x.target.checked, e)}
          />
          Auto preview changes
        </label>
        <button type="button" disabled={tagProblem !== ''} onClick={ok}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Block Attribute Settings, over the manager. */
function BlockAttributeSettings({
  settings,
  onOk,
  onCancel,
}: {
  settings: BattmanSettings;
  onOk: (s: BattmanSettings) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(settings);
  const ok = () => onOk(s);
  const toggle = (c: BattmanColumn, on: boolean) =>
    setS({
      ...s,
      columns: BATTMAN_COLUMNS.filter((x) => (x === c ? on : s.columns.includes(x))),
    });
  return (
    <Modal
      label="Block Attribute Settings"
      className="battman-settings"
      onOk={ok}
      onCancel={onCancel}
    >
      <fieldset className="block-definition-group">
        <legend>Display in list</legend>
        <div className="battman-settings-columns">
          {BATTMAN_COLUMNS.map((c) => (
            <label key={c} className="matchprop-check">
              <input
                type="checkbox"
                checked={s.columns.includes(c)}
                // The list always shows the tags.
                disabled={c === 'tag'}
                onChange={(e) => toggle(c, e.target.checked)}
              />
              {COLUMN_LABELS[c]}
            </label>
          ))}
        </div>
        <div className="battman-settings-all">
          <button type="button" onClick={() => setS({ ...s, columns: [...BATTMAN_COLUMNS] })}>
            Select All
          </button>
          <button type="button" onClick={() => setS({ ...s, columns: ['tag'] })}>
            Clear All
          </button>
        </div>
      </fieldset>
      <label className="matchprop-check">
        <input
          type="checkbox"
          checked={s.emphasizeDuplicates}
          onChange={(e) => setS({ ...s, emphasizeDuplicates: e.target.checked })}
        />
        Emphasize duplicate tags
      </label>
      <label className="matchprop-check">
        <input
          type="checkbox"
          checked={s.applyToExisting}
          onChange={(e) => setS({ ...s, applyToExisting: e.target.checked })}
        />
        Apply changes to existing references
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
