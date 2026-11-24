// The Parameters Manager (M9-03 part 5, PARAMETERS): AutoCAD's palette of the drawing's
// dimensional constraints' parameters, by Name, Expression, Value, Type and Description.
// AutoCAD 2024 Help, "Parameters Manager": a name, an expression and a description are edited in
// place; the geometry follows a new expression; renaming a parameter renames it in the
// expressions that use it; Delete removes the selected parameter's constraint, and expressions
// that used it keep its value. A reference constraint's parameter shows what it measures, and its
// expression cannot be edited. The search box narrows the list.
//
// User parameters (part 6): New (AutoCAD's "Creates a new user parameter") adds user1 = 1, the
// next free number after it, and puts its name in edit mode, as AutoCAD does. The table shows
// AutoCAD's two groups, Dimensional Constraint Parameters and then User Parameters, each only
// when it has rows.
//
// The filter tree and sorting (part 12): » expands the filter tree beside the list (AutoCAD's
// "Expands the filter tree"), which holds All, All Used in Expressions and the drawing's group
// filters, and Invert filter under it. New Group Filter ("Creates a new parameter group filter")
// makes Group Filter1, its name ready to type; parameters are dragged onto a group (or added from
// a row's shortcut menu, the keyboard's way), and a group is renamed (F2, double click) or deleted
// (Delete) from the tree or its shortcut menu. The groups stay with the drawing. A column's header
// sorts the rows by it, within each of the two groups; clicked again, the other way.
//
// The rows come from the drawing's engine while the palette shows it; each edit goes back as one
// undo step, and a refused one (a cycle, a name in use) says why on the command line and the
// row shows its value again.
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import type { Handle, ParameterEdit, ParameterGroupInfo, ParameterInfo } from '@triya/engine';
import type { OpenDocument } from './documents';
import { engines } from './engine/registry';
import { RenameField } from './LayerFilterTree';
import {
  filterParameters,
  parameterRows,
  parameterValueText,
  searchParameters,
  sortParameters,
  sortedGroups,
  type ParameterFilter,
  type ParameterSort,
} from './parameters';

/** The data type a drag of a parameter's row carries: its object's handle. */
const PARAMETER_DRAG_TYPE = 'application/x-triya-parameter';

/** An in-place cell: Enter or leaving it commits a change, Esc puts the value back. */
function EditCell({
  value,
  label,
  readOnly,
  sent,
  onCommit,
}: {
  value: string;
  label: string;
  readOnly?: boolean;
  /** The rows the cell's value came with: each new send shows the value again. */
  sent: unknown;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // The engine's next rows show what the edit made, or put back a refused one (the same value).
  useEffect(() => setDraft(value), [value, sent]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraft(value);
    }
  };
  return (
    <input
      type="text"
      aria-label={label}
      value={draft}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onKeyDown={key}
      onBlur={commit}
    />
  );
}

/** A group of rows, with AutoCAD's heading for it. */
function ParameterGroup({
  title,
  rows,
  sent,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onMenu,
}: {
  title: string;
  rows: readonly ParameterInfo[];
  sent: unknown;
  selected: string | undefined;
  onSelect: (name: string) => void;
  onEdit: (e: ParameterEdit) => void;
  onDelete: (r: ParameterInfo) => void;
  onMenu: (r: ParameterInfo, at: { x: number; y: number }) => void;
}) {
  if (rows.length === 0) return null;
  // The value and type cells hold no field: a drag from them takes the row to a group filter.
  const drag = (r: ParameterInfo) => (e: DragEvent) => {
    e.dataTransfer.setData(PARAMETER_DRAG_TYPE, r.constraint);
    e.dataTransfer.effectAllowed = 'copy';
    onSelect(r.name);
  };
  return (
    <tbody aria-label={title}>
      <tr className="parameters-group">
        <th scope="rowgroup" colSpan={5}>
          {title}
        </th>
      </tr>
      {rows.map((r) => (
        <tr
          key={r.constraint}
          data-name={r.name}
          aria-selected={r.name === selected}
          data-reference={r.reference || undefined}
          onFocus={() => onSelect(r.name)}
          onClick={() => onSelect(r.name)}
          onContextMenu={(e) => {
            e.preventDefault();
            onSelect(r.name);
            onMenu(r, { x: e.clientX, y: e.clientY });
          }}
          onKeyDown={(e) => {
            if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              onMenu(r, { x: box.left + 24, y: box.bottom });
            }
            // Delete on a row (not while typing in its cells) deletes it.
            if (e.key === 'Delete' && e.target === e.currentTarget) onDelete(r);
          }}
          tabIndex={-1}
        >
          <th scope="row">
            <EditCell
              sent={sent}
              value={r.name}
              label={`Name of ${r.name}`}
              onCommit={(to) => onEdit({ kind: 'rename', name: r.name, to })}
            />
          </th>
          <td>
            <EditCell
              sent={sent}
              value={r.reference ? `(${r.expression})` : r.expression}
              label={`Expression of ${r.name}`}
              readOnly={r.reference}
              onCommit={(expression) => onEdit({ kind: 'expression', name: r.name, expression })}
            />
          </td>
          <td
            className="value"
            data-error={r.value === undefined || undefined}
            title={r.error}
            draggable
            onDragStart={drag(r)}
          >
            {parameterValueText(r)}
          </td>
          <td draggable onDragStart={drag(r)}>
            {r.type}
          </td>
          <td>
            <EditCell
              sent={sent}
              value={r.description}
              label={`Description of ${r.name}`}
              onCommit={(description) => onEdit({ kind: 'description', name: r.name, description })}
            />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

const COLUMNS: readonly { readonly column: ParameterSort['column']; readonly title: string }[] = [
  { column: 'name', title: 'Name' },
  { column: 'expression', title: 'Expression' },
  { column: 'value', title: 'Value' },
  { column: 'type', title: 'Type' },
  { column: 'description', title: 'Description' },
];

/** A column's header: a click sorts the rows by it, again the other way. */
function SortHeader({
  column,
  title,
  sort,
  onSort,
}: {
  column: ParameterSort['column'];
  title: string;
  sort: ParameterSort | undefined;
  onSort: (s: ParameterSort) => void;
}) {
  const on = sort?.column === column ? sort : undefined;
  return (
    <th scope="col" aria-sort={on ? (on.descending ? 'descending' : 'ascending') : undefined}>
      <button
        type="button"
        className="parameters-sort"
        title={`Sort by ${title}`}
        onClick={() => onSort({ column, descending: on ? !on.descending : false })}
      >
        {title}
        {on && (
          <span className="parameters-sort-arrow" aria-hidden>
            {on.descending ? '▼' : '▲'}
          </span>
        )}
      </button>
    </th>
  );
}

/** A shortcut menu: ↑/↓ move, Esc or a click elsewhere closes it. */
interface MenuItem {
  readonly label: string;
  readonly disabled?: boolean;
  readonly run: () => void;
}

function ParameterMenu({
  label,
  at,
  items,
  onClose,
}: {
  label: string;
  at: { readonly x: number; readonly y: number };
  items: readonly MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);
  return (
    <div
      ref={ref}
      className="snap-menu"
      role="menu"
      aria-label={label}
      style={{
        left: Math.min(at.x, window.innerWidth - 220),
        top: Math.max(0, Math.min(at.y, window.innerHeight - items.length * 28 - 16)),
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
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className="snap-menu-item"
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** A node of the filter tree. */
interface FilterNode {
  readonly key: string;
  readonly name: string;
  readonly filter: ParameterFilter;
  readonly group?: ParameterGroupInfo;
}

const filterKey = (f: ParameterFilter) => (f.kind === 'group' ? f.group : f.kind);

/** The filter tree: All, then All Used in Expressions and the group filters under it. */
function FilterTree({
  groups,
  filter,
  invert,
  renaming,
  onChoose,
  onInvert,
  onNew,
  onRename,
  onDelete,
  onMenu,
  onDrop,
  onCollapse,
}: {
  groups: readonly ParameterGroupInfo[];
  filter: ParameterFilter;
  invert: boolean;
  renaming: Handle | undefined;
  onChoose: (f: ParameterFilter) => void;
  onInvert: (invert: boolean) => void;
  onNew: () => void;
  /** Starts typing a group's name in place (`name` undefined), or ends it. */
  onRename: (group: Handle, name?: string | null) => void;
  onDelete: (group: Handle) => void;
  onMenu: (n: FilterNode, at: { x: number; y: number }) => void;
  onDrop: (group: Handle, parameter: Handle) => void;
  onCollapse: () => void;
}) {
  const [dropping, setDropping] = useState<string | undefined>();
  const ref = useRef<HTMLUListElement>(null);
  const nodes: FilterNode[] = [
    { key: 'all', name: 'All', filter: { kind: 'all' } },
    { key: 'expressions', name: 'All Used in Expressions', filter: { kind: 'expressions' } },
    ...sortedGroups(groups).map((g) => ({
      key: g.handle,
      name: g.name,
      filter: { kind: 'group', group: g.handle } as const,
      group: g,
    })),
  ];
  const chosen = filterKey(filter);
  const focus = (key: string) =>
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus(),
    );
  const onKey = (e: KeyboardEvent, n: FilterNode) => {
    if (e.target !== e.currentTarget) return;
    const i = nodes.indexOf(n);
    const go = (to: FilterNode | undefined) => {
      if (!to) return;
      e.preventDefault();
      onChoose(to.filter);
      focus(to.key);
    };
    if (e.key === 'ArrowDown') go(nodes[i + 1]);
    else if (e.key === 'ArrowUp') go(nodes[i - 1]);
    else if (e.key === 'Home') go(nodes[0]);
    else if (e.key === 'End') go(nodes.at(-1));
    else if (e.key === 'ArrowLeft' && n.key !== 'all') go(nodes[0]);
    else if (e.key === 'F2' && n.group) {
      e.preventDefault();
      onRename(n.group.handle);
    } else if (e.key === 'Delete' && n.group) {
      e.preventDefault();
      onDelete(n.group.handle);
      focus('all');
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      onMenu(n, { x: box.left + 24, y: box.bottom });
    }
  };
  return (
    <div className="layer-filters parameters-filters">
      <div className="layer-filters-head">
        <span>Filters</span>
        <span>
          <button
            type="button"
            aria-label="New Group Filter"
            title="Creates a new parameter group filter"
            onClick={onNew}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Collapse filter tree"
            title="Collapses the filter tree"
            aria-expanded="true"
            onClick={onCollapse}
          >
            «
          </button>
        </span>
      </div>
      <ul ref={ref} role="tree" aria-label="Parameter filters" className="layer-filter-tree">
        {nodes.map((n) => (
          <li
            key={n.key}
            role="treeitem"
            data-key={n.key}
            data-drop={dropping === n.key || undefined}
            aria-level={n.key === 'all' ? 1 : 2}
            aria-expanded={n.key === 'all' ? true : undefined}
            aria-selected={n.key === chosen}
            tabIndex={n.key === chosen ? 0 : -1}
            style={{ paddingLeft: n.key === 'all' ? 4 : 16 }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('input')) return;
              onChoose(n.filter);
            }}
            onDoubleClick={() => n.group && onRename(n.group.handle)}
            onContextMenu={(e) => {
              e.preventDefault();
              onChoose(n.filter);
              onMenu(n, { x: e.clientX, y: e.clientY });
            }}
            onKeyDown={(e) => onKey(e, n)}
            onDragOver={(e) => {
              if (!n.group || !e.dataTransfer.types.includes(PARAMETER_DRAG_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDropping(n.key);
            }}
            onDragLeave={() => setDropping(undefined)}
            onDrop={(e) => {
              setDropping(undefined);
              const parameter = e.dataTransfer.getData(PARAMETER_DRAG_TYPE);
              if (!n.group || !parameter) return;
              e.preventDefault();
              onDrop(n.group.handle, parameter);
            }}
          >
            <span className="layer-filter-twisty" aria-hidden>
              {n.key === 'all' ? '▾' : ''}
            </span>
            {n.group && renaming === n.group.handle ? (
              <RenameField
                name={n.name}
                onDone={(name) => onRename(n.group!.handle, name ?? null)}
              />
            ) : (
              <span className="layer-filter-name" title={n.name}>
                {n.name}
              </span>
            )}
          </li>
        ))}
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

type Menu =
  | { readonly kind: 'row'; readonly row: ParameterInfo; readonly at: { x: number; y: number } }
  | { readonly kind: 'filter'; readonly node: FilterNode; readonly at: { x: number; y: number } };

export function ParametersPalette({ doc, onClose }: { doc: OpenDocument; onClose: () => void }) {
  const rows = useSyncExternalStore(parameterRows.subscribe, () => parameterRows.get(doc.id));
  const groups = useSyncExternalStore(parameterRows.subscribe, () => parameterRows.groups(doc.id));
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | undefined>();
  const [treeOpen, setTreeOpen] = useState(false);
  const [filter, setFilter] = useState<ParameterFilter>({ kind: 'all' });
  const [invert, setInvert] = useState(false);
  const [sort, setSort] = useState<ParameterSort | undefined>();
  const [renaming, setRenaming] = useState<Handle | undefined>();
  const [menu, setMenu] = useState<Menu | undefined>();
  // The user parameters' names when New was pressed: the one the engine adds is put in edit mode.
  const before = useRef<ReadonlySet<string> | undefined>(undefined);
  // The group filters when New Group Filter was pressed: the one added is chosen and named.
  const groupsBefore = useRef<ReadonlySet<Handle> | undefined>(undefined);
  const table = useRef<HTMLTableElement>(null);

  useEffect(() => {
    // The engine sends rows only while the palette shows its drawing.
    engines.command(doc.id, { kind: 'parameters', open: true });
    return () => engines.command(doc.id, { kind: 'parameters', open: false });
  }, [doc.id]);

  useEffect(() => {
    const was = before.current;
    if (!was || !rows) return;
    const made = rows.find((r) => r.user && !was.has(r.name));
    if (!made) return;
    before.current = undefined;
    setSearch('');
    setSelected(made.name);
    const input = table.current?.querySelector<HTMLInputElement>(
      `tr[data-name="${CSS.escape(made.name)}"] th input`,
    );
    input?.focus();
    input?.select();
  }, [rows]);

  useEffect(() => {
    const was = groupsBefore.current;
    if (was) {
      const made = groups.find((g) => !was.has(g.handle));
      if (made) {
        groupsBefore.current = undefined;
        setFilter({ kind: 'group', group: made.handle });
        setRenaming(made.handle);
        return;
      }
    }
    // A group filter deleted (or undone) leaves All chosen.
    if (filter.kind === 'group' && !groups.some((g) => g.handle === filter.group)) {
      setFilter({ kind: 'all' });
    }
  }, [groups, filter]);

  const edit = (e: ParameterEdit) => engines.command(doc.id, { kind: 'parameter', edit: e });
  const shown = sortParameters(
    filterParameters(searchParameters(rows ?? [], search), filter, groups, invert),
    sort,
  );
  const picked = rows?.find((r) => r.name === selected);
  const remove = (r: ParameterInfo) => {
    edit({ kind: 'delete', name: r.name });
    setSelected(undefined);
  };
  const create = () => {
    before.current = new Set((rows ?? []).filter((r) => r.user).map((r) => r.name));
    // A new user parameter shows whatever the filter: All is chosen.
    setFilter({ kind: 'all' });
    setInvert(false);
    edit({ kind: 'new' });
  };
  const createGroup = () => {
    groupsBefore.current = new Set(groups.map((g) => g.handle));
    setTreeOpen(true);
    setInvert(false);
    edit({ kind: 'new-group' });
  };
  const rename = (group: Handle, name?: string | null) => {
    if (name === undefined) {
      setRenaming(group);
      return;
    }
    setRenaming(undefined);
    if (name !== null) edit({ kind: 'rename-group', group, to: name });
  };
  const deleteGroup = (group: Handle) => edit({ kind: 'delete-group', group });
  const inGroup = filter.kind === 'group' ? filter.group : undefined;
  const groupNamed = groups.find((g) => g.handle === inGroup)?.name;
  const menuItems = (m: Menu): MenuItem[] => {
    if (m.kind === 'filter') {
      const g = m.node.group;
      return [
        { label: 'New Group Filter', run: createGroup },
        ...(g
          ? [
              { label: 'Rename', run: () => rename(g.handle) },
              { label: 'Delete', run: () => deleteGroup(g.handle) },
            ]
          : []),
      ];
    }
    const r = m.row;
    return [
      ...sortedGroups(groups).map((g) => ({
        label: `Add to ${g.name}`,
        disabled: g.members.includes(r.constraint),
        run: () => edit({ kind: 'add-to-group', group: g.handle, parameters: [r.constraint] }),
      })),
      ...(inGroup && !invert
        ? [
            {
              label: `Remove from ${groupNamed}`,
              run: () =>
                edit({ kind: 'remove-from-group', group: inGroup, parameters: [r.constraint] }),
            },
          ]
        : []),
      { label: 'Delete Parameter', run: () => remove(r) },
    ];
  };
  const groupProps = {
    sent: rows,
    selected,
    onSelect: setSelected,
    onEdit: edit,
    onDelete: remove,
    onMenu: (row: ParameterInfo, at: { x: number; y: number }) => setMenu({ kind: 'row', row, at }),
  };
  const filtered = search.trim() !== '' || filter.kind !== 'all' || invert;

  return (
    <aside className="palette parameters-palette" aria-labelledby="parameters-title">
      <header>
        <h2 id="parameters-title">Parameters Manager</h2>
        <button type="button" aria-label="Close Parameters Manager" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="parameters-tools" role="toolbar" aria-label="Parameters">
        <button
          type="button"
          aria-label="New User Parameter"
          title="Creates a new user parameter"
          onClick={create}
        >
          New
        </button>
        <button
          type="button"
          disabled={!picked}
          title={
            picked?.user
              ? 'Deletes the selected user parameter; expressions that use it keep its value'
              : 'Deletes the selected parameter and its dimensional constraint; expressions that use it keep its value'
          }
          onClick={() => picked && remove(picked)}
        >
          Delete
        </button>
        <input
          type="search"
          aria-label="Search for parameter"
          placeholder="Search for parameter"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </div>
      <div className="layer-body parameters-body">
        {treeOpen ? (
          <FilterTree
            groups={groups}
            filter={filter}
            invert={invert}
            renaming={renaming}
            onChoose={setFilter}
            onInvert={setInvert}
            onNew={createGroup}
            onRename={rename}
            onDelete={deleteGroup}
            onMenu={(node, at) => setMenu({ kind: 'filter', node, at })}
            onDrop={(group, parameter) =>
              edit({ kind: 'add-to-group', group, parameters: [parameter] })
            }
            onCollapse={() => setTreeOpen(false)}
          />
        ) : (
          <button
            type="button"
            className="layer-filters-expand"
            aria-label="Expand filter tree"
            title="Expands the filter tree"
            aria-expanded="false"
            onClick={() => setTreeOpen(true)}
          >
            »
          </button>
        )}
        {rows === undefined ? (
          <p className="empty">Reading the drawing's parameters…</p>
        ) : rows.length === 0 ? (
          <p className="empty">
            None: the drawing has no dimensional constraints or user parameters.
          </p>
        ) : (
          <div className="parameters-table-wrap">
            <table className="parameters-table" aria-label="Parameters" ref={table}>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <SortHeader key={c.column} {...c} sort={sort} onSort={setSort} />
                  ))}
                </tr>
              </thead>
              <ParameterGroup
                title="Dimensional Constraint Parameters"
                rows={shown.filter((r) => !r.user)}
                {...groupProps}
              />
              <ParameterGroup
                title="User Parameters"
                rows={shown.filter((r) => r.user)}
                {...groupProps}
              />
            </table>
            {shown.length === 0 && filtered && (
              <p className="empty">
                {search.trim() !== ''
                  ? 'No parameter matches the search.'
                  : 'No parameter is in this filter.'}
              </p>
            )}
          </div>
        )}
      </div>
      {menu && (
        <ParameterMenu
          label={menu.kind === 'row' ? `Parameter ${menu.row.name}` : `Filter ${menu.node.name}`}
          at={menu.at}
          items={menuItems(menu)}
          onClose={() => setMenu(undefined)}
        />
      )}
    </aside>
  );
}
