// PURGE's Purge dialog (M5-09 part 2), with AutoCAD 2024's structure and labels (AutoCAD Help,
// "Purge Dialog Box"; UI_SPEC.md §7). Two views at the top:
// - Purgeable Items: "Named Items Not Used", a tree of All Items, each object type with how many
//   it holds, and the items, each with a check box (checking a type or All Items checks what it
//   holds); Preview of the item clicked (a block's drawing); Options "Confirm each item to be
//   purged" and "Purge nested items"; Purge Unnamed Objects "Zero-length geometry", "Empty text
//   objects" and "Orphaned data" (the DGN linestyle data no linetype uses, M5-09 part 5), each
//   with how many it would take; Purge Checked Items and Purge All. What a purge did shows at the lower left.
// - Find Non-Purgeable Items: "Named Items In Use", Preview, Possible Reasons and Details of the
//   item clicked, and Select Objects, which closes the dialog with the objects using the item
//   selected and zoomed to.
// The trees are keyboard-operable as tree views (Up/Down, Right opens or goes in, Left closes or
// goes out, Space checks). Close and Esc close it. PURGE's Confirm Purge ("Purge layer "OLD"?":
// Purge this item, Purge all items, Skip this item; Esc skips) is `PurgeConfirmDialog`. AutoCAD's
// Help button is left out, as Triya's other dialogs leave it.
import {
  PURGE_RULES,
  type DialogRequest,
  type Handle,
  type PromptAnswer,
  type PurgeAnswer,
  type PurgeCategory,
  type PurgeItem,
  type PurgeSettings,
  type PurgeView,
} from '@triya/engine';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { StylePreview } from './StylePreview';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'purge' }>;
type ConfirmRequest = Extract<DialogRequest, { type: 'purgeconfirm' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const PREVIEW = { width: 160, height: 120 };

/** The object types the tree lists, by their titles as AutoCAD's tree sorts them. */
const CATEGORIES: readonly PurgeCategory[] = (Object.keys(PURGE_RULES) as PurgeCategory[])
  .filter((c) => c !== 'appIds')
  .sort((a, b) => PURGE_RULES[a].title.localeCompare(PURGE_RULES[b].title));

const ALL_KEY = 'all';

/** One row the tree shows. */
interface Row {
  readonly key: string;
  readonly label: string;
  readonly level: 1 | 2 | 3;
  /** A branch: whether it is open. */
  readonly open?: boolean;
  /** The items under it (an item: itself). */
  readonly items: readonly PurgeItem[];
  readonly parent?: string;
  readonly item?: PurgeItem;
}

function rowsOf(items: readonly PurgeItem[], open: ReadonlySet<string>): Row[] {
  const out: Row[] = [
    { key: ALL_KEY, label: 'All Items', level: 1, open: open.has(ALL_KEY), items },
  ];
  if (!open.has(ALL_KEY)) return out;
  for (const c of CATEGORIES) {
    const of = items.filter((i) => i.category === c);
    out.push({
      key: c,
      label: `${PURGE_RULES[c].title} (${of.length})`,
      level: 2,
      ...(of.length > 0 && { open: open.has(c) }),
      items: of,
      parent: ALL_KEY,
    });
    if (!open.has(c)) continue;
    for (const i of of)
      out.push({ key: i.handle, label: i.name, level: 3, items: [i], parent: c, item: i });
  }
  return out;
}

const round = (n: number) => String(Math.round(n * 1e4) / 1e4);

/**
 * A tree of the named items: the view's rows, with check boxes when `checked` is given. Clicking
 * a row makes it the active one (`onActive`).
 */
function ItemTree({
  label,
  items,
  active,
  onActive,
  checked,
  onCheck,
}: {
  label: string;
  items: readonly PurgeItem[];
  active: string;
  onActive: (row: Row) => void;
  checked?: ReadonlySet<Handle>;
  onCheck?: (items: readonly PurgeItem[], on: boolean) => void;
}) {
  const labelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set([ALL_KEY]));
  const rows = useMemo(() => rowsOf(items, open), [items, open]);
  const at = Math.max(
    0,
    rows.findIndex((r) => r.key === active),
  );
  const current = rows[at];
  const stateOf = (r: Row): boolean | 'mixed' => {
    if (!checked || r.items.length === 0) return false;
    const n = r.items.filter((i) => checked.has(i.handle)).length;
    return n === 0 ? false : n === r.items.length ? true : 'mixed';
  };

  const toggle = (key: string, to?: boolean) => {
    const next = new Set(open);
    if (to ?? !next.has(key)) next.add(key);
    else next.delete(key);
    setOpen(next);
  };
  const focusRow = (row: Row | undefined) => {
    if (!row) return;
    onActive(row);
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(row.key)}"]`)?.focus(),
    );
  };
  const check = (r: Row) => onCheck?.(r.items, stateOf(r) !== true);
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!current) return;
    const move = (i: number) => {
      e.preventDefault();
      focusRow(rows[Math.max(0, Math.min(rows.length - 1, i))]);
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(rows.length - 1);
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (current.open === undefined) return;
      if (!current.open) toggle(current.key, true);
      else move(at + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (current.open) toggle(current.key, false);
      else focusRow(rows.find((r) => r.key === current.parent));
    } else if (e.key === 'Enter') {
      // Enter in the tree opens or closes a type; it does not close the dialog.
      e.preventDefault();
      e.stopPropagation();
      if (current.open !== undefined) toggle(current.key);
    } else if (e.key === ' ' && onCheck) {
      e.preventDefault();
      check(current);
    }
  };

  return (
    <div className="purge-tree-group">
      <span id={labelId}>{label}</span>
      <div
        ref={ref}
        role="tree"
        aria-labelledby={labelId}
        className="xbind-tree purge-tree"
        onKeyDown={keys}
      >
        {rows.map((r) => {
          const state = stateOf(r);
          return (
            <div
              key={r.key}
              data-key={r.key}
              role="treeitem"
              aria-label={r.label}
              aria-level={r.level}
              aria-expanded={r.open}
              aria-selected={r === current}
              aria-checked={onCheck ? state : undefined}
              tabIndex={r === current ? 0 : -1}
              className={`xbind-item xbind-level-${r.level}`}
              onClick={() => onActive(r)}
              onDoubleClick={() => r.open !== undefined && toggle(r.key)}
            >
              <span
                className="xbind-twisty"
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  if (r.open !== undefined) toggle(r.key);
                }}
              >
                {r.open === undefined ? '' : r.open ? '−' : '+'}
              </span>
              {onCheck && (
                <input
                  type="checkbox"
                  tabIndex={-1}
                  aria-label={r.label}
                  checked={state === true}
                  disabled={r.items.length === 0}
                  ref={(el) => {
                    if (el) el.indeterminate = state === 'mixed';
                  }}
                  onChange={() => check(r)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              {r.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PurgeDialog({ doc, request }: { doc: number; request: Request }) {
  const reasonsId = useId();
  const [view, setView] = useState<PurgeView>(request.view);
  const [settings, setSettings] = useState<PurgeSettings>(request.settings);
  const [checked, setChecked] = useState<ReadonlySet<Handle>>(new Set());
  const [active, setActive] = useState<Record<PurgeView, string>>({
    purgeable: ALL_KEY,
    inUse: ALL_KEY,
  });
  // A purge leaves the items still in the drawing checked.
  useEffect(() => {
    setChecked((c) => {
      const has = new Set(request.purgeable.map((i) => i.handle));
      return new Set([...c].filter((h) => has.has(h)));
    });
  }, [request.purgeable]);

  const items = view === 'purgeable' ? request.purgeable : request.inUse;
  const picked = items.find((i) => i.handle === active[view]);
  const preview = useMemo(
    () =>
      picked?.category === 'blocks' ? { kind: 'block' as const, block: picked.handle } : undefined,
    [picked],
  );
  const reasons =
    view === 'inUse' ? request.inUse.find((i) => i.handle === picked?.handle) : undefined;
  const details =
    request.details && request.details.handle === picked?.handle ? request.details : undefined;

  const send = (action: 'apply' | 'ok' | 'select', patch: PurgeAnswer = {}) =>
    void answer(doc, { kind: 'dialog', action, purge: { view, settings, ...patch } });
  const close = () => send('ok');
  const onActive = (row: Row) => {
    setActive({ ...active, [view]: row.key });
    // An item in use clicked: its Details.
    if (view === 'inUse' && row.item) send('apply', { details: row.item.handle });
  };
  const onCheck = (of: readonly PurgeItem[], on: boolean) => {
    const next = new Set(checked);
    for (const i of of) {
      if (on) next.add(i.handle);
      else next.delete(i.handle);
    }
    setChecked(next);
  };
  const option = (key: keyof PurgeSettings, label: string) => (
    <label className="purge-check">
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(e) => setSettings({ ...settings, [key]: e.currentTarget.checked })}
      />
      {label}
    </label>
  );
  const unnamed = settings.zeroLength || settings.emptyText || settings.orphaned;

  return (
    <Modal label="Purge" className="purge-dialog" onOk={close} onCancel={close}>
      <div role="tablist" className="cad-dialog-tabs" aria-label="Views">
        {(
          [
            ['purgeable', 'Purgeable Items'],
            ['inUse', 'Find Non-Purgeable Items'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="purge-body">
        {view === 'purgeable' ? (
          <ItemTree
            key="purgeable"
            label="Named Items Not Used"
            items={request.purgeable}
            active={active.purgeable}
            onActive={onActive}
            checked={checked}
            onCheck={onCheck}
          />
        ) : (
          <ItemTree
            key="inUse"
            label="Named Items In Use"
            items={request.inUse}
            active={active.inUse}
            onActive={onActive}
          />
        )}
        <div className="purge-side">
          <span>Preview</span>
          <StylePreview doc={doc} preview={preview} size={PREVIEW} testId="purge-preview" />
          {view === 'purgeable' ? (
            <>
              <fieldset>
                <legend>Options</legend>
                {option('confirm', 'Confirm each item to be purged')}
                {option('nested', 'Purge nested items')}
              </fieldset>
              <fieldset>
                <legend>Purge Unnamed Objects</legend>
                {option('zeroLength', `Zero-length geometry (${request.zeroLength})`)}
                {option('emptyText', `Empty text objects (${request.emptyText})`)}
                {option('orphaned', `Orphaned data (${request.orphaned})`)}
              </fieldset>
            </>
          ) : (
            <>
              <span id={reasonsId}>Possible Reasons</span>
              <ul className="purge-reasons" aria-labelledby={reasonsId} data-testid="purge-reasons">
                {(reasons?.reasons ?? []).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <span>Details</span>
              <dl className="purge-details" data-testid="purge-details">
                {details && (
                  <>
                    <dt>Objects</dt>
                    <dd>
                      {details.objects}
                      {details.spaces.length > 0 &&
                        ` (${details.spaces.map((s) => `${s.name}: ${s.objects}`).join(', ')})`}
                    </dd>
                    {details.extents && (
                      <>
                        <dt>Location</dt>
                        <dd>
                          {round(details.extents.minX)},{round(details.extents.minY)} to{' '}
                          {round(details.extents.maxX)},{round(details.extents.maxY)}
                        </dd>
                        <dt>Size</dt>
                        <dd>
                          {round(details.extents.maxX - details.extents.minX)} x{' '}
                          {round(details.extents.maxY - details.extents.minY)}
                        </dd>
                      </>
                    )}
                  </>
                )}
              </dl>
              <button
                type="button"
                disabled={!details || details.here === 0}
                onClick={() => send('select', { details: details!.handle })}
              >
                Select Objects
              </button>
            </>
          )}
        </div>
      </div>
      <div className="cad-dialog-buttons purge-buttons">
        <p role="status" className="purge-note">
          {request.note ?? ''}
        </p>
        {view === 'purgeable' && (
          <>
            <button
              type="button"
              disabled={checked.size === 0 && !unnamed}
              onClick={() => send('apply', { run: 'checked', checked: [...checked] })}
            >
              Purge Checked Items
            </button>
            <button
              type="button"
              disabled={request.purgeable.length === 0 && !unnamed}
              onClick={() => send('apply', { run: 'all' })}
            >
              Purge All
            </button>
          </>
        )}
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  );
}

/** PURGE's Confirm Purge: "Purge layer "OLD"?" */
export function PurgeConfirmDialog({ doc, request }: { doc: number; request: ConfirmRequest }) {
  const say = (confirm: 'this' | 'all' | 'skip') =>
    void answer(doc, { kind: 'dialog', action: 'ok', purge: { confirm } });
  return (
    <Modal
      label="Purge - Confirm Purge"
      className="purge-confirm-dialog"
      onOk={() => say('this')}
      onCancel={() => say('skip')}
    >
      <p>
        Purge {request.one} &quot;{request.name}&quot;?
      </p>
      <div className="purge-confirm-buttons">
        <button type="button" autoFocus onClick={() => say('this')}>
          Purge this item
        </button>
        <button type="button" onClick={() => say('all')}>
          Purge all items
        </button>
        <button type="button" onClick={() => say('skip')}>
          Skip this item
        </button>
      </div>
    </Modal>
  );
}
