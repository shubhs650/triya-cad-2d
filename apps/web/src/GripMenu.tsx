// A grip's hover menu (M3-05 part 2; `grip-menu.ts` decides when): the functions of the grip
// under a resting cursor, as AutoCAD lists them ("Stretch Vertex", "Add Vertex", …). Choosing
// one makes the grip hot in that function, as clicking the grip and Ctrl-cycling to it would.
// The menu takes no focus, so typing still goes to the command line; Esc closes it.
import { useEffect, useSyncExternalStore } from 'react';
import { engines } from './engine/registry';
import { gripMenus } from './grip-menu';

export function GripMenu() {
  const state = useSyncExternalStore(gripMenus.subscribe, gripMenus.get);
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') gripMenus.close(state.doc);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [state]);
  if (!state) return null;
  return (
    <div
      className="snap-menu grip-menu"
      role="menu"
      aria-label="Grip functions"
      data-testid="grip-menu"
      style={{
        left: Math.min(state.left, window.innerWidth - 180),
        top: Math.min(state.top, window.innerHeight - 24 * state.items.length - 8),
      }}
      onPointerEnter={() => gripMenus.enter()}
      onPointerLeave={() => gripMenus.leave()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item) => (
        <button
          key={item}
          type="button"
          role="menuitem"
          className="snap-menu-item"
          onClick={() => {
            gripMenus.close(state.doc);
            engines.command(state.doc, {
              kind: 'pick',
              point: state.grip,
              grip: state.within,
              gripFunction: item,
            });
          }}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
