// The Quick Access toolbar's Undo and Redo (M2-23) with their drop-down lists (M2-36). A button
// runs U or REDO on the drawing shown, as their keys do, named by the step it would undo or redo.
// Beside each, a list names the steps, newest (or next) first; pointing at one marks it and every
// step above it, and picking it undoes or redoes them all in one go, as AutoCAD's lists do, by
// running UNDO n or MREDO n on the drawing's command engine. Arrow keys move, Enter picks, Esc or
// a click elsewhere closes it.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { engines } from './engine/registry';
import { undoButtons, undoList, undoListPick, undoStates } from './undo';

type Kind = 'undo' | 'redo';

export function UndoButtons({ doc }: { readonly doc: number | undefined }) {
  useSyncExternalStore(undoStates.subscribe, undoStates.version);
  const state = undoStates.get(doc);
  const { undo, redo } = undoButtons(state);
  const [open, setOpen] = useState<Kind | undefined>();
  const run = (name: string) => {
    if (doc !== undefined) engines.command(doc, { kind: 'invoke', name });
  };
  const pick = (kind: Kind, index: number) => {
    setOpen(undefined);
    if (doc === undefined) return;
    const { command, count } = undoListPick(kind, index);
    engines.command(doc, { kind: 'invoke', name: command });
    engines.command(doc, { kind: 'answer', answer: { kind: 'number', value: count } });
  };
  return (
    <>
      <button
        type="button"
        className="undo-button"
        disabled={!undo.enabled}
        title={undo.title}
        aria-keyshortcuts="Control+Z"
        onClick={() => run('U')}
      >
        Undo
      </button>
      <ListButton
        kind="undo"
        items={undoList(state, 'undo').items}
        open={open === 'undo'}
        onOpen={(o) => setOpen(o ? 'undo' : undefined)}
        onPick={(i) => pick('undo', i)}
      />
      <button
        type="button"
        className="redo-button"
        disabled={!redo.enabled}
        title={redo.title}
        aria-keyshortcuts="Control+Y"
        onClick={() => run('REDO')}
      >
        Redo
      </button>
      <ListButton
        kind="redo"
        items={undoList(state, 'redo').items}
        open={open === 'redo'}
        onOpen={(o) => setOpen(o ? 'redo' : undefined)}
        onPick={(i) => pick('redo', i)}
      />
    </>
  );
}

function ListButton({
  kind,
  items,
  open,
  onOpen,
  onPick,
}: {
  readonly kind: Kind;
  readonly items: readonly string[];
  readonly open: boolean;
  readonly onOpen: (open: boolean) => void;
  readonly onPick: (index: number) => void;
}) {
  const name = kind === 'undo' ? 'Undo list' : 'Redo list';
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState(0);
  const shown = open && items.length > 0;

  useEffect(() => {
    if (!shown) return;
    setAt(0);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) onOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
    // onOpen is a new closure each render; the list only needs re-arming when it opens.
  }, [shown]);

  const close = (refocus: boolean) => {
    onOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const choose = (i: number) => {
    onPick(i);
    trigger.current?.focus();
  };
  const menuItems = () => [
    ...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
  ];
  // The keys move from the entry that has the focus; the pointer may have marked another.
  const focusItem = (step: number | 'first' | 'last') => {
    const list = menuItems();
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const j =
      step === 'first'
        ? 0
        : step === 'last'
          ? list.length - 1
          : (Math.max(i, 0) + step + list.length) % list.length;
    list[j]?.focus();
  };

  return (
    <span className="undo-list" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="undo-list-button"
        aria-label={name}
        title={name}
        aria-haspopup="menu"
        aria-expanded={shown}
        disabled={items.length === 0}
        onClick={() => onOpen(!shown)}
      >
        ▾
      </button>
      {shown && (
        <div
          className="undo-list-menu"
          role="menu"
          aria-label={name}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              focusItem(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              focusItem(e.key === 'Home' ? 'first' : 'last');
            } else if (e.key === 'Tab') {
              close(false);
            }
          }}
        >
          <div className="undo-list-items">
            {items.map((label, i) => (
              <button
                // Labels repeat (LINE, LINE); a step's place in the list is its identity here.
                key={i}
                type="button"
                role="menuitem"
                className="undo-list-item"
                data-included={i <= at}
                onPointerEnter={() => setAt(i)}
                onFocus={() => setAt(i)}
                onClick={() => choose(i)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="undo-list-count" data-testid="undo-list-count" aria-live="polite">
            {undoListPick(kind, at).text}
          </div>
        </div>
      )}
    </span>
  );
}
