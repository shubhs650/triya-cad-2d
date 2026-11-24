// A prompt's right-click menu (M3-05 part 5): with a grip hot, a right-click on the canvas lists
// AutoCAD's grip options (Enter, Move, Mirror, Rotate, Scale, Stretch, Base Point, Copy,
// Reference, Undo, Properties, Exit, and a multi-functional grip's functions). Choosing an item
// answers the prompt as its keyword typed would, so the command line, Dynamic Input and this
// menu are one way in. A selected table cell's prompt (TABLECELL, M4-05 part 3) lists the Table
// Cell options here, AutoCAD's cell shortcut menu. Greyed items are not chosen; arrow keys
// move, Enter chooses, Esc or a click elsewhere closes it. A constraint bar's icon (M9-05 part 4)
// has its own menu here, whose items act on the drawing instead of answering a prompt.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { engines } from './engine/registry';
import { shortcutMenu } from './shortcut-menu';

export function ShortcutMenu() {
  const state = useSyncExternalStore(shortcutMenu.subscribe, shortcutMenu.get);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) shortcutMenu.close();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [state]);
  if (!state) return null;
  const items = () => [
    ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
  ];
  return (
    <div
      ref={ref}
      className="snap-menu"
      role="menu"
      aria-label={state.title}
      style={{
        left: Math.min(state.at.x, window.innerWidth - 220),
        top: Math.min(state.at.y, Math.max(0, window.innerHeight - state.items.length * 28 - 16)),
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          shortcutMenu.close();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : list.length - 1;
          list[(i + step) % list.length]?.focus();
        }
      }}
    >
      {state.items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="snap-menu-item"
          disabled={item.disabled}
          data-separator={item.separatorBefore ? 'before' : undefined}
          onClick={() => {
            shortcutMenu.close();
            if (state.choose) return state.choose(item);
            engines.command(state.doc, {
              kind: 'answer',
              answer:
                item.keyword === undefined
                  ? { kind: 'enter' }
                  : { kind: 'keyword', keyword: item.keyword },
            });
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
