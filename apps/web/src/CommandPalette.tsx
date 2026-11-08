// The Ctrl+K palette (M2-02 part 2, UI_SPEC.md §5, FR-C3): fuzzy search over the commands, with
// their aliases, and the app's settings and windows with their keys. Enter runs the highlighted
// one: a command starts as a ribbon button would (`invoke`, cancelling a running one unless it
// is transparent). Recent files join it with M2-14.
import { useEffect, useRef, useState } from 'react';
import { rankItems, type PaletteItem } from './palette';

export function CommandPalette({
  items,
  onRun,
  onClose,
}: {
  items: readonly PaletteItem[];
  onRun: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const found = rankItems(items, query);
  const current = Math.min(at, Math.max(found.length - 1, 0));

  useEffect(() => input.current?.focus(), []);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    onRun(item);
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
              const n = found.length;
              if (n > 0) setAt((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
            }
          }}
        />
        <ul id="palette-list" role="listbox" aria-label="Commands">
          {found.map((item, i) => (
            <li
              key={item.id}
              id={`palette-${item.id}`}
              role="option"
              aria-selected={i === current}
              onPointerDown={(e) => {
                e.preventDefault();
                run(item);
              }}
            >
              <span className="label">{item.label}</span>
              {item.aliases.length > 0 && <span className="alias">{item.aliases.join(', ')}</span>}
              {item.keys && <kbd>{item.keys}</kbd>}
            </li>
          ))}
          {found.length === 0 && <li className="empty">No matches</li>}
        </ul>
      </dialog>
    </div>
  );
}
