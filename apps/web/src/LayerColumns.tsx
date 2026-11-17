// The Layer Properties Manager's column header menu and Customize Layer Columns (M5-05 part 3;
// AutoCAD 2024 Help, "Layer Properties Manager", "Customize Layer Columns Dialog Box").
// - A right-click on a column header (or Shift+F10 / the Menu key on it) lists the columns, each
//   checked while shown (Name is always shown, so it is not listed), then Customize... and
//   Restore All Columns to Defaults. A pick closes it, as AutoCAD's does; arrow keys move,
//   Enter or Space chooses, Esc or a click elsewhere closes it.
// - M5-05 part 5: the menu also has Maximize All Columns, Maximize Column, Optimize All Columns,
//   Optimize Column and Freeze Column (Unfreeze Column while one is frozen), for the column
//   right-clicked. A header dragged sideways moves its column before the one it is dropped on;
//   its right edge dragged sizes the column, a double-click on that edge optimizes it.
// - Customize Layer Columns: every column with a check box (Name checked and fixed), Move Up and
//   Move Down for the column chosen, Select All and Clear All; OK applies, Esc cancels.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Modal } from './AttributeDialogs';
import {
  DEFAULT_LAYER_COLUMNS,
  LAYER_COLUMNS,
  hideableLayerColumn,
  moveLayerColumn,
  type LayerColumnKey,
  type LayerColumnSettings,
} from './layer-columns';

const TITLE = new Map(LAYER_COLUMNS.map((c) => [c.key, c.title]));
const LAYOUT_ONLY = new Set(LAYER_COLUMNS.filter((c) => c.layoutOnly).map((c) => c.key));

/** The header menu's sizing items, for the column right-clicked or for all of them. */
export type LayerColumnSizing = 'maximize-all' | 'maximize' | 'optimize-all' | 'optimize';

const SIZING: readonly (readonly [LayerColumnSizing, string])[] = [
  ['maximize-all', 'Maximize All Columns'],
  ['maximize', 'Maximize Column'],
  ['optimize-all', 'Optimize All Columns'],
  ['optimize', 'Optimize Column'],
];

export function LayerColumnsMenu({
  at,
  settings,
  inLayout,
  onChange,
  onCustomize,
  onSize,
  onClose,
}: {
  at: { readonly x: number; readonly y: number; readonly column: LayerColumnKey };
  settings: LayerColumnSettings;
  inLayout: boolean;
  onChange: (s: LayerColumnSettings) => void;
  onCustomize: () => void;
  onSize: (how: LayerColumnSizing, column: LayerColumnKey) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);
  const listed = settings.order.filter(
    (k) => hideableLayerColumn(k) && (inLayout || !LAYOUT_ONLY.has(k)),
  );
  const toggle = (k: LayerColumnKey) => {
    const hidden = settings.hidden.includes(k)
      ? settings.hidden.filter((h) => h !== k)
      : [...settings.hidden, k];
    onChange({ ...settings, hidden });
    onClose();
  };
  return (
    <div
      ref={ref}
      className="snap-menu layer-columns-menu"
      role="menu"
      aria-label="Layer columns"
      style={{
        left: Math.min(at.x, window.innerWidth - 240),
        top: Math.min(at.y, Math.max(0, window.innerHeight - (listed.length + 8) * 28 - 40)),
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const list = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : list.length - 1;
          list[(i + step) % list.length]?.focus();
        }
      }}
    >
      {listed.map((k) => {
        const shown = !settings.hidden.includes(k);
        return (
          <button
            key={k}
            type="button"
            role="menuitemcheckbox"
            aria-checked={shown}
            className="osnap-menu-item"
            onClick={() => toggle(k)}
          >
            <span className="osnap-check" aria-hidden="true">
              {shown ? '✓' : ''}
            </span>
            {TITLE.get(k)}
          </button>
        );
      })}
      <button
        type="button"
        role="menuitem"
        className="snap-menu-item"
        data-separator="before"
        onClick={onCustomize}
      >
        Customize...
      </button>
      {SIZING.map(([how, label], i) => (
        <button
          key={how}
          type="button"
          role="menuitem"
          className="snap-menu-item"
          data-separator={i === 0 ? 'before' : undefined}
          onClick={() => {
            onSize(how, at.column);
            onClose();
          }}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        role="menuitem"
        className="snap-menu-item"
        data-separator="before"
        onClick={() => {
          // One column is frozen at a time: the item unfreezes it, whichever header is clicked.
          const { frozen, ...rest } = settings;
          onChange(frozen ? rest : { ...settings, frozen: at.column });
          onClose();
        }}
      >
        {settings.frozen ? 'Unfreeze Column' : 'Freeze Column'}
      </button>
      <button
        type="button"
        role="menuitem"
        className="snap-menu-item"
        onClick={() => {
          onChange({ ...DEFAULT_LAYER_COLUMNS, sort: settings.sort });
          onClose();
        }}
      >
        Restore All Columns to Defaults
      </button>
    </div>
  );
}

/** Pointer travel (px) before a press on a header is a drag rather than a click. */
const DRAG_PX = 4;

/**
 * A column's header: a click sorts by it, Shift+F10 (or the Menu key) opens the header menu, a
 * sideways drag moves the column (the header it would go before is marked while dragging), and
 * the grip on its right edge sizes it (a double-click on the grip optimizes it).
 */
export function LayerColumnHeader({
  columnKey,
  title,
  sort,
  onSort,
  onMenu,
  onMove,
  onResize,
  onOptimize,
}: {
  columnKey: LayerColumnKey;
  title: string;
  sort: 'ascending' | 'descending' | undefined;
  onSort: () => void;
  onMenu: (at: { x: number; y: number }) => void;
  /** Dropped before `before` (`undefined`: after the last column). */
  onMove: (before: LayerColumnKey | undefined) => void;
  /** The column's width while its edge is dragged; `done` once it is let go. */
  onResize: (width: number, done: boolean) => void;
  onOptimize: () => void;
}) {
  const drag = useRef<{ x: number; moved: boolean; before?: LayerColumnKey | 'end' }>(undefined);
  const dropMark = (th: Element | null, before: LayerColumnKey | 'end' | undefined) => {
    const row = th?.parentElement;
    if (!row) return;
    for (const h of row.querySelectorAll<HTMLElement>('th[data-col]')) delete h.dataset['drop'];
    if (before === undefined) return;
    const heads = [...row.querySelectorAll<HTMLElement>('th[data-col]')];
    const at = before === 'end' ? heads.at(-1) : heads.find((h) => h.dataset['col'] === before);
    if (at) at.dataset['drop'] = before === 'end' ? 'after' : 'before';
  };
  /** The header the pointer is before: the first whose middle is right of it. */
  const dropAt = (th: Element, x: number): LayerColumnKey | 'end' => {
    const heads = [...(th.parentElement?.querySelectorAll<HTMLElement>('th[data-col]') ?? [])];
    const next = heads.find((h) => {
      const r = h.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    return (next?.dataset['col'] as LayerColumnKey | undefined) ?? 'end';
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLTableCellElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLTableCellElement>) => {
    const d = drag.current;
    if (!d || (!d.moved && Math.abs(e.clientX - d.x) < DRAG_PX)) return;
    const th = e.currentTarget;
    // Captured only once it is a drag, so that a plain click still reaches the sort button.
    if (!d.moved) th.setPointerCapture(e.pointerId);
    d.moved = true;
    th.dataset['dragging'] = 'true';
    d.before = dropAt(th, e.clientX);
    dropMark(th, d.before);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLTableCellElement>) => {
    const d = drag.current;
    if (!d?.moved) {
      drag.current = undefined;
      return;
    }
    const th = e.currentTarget;
    delete th.dataset['dragging'];
    dropMark(th, undefined);
    // The click that follows the drag's release is not a sort (cleared on that click).
    if (d.before !== undefined) onMove(d.before === 'end' ? undefined : d.before);
  };
  const onGripDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const start = e.clientX;
    const width = grip.closest('th')?.getBoundingClientRect().width ?? 0;
    const move = (m: PointerEvent) => onResize(width + m.clientX - start, false);
    const up = (u: PointerEvent) => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      onResize(width + u.clientX - start, true);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };
  return (
    <th
      data-col={columnKey}
      scope="col"
      aria-sort={sort}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        drag.current = undefined;
        delete e.currentTarget.dataset['dragging'];
        dropMark(e.currentTarget, undefined);
      }}
    >
      <button
        type="button"
        className="layer-sort"
        title={`Sort by ${title}`}
        onClick={() => {
          const dragged = drag.current?.moved;
          drag.current = undefined;
          if (!dragged) onSort();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault();
            const box = e.currentTarget.getBoundingClientRect();
            onMenu({ x: box.left, y: box.bottom });
          }
        }}
      >
        {title}
        {sort && (
          <span className="layer-sort-arrow" aria-hidden>
            {sort === 'descending' ? '▼' : '▲'}
          </span>
        )}
      </button>
      <span
        className="layer-col-grip"
        aria-hidden
        title={`Size ${title}`}
        onPointerDown={onGripDown}
        onDoubleClick={onOptimize}
      />
    </th>
  );
}

export function CustomizeLayerColumnsDialog({
  settings,
  onOk,
  onCancel,
}: {
  settings: LayerColumnSettings;
  onOk: (s: LayerColumnSettings) => void;
  onCancel: () => void;
}) {
  const [order, setOrder] = useState(settings.order);
  const [hidden, setHidden] = useState<ReadonlySet<LayerColumnKey>>(new Set(settings.hidden));
  const [chosen, setChosen] = useState<LayerColumnKey>(order[0]!);
  const list = useRef<HTMLUListElement>(null);
  const ok = () => onOk({ ...settings, order, hidden: order.filter((k) => hidden.has(k)) });
  const move = (by: -1 | 1) => {
    setOrder(moveLayerColumn(order, chosen, by));
    // The column moved keeps the focus, so Move Up can be pressed again from the keyboard.
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLInputElement>(`input[data-column="${chosen}"]`)?.focus(),
    );
  };
  const at = order.indexOf(chosen);
  return (
    <Modal
      label="Customize Layer Columns"
      className="layer-columns-dialog"
      onOk={ok}
      onCancel={onCancel}
    >
      <p>
        Check the columns to display. Select a column name and click Move Up or Move Down to change
        the order.
      </p>
      <div className="layer-columns-body">
        <ul ref={list} className="layer-columns-list" aria-label="Columns">
          {order.map((k) => (
            <li key={k} aria-current={k === chosen ? 'true' : undefined}>
              <label>
                <input
                  type="checkbox"
                  data-column={k}
                  checked={!hidden.has(k)}
                  // Name is always shown; it stays focusable so that it can be moved.
                  aria-disabled={!hideableLayerColumn(k) || undefined}
                  autoFocus={k === chosen}
                  onFocus={() => setChosen(k)}
                  onChange={(e) => {
                    if (!hideableLayerColumn(k)) return;
                    const next = new Set(hidden);
                    if (e.currentTarget.checked) next.delete(k);
                    else next.add(k);
                    setHidden(next);
                  }}
                />
                {TITLE.get(k)}
              </label>
            </li>
          ))}
        </ul>
        <div className="layer-columns-actions">
          <button type="button" disabled={at <= 0} onClick={() => move(-1)}>
            Move Up
          </button>
          <button type="button" disabled={at >= order.length - 1} onClick={() => move(1)}>
            Move Down
          </button>
          <button type="button" onClick={() => setHidden(new Set())}>
            Select All
          </button>
          <button
            type="button"
            onClick={() => setHidden(new Set(order.filter((k) => hideableLayerColumn(k))))}
          >
            Clear All
          </button>
        </div>
      </div>
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
