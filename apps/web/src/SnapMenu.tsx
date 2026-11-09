// The object snap menu (M2-04 part 2): Shift+right-click on the canvas at a point prompt, as
// in AutoCAD. Choosing an item types its override at the prompt (`END`, `FROM`, `NON`), so the
// command line, Dynamic Input and this menu are one way in. Arrow keys move, Enter chooses,
// Esc or a click elsewhere closes it.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { engines } from './engine/registry';
import { SNAP_MENU_ITEMS, snapMenu } from './snap-menu';

export function SnapMenu() {
  const state = useSyncExternalStore(snapMenu.subscribe, snapMenu.get);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) snapMenu.close();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [state]);
  if (!state) return null;
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  return (
    <div
      ref={ref}
      className="snap-menu"
      role="menu"
      aria-label="Object snap overrides"
      style={{
        left: Math.min(state.at.x, window.innerWidth - 220),
        top: Math.min(state.at.y, window.innerHeight - 440),
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          snapMenu.close();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : list.length - 1;
          list[(i + step) % list.length]?.focus();
        }
      }}
    >
      {SNAP_MENU_ITEMS.map((item) => (
        <button
          key={item.text}
          type="button"
          role="menuitem"
          className="snap-menu-item"
          data-separator={item.text === 'END' || item.text === 'NON' ? 'before' : undefined}
          onClick={() => {
            snapMenu.close();
            engines.command(state.doc, { kind: 'submit', text: item.text });
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
