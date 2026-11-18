// The layer tools' list dialogs (M5-06 part 3), with AutoCAD 2024's titles and labels (AutoCAD
// Help, "Change to Layer Dialog Box", "Delete Layers Dialog Box", "Merge Layers Dialog Box",
// "Merge to Layer Dialog Box"; UI_SPEC.md §7): LAYMCH's Change to Layer (Current Layer, where a
// name the drawing lacks makes a layer, over the Destination Layer list), LAYDEL's Delete Layers
// and LAYMRG's Merge Layers (several layers, chosen with Shift and Ctrl) and Merge to Layer (one
// target). The engine lists only the layers the command can take. A double-click on a layer of a
// one-layer list is OK; Esc or Cancel goes back to the command's pick prompt. AutoCAD's Help
// button is left out, as Triya's other dialogs leave it.
import type { DialogRequest, Handle, PromptAnswer } from '@triya/engine';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'layerlist' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** The list's label in each dialog. */
const LIST_LABEL: Record<Request['title'], string> = {
  'Change to Layer': 'Destination Layer:',
  'Delete Layers': 'Layers to Delete:',
  'Merge Layers': 'Layers to Merge:',
  'Merge to Layer': 'Target Layer:',
};

export function LayerListDialog({ doc, request }: { doc: number; request: Request }) {
  const { layers, multiple } = request;
  const naming = request.title === 'Change to Layer';
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<Handle>>(() => {
    const current = layers.find((l) => l.name === request.current);
    return new Set(current ? [current.handle] : []);
  });
  /** The row the keyboard is on, and where a Shift range starts. */
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      layers.findIndex((l) => selected.has(l.handle)),
    ),
  );
  const [anchor, setAnchor] = useState(active);
  const [name, setName] = useState(request.current ?? '');

  const ok = () => {
    if (naming) {
      const typed = name.trim();
      const listed = layers.find((l) => l.name.toUpperCase() === typed.toUpperCase());
      void answer(
        doc,
        listed
          ? { kind: 'dialog', action: 'ok', layers: [listed.handle] }
          : { kind: 'dialog', action: 'ok', layerName: typed },
      );
      return;
    }
    // In the list's order, which is how the command reports them.
    void answer(doc, {
      kind: 'dialog',
      action: 'ok',
      layers: layers.filter((l) => selected.has(l.handle)).map((l) => l.handle),
    });
  };
  const cancel = () => void answer(doc, { kind: 'escape' });

  /** A click or key on row `i`: alone, added or removed (Ctrl), or a range from the anchor (Shift). */
  const choose = (i: number, how: { ctrl?: boolean; shift?: boolean } = {}) => {
    const l = layers[i];
    if (!l) return;
    setActive(i);
    if (naming) setName(l.name);
    if (multiple && how.shift) {
      const [from, to] = anchor < i ? [anchor, i] : [i, anchor];
      setSelected(new Set(layers.slice(from, to + 1).map((x) => x.handle)));
      return;
    }
    setAnchor(i);
    if (multiple && how.ctrl) {
      const next = new Set(selected);
      if (next.has(l.handle)) next.delete(l.handle);
      else next.add(l.handle);
      setSelected(next);
      return;
    }
    setSelected(new Set([l.handle]));
  };

  const keys = (e: KeyboardEvent<HTMLUListElement>) => {
    const move = (i: number) => {
      e.preventDefault();
      choose(Math.min(layers.length - 1, Math.max(0, i)), { shift: e.shiftKey });
      listRef.current?.children[i]?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') move(active + 1);
    else if (e.key === 'ArrowUp') move(active - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(layers.length - 1);
    else if (multiple && e.key === ' ') {
      e.preventDefault();
      choose(active, { ctrl: true });
    } else if (multiple && e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSelected(new Set(layers.map((l) => l.handle)));
    }
  };

  const canOk = naming ? name.trim() !== '' : selected.size > 0;
  return (
    <Modal
      label={request.title}
      className="layer-list-dialog"
      onOk={() => canOk && ok()}
      onCancel={cancel}
    >
      {naming && (
        <label className="layer-list-name">
          Current Layer:
          <input
            type="text"
            value={name}
            autoFocus
            spellCheck={false}
            onChange={(e) => {
              setName(e.target.value);
              const i = layers.findIndex(
                (l) => l.name.toUpperCase() === e.target.value.trim().toUpperCase(),
              );
              setSelected(new Set(i >= 0 ? [layers[i]!.handle] : []));
              if (i >= 0) setActive(i);
            }}
          />
        </label>
      )}
      <span id={listId}>{LIST_LABEL[request.title]}</span>
      <ul
        ref={listRef}
        role="listbox"
        aria-labelledby={listId}
        aria-multiselectable={multiple || undefined}
        aria-activedescendant={layers[active] ? `${listId}-${active}` : undefined}
        className="dimstyle-list layer-list"
        tabIndex={0}
        autoFocus={!naming}
        onKeyDown={keys}
      >
        {layers.map((l, i) => (
          <li
            key={l.handle}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={selected.has(l.handle)}
            className={i === active ? 'layer-list-active' : undefined}
            onClick={(e) => choose(i, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
            onDoubleClick={() => {
              if (multiple) return;
              choose(i);
              // The state set by the click lands after this handler: answer with the row itself.
              void answer(doc, { kind: 'dialog', action: 'ok', layers: [l.handle] });
            }}
          >
            {l.name}
          </li>
        ))}
      </ul>
      {layers.length === 0 && <p className="layer-list-empty">No layers can be chosen.</p>}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={!canOk}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
