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
import { useEffect, useRef, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { layoutsOf, spacesOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';

type TabAction = 'new' | 'delete' | 'rename';

const ITEMS: readonly { action: TabAction; label: string; layout?: true }[] = [
  { action: 'new', label: 'New Layout' },
  { action: 'delete', label: 'Delete', layout: true },
  { action: 'rename', label: 'Rename', layout: true },
];

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
    else if (action === 'delete') setDeleting(block);
    else setRenaming(block);
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
