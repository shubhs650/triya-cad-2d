// XBIND's Xbind dialog (M5-04 part 7), with AutoCAD 2024's labels ("Xbind Dialog Box"; UI_SPEC.md
// §7): the Xrefs tree (each xref, then Block, Dimstyle, Layer, Linetype and Textstyle, then the
// xref-dependent definitions, `xref|name`), Add -> and <- Remove, and Definitions to Bind. Add on
// an xref or a kind adds every definition under it; a definition added leaves the tree until it is
// removed. The tree is keyboard-operable as a tree view (Up/Down, Right opens or goes in, Left
// closes or goes out, Enter adds or opens); a double-click does what Enter does. OK binds the
// list; Esc or Cancel binds nothing. AutoCAD's Help button is left out, as Triya's other dialogs
// leave it.
import type { DialogRequest, Handle, XbindDefinition, XbindKind } from '@triya/engine';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'xbind' }>;

/** The tree's kinds, in AutoCAD's order. */
const KINDS: readonly XbindKind[] = ['Block', 'Dimstyle', 'Layer', 'Linetype', 'Textstyle'];

/** One row the tree shows. */
interface Row {
  readonly key: string;
  readonly label: string;
  readonly level: 1 | 2 | 3;
  /** A branch: whether it is open. */
  readonly open?: boolean;
  /** The definitions under it (a leaf: itself), not yet added. */
  readonly definitions: readonly XbindDefinition[];
  readonly parent?: string;
}

export function XbindDialog({ doc, request }: { doc: number; request: Request }) {
  const treeId = useId();
  const listId = useId();
  const treeRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<readonly XbindDefinition[]>([]);
  const [active, setActive] = useState<string | undefined>(
    request.xrefs[0] ? `x:${request.xrefs[0].name}` : undefined,
  );
  const [chosen, setChosen] = useState<Handle | undefined>();

  const rows = useMemo(() => {
    const taken = new Set(added.map((d) => d.handle));
    const out: Row[] = [];
    for (const x of request.xrefs) {
      const xkey = `x:${x.name}`;
      const left = x.definitions.filter((d) => !taken.has(d.handle));
      out.push({ key: xkey, label: x.name, level: 1, open: open.has(xkey), definitions: left });
      if (!open.has(xkey)) continue;
      for (const kind of KINDS) {
        const kkey = `${xkey}:${kind}`;
        const defs = left.filter((d) => d.kind === kind);
        out.push({
          key: kkey,
          label: kind,
          level: 2,
          open: open.has(kkey),
          definitions: defs,
          parent: xkey,
        });
        if (!open.has(kkey)) continue;
        for (const d of defs)
          out.push({
            key: `d:${d.handle}`,
            label: d.name,
            level: 3,
            definitions: [d],
            parent: kkey,
          });
      }
    }
    return out;
  }, [request.xrefs, open, added]);

  const at = rows.findIndex((r) => r.key === active);
  const current = rows[at];

  const toggle = (key: string, to?: boolean) => {
    const next = new Set(open);
    if (to ?? !next.has(key)) next.add(key);
    else next.delete(key);
    setOpen(next);
  };
  const add = (row: Row | undefined) => {
    if (!row || row.definitions.length === 0) return;
    setAdded([...added, ...row.definitions]);
    // A leaf added leaves the tree: the keyboard goes to its kind.
    if (row.level === 3) setActive(row.parent);
  };
  const remove = () => {
    if (chosen === undefined) return;
    const i = added.findIndex((d) => d.handle === chosen);
    const next = added.filter((d) => d.handle !== chosen);
    setAdded(next);
    setChosen(next[Math.min(i, next.length - 1)]?.handle);
  };
  /** Enter or a double-click on `row`: a definition is added, a branch opens or closes. */
  const activate = (row: Row) => {
    if (row.level === 3) add(row);
    else toggle(row.key);
  };

  const focusRow = (key: string | undefined) => {
    setActive(key);
    if (key === undefined) return;
    requestAnimationFrame(() =>
      treeRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus(),
    );
  };
  const onTreeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!current) return;
    const move = (i: number) => {
      e.preventDefault();
      focusRow(rows[Math.max(0, Math.min(rows.length - 1, i))]?.key);
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(rows.length - 1);
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (current.level === 3) return;
      if (!current.open) toggle(current.key, true);
      else move(at + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (current.level !== 3 && current.open) toggle(current.key, false);
      else if (current.parent) focusRow(current.parent);
    } else if (e.key === 'Enter') {
      // Enter in the tree adds or opens; OK is the button's.
      e.preventDefault();
      e.stopPropagation();
      activate(current);
      if (current.level === 3 && current.parent) focusRow(current.parent);
    }
  };

  const ok = () =>
    void engines.command(doc, {
      kind: 'answer',
      answer: { kind: 'dialog', action: 'ok', xbind: added.map((d) => d.handle) },
    });
  const cancel = () => void engines.command(doc, { kind: 'cancel' });

  return (
    <Modal label="Xbind" className="xbind-dialog" onOk={ok} onCancel={cancel}>
      <div className="xbind-body">
        <div className="xbind-column">
          <span id={treeId}>Xrefs</span>
          <div
            ref={treeRef}
            role="tree"
            aria-labelledby={treeId}
            className="xbind-tree"
            onKeyDown={onTreeKey}
          >
            {rows.map((r) => (
              <div
                key={r.key}
                data-key={r.key}
                role="treeitem"
                aria-level={r.level}
                aria-expanded={r.level === 3 ? undefined : r.open}
                aria-selected={r.key === active}
                tabIndex={r.key === active || (at < 0 && r === rows[0]) ? 0 : -1}
                autoFocus={r.key === active}
                className={`xbind-item xbind-level-${r.level}`}
                onClick={() => setActive(r.key)}
                onDoubleClick={() => activate(r)}
              >
                {r.level !== 3 && (
                  <span className="xbind-twisty" aria-hidden="true">
                    {r.open ? '−' : '+'}
                  </span>
                )}
                {r.label}
              </div>
            ))}
            {rows.length === 0 && <div className="xbind-empty">No external references.</div>}
          </div>
        </div>
        <div className="xbind-buttons">
          <button
            type="button"
            onClick={() => add(current)}
            disabled={!current || current.definitions.length === 0}
          >
            {'Add ->'}
          </button>
          <button type="button" onClick={remove} disabled={chosen === undefined}>
            {'<- Remove'}
          </button>
        </div>
        <div className="xbind-column">
          <span id={listId}>Definitions to Bind</span>
          <ul
            role="listbox"
            aria-labelledby={listId}
            className="dimstyle-list xbind-list"
            tabIndex={0}
            onKeyDown={(e) => {
              const i = added.findIndex((d) => d.handle === chosen);
              const go = (j: number) => {
                e.preventDefault();
                setChosen(added[Math.max(0, Math.min(added.length - 1, j))]?.handle);
              };
              if (e.key === 'ArrowDown') go(i + 1);
              else if (e.key === 'ArrowUp') go(Math.max(0, i - 1));
              else if (e.key === 'Delete') {
                e.preventDefault();
                remove();
              }
            }}
          >
            {added.map((d) => (
              <li
                key={d.handle}
                role="option"
                aria-selected={d.handle === chosen}
                onClick={() => setChosen(d.handle)}
                onDoubleClick={() => {
                  setChosen(d.handle);
                  setAdded(added.filter((x) => x.handle !== d.handle));
                }}
              >
                {d.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
