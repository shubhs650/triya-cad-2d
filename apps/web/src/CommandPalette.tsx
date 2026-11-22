// The Ctrl+K palette (M2-02 part 2, UI_SPEC.md §5, FR-C3): fuzzy search over the commands, with
// their aliases, and the app's settings and windows with their keys. Enter runs the highlighted
// one: a command starts as a ribbon button would (`invoke`, cancelling a running one unless it
// is transparent). Recent files join it with M2-14.
//
// M7-06 part 2: with nothing typed the items run last come first, marked Recently used; each
// item says what it is (Command, View, Drafting, Options, Drawing); the letters a search matched
// are marked; ↑/↓ move, Page Up/Page Down a page, and the highlighted item stays in view; the
// pointer resting on an item highlights it.
import { useEffect, useRef, useState } from 'react';
import { matchedLetters, rankItems, recentFirst, type PaletteItem } from './palette';

/** How far Page Up and Page Down move: about the list's height. */
const PAGE = 8;

export function CommandPalette({
  items,
  recent = [],
  onRun,
  onClose,
}: {
  items: readonly PaletteItem[];
  /** The items run last, newest first: listed first while nothing is typed. */
  recent?: readonly string[];
  onRun: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const searching = query.trim() !== '';
  const found = searching ? rankItems(items, query) : recentFirst(items, recent);
  const current = Math.min(at, Math.max(found.length - 1, 0));
  const ranLast = new Set(searching ? [] : recent);

  useEffect(() => input.current?.focus(), []);
  // The highlighted item stays in view as the keys move it.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [current, query]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    onRun(item);
  };
  const move = (by: number, wrap: boolean) => {
    const n = found.length;
    if (n === 0) return;
    const to = current + by;
    setAt(wrap ? (to + n) % n : Math.max(0, Math.min(n - 1, to)));
  };

  return (
    <div className="palette-backdrop" onPointerDown={onClose}>
      <dialog
        open
        className="command-palette"
        aria-label="Command palette"
        aria-modal="true"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={found[current] ? `palette-${found[current].id}` : undefined}
          aria-label="Search commands"
          placeholder="Search commands and settings"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(found[current]);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              move(e.key === 'ArrowDown' ? 1 : -1, true);
            } else if (e.key === 'PageDown' || e.key === 'PageUp') {
              e.preventDefault();
              move(e.key === 'PageDown' ? PAGE : -PAGE, false);
            }
          }}
        />
        <ul ref={list} id="palette-list" role="listbox" aria-label="Commands">
          {found.map((item, i) => (
            <li
              key={item.id}
              id={`palette-${item.id}`}
              role="option"
              aria-selected={i === current}
              onPointerMove={() => {
                if (i !== current) setAt(i);
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                run(item);
              }}
            >
              <span className="label">
                <Marked text={item.label} at={matchedLetters(item, query)} />
              </span>
              {item.aliases.length > 0 && <span className="alias">{item.aliases.join(', ')}</span>}
              {item.keys && <kbd>{item.keys}</kbd>}
              <span className="group">{ranLast.has(item.id) ? 'Recently used' : item.group}</span>
            </li>
          ))}
          {found.length === 0 && <li className="empty">No matches</li>}
        </ul>
        <p className="palette-hint" aria-hidden="true">
          ↑↓ move · Enter runs · Esc closes
        </p>
      </dialog>
    </div>
  );
}

/** `text` with the letters at `at` marked. */
function Marked({ text, at }: { text: string; at: readonly number[] }) {
  if (at.length === 0) return <>{text}</>;
  const marked = new Set(at);
  const parts: { text: string; mark: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const mark = marked.has(i);
    const last = parts.at(-1);
    if (last && last.mark === mark) last.text += text[i];
    else parts.push({ text: text[i]!, mark });
  }
  return (
    <>
      {parts.map((p, i) =>
        p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}
