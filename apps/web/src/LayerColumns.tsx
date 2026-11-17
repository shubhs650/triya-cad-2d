// The Layer Properties Manager's column header menu and Customize Layer Columns (M5-05 part 3;
// AutoCAD 2024 Help, "Layer Properties Manager", "Customize Layer Columns Dialog Box").
// - A right-click on a column header (or Shift+F10 / the Menu key on it) lists the columns, each
//   checked while shown (Name is always shown, so it is not listed), then Customize... and
//   Restore All Columns to Defaults. A pick closes it, as AutoCAD's does; arrow keys move,
//   Enter or Space chooses, Esc or a click elsewhere closes it.
// - Customize Layer Columns: every column with a check box (Name checked and fixed), Move Up and
//   Move Down for the column chosen, Select All and Clear All; OK applies, Esc cancels.
import { useEffect, useRef, useState } from 'react';
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

export function LayerColumnsMenu({
  at,
  settings,
  inLayout,
  onChange,
  onCustomize,
  onClose,
}: {
  at: { readonly x: number; readonly y: number };
  settings: LayerColumnSettings;
  inLayout: boolean;
  onChange: (s: LayerColumnSettings) => void;
  onCustomize: () => void;
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
        top: Math.min(at.y, Math.max(0, window.innerHeight - (listed.length + 2) * 28 - 24)),
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
