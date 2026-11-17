// The Layer Properties Manager's layer list menu and Merge to Layer dialog (M5-05 part 4; AutoCAD
// 2024 Help, "Layer Properties Manager", the layer list's shortcut menu).
// - A right-click on a layer (or Shift+F10 / the menu key on a focused row) selects it unless it
//   is selected already, and shows the menu: Set Current, New Layer, Rename Layer, Delete Layer,
//   Change Description, Merge Selected Layer(s) to..., then Select All, Clear All, Select All
//   but Current and Invert Selection.
// - Merge Selected Layer(s) to... opens Merge to Layer: the Target Layer list holds the layers
//   not selected (an xref's layers left out, as nothing can go on them). OK asks, as AutoCAD
//   does, whether to merge, and Yes merges them: their objects go to the target layer and they
//   are purged (one LAYER undo step).
import { useEffect, useRef, useState } from 'react';
import type { Handle } from '@triya/engine';
import { Modal } from './AttributeDialogs';
import type { LayerRow } from './layers';

export type LayerListAction =
  | 'current'
  | 'new'
  | 'rename'
  | 'delete'
  | 'description'
  | 'merge'
  | 'all'
  | 'clear'
  | 'allButCurrent'
  | 'invert';

interface Item {
  readonly action: LayerListAction;
  readonly label: string;
  readonly separator?: boolean;
  /** Greyed unless one layer is selected, or any. */
  readonly needs?: 'one' | 'any';
}

const ITEMS: readonly Item[] = [
  { action: 'current', label: 'Set current', needs: 'one' },
  { action: 'new', label: 'New Layer' },
  { action: 'rename', label: 'Rename Layer', needs: 'one' },
  { action: 'delete', label: 'Delete Layer', needs: 'any' },
  { action: 'description', label: 'Change Description', needs: 'one' },
  { action: 'merge', label: 'Merge Selected Layer(s) to...', needs: 'any', separator: true },
  { action: 'all', label: 'Select All', separator: true },
  { action: 'clear', label: 'Clear All' },
  { action: 'allButCurrent', label: 'Select All but Current' },
  { action: 'invert', label: 'Invert Selection' },
];

export function LayerListMenu({
  at,
  selected,
  onAction,
  onClose,
}: {
  at: { readonly x: number; readonly y: number };
  /** How many layers are selected. */
  selected: number;
  onAction: (a: LayerListAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="snap-menu layer-list-menu"
      role="menu"
      aria-label="Layer list"
      style={{
        left: Math.min(at.x, window.innerWidth - 260),
        top: Math.min(at.y, Math.max(0, window.innerHeight - ITEMS.length * 28 - 40)),
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const list = [
          ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
        ];
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
      {ITEMS.map((it) => (
        <button
          key={it.action}
          type="button"
          role="menuitem"
          className="snap-menu-item"
          data-separator={it.separator ? 'before' : undefined}
          disabled={
            (it.needs === 'one' && selected !== 1) || (it.needs === 'any' && selected === 0)
          }
          onClick={() => {
            onClose();
            onAction(it.action);
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** The layers a merge may go into: those not merged, and none of an xref's. */
export function mergeTargets(rows: readonly LayerRow[], merged: ReadonlySet<Handle>): LayerRow[] {
  return rows.filter((r) => !merged.has(r.handle) && r.xref !== true);
}

/** AutoCAD's question before a merge. */
export function mergeQuestion(names: readonly string[], target: string): string {
  const which =
    names.length === 1 ? `layer "${names[0]}"` : `layers ${names.map((n) => `"${n}"`).join(', ')}`;
  return `Merging ${which} into layer "${target}". Do you want to continue?`;
}

export function MergeToLayerDialog({
  layers,
  targets,
  onMerge,
  onCancel,
}: {
  /** The layers merged, by name. */
  layers: readonly string[];
  /** The layers they may go into, in the manager's order. */
  targets: readonly LayerRow[];
  onMerge: (target: Handle) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<Handle | undefined>(targets[0]?.handle);
  const [asking, setAsking] = useState(false);
  const target = targets.find((t) => t.handle === chosen);
  const ok = () => {
    if (asking) {
      if (chosen !== undefined) onMerge(chosen);
    } else if (target) setAsking(true);
  };
  return (
    <Modal label="Merge to Layer" className="merge-to-layer" onOk={ok} onCancel={onCancel}>
      <label className="merge-to-layer-list">
        <span>Target Layer:</span>
        <select
          size={10}
          aria-label="Target Layer"
          autoFocus
          disabled={asking}
          value={chosen ?? ''}
          onChange={(e) => setChosen(e.currentTarget.value)}
          onDoubleClick={ok}
        >
          {targets.map((t) => (
            <option key={t.handle} value={t.handle}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {asking && target ? (
        <div role="alertdialog" aria-label="Merge to Layer - Confirm" className="new-view-replace">
          <p>{mergeQuestion(layers, target.name)}</p>
          <button type="button" autoFocus onClick={() => onMerge(target.handle)}>
            Yes
          </button>
          <button type="button" onClick={() => setAsking(false)}>
            No
          </button>
        </div>
      ) : (
        <div className="cad-dialog-buttons">
          <button type="button" disabled={!target} onClick={ok}>
            OK
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </Modal>
  );
}
