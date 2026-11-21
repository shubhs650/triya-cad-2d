// The palette stack and its rail (M7-03, UI_SPEC.md §4; palette-stack.ts holds the layout).
// The open palettes are tabs of one stack docked beside the drawing area, right by default; the
// tab strip's button docks it on the other side, and its inner edge is dragged (or, focused,
// moved with the arrow keys) to size it. Tabs are dragged sideways into another order, or moved
// with Ctrl+Shift+Page Up/Down as the drawing tabs are. Below 1366 px the stack slides over the
// drawing area instead of narrowing it, and Esc slides it away.
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  PALETTES,
  PALETTE_WIDTH,
  SLIDE_OVER_BELOW,
  clampPaletteWidth,
  paletteStack,
  type PaletteName,
} from './palette-stack';

/** Pixels a tab moves before it drags (a click below that), as the drawing tabs. */
const DRAG_START = 5;
/** The arrow keys' step on the width handle, px; Shift for a bigger one. */
const WIDTH_STEP = 16;

const titleOf = (p: PaletteName): string => PALETTES.find((x) => x.name === p)?.title ?? p;

export function PaletteDock({ render }: { render: (p: PaletteName) => ReactNode }) {
  const stack = paletteStack;
  const layout = useSyncExternalStore(stack.subscribe, stack.layout);
  const shown = useSyncExternalStore(stack.subscribe, stack.get);
  const narrow = useSyncExternalStore(stack.subscribe, stack.narrow);
  const tabs = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  const drag = useRef<{ p: PaletteName; pointer: number; x: number; moved: boolean } | undefined>(
    undefined,
  );
  const [dragged, setDragged] = useState<PaletteName>();
  const sizing = useRef<{ pointer: number; x: number; width: number } | undefined>(undefined);
  const [sizedWidth, setSizedWidth] = useState<number>();

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${SLIDE_OVER_BELOW - 0.02}px)`);
    const follow = () => stack.setNarrow(query.matches);
    follow();
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [stack]);

  const width = sizedWidth ?? layout.width;
  // The width handle sits on the stack's edge facing the drawing area.
  const sign = layout.side === 'right' ? -1 : 1;

  const focusTab = (p: PaletteName) =>
    requestAnimationFrame(() =>
      tabs.current?.querySelector<HTMLElement>(`[data-palette="${p}"]`)?.focus(),
    );

  const tabKey = (p: PaletteName, e: ReactKeyboardEvent) => {
    const at = layout.open.indexOf(p);
    if (e.ctrlKey && e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown')) {
      e.preventDefault();
      stack.move(p, at + (e.key === 'PageUp' ? -1 : 1));
      focusTab(p);
      return;
    }
    const to =
      e.key === 'ArrowLeft'
        ? layout.open[(at - 1 + layout.open.length) % layout.open.length]
        : e.key === 'ArrowRight'
          ? layout.open[(at + 1) % layout.open.length]
          : e.key === 'Home'
            ? layout.open[0]
            : e.key === 'End'
              ? layout.open[layout.open.length - 1]
              : undefined;
    if (to === undefined || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    stack.set(to);
    focusTab(to);
  };

  const tabDown = (p: PaletteName, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    drag.current = { p, pointer: e.pointerId, x: e.clientX, moved: false };
  };

  const tabMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < DRAG_START) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragged(d.p);
      stack.set(d.p);
    }
    // The dragged tab goes before the first other tab whose middle is right of the pointer.
    const others = [...(tabs.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].filter(
      (t) => t.dataset['palette'] !== d.p,
    );
    const to = others.filter((t) => {
      const r = t.getBoundingClientRect();
      return r.left + r.width / 2 < e.clientX;
    }).length;
    stack.move(d.p, to);
  };

  const tabUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = undefined;
    setDragged(undefined);
  };

  const sizeDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    sizing.current = { pointer: e.pointerId, x: e.clientX, width: layout.width };
  };

  const sizeMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = sizing.current;
    if (!s || s.pointer !== e.pointerId) return;
    setSizedWidth(clampPaletteWidth(s.width + sign * (e.clientX - s.x)));
  };

  // The width is kept once the drag ends, not on every move.
  const sizeUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = sizing.current;
    if (!s || s.pointer !== e.pointerId) return;
    sizing.current = undefined;
    stack.resize(s.width + sign * (e.clientX - s.x));
    setSizedWidth(undefined);
  };

  const sizeKey = (e: ReactKeyboardEvent) => {
    // Left and Right move the edge that way, as AutoCAD's splitter; Home/End the narrowest/widest.
    const step = e.shiftKey ? WIDTH_STEP * 4 : WIDTH_STEP;
    const next =
      e.key === 'ArrowLeft'
        ? layout.width - sign * step
        : e.key === 'ArrowRight'
          ? layout.width + sign * step
          : e.key === 'Home'
            ? PALETTE_WIDTH.min
            : e.key === 'End'
              ? PALETTE_WIDTH.max
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    stack.resize(next);
  };

  const stackKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !narrow) return;
    // Esc in a field or a menu is that field's (it cancels an edit); elsewhere it slides away.
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;
    e.preventDefault();
    const p = shown;
    stack.slideAway();
    if (p) rail.current?.querySelector<HTMLElement>(`[data-palette="${p}"]`)?.focus();
  };

  return (
    <div
      className="palette-dock"
      data-side={layout.side}
      data-mode={narrow ? 'slide-over' : 'docked'}
    >
      {shown && (
        <section
          className="palette-stack"
          aria-label="Palette stack"
          data-testid="palette-stack"
          style={{ '--palette-width': `${width}px` } as CSSProperties}
          onKeyDown={stackKey}
        >
          <div
            className="palette-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Palette width"
            aria-valuemin={PALETTE_WIDTH.min}
            aria-valuemax={PALETTE_WIDTH.max}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={sizeDown}
            onPointerMove={sizeMove}
            onPointerUp={sizeUp}
            onPointerCancel={sizeUp}
            onKeyDown={sizeKey}
          />
          <div className="palette-tabs">
            <div ref={tabs} role="tablist" aria-label="Open palettes">
              {layout.open.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  id={`palette-tab-${p}`}
                  data-palette={p}
                  data-dragging={p === dragged}
                  aria-selected={p === shown}
                  aria-controls="palette-panel"
                  aria-keyshortcuts="Control+Shift+PageUp Control+Shift+PageDown"
                  tabIndex={p === shown ? 0 : -1}
                  onClick={() => stack.set(p)}
                  onKeyDown={(e) => tabKey(p, e)}
                  onPointerDown={(e) => tabDown(p, e)}
                  onPointerMove={tabMove}
                  onPointerUp={tabUp}
                  onPointerCancel={tabUp}
                >
                  {titleOf(p)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="palette-dock-side"
              aria-label={layout.side === 'right' ? 'Dock palettes left' : 'Dock palettes right'}
              title={layout.side === 'right' ? 'Dock palettes left' : 'Dock palettes right'}
              onClick={() => stack.dock(layout.side === 'right' ? 'left' : 'right')}
            >
              {layout.side === 'right' ? '⇤' : '⇥'}
            </button>
          </div>
          <div
            className="palette-panel"
            id="palette-panel"
            role="tabpanel"
            aria-labelledby={`palette-tab-${shown}`}
          >
            {render(shown)}
          </div>
        </section>
      )}
      <nav ref={rail} className="palette-rail" aria-label="Palettes">
        {PALETTES.map(({ name, title }) => (
          <button
            key={name}
            type="button"
            data-palette={name}
            aria-expanded={shown === name}
            onClick={() => stack.toggle(name)}
          >
            {title}
          </button>
        ))}
      </nav>
    </div>
  );
}
