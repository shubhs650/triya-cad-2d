// DesignCenter (M5-11, Design-Center-lite; AutoCAD 2024 Help, "DesignCenter Window"): a tree of
// the drawings open and the drawing files loaded into it (Load..., or files dropped on it), each
// with its Blocks, Dimstyles, Layers, Linetypes, Multileaderstyles, Tablestyles and Textstyles;
// the content area lists the category picked. As AutoCAD's ("To Add Content with DesignCenter",
// "To Insert a Block with DesignCenter"):
//   - an item dragged onto the drawing is added to it; a block is inserted where it is dropped;
//   - a double click (or Enter) adds the items picked, or opens the Insert dialog on a block;
//   - Add <Category>(s) and Insert Block... do the same from the buttons, as the shortcut menu's;
//   - a duplicate definition is ignored (the command line says which).
// Click picks an item, Ctrl or Shift adds one. Folders, History, layouts, xrefs and the preview
// and description panes are left for later parts (ROADMAP.md).
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  DESIGN_CENTER_CATEGORIES,
  designCenterContent,
  type DesignCenterCategory,
  type DesignCenterContent,
} from '@triya/engine';
import type { OpenDocument } from './documents';
import {
  DESIGN_CENTER_DRAG,
  designCenterDrop,
  designCenterFiles,
  designCenterSources,
  sourceModel,
  startDesignCenterDrag,
  type DesignCenterSource,
} from './design-center';

/** The buttons' and shortcut menu's names for adding a category's items. */
const ADD: Record<DesignCenterCategory, string> = {
  blocks: 'Insert Block...',
  dimstyles: 'Add Dimstyle(s)',
  layers: 'Add Layer(s)',
  linetypes: 'Add Linetype(s)',
  mleaderstyles: 'Add Multileader Style(s)',
  tablestyles: 'Add Table Style(s)',
  textstyles: 'Add Text Style(s)',
};

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly content: DesignCenterContent }
  | { readonly state: 'failed'; readonly message: string };

/** What `source` offers, read again when an open drawing changes. */
function useContent(source: DesignCenterSource | undefined): Loaded | undefined {
  const [loaded, setLoaded] = useState<{ key: string; value: Loaded }>();
  const key = source && `${source.key}@${source.doc?.revision ?? 0}`;
  useEffect(() => {
    if (!source || !key) return;
    let live = true;
    setLoaded((l) => (l?.key === key ? l : { key, value: { state: 'loading' } }));
    sourceModel(source).then(
      (model) =>
        live && setLoaded({ key, value: { state: 'ready', content: designCenterContent(model) } }),
      (e: unknown) =>
        live &&
        setLoaded({
          key,
          value: { state: 'failed', message: e instanceof Error ? e.message : String(e) },
        }),
    );
    return () => {
      live = false;
    };
    // The source is the same while its key is.
  }, [key]);
  return source && loaded && loaded.key === key ? loaded.value : undefined;
}

/** A drawing in the tree, its categories under it when open. */
function SourceNode({
  source,
  open,
  picked,
  onToggle,
  onPick,
}: {
  source: DesignCenterSource;
  open: boolean;
  picked: DesignCenterCategory | undefined;
  onToggle: () => void;
  onPick: (category: DesignCenterCategory) => void;
}) {
  const loaded = useContent(open ? source : undefined);
  return (
    <li role="treeitem" aria-expanded={open} aria-selected={false}>
      <button type="button" className="design-center-drawing" onClick={onToggle}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {source.name}
      </button>
      {open && loaded?.state === 'loading' && <p className="hint">Reading…</p>}
      {open && loaded?.state === 'failed' && (
        <p className="message error" role="alert">
          {source.name} could not be read: {loaded.message}
        </p>
      )}
      {open && loaded?.state === 'ready' && (
        <ul role="group">
          {DESIGN_CENTER_CATEGORIES.map(({ category, label }) => (
            <li
              key={category}
              role="treeitem"
              aria-selected={picked === category}
              className="design-center-category"
            >
              <button type="button" onClick={() => onPick(category)}>
                {label} <span className="count">({loaded.content[category].length})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function DesignCenterPalette({
  doc,
  docs,
  onClose,
}: {
  /** The drawing shown: what DesignCenter adds to. */
  doc: OpenDocument;
  docs: readonly OpenDocument[];
  onClose: () => void;
}) {
  const files = useSyncExternalStore(designCenterFiles.subscribe, designCenterFiles.get);
  const sources = designCenterSources(docs, files);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([`doc:${doc.id}`]));
  const [at, setAt] = useState<{ source: string; category: DesignCenterCategory }>();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [dropping, setDropping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const source = sources.find((s) => s.key === at?.source);
  const loaded = useContent(source);
  const names = loaded?.state === 'ready' && at ? loaded.content[at.category] : [];
  const category = source ? at?.category : undefined;
  // What is picked stays only while it is listed.
  const chosen = selected.filter((n) => names.includes(n));

  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const pick = (e: MouseEvent | KeyboardEvent, name: string) => {
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    setSelected((s) => {
      if (!add) return [name];
      return s.includes(name) ? s.filter((n) => n !== name) : [...s, name];
    });
  };
  /** Add (or, for a block, Insert Block...) the items `list`. */
  const add = (list: readonly string[]) => {
    if (!source || !category || list.length === 0) return;
    void designCenterDrop(doc.id, source, category, list, category === 'blocks' ? {} : undefined);
  };

  return (
    <aside
      className={
        dropping ? 'palette design-center-palette dropping' : 'palette design-center-palette'
      }
      aria-labelledby="design-center-title"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        // Drawing files dropped here are loaded into DesignCenter, not opened.
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        designCenterFiles.add(e.dataTransfer.files);
      }}
    >
      <header>
        <h2 id="design-center-title">DesignCenter</h2>
        <button type="button" aria-label="Close DesignCenter" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="design-center-actions">
        <button type="button" onClick={() => picker.current?.click()}>
          Load...
        </button>
        <input
          ref={picker}
          type="file"
          accept=".dxf,.dwg"
          multiple
          hidden
          aria-label="Drawing files to load"
          onChange={(e) => {
            designCenterFiles.add(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
          }}
        />
      </div>
      <div className="design-center-panes">
        <ul className="design-center-tree" role="tree" aria-label="Open drawings and loaded files">
          {sources.map((s) => (
            <SourceNode
              key={s.key}
              source={s}
              open={expanded.has(s.key)}
              picked={at?.source === s.key ? at.category : undefined}
              onToggle={() => toggle(s.key)}
              onPick={(c) => {
                setAt({ source: s.key, category: c });
                setSelected([]);
              }}
            />
          ))}
        </ul>
        {source && category && (
          <section className="design-center-content" aria-label="Content">
            <h3>
              {source.name} › {DESIGN_CENTER_CATEGORIES.find((c) => c.category === category)!.label}
            </h3>
            {names.length === 0 ? (
              <p className="empty">None.</p>
            ) : (
              <ul
                role="listbox"
                aria-multiselectable="true"
                aria-label={DESIGN_CENTER_CATEGORIES.find((c) => c.category === category)!.label}
              >
                {names.map((name) => (
                  <li
                    key={name}
                    role="option"
                    tabIndex={0}
                    aria-selected={chosen.includes(name)}
                    draggable
                    onClick={(e) => pick(e, name)}
                    onDoubleClick={() => add([name])}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') add(chosen.includes(name) ? chosen : [name]);
                      else if (e.key === ' ') {
                        e.preventDefault();
                        pick(e, name);
                      }
                    }}
                    onDragStart={(e) => {
                      const list = chosen.includes(name) ? chosen : [name];
                      startDesignCenterDrag({ source, category, names: list });
                      e.dataTransfer.setData(DESIGN_CENTER_DRAG, list.join('\n'));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onDragEnd={() => startDesignCenterDrag(undefined)}
                  >
                    {name}
                  </li>
                ))}
              </ul>
            )}
            <div className="design-center-actions">
              <button type="button" disabled={chosen.length === 0} onClick={() => add(chosen)}>
                {ADD[category]}
              </button>
            </div>
            <p className="hint">
              {category === 'blocks'
                ? 'Drag a block onto the drawing to insert it there.'
                : 'Drag items onto the drawing to add them.'}{' '}
              Duplicate definitions are ignored.
            </p>
          </section>
        )}
      </div>
    </aside>
  );
}
