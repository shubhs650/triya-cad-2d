// The Layer Properties Manager's filter tree (M5-07 part 5; AutoCAD 2024 Help, "Layer Properties
// Manager"): All, and under it All Used Layers and the drawing's filters, each nested filter under
// its parent. Selecting a node lists its layers; "Invert filter" lists the others.
// - A right-click on a node (Shift+F10 or the menu key on the focused one) opens the filter menu:
//   Visibility, Lock, Viewport and Isolate Group on the node's layers (part 6), New Properties
//   Filter..., New Group Filter, Convert to Group Filter (part 6), Rename, Delete, Properties... (a
//   property filter's Layer Filter Properties). On a filter the new one is nested in it; a group
//   filter cannot be nested in a property filter, so New Group Filter is greyed there. All and
//   All Used Layers cannot be renamed or deleted.
// - A filter's name is renamed in place (F2, or a double-click on a group filter; a double-click
//   on a property filter opens its properties); Enter keeps it, Esc does not, Delete deletes.
// - Layers dragged from the list onto a group filter are put in it.
// - While a layer is unreconciled, Unreconciled New Layers (M5-19 part 2) comes after All Used
//   Layers; its menu is the Xref node's. Viewport Overrides (M6-02 part 12) comes after it while
//   the layout viewport made current overrides a layer, with the same menu.
// - When the drawing has xrefs, the Xref node comes after the filters, with a node for each xref
//   (part 8); their menus offer Visibility, Lock and Isolate Group, not new filters.
// - Keyboard: ↑/↓ move between the nodes shown, ← closes a node or goes to its parent, → opens
//   it; the selected node is the tree's one focusable item.
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  UNRECONCILED_NODE,
  XREF_NODE,
  xrefNode,
  type Handle,
  type LayerFilter,
} from '@triya/engine';
import {
  FILTER_MENU,
  filterMenuEnabled,
  type FilterChoice,
  type FilterMenuContext,
  type FilterMenuEntry,
  type LayerFilterAction,
  type LayerFilterNode,
} from './layer-filters';

/** The data type a drag of layer rows carries: their handles as JSON. */
export const LAYER_DRAG_TYPE = 'application/x-triya-layers';

export type { LayerFilterAction };

/** One node as the tree shows it. */
interface Shown {
  readonly choice: FilterChoice;
  readonly name: string;
  readonly level: number;
  readonly filter?: LayerFilter;
  readonly parent?: FilterChoice;
  readonly hasChildren: boolean;
}

function shownNodes(
  tree: readonly LayerFilterNode[],
  xrefs: readonly string[],
  unreconciled: boolean,
  overrides: FilterChoice | undefined,
  closed: ReadonlySet<FilterChoice>,
): Shown[] {
  const out: Shown[] = [{ choice: 'all', name: 'All', level: 1, hasChildren: true }];
  if (closed.has('all')) return out;
  out.push({
    choice: 'used',
    name: 'All Used Layers',
    level: 2,
    parent: 'all',
    hasChildren: false,
  });
  if (unreconciled)
    out.push({
      choice: UNRECONCILED_NODE,
      name: 'Unreconciled New Layers',
      level: 2,
      parent: 'all',
      hasChildren: false,
    });
  if (overrides !== undefined)
    out.push({
      choice: overrides,
      name: 'Viewport Overrides',
      level: 2,
      parent: 'all',
      hasChildren: false,
    });
  const walk = (nodes: readonly LayerFilterNode[], level: number, parent: FilterChoice) => {
    for (const n of nodes) {
      const h = n.filter.handle;
      out.push({
        choice: h,
        name: n.filter.name,
        level,
        filter: n.filter,
        parent,
        hasChildren: n.children.length > 0,
      });
      if (!closed.has(h)) walk(n.children, level + 1, h);
    }
  };
  walk(tree, 2, 'all');
  if (xrefs.length === 0) return out;
  out.push({ choice: XREF_NODE, name: 'Xref', level: 2, parent: 'all', hasChildren: true });
  if (closed.has(XREF_NODE)) return out;
  for (const name of xrefs)
    out.push({ choice: xrefNode(name), name, level: 3, parent: XREF_NODE, hasChildren: false });
  return out;
}

export function LayerFilterTree({
  tree,
  xrefs,
  unreconciled = false,
  viewportOverrides,
  choice,
  invert,
  renaming,
  onChoose,
  onInvert,
  onRename,
  onMenu,
  onAction,
  onDropLayers,
  onCollapse,
}: {
  tree: readonly LayerFilterNode[];
  /** The drawing's xrefs, by name: the Xref node's children. */
  xrefs: readonly string[];
  /** Whether a layer is unreconciled: Unreconciled New Layers is shown. */
  unreconciled?: boolean;
  /** The Viewport Overrides node of the viewport made current, while it overrides a layer. */
  viewportOverrides?: FilterChoice | undefined;
  choice: FilterChoice;
  invert: boolean;
  /** The filter whose name is being typed in place. */
  renaming: Handle | undefined;
  onChoose: (c: FilterChoice) => void;
  onInvert: (invert: boolean) => void;
  /** The name typed in place, or undefined when it was cancelled. */
  onRename: (filter: Handle, name: string | undefined) => void;
  onMenu: (c: FilterChoice, at: { x: number; y: number }) => void;
  onAction: (a: LayerFilterAction, c: FilterChoice) => void;
  onDropLayers: (filter: Handle, layers: Handle[]) => void;
  /** Collapses the tree, leaving the list the palette's width. */
  onCollapse: () => void;
}) {
  const [closed, setClosed] = useState<ReadonlySet<FilterChoice>>(new Set());
  const [dropping, setDropping] = useState<Handle | undefined>();
  const ref = useRef<HTMLUListElement>(null);
  const nodes = shownNodes(tree, xrefs, unreconciled, viewportOverrides, closed);
  // The selected node may be inside a closed one: then its nearest open ancestor takes the focus.
  const focusable = nodes.some((n) => n.choice === choice) ? choice : 'all';
  const focus = (c: FilterChoice) =>
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>(`[data-choice="${CSS.escape(c)}"]`)?.focus(),
    );
  // A rename ended (or a new filter chosen): the tree keeps the focus it had.
  const wasRenaming = useRef(renaming);
  useEffect(() => {
    if (wasRenaming.current !== undefined && renaming === undefined) focus(choice);
    wasRenaming.current = renaming;
  }, [renaming, choice]);

  const setOpen = (c: FilterChoice, open: boolean) => {
    const next = new Set(closed);
    if (open) next.delete(c);
    else next.add(c);
    setClosed(next);
  };

  const onKey = (e: KeyboardEvent, n: Shown) => {
    if (e.target !== e.currentTarget) return;
    const i = nodes.indexOf(n);
    const go = (to: Shown | undefined) => {
      if (!to) return;
      e.preventDefault();
      onChoose(to.choice);
      focus(to.choice);
    };
    if (e.key === 'ArrowDown') go(nodes[i + 1]);
    else if (e.key === 'ArrowUp') go(nodes[i - 1]);
    else if (e.key === 'Home') go(nodes[0]);
    else if (e.key === 'End') go(nodes.at(-1));
    else if (e.key === 'ArrowRight' && n.hasChildren && closed.has(n.choice)) {
      e.preventDefault();
      setOpen(n.choice, true);
    } else if (e.key === 'ArrowLeft') {
      if (n.hasChildren && !closed.has(n.choice)) {
        e.preventDefault();
        setOpen(n.choice, false);
      } else go(nodes.find((p) => p.choice === n.parent));
    } else if (e.key === 'F2' && n.filter) {
      e.preventDefault();
      onAction('rename', n.choice);
    } else if (e.key === 'Delete' && n.filter) {
      e.preventDefault();
      onAction('delete', n.choice);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      onMenu(n.choice, { x: box.left + 24, y: box.bottom });
    }
  };

  const layersOf = (e: DragEvent): Handle[] | undefined => {
    const text = e.dataTransfer.getData(LAYER_DRAG_TYPE);
    try {
      const v: unknown = JSON.parse(text);
      return Array.isArray(v) ? v.filter((h): h is Handle => typeof h === 'string') : undefined;
    } catch {
      return undefined;
    }
  };

  return (
    <div className="layer-filters">
      <div className="layer-filters-head">
        <span>Filters</span>
        <button
          type="button"
          aria-label="Collapse Layer Filter tree"
          title="Collapse Layer Filter tree"
          aria-expanded="true"
          onClick={onCollapse}
        >
          «
        </button>
      </div>
      <ul ref={ref} role="tree" aria-label="Layer filters" className="layer-filter-tree">
        {nodes.map((n) => {
          const group = n.filter?.filterType === 'group';
          return (
            <li
              key={n.choice}
              role="treeitem"
              data-choice={n.choice}
              data-filter-type={n.filter?.filterType}
              data-drop={dropping === n.choice || undefined}
              aria-level={n.level}
              aria-selected={n.choice === choice}
              aria-expanded={n.hasChildren ? !closed.has(n.choice) : undefined}
              tabIndex={n.choice === focusable ? 0 : -1}
              style={{ paddingLeft: 4 + (n.level - 1) * 12 }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('input')) return;
                onChoose(n.choice);
              }}
              onDoubleClick={() => {
                if (n.filter) onAction(group ? 'rename' : 'properties', n.choice);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onMenu(n.choice, { x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => onKey(e, n)}
              onDragOver={(e) => {
                if (!group || !e.dataTransfer.types.includes(LAYER_DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDropping(n.choice);
              }}
              onDragLeave={() => setDropping(undefined)}
              onDrop={(e) => {
                setDropping(undefined);
                const layers = group ? layersOf(e) : undefined;
                if (!layers || layers.length === 0) return;
                e.preventDefault();
                onDropLayers(n.choice, layers);
              }}
            >
              {n.hasChildren ? (
                <span
                  className="layer-filter-twisty"
                  aria-hidden
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(n.choice, closed.has(n.choice));
                  }}
                >
                  {closed.has(n.choice) ? '▸' : '▾'}
                </span>
              ) : (
                <span className="layer-filter-twisty" aria-hidden />
              )}
              {renaming !== undefined && n.choice === renaming ? (
                <RenameField name={n.name} onDone={(name) => onRename(renaming, name)} />
              ) : (
                <span className="layer-filter-name" title={n.filter?.expression || undefined}>
                  {n.name}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <label className="layer-filter-invert">
        <input
          type="checkbox"
          checked={invert}
          onChange={(e) => onInvert(e.currentTarget.checked)}
        />
        Invert filter
      </label>
    </div>
  );
}

/** A filter's name typed in place: Enter or leaving the field keeps it, Esc does not. */
function RenameField({
  name,
  onDone,
}: {
  name: string;
  onDone: (name: string | undefined) => void;
}) {
  const ended = useRef(false);
  const end = (value: string | undefined) => {
    if (ended.current) return;
    ended.current = true;
    onDone(value);
  };
  return (
    <input
      className="layer-in-place"
      aria-label={`Name of filter ${name}`}
      defaultValue={name}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') end(e.currentTarget.value);
        else if (e.key === 'Escape') end(undefined);
      }}
      onBlur={(e) => end(e.currentTarget.value)}
    />
  );
}

/**
 * The filter menu (part 6 adds Visibility, Lock, Viewport, Isolate Group and Convert to Group
 * Filter): a submenu opens on hover, a click, → or Enter, and closes on ← or Esc; ↑/↓ move
 * within the menu that has the focus.
 */
export function LayerFilterMenu({
  at,
  context,
  onAction,
  onClose,
}: {
  at: { readonly x: number; readonly y: number };
  context: FilterMenuContext;
  onAction: (a: LayerFilterAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | undefined>();
  /** A submenu opened from the keyboard takes the focus once it is shown. */
  const focusOpened = useRef(false);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);
  useEffect(() => {
    if (!focusOpened.current || open === undefined) return;
    focusOpened.current = false;
    ref.current
      ?.querySelector<HTMLElement>(
        `[data-submenu="${CSS.escape(open)}"] [role="menuitem"]:not(:disabled)`,
      )
      ?.focus();
  }, [open]);
  const enabled = (e: FilterMenuEntry) =>
    e.items
      ? e.items.some((i) => filterMenuEnabled(i.action, context))
      : filterMenuEnabled(e.action!, context);
  const choose = (a: LayerFilterAction) => {
    onClose();
    onAction(a);
  };
  const parentOf = (label: string) =>
    ref.current?.querySelector<HTMLElement>(`[data-opens="${CSS.escape(label)}"]`);
  return (
    <div
      ref={ref}
      // Not .layer-list-menu, whose scrolling would clip the submenus.
      className="snap-menu layer-filter-menu"
      role="menu"
      aria-label="Layer filter"
      style={{
        left: Math.min(at.x, window.innerWidth - 420),
        top: Math.min(at.y, Math.max(0, window.innerHeight - FILTER_MENU.length * 28 - 40)),
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const active = document.activeElement as HTMLElement | null;
        const menu = active?.closest<HTMLElement>('[role="menu"]') ?? ref.current;
        const sub = menu?.dataset['submenu'];
        const list = [
          ...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
        ].filter((el) => el.closest('[role="menu"]') === menu);
        const i = active ? list.indexOf(active) : -1;
        const opens = active?.dataset['opens'];
        if (e.key === 'Escape' || (e.key === 'ArrowLeft' && sub !== undefined)) {
          e.preventDefault();
          if (sub === undefined) onClose();
          else {
            setOpen(undefined);
            parentOf(sub)?.focus();
          }
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : list.length - 1;
          list[(i + step) % list.length]?.focus();
        } else if (
          opens !== undefined &&
          (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')
        ) {
          e.preventDefault();
          focusOpened.current = true;
          setOpen(opens);
        }
      }}
    >
      {FILTER_MENU.map((entry) => {
        const separator = entry.separator ? 'before' : undefined;
        if (!entry.items)
          return (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              className="snap-menu-item"
              data-separator={separator}
              disabled={!enabled(entry)}
              onPointerEnter={() => setOpen(undefined)}
              onClick={() => choose(entry.action!)}
            >
              {entry.label}
            </button>
          );
        const shown = open === entry.label;
        return (
          <div
            key={entry.label}
            role="none"
            className="layer-filter-submenu-host"
            data-separator={separator}
          >
            <button
              type="button"
              role="menuitem"
              className="snap-menu-item layer-filter-submenu-item"
              aria-haspopup="menu"
              aria-expanded={shown}
              data-opens={entry.label}
              disabled={!enabled(entry)}
              onPointerEnter={() => setOpen(entry.label)}
              onClick={() => {
                // Enter and Space open it from the keyboard handler, with the focus moved in.
                if (open !== entry.label) setOpen(entry.label);
              }}
            >
              {entry.label}
              <span aria-hidden className="layer-filter-submenu-arrow">
                ▸
              </span>
            </button>
            {shown && (
              <div
                className="snap-menu layer-filter-submenu"
                role="menu"
                aria-label={entry.label}
                data-submenu={entry.label}
              >
                {entry.items.map((it) => (
                  <button
                    key={it.action}
                    type="button"
                    role="menuitem"
                    className="snap-menu-item"
                    disabled={!filterMenuEnabled(it.action, context)}
                    onClick={() => choose(it.action)}
                  >
                    {it.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
