// The Viewports dialog (M6-02 part 11), with AutoCAD 2024's structure and labels (UI_SPEC.md §7;
// AutoCAD 2024 Help, "Viewports Dialog Box"). New Viewports: New name (model space only),
// Standard viewports, Preview, Apply to (model space) or Viewport Spacing (a layout), and Change
// view to, which sets the view of the viewport selected in the preview ("Click a viewport in the
// preview image to select it"). Named Viewports: Current name, Named viewports and Preview; the
// list's shortcut menu (right click, Shift+F10 or the context-menu key) has Rename and Delete,
// as do F2 and Delete. The Setup (2D/3D) and Visual Style lists are 3D, which Triya leaves out.
// OK answers VPORTS, which does the rest; Cancel and Esc change nothing.
import { useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react';
import {
  ACTIVE_MODEL_CONFIGURATION,
  STANDARD_VIEWPORTS,
  type ViewportsDialogRequest,
} from '@triya/engine';
import { Modal } from './AttributeDialogs';
import {
  CURRENT_VIEW,
  nameProblem,
  namedPreview,
  newPreview,
  viewCount,
  viewportsDialog,
  type NewTab,
  type PreviewTile,
} from './viewports-dialog';

export function ViewportsDialog({ doc }: { doc: number | undefined }) {
  const open = useSyncExternalStore(viewportsDialog.subscribe, viewportsDialog.get);
  if (doc === undefined || open?.doc !== doc) return null;
  return <Body key={doc} request={open.request} />;
}

type Tab = 'new' | 'named';

function Body({ request }: { request: ViewportsDialogRequest }) {
  const [tab, setTab] = useState<Tab>('new');
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<NewTab>({
    standard: ACTIVE_MODEL_CONFIGURATION,
    applyTo: 'Display',
    views: [],
  });
  const [spacing, setSpacing] = useState('0');
  const [picked, setPicked] = useState(0);
  // The Named Viewports tab's list as renamed and deleted so far, each with its first name.
  const [names, setNames] = useState(() =>
    request.configurations.map((c) => ({ from: c.name, to: c.name })),
  );
  const [selected, setSelected] = useState<string | undefined>(
    () => names.find((n) => n.from.toUpperCase() === request.current.toUpperCase())?.from,
  );
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [problem, setProblem] = useState<string>();

  const tiles = newPreview(request, fresh);
  const count = viewCount(request, fresh);
  const current = names.find((n) => n.from.toUpperCase() === request.current.toUpperCase());

  const choose = (standard: NewTab['standard']) => {
    setFresh({ ...fresh, standard, views: [] });
    setPicked(0);
  };
  const setView = (view: string) => {
    const views = Array.from({ length: count }, (_, i) => fresh.views[i] ?? null);
    views[picked] = view === CURRENT_VIEW ? null : view;
    setFresh({ ...fresh, views });
  };

  const ok = (pick = selected) => {
    const renamed = names.filter((n) => n.to !== n.from).map(({ from, to }) => ({ from, to }));
    const deleted = request.configurations
      .map((c) => c.name)
      .filter((c) => !names.some((n) => n.from === c));
    if (tab === 'named') {
      const to = names.find((n) => n.from === pick)?.to;
      viewportsDialog.close({ renamed, deleted, ...(to && { apply: { tab: 'named', name: to } }) });
      return;
    }
    const typed = name.trim();
    // A configuration of the same name is replaced, as -VPORTS Save replaces it.
    const why = typed && nameProblem(typed, []);
    if (why) return setProblem(why);
    const gap = Number(spacing);
    if (request.layout && !(Number.isFinite(gap) && gap >= 0)) {
      return setProblem('Viewport Spacing must be zero or more.');
    }
    viewportsDialog.close({
      renamed,
      deleted,
      apply: {
        tab: 'new',
        standard: fresh.standard,
        applyTo: fresh.applyTo,
        spacing: request.layout ? gap : 0,
        views: Array.from({ length: count }, (_, i) => fresh.views[i] ?? null),
        ...(!request.layout && typed && { name: typed }),
      },
    });
  };
  const cancel = () => viewportsDialog.close();

  const rename = (from: string, to: string | undefined) => {
    setRenaming(undefined);
    if (to === undefined) return;
    const entry = names.find((n) => n.from === from);
    if (!entry || to === entry.to) return;
    const why = nameProblem(
      to,
      names.filter((n) => n.from !== from).map((n) => n.to),
    );
    if (why) return setProblem(why);
    setProblem(undefined);
    setNames(names.map((n) => (n.from === from ? { ...n, to: to.trim() } : n)));
  };
  const remove = (from: string) => {
    const at = names.findIndex((n) => n.from === from);
    const rest = names.filter((n) => n.from !== from);
    setNames(rest);
    setSelected(rest[Math.min(at, rest.length - 1)]?.from);
  };
  const listKey = (e: KeyboardEvent) => {
    if (renaming) return;
    const at = names.findIndex((n) => n.from === selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next =
        names[Math.max(0, Math.min(names.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) setSelected(next.from);
    } else if (e.key === 'F2' && selected) {
      e.preventDefault();
      setRenaming(selected);
    } else if (e.key === 'Delete' && selected) {
      e.preventDefault();
      remove(selected);
    } else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (selected) setMenu({ x: r.left + 16, y: r.top + 16 });
    }
  };
  const openMenu = (e: MouseEvent, from: string) => {
    e.preventDefault();
    setSelected(from);
    // The menu is fixed: in the viewport's coordinates, as the Dimension Style Manager's.
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <Modal label="Viewports" className="viewports-dialog" onOk={() => ok()} onCancel={cancel}>
      <div role="tablist" className="cad-dialog-tabs">
        {(
          [
            ['new', 'New Viewports'],
            ['named', 'Named Viewports'],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setProblem(undefined);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'new' ? (
        <div role="tabpanel" className="cad-dialog-panel" aria-label="New Viewports">
          <label className="cad-dialog-field">
            <span>New name:</span>
            <input
              type="text"
              value={name}
              maxLength={255}
              disabled={request.layout}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="viewports-columns">
            <label className="cad-dialog-field viewports-list">
              <span>Standard viewports:</span>
              <select
                size={13}
                value={fresh.standard}
                onChange={(e) => choose(e.currentTarget.value as NewTab['standard'])}
              >
                {[ACTIVE_MODEL_CONFIGURATION, ...STANDARD_VIEWPORTS].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <Preview tiles={tiles} picked={picked} onPick={setPicked} />
          </div>
          <div className="viewports-columns">
            {request.layout ? (
              <label className="cad-dialog-field">
                <span>Viewport Spacing:</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={spacing}
                  onChange={(e) => setSpacing(e.target.value)}
                />
              </label>
            ) : (
              <label className="cad-dialog-field">
                <span>Apply to:</span>
                <select
                  value={fresh.applyTo}
                  disabled={fresh.standard === ACTIVE_MODEL_CONFIGURATION}
                  onChange={(e) =>
                    setFresh({ ...fresh, applyTo: e.currentTarget.value as NewTab['applyTo'] })
                  }
                >
                  <option value="Display">Display</option>
                  <option value="Current viewport">Current Viewport</option>
                </select>
              </label>
            )}
            <label className="cad-dialog-field">
              <span>Change view to:</span>
              <select
                value={fresh.views[picked] ?? CURRENT_VIEW}
                onChange={(e) => setView(e.currentTarget.value)}
              >
                {[CURRENT_VIEW, ...request.views].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : (
        <div role="tabpanel" className="cad-dialog-panel" aria-label="Named Viewports">
          <p className="cad-dialog-field">
            <span>Current name:</span>{' '}
            <span data-testid="viewports-current">{current?.to ?? request.current}</span>
          </p>
          <div className="viewports-columns">
            <div className="cad-dialog-field viewports-list">
              <span id="viewports-named-label">Named viewports:</span>
              <div
                role="listbox"
                tabIndex={0}
                aria-labelledby="viewports-named-label"
                className="viewports-named"
                onKeyDown={listKey}
              >
                {names.map((n) => (
                  <div
                    key={n.from}
                    role="option"
                    aria-selected={selected === n.from}
                    onClick={() => setSelected(n.from)}
                    onDoubleClick={() => ok(n.from)}
                    onContextMenu={(e) => openMenu(e, n.from)}
                  >
                    {renaming === n.from ? (
                      <RenameInput name={n.to} onDone={(to) => rename(n.from, to)} />
                    ) : (
                      n.to
                    )}
                  </div>
                ))}
              </div>
            </div>
            <Preview tiles={selected ? namedPreview(request, selected) : []} />
          </div>
          {menu && selected && (
            <div
              role="menu"
              aria-label="Named viewports"
              className="dimstyle-menu"
              style={{ left: menu.x, top: menu.y }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu(undefined);
                }
              }}
              onMouseLeave={() => setMenu(undefined)}
            >
              <button
                type="button"
                role="menuitem"
                autoFocus
                onClick={() => {
                  setMenu(undefined);
                  setRenaming(selected);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(undefined);
                  remove(selected);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      {problem && (
        <p role="alert" className="viewports-problem">
          {problem}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => ok()}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/**
 * The preview: each viewport in its place, named by its view; with `onPick`, the arrangement's
 * viewports are buttons that select the one Change view to sets.
 */
function Preview(props: {
  tiles: readonly PreviewTile[];
  picked?: number;
  onPick?: (index: number) => void;
}) {
  return (
    <div className="cad-dialog-field">
      <span>Preview</span>
      <div className="viewports-preview" data-testid="viewports-preview">
        {props.tiles.map((t, i) => {
          const style = {
            left: `${t.corners.minX * 100}%`,
            top: `${(1 - t.corners.maxY) * 100}%`,
            width: `${(t.corners.maxX - t.corners.minX) * 100}%`,
            height: `${(t.corners.maxY - t.corners.minY) * 100}%`,
          };
          const pick = props.onPick;
          if (pick && t.index !== undefined) {
            const index = t.index;
            return (
              <button
                key={i}
                type="button"
                className="viewports-tile"
                style={style}
                aria-pressed={props.picked === index}
                aria-label={`Viewport ${index + 1}: ${t.label}`}
                onClick={() => pick(index)}
              >
                {t.label}
              </button>
            );
          }
          return (
            <div key={i} className="viewports-tile" style={style}>
              {t.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RenameInput({ name, onDone }: { name: string; onDone: (to?: string) => void }) {
  const [text, setText] = useState(name);
  return (
    <input
      type="text"
      aria-label="New name"
      autoFocus
      value={text}
      maxLength={255}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onDone(text);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onDone(undefined);
        }
      }}
    />
  );
}
