// LAYWALK's LayerWalk dialog (M5-06 part 4), with AutoCAD 2024's structure and labels (AutoCAD
// Help, "LayerWalk Dialog Box"; UI_SPEC.md §7): "LayerWalk - Layers: n" over the Filter check
// box, the layer list, Select Objects, the filter box, Purge, Restore on Exit and Close.
// - The layers chosen in the list are shown and every other layer hidden as they are chosen
//   (each change is a walk step the command makes); a click chooses one, Ctrl a click adds or
//   removes one, Shift a click (or a drag) a run, the arrow keys walk the list, Space adds or
//   removes, Ctrl+A chooses all. A double-click sets a layer to Always Show or back (`*`).
// - The list's shortcut menu (right-click, Shift+F10 or the menu key): Hold Selection, Release
//   Selection, Release All, Select All, Clear All, Invert Selection, Select Unreferenced, Save
//   Layer State..., Inspect, Copy as Filter, Save Current Filter and Delete Current Filter.
// - The filter box takes a wildcard (AutoCAD's: `*`, `?`, `#`, `@`, `[...]`, `~`, commas);
//   Enter applies it and checks Filter, which turns it off and on. Its list offers the filters
//   saved.
// Esc is Close: Restore on Exit (as checked) puts the layers back. AutoCAD's Help button is left
// out, as Triya's other dialogs leave it.
import {
  wcmatch,
  type DialogRequest,
  type Handle,
  type LayerWalkAnswer,
  type LayerWalkSettings,
  type PromptAnswer,
} from '@triya/engine';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';
import { NewLayerState } from './LayerStatesManager';

type Request = Extract<DialogRequest, { type: 'laywalk' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

type MenuAction =
  | 'hold'
  | 'release'
  | 'releaseAll'
  | 'all'
  | 'clear'
  | 'invert'
  | 'unreferenced'
  | 'saveState'
  | 'inspect'
  | 'copyFilter'
  | 'saveFilter'
  | 'deleteFilter';

const MENU: readonly { action: MenuAction; label: string; separator?: true }[] = [
  { action: 'hold', label: 'Hold Selection' },
  { action: 'release', label: 'Release Selection' },
  { action: 'releaseAll', label: 'Release All' },
  { action: 'all', label: 'Select All', separator: true },
  { action: 'clear', label: 'Clear All' },
  { action: 'invert', label: 'Invert Selection' },
  { action: 'unreferenced', label: 'Select Unreferenced' },
  { action: 'saveState', label: 'Save Layer State...', separator: true },
  { action: 'inspect', label: 'Inspect' },
  { action: 'copyFilter', label: 'Copy as Filter', separator: true },
  { action: 'saveFilter', label: 'Save Current Filter' },
  { action: 'deleteFilter', label: 'Delete Current Filter' },
];

export function LayerWalkDialog({ doc, request }: { doc: number; request: Request }) {
  const { layers } = request;
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [walk, setWalk] = useState<LayerWalkSettings>(request.walk);
  /** Answers sent that the engine has not yet answered with a new request. */
  const pending = useRef(0);
  const seen = useRef(request);
  // A new request (a walk step done, Purge, a state saved) is the engine's word on the layers
  // chosen once every step sent is done; until then the dialog's own are newer.
  useEffect(() => {
    if (seen.current === request) return;
    seen.current = request;
    pending.current = Math.max(0, pending.current - 1);
    if (pending.current === 0) setWalk(request.walk);
  }, [request]);

  const shownLayers =
    walk.filterOn && walk.filter.trim() !== ''
      ? layers.filter((l) => wcmatch(l.name, walk.filter.trim()))
      : layers;
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      shownLayers.findIndex((l) => walk.selected.includes(l.handle)),
    ),
  );
  const [anchor, setAnchor] = useState(active);
  const [menu, setMenu] = useState<{ x: number; y: number } | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const dragging = useRef(false);

  /** Sends `next` to the command: apply (a walk step, with `extra`), select or close. */
  const send = (
    next: LayerWalkSettings,
    action: 'apply' | 'select' | 'ok' = 'apply',
    extra: Omit<LayerWalkAnswer, 'walk'> = {},
  ) => {
    setWalk(next);
    if (action === 'apply') pending.current++;
    void answer(doc, { kind: 'dialog', action, laywalk: { walk: next, ...extra } });
  };
  /** The layers chosen changed: a walk step. */
  const choose = (selected: Iterable<Handle>) => {
    setInfo(undefined);
    send({ ...walk, selected: [...new Set(selected)] });
  };
  const close = () => send(walk, 'ok');

  const selected = new Set(walk.selected);
  const held = new Set(walk.held);

  /** A click or key on row `i`: alone, added or removed (Ctrl), or a run from the anchor (Shift). */
  const pick = (i: number, how: { ctrl?: boolean; shift?: boolean } = {}) => {
    const l = shownLayers[i];
    if (!l) return;
    setActive(i);
    if (how.shift) {
      const [from, to] = anchor < i ? [anchor, i] : [i, anchor];
      choose(shownLayers.slice(from, to + 1).map((x) => x.handle));
      return;
    }
    setAnchor(i);
    if (how.ctrl) {
      const next = new Set(selected);
      if (next.has(l.handle)) next.delete(l.handle);
      else next.add(l.handle);
      choose(next);
      return;
    }
    choose([l.handle]);
  };
  const toggleHold = (handles: readonly Handle[], hold: boolean) => {
    const next = new Set(held);
    for (const h of handles) {
      if (hold) next.add(h);
      else next.delete(h);
    }
    send({ ...walk, held: [...next] });
  };

  const keys = (e: KeyboardEvent<HTMLUListElement>) => {
    const move = (i: number) => {
      e.preventDefault();
      const to = Math.min(shownLayers.length - 1, Math.max(0, i));
      pick(to, { shift: e.shiftKey });
      listRef.current?.children[to]?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') move(active + 1);
    else if (e.key === 'ArrowUp') move(active - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(shownLayers.length - 1);
    else if (e.key === ' ') {
      e.preventDefault();
      pick(active, { ctrl: true });
    } else if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      choose(shownLayers.map((l) => l.handle));
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = listRef.current?.children[active]?.getBoundingClientRect();
      setMenu({ x: r ? r.left + 16 : 0, y: r ? r.bottom : 0 });
    }
  };

  const chosenRows = shownLayers.filter((l) => selected.has(l.handle));
  const onMenu = (a: MenuAction) => {
    const chosen = chosenRows.map((l) => l.handle);
    switch (a) {
      case 'hold':
        return toggleHold(chosen, true);
      case 'release':
        return toggleHold(chosen, false);
      case 'releaseAll':
        return send({ ...walk, held: [] });
      case 'all':
        return choose(shownLayers.map((l) => l.handle));
      case 'clear':
        return choose([]);
      case 'invert':
        return choose(shownLayers.filter((l) => !selected.has(l.handle)).map((l) => l.handle));
      case 'unreferenced':
        return choose(shownLayers.filter((l) => !l.referenced).map((l) => l.handle));
      case 'saveState':
        return setSaving(true);
      case 'inspect': {
        const objects = layers
          .filter((l) => selected.has(l.handle))
          .reduce((n, l) => n + l.objects, 0);
        return setInfo(
          `Layers in drawing: ${layers.length}. Layers selected: ${selected.size}. ` +
            `Objects on selected layers: ${objects}.`,
        );
      }
      case 'copyFilter': {
        const first = chosenRows[0] ?? shownLayers[active];
        if (first) setWalk({ ...walk, filter: first.name });
        return;
      }
      case 'saveFilter': {
        const f = walk.filter.trim();
        if (f !== '' && !walk.filters.includes(f))
          setWalk({ ...walk, filters: [...walk.filters, f] });
        return;
      }
      case 'deleteFilter':
        return setWalk({
          ...walk,
          filters: walk.filters.filter((f) => f !== walk.filter.trim()),
          filter: '',
          filterOn: false,
        });
    }
  };

  const canPurge = layers.some((l) => l.purgeable && selected.has(l.handle));
  const note = info ?? request.note;
  return (
    <Modal
      label={`LayerWalk - Layers: ${layers.length}`}
      className="layer-walk"
      onOk={close}
      onCancel={close}
    >
      <label className="layer-walk-filter-on">
        <input
          type="checkbox"
          checked={walk.filterOn}
          disabled={walk.filter.trim() === ''}
          onChange={(e) => setWalk({ ...walk, filterOn: e.currentTarget.checked })}
        />
        Filter
      </label>
      <ul
        ref={listRef}
        role="listbox"
        aria-label="Layers"
        aria-multiselectable
        aria-activedescendant={shownLayers[active] ? `${listId}-${active}` : undefined}
        className="dimstyle-list layer-list layer-walk-list"
        tabIndex={0}
        autoFocus
        onKeyDown={keys}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {shownLayers.map((l, i) => (
          <li
            key={l.handle}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={selected.has(l.handle)}
            aria-label={held.has(l.handle) ? `${l.name} (Always Show)` : l.name}
            className={i === active ? 'layer-list-active' : undefined}
            onPointerDown={(e) => {
              if (e.button !== 0) {
                // A right-click on a layer not chosen chooses it, as the menu acts on the choice.
                if (e.button === 2 && !selected.has(l.handle)) pick(i);
                return;
              }
              dragging.current = true;
              pick(i, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
            }}
            onPointerEnter={(e) => {
              if (dragging.current && e.buttons === 1) pick(i, { shift: true });
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onDoubleClick={() => toggleHold([l.handle], !held.has(l.handle))}
          >
            <span className="layer-walk-hold" aria-hidden>
              {held.has(l.handle) ? '*' : ''}
            </span>
            {l.name}
          </li>
        ))}
      </ul>
      <div className="layer-walk-row">
        <button type="button" onClick={() => send(walk, 'select')}>
          Select Objects
        </button>
        <input
          type="text"
          aria-label="Filter"
          className="layer-walk-filter"
          list={`${listId}-filters`}
          value={walk.filter}
          spellCheck={false}
          onChange={(e) => setWalk({ ...walk, filter: e.currentTarget.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            // Enter applies the filter here; elsewhere in the dialog it is Close.
            e.preventDefault();
            e.stopPropagation();
            setWalk({ ...walk, filterOn: walk.filter.trim() !== '' });
            setActive(0);
            setAnchor(0);
          }}
        />
        <datalist id={`${listId}-filters`}>
          {walk.filters.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>
      {note !== undefined && (
        <p role="status" className="layer-walk-note">
          {note}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button
          type="button"
          disabled={!canPurge}
          onClick={() => send(walk, 'apply', { purge: true })}
        >
          Purge
        </button>
        <label className="layer-walk-restore">
          <input
            type="checkbox"
            checked={walk.restore}
            onChange={(e) => setWalk({ ...walk, restore: e.currentTarget.checked })}
          />
          Restore on Exit
        </label>
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
      {menu && (
        <WalkMenu
          at={menu}
          chosen={chosenRows.length}
          filter={walk.filter.trim()}
          saved={walk.filters.includes(walk.filter.trim())}
          onAction={onMenu}
          onClose={() => {
            setMenu(undefined);
            listRef.current?.focus();
          }}
        />
      )}
      {saving && (
        <NewLayerState
          existing={(name) => request.states.find((s) => s.toUpperCase() === name.toUpperCase())}
          problem={undefined}
          onSave={(name, description) => {
            setSaving(false);
            send(walk, 'apply', { saveState: { name, description } });
            listRef.current?.focus();
          }}
          onCancel={() => {
            setSaving(false);
            listRef.current?.focus();
          }}
        />
      )}
    </Modal>
  );
}

/** The layer list's shortcut menu. */
function WalkMenu({
  at,
  chosen,
  filter,
  saved,
  onAction,
  onClose,
}: {
  at: { readonly x: number; readonly y: number };
  /** How many layers listed are chosen. */
  chosen: number;
  /** The filter box's wildcard, and whether it is saved. */
  filter: string;
  saved: boolean;
  onAction: (a: MenuAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The dialog re-renders as walk steps come back: the menu keeps its focus meanwhile.
  const closing = useRef(onClose);
  closing.current = onClose;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closing.current();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);
  const disabled = (a: MenuAction) =>
    ((a === 'hold' || a === 'release' || a === 'copyFilter') && chosen === 0) ||
    (a === 'saveFilter' && (filter === '' || saved)) ||
    (a === 'deleteFilter' && !saved);
  return (
    <div
      ref={ref}
      className="snap-menu layer-list-menu layer-walk-menu"
      role="menu"
      aria-label="Layer list"
      style={{
        left: Math.min(at.x, window.innerWidth - 220),
        top: Math.min(at.y, Math.max(0, window.innerHeight - MENU.length * 28 - 40)),
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
      {MENU.map((it) => (
        <button
          key={it.action}
          type="button"
          role="menuitem"
          className="snap-menu-item"
          data-separator={it.separator ? 'before' : undefined}
          disabled={disabled(it.action)}
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
