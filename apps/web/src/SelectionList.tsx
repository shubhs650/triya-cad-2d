// Selection cycling's Selection list (M3-04 part 3, `selection-list.ts`): AutoCAD's small list
// titled "Selection" that opens by a pick over overlapping objects, one row per object by its
// type's name. Hovering a row (or moving to it with the arrow keys) highlights its object on the
// canvas; a click or Enter selects it; Esc or a click elsewhere selects none.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { EntityId } from '@triya/engine';
import { rolloverPlacement } from './rollover';
import { selectionList } from './selection-list';

export function SelectionList({
  doc,
  onHover,
}: {
  doc: number;
  /** The object to show highlighted besides the selection, none when the list leaves it. */
  onHover: (id: EntityId | undefined) => void;
}) {
  const open = useSyncExternalStore(selectionList.subscribe, selectionList.get);
  if (open?.doc !== doc) return null;
  return <Body key={JSON.stringify(open.request)} request={open.request} onHover={onHover} />;
}

function Body({
  request,
  onHover,
}: {
  request: NonNullable<ReturnType<typeof selectionList.get>>['request'];
  onHover: (id: EntityId | undefined) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | undefined>();
  const hover = useRef(onHover);
  hover.current = onHover;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Beside the pick as a rollover tooltip goes beside the cursor, kept inside the window.
    setPlace(
      rolloverPlacement(
        request.at,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [request]);
  // The first row takes the keys once the list shows (a hidden one cannot take focus).
  const shown = place !== undefined;
  useEffect(() => {
    if (shown) ref.current?.querySelector('button')?.focus();
  }, [shown]);

  useEffect(() => {
    // Esc closes the list, choosing nothing: the command line must not also cancel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        selectionList.close();
      }
    };
    // A press anywhere else closes it too; the press then does what it does there.
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) selectionList.close();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('pointerdown', onDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('pointerdown', onDown, { capture: true });
      hover.current(undefined);
    };
  }, []);

  /** Up and Down move between the rows, as in a list box. */
  const step = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (d === 0) return;
    e.preventDefault();
    const rows = ref.current?.querySelectorAll('button');
    const n = request.candidates.length;
    (rows?.[(i + d + n) % n] as HTMLButtonElement | undefined)?.focus();
  };

  return (
    <div
      ref={ref}
      className="selection-list"
      role="dialog"
      aria-label="Selection"
      data-testid="selection-list"
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        visibility: place ? 'visible' : 'hidden',
      }}
      onPointerLeave={() => onHover(undefined)}
    >
      <div className="selection-list-title">Selection</div>
      <ul>
        {request.candidates.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              onPointerEnter={() => onHover(c.id)}
              onFocus={() => onHover(c.id)}
              onKeyDown={(e) => step(e, i)}
              onClick={() => selectionList.close(c.id)}
            >
              {c.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
