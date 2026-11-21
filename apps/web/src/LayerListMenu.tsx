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
// - With a group filter selected in the filter tree (M5-07 part 5), Remove From Group Filter takes
//   the selected layers out of it (one LAYER step).
// - Reconcile Layer (M5-19 part 2; Help: "Removes new layers from the unreconciled layers filter.
//   Available only when an unreconciled layer is selected") reconciles the selected layers that
//   are unreconciled, one LAYER step. Triya shows it only then, so the menu otherwise keeps the
//   items it had.
// - Remove Viewport Overrides For (M6-02 part 12; Help: "Removes a single property override or
//   all property overrides on selected layers or all layers, for either the current viewport or
//   all viewports. ... To remove a single property override, right-click the property override
//   in the Layer list"), on a layout: Selected Layers or All Layers, each in the Current
//   Viewport Only (greyed in paper space, as no viewport is current) or All Viewports. AutoCAD
//   nests Selected Layers and All Layers as submenus of their own; Triya lists the four items in
//   one submenu, named "Selected Layers - Current Viewport Only" and so on, so the menu stays
//   one level deep. Right-clicked on a VP Color, VP Linetype, VP Lineweight or VP Transparency
//   cell, the item names that column ("Remove VP Color Overrides For") and removes only it.
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
  | 'removeFromGroup'
  | 'reconcile'
  | RemoveOverridesAction
  | 'all'
  | 'clear'
  | 'allButCurrent'
  | 'invert';

/** Remove Viewport Overrides For's items: whose layers, in which viewports. */
export type RemoveOverridesAction =
  'removeSelectedCurrent' | 'removeSelectedAll' | 'removeAllCurrent' | 'removeAllAll';

const REMOVE_ITEMS: readonly { readonly action: RemoveOverridesAction; readonly label: string }[] =
  [
    { action: 'removeSelectedCurrent', label: 'Selected Layers - Current Viewport Only' },
    { action: 'removeSelectedAll', label: 'Selected Layers - All Viewports' },
    { action: 'removeAllCurrent', label: 'All Layers - Current Viewport Only' },
    { action: 'removeAllAll', label: 'All Layers - All Viewports' },
  ];

/** Whether `a` is one of Remove Viewport Overrides For's items. */
export const isRemoveOverrides = (a: string): a is RemoveOverridesAction =>
  REMOVE_ITEMS.some((r) => r.action === a);

/** The edit a Remove Viewport Overrides For item asks for: which layers, which viewport. */
export function removeOverridesTarget(
  a: RemoveOverridesAction,
  selected: readonly Handle[],
  viewport: Handle | undefined,
): { readonly layers?: readonly Handle[]; readonly viewport?: Handle } | undefined {
  const current = a === 'removeSelectedCurrent' || a === 'removeAllCurrent';
  if (current && viewport === undefined) return undefined;
  const mine = a === 'removeSelectedCurrent' || a === 'removeSelectedAll';
  if (mine && selected.length === 0) return undefined;
  return {
    ...(mine && { layers: selected }),
    ...(current && viewport !== undefined && { viewport }),
  };
}

interface Item {
  readonly action: LayerListAction;
  readonly label: string;
  readonly separator?: boolean;
  /** Greyed unless one layer is selected, or any. */
  readonly needs?: 'one' | 'any';
  /** Shown only with a group filter selected. */
  readonly group?: true;
  /** Shown only with an unreconciled layer selected. */
  readonly reconcile?: true;
}

const ITEMS: readonly Item[] = [
  { action: 'current', label: 'Set current', needs: 'one' },
  { action: 'new', label: 'New Layer' },
  { action: 'rename', label: 'Rename Layer', needs: 'one' },
  { action: 'delete', label: 'Delete Layer', needs: 'any' },
  { action: 'description', label: 'Change Description', needs: 'one' },
  { action: 'merge', label: 'Merge Selected Layer(s) to...', needs: 'any', separator: true },
  { action: 'removeFromGroup', label: 'Remove From Group Filter', needs: 'any', group: true },
  { action: 'reconcile', label: 'Reconcile Layer', needs: 'any', reconcile: true },
  { action: 'all', label: 'Select All', separator: true },
  { action: 'clear', label: 'Clear All' },
  { action: 'allButCurrent', label: 'Select All but Current' },
  { action: 'invert', label: 'Invert Selection' },
];

export function LayerListMenu({
  at,
  selected,
  group = false,
  reconcile = false,
  overrides,
  onAction,
  onClose,
}: {
  at: { readonly x: number; readonly y: number };
  /** How many layers are selected. */
  selected: number;
  /** Whether a group filter is selected in the filter tree. */
  group?: boolean;
  /** Whether an unreconciled layer is selected (`reconcilable`). */
  reconcile?: boolean;
  /**
   * On a layout, Remove Viewport Overrides For: whether a layout viewport is current, and the
   * VP column right-clicked, if one was (its title, "VP Color").
   */
  overrides?: { readonly current: boolean; readonly column?: string | undefined } | undefined;
  onAction: (a: LayerListAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [removing, setRemoving] = useState(false);
  const removeLabel = `Remove ${overrides?.column ?? 'Viewport'} Overrides For`;
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
        } else if (
          (e.key === 'ArrowRight' || e.key === 'ArrowLeft') &&
          (document.activeElement as HTMLElement | null)?.dataset['opens'] === 'overrides'
        ) {
          e.preventDefault();
          setRemoving(e.key === 'ArrowRight');
        }
      }}
    >
      {ITEMS.filter((it) => (group || !it.group) && (reconcile || !it.reconcile)).flatMap((it) => [
        ...(it.action === 'all' && overrides
          ? [
              <button
                key="overrides"
                type="button"
                role="menuitem"
                className="snap-menu-item layer-list-submenu-item"
                aria-haspopup="menu"
                aria-expanded={removing}
                data-opens="overrides"
                data-separator="before"
                onClick={() => setRemoving((r) => !r)}
              >
                {removeLabel}
                <span aria-hidden className="layer-filter-submenu-arrow">
                  {removing ? '▾' : '▸'}
                </span>
              </button>,
              ...(removing
                ? REMOVE_ITEMS.map((r) => (
                    <button
                      key={r.action}
                      type="button"
                      role="menuitem"
                      className="snap-menu-item layer-list-subitem"
                      disabled={
                        (r.action.endsWith('Current') && !overrides.current) ||
                        (r.action.startsWith('removeSelected') && selected === 0)
                      }
                      onClick={() => {
                        onClose();
                        onAction(r.action);
                      }}
                    >
                      {r.label}
                    </button>
                  ))
                : []),
            ]
          : []),
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
        </button>,
      ])}
    </div>
  );
}

/** Whether Reconcile Layer is offered for the layers `selected`: one of them is unreconciled. */
export const reconcilable = (selected: readonly LayerRow[]): boolean =>
  selected.some((r) => r.unreconciled === true);

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
