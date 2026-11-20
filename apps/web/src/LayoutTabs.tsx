// The layout tabs below the drawing (M1-22): Model, then the layouts in tab order (DXF 71). While
// the Block Editor is open (M5-02) its bar takes their place, as AutoCAD's editor leaves no tab to
// switch to: the block's name, Save Block (BSAVE) and Close Block Editor (BCLOSE). While a
// reference is edited in place (M5-02 part 3) the Edit Reference bar does, with the buttons of
// AutoCAD's Edit Reference panel: the working set is in the space shown, so no other tab is
// offered either.
//
// M6-01 part 1: a layout tab's shortcut menu (AutoCAD 2024 Help, "Layout Tab Shortcut Menu"; a
// right-click, or Shift+F10 / the menu key on a focused tab) offers New Layout, Delete and Rename.
// New Layout and Delete run LAYOUT's New and Delete, so the command line and the menu make and
// delete layouts alike; Delete first asks, as AutoCAD does, "The selected layout(s) will be
// permanently deleted." Rename, or a double-click on a layout tab, edits the name in place on the
// tab: Enter or a click elsewhere renames it (one LAYOUT undo step), Esc keeps it. The Model tab
// offers New Layout only.
//
// M6-01 part 2: the menu's Move or Copy... opens AutoCAD's Move or Copy dialog ("Before layout:"
// lists the layouts and "(move to end)"; "Create a copy" copies the layout there instead, as
// LAYOUT Copy copies it, named "<name> (2)"). Dragging a layout tab onto another moves it before
// that tab, or after it when dropped on the tab's right half; the Model tab stays first. Each is
// one LAYOUT undo step (the session's layout edit, `placeLayout` and `copyLayout`).
//
// M6-01 part 3: the menu's Page Setup Manager... (the Model tab's too) shows the tab's space and
// runs PAGESETUP on it.
//
// M6-01 part 4: the menu's From Template... (the Model tab's too) runs LAYOUT Template, whose
// Insert Layout(s) dialog picks a drawing file and the layouts it inserts.
import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { layoutsOf, spacesOf, type OpenDocument } from './documents';
import { whenRegistered } from './canvas/registry';
import { engines } from './engine/registry';

type TabAction = 'new' | 'template' | 'delete' | 'rename' | 'move' | 'pagesetup';

const ITEMS: readonly { action: TabAction; label: string; layout?: true }[] = [
  { action: 'new', label: 'New Layout' },
  { action: 'template', label: 'From Template...' },
  { action: 'delete', label: 'Delete', layout: true },
  { action: 'rename', label: 'Rename', layout: true },
  { action: 'move', label: 'Move or Copy...', layout: true },
  { action: 'pagesetup', label: 'Page Setup Manager...' },
];

/** The drag data of a layout tab: its sheet block. */
const TAB_DRAG = 'application/x-triya-layout';

/** Runs LAYOUT with `answers` typed in turn. */
function layoutCommand(doc: number, ...answers: string[]): void {
  engines.command(doc, { kind: 'invoke', name: 'LAYOUT' });
  for (const text of answers) engines.command(doc, { kind: 'submit', text });
}

export function LayoutTabs({
  doc,
  onShow,
  onFail,
  onEdited,
}: {
  doc: OpenDocument | undefined;
  /** Shows the space whose block is `block`. */
  onShow: (block: string) => void;
  /** An edit refused: why. */
  onFail: (message: string) => void;
  /** An edit made (a layout renamed). */
  onEdited: () => void;
}) {
  const [menu, setMenu] = useState<{ block: string; x: number; y: number }>();
  const [renaming, setRenaming] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [moving, setMoving] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  if (!doc) return <nav className="layout-tabs" aria-label="Layouts" />;
  if (doc.refEdit !== undefined) {
    const run = (name: string, option: string) => {
      engines.command(doc.id, { kind: 'invoke', name });
      engines.command(doc.id, { kind: 'submit', text: option });
    };
    return (
      <div className="layout-tabs block-editor-bar" role="toolbar" aria-label="Edit Reference">
        <span className="block-editor-name">
          Editing reference: <strong>{doc.refEdit}</strong>
        </span>
        <button type="button" onClick={() => run('REFSET', 'Add')}>
          Add to Working Set
        </button>
        <button type="button" onClick={() => run('REFSET', 'Remove')}>
          Remove from Working Set
        </button>
        <button type="button" onClick={() => run('REFCLOSE', 'Discard')}>
          Discard Changes
        </button>
        <button type="button" onClick={() => run('REFCLOSE', 'Save')}>
          Save Changes
        </button>
      </div>
    );
  }
  if (doc.blockEditor) {
    const run = (name: string) => engines.command(doc.id, { kind: 'invoke', name });
    return (
      <div className="layout-tabs block-editor-bar" role="toolbar" aria-label="Block Editor">
        <span className="block-editor-name">
          Block Editor: <strong>{doc.blockEditor.name}</strong>
        </span>
        <button type="button" onClick={() => run('BEDIT')}>
          Edit Block
        </button>
        <button type="button" onClick={() => run('BSAVE')}>
          Save Block
        </button>
        <button type="button" onClick={() => run('BCLOSE')}>
          Close Block Editor
        </button>
      </div>
    );
  }
  const changes = engines.changesOf(doc.id);
  const tabs = spacesOf(doc, changes);
  const model = doc.opened.modelSpace;
  const nameOf = (block: string | undefined) => tabs.find((t) => t.block === block)?.name;

  const rename = async (block: string, name: string) => {
    setRenaming(undefined);
    const layout = layoutsOf(doc.opened.init, changes).find((l) => l.blockRecord === block);
    if (!layout || name === layout.name) return;
    const r = await engines.edit(doc.id, { kind: 'layout', layout: layout.handle, name });
    if (!r.ok) onFail(r.message);
    else if (Object.keys(r.change).length > 0) onEdited();
  };
  const confirmDelete = () => {
    const name = nameOf(deleting);
    setDeleting(undefined);
    if (name !== undefined) layoutCommand(doc.id, 'Delete', name);
  };
  const act = (action: TabAction, block: string) => {
    if (action === 'new') layoutCommand(doc.id, 'New', '');
    // LAYOUT Template's Insert Layout(s) dialog (M6-01 part 4).
    else if (action === 'template') layoutCommand(doc.id, 'Template', '');
    else if (action === 'delete') setDeleting(block);
    else if (action === 'move') setMoving(block);
    else if (action === 'pagesetup') {
      // M6-01 part 3: the tab's space shown, then PAGESETUP opens the manager on it.
      onShow(block);
      // Once the space's canvas exists: the manager reads the space from it.
      void whenRegistered(doc.id, block).then(() =>
        engines.command(doc.id, { kind: 'invoke', name: 'PAGESETUP' }),
      );
    } else setRenaming(block);
  };
  /** The paper layouts in tab order, as the tabs show them. */
  const sheets = tabs.filter((t) => t.block !== model);
  /** `block`'s layout put at tab `at` among the layouts (1 first), or a copy of it put there. */
  const place = async (block: string, at: number, copy: boolean) => {
    const layout = layoutsOf(doc.opened.init, changes).find((l) => l.blockRecord === block);
    if (!layout) return;
    const r = await engines.edit(doc.id, {
      kind: 'layout',
      layout: layout.handle,
      tabOrder: at,
      ...(copy && { copy: true }),
    });
    if (!r.ok) onFail(r.message);
    else {
      if (r.messages) onFail(r.messages.join(' '));
      if (Object.keys(r.change).length > 0) onEdited();
    }
  };
  /** A tab dropped on `target`'s tab: before it, or after it on its right half. */
  const drop = (target: string, after: boolean) => {
    const from = dragging;
    setDragging(undefined);
    if (from === undefined || from === target || target === model) return;
    const rest = sheets.filter((t) => t.block !== from);
    const at = rest.findIndex((t) => t.block === target) + (after ? 2 : 1);
    if (at > 0) void place(from, at, false);
  };

  return (
    <nav className="layout-tabs" aria-label="Layouts">
      <div role="tablist" aria-label="Model and layouts">
        {tabs.map((t) =>
          t.block === renaming ? (
            <RenameField
              key={t.block}
              name={t.name}
              onDone={(name) =>
                void (name === undefined ? setRenaming(undefined) : rename(t.block, name))
              }
            />
          ) : (
            <button
              key={t.block}
              type="button"
              role="tab"
              className="layout-tab"
              aria-selected={t.block === doc.block}
              draggable={t.block !== model}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_DRAG, t.block);
                e.dataTransfer.effectAllowed = 'move';
                setDragging(t.block);
              }}
              onDragEnd={() => setDragging(undefined)}
              onDragOver={(e) => {
                if (dragging === undefined || t.block === model) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                drop(t.block, e.clientX > r.left + r.width / 2);
              }}
              onClick={() => onShow(t.block)}
              onDoubleClick={() => {
                if (t.block !== model) setRenaming(t.block);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                // A keyboard's context menu has no pointer: the menu opens over the tab.
                const at =
                  e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.left, y: r.top };
                setMenu({ block: t.block, ...at });
              }}
            >
              {t.name}
            </button>
          ),
        )}
      </div>
      {menu && (
        <TabMenu
          at={menu}
          layout={menu.block !== model}
          onAction={(a) => act(a, menu.block)}
          onClose={() => setMenu(undefined)}
        />
      )}
      {moving !== undefined && (
        <MoveOrCopyDialog
          layout={moving}
          sheets={sheets}
          onDone={(r) => {
            setMoving(undefined);
            if (!r) return;
            // Before a layout: its place once the moved one is out of the list (a copy leaves
            // the list as it is); "(move to end)" past the last.
            const rest = r.copy ? sheets : sheets.filter((t) => t.block !== moving);
            const at =
              r.before === undefined
                ? sheets.length + 1
                : rest.findIndex((t) => t.block === r.before) + 1;
            if (at > 0) void place(moving, at, r.copy);
          }}
        />
      )}
      {deleting !== undefined && (
        <Modal
          label="Delete Layout"
          className="layout-delete"
          onOk={confirmDelete}
          onCancel={() => setDeleting(undefined)}
        >
          <p>The selected layout(s) will be permanently deleted.</p>
          <div className="cad-dialog-buttons">
            <button type="button" autoFocus onClick={confirmDelete}>
              OK
            </button>
            <button type="button" onClick={() => setDeleting(undefined)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </nav>
  );
}

/**
 * AutoCAD's Move or Copy dialog (AutoCAD 2024 Help, "Move or Copy Dialog Box"): "Before layout"
 * lists the layouts and "(move to end)", the layout's own next tab picked; "Create a copy".
 * `onDone` with the layout picked (undefined: the end) and the copy box, or undefined on Cancel.
 */
function MoveOrCopyDialog({
  layout,
  sheets,
  onDone,
}: {
  layout: string;
  sheets: readonly { readonly block: string; readonly name: string }[];
  onDone: (r: { before: string | undefined; copy: boolean } | undefined) => void;
}) {
  const id = useId();
  const items = [...sheets.map((t) => ({ block: t.block, name: t.name })), END];
  const own = sheets.findIndex((t) => t.block === layout);
  const [picked, setPicked] = useState(Math.min(own + 1, items.length - 1));
  const [copy, setCopy] = useState(false);
  const ok = () => onDone({ before: items[picked]!.block, copy });
  return (
    <Modal
      label="Move or Copy"
      className="layout-move"
      onOk={ok}
      onCancel={() => onDone(undefined)}
    >
      <label className="cad-dialog-field" htmlFor={`${id}-list`}>
        <span>Before layout:</span>
      </label>
      <ul
        id={`${id}-list`}
        role="listbox"
        aria-label="Before layout"
        aria-activedescendant={`${id}-${picked}`}
        className="dimstyle-list layout-move-list"
        tabIndex={0}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setPicked((p) => Math.max(0, Math.min(items.length - 1, p + step)));
          }
        }}
      >
        {items.map((t, i) => (
          <li
            key={t.block ?? 'end'}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === picked}
            className={i === picked ? 'layer-list-active' : undefined}
            onClick={() => setPicked(i)}
            onDoubleClick={() => onDone({ before: t.block, copy })}
          >
            {t.name}
          </li>
        ))}
      </ul>
      <label className="cad-dialog-check">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        Create a copy
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={() => onDone(undefined)}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

const END = { block: undefined, name: '(move to end)' } as const;

/** A layout's name edited in place on its tab: `onDone` with the name, or undefined on Esc. */
function RenameField({
  name,
  onDone,
}: {
  name: string;
  onDone: (name: string | undefined) => void;
}) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (v: string | undefined) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="layout-tab layout-tab-rename"
      aria-label="Layout name"
      value={value}
      maxLength={255}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim() || undefined)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(value.trim() || undefined);
        else if (e.key === 'Escape') finish(undefined);
      }}
    />
  );
}

/** The layout tab's shortcut menu: Delete and Rename greyed on the Model tab. */
function TabMenu({
  at,
  layout,
  onAction,
  onClose,
}: {
  at: { readonly x: number; readonly y: number };
  /** Whether the tab is a layout's (not the Model tab). */
  layout: boolean;
  onAction: (a: TabAction) => void;
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
      className="snap-menu layout-tab-menu"
      role="menu"
      aria-label="Layout tab"
      style={{
        left: Math.min(at.x, window.innerWidth - 220),
        top: Math.max(0, Math.min(at.y - ITEMS.length * 28 - 16, window.innerHeight - 120)),
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
          disabled={it.layout && !layout}
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
