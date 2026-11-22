// The palette stack and its rail (M7-03, UI_SPEC.md §4; palette-stack.ts holds the layout).
// The open palettes are tabs of one stack docked beside the drawing area, right by default. Its
// inner edge is dragged (or, focused, moved with the arrow keys) to size it. Tabs are dragged
// sideways into another order, or moved with Ctrl+Shift+Page Up/Down as the drawing tabs are.
// Below 1366 px the stack slides over the drawing area instead of narrowing it, and Esc slides
// it away.
// Part 2, as AutoCAD's palettes: the stack is dragged off its dock by its tab strip (the grip at
// its start, or the strip's free part) and floats where it is dropped, or docks at the drawing
// area's left, right or bottom edge when dropped there. The Palette options menu at the strip's
// end (AutoCAD's palette Properties menu) docks it left, right or at the bottom, floats it, and
// turns auto-hide on: the stack then collapses to its tab strip over the drawing area and opens
// while the pointer rests on it or the keyboard is in it.
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
  FLOAT_HEIGHT,
  PALETTES,
  PALETTE_HEIGHT,
  PALETTE_WIDTH,
  SLIDE_OVER_BELOW,
  clampFloatHeight,
  clampPaletteHeight,
  clampPaletteWidth,
  dockTarget,
  paletteStack,
  placeFloating,
  type DockSide,
  type PaletteName,
} from './palette-stack';

/** Pixels a tab or the stack moves before it drags (a click below that), as the drawing tabs. */
const DRAG_START = 5;
/** The arrow keys' step on the size handles and the grip, px; Shift for a bigger one. */
const STEP = 16;
/** How long the pointer rests on an auto-hidden stack before it opens, and is away before it
 * closes, ms (AutoCAD opens an auto-hidden palette on a short rollover delay). */
const REVEAL_AFTER = 200;
const HIDE_AFTER = 300;

const titleOf = (p: PaletteName): string => PALETTES.find((x) => x.name === p)?.title ?? p;

/** The Palette options menu's items: where the stack goes, then auto-hide. */
const PLACES: readonly { readonly label: string; readonly place: DockSide | 'float' }[] = [
  { label: 'Dock Left', place: 'left' },
  { label: 'Dock Right', place: 'right' },
  { label: 'Dock Bottom', place: 'bottom' },
  { label: 'Float', place: 'float' },
];

interface Sizing {
  readonly pointer: number;
  readonly axis: 'x' | 'y';
  readonly from: number;
  readonly size: number;
}

interface Moving {
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  /** The pointer's offset in the floating stack it drags. */
  readonly dx: number;
  readonly dy: number;
  moved: boolean;
}

function useViewport(): { width: number; height: number } {
  const [view, setView] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const follow = () => setView({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', follow);
    return () => window.removeEventListener('resize', follow);
  }, []);
  return view;
}

export function PaletteDock({
  render,
  rail: railShown = true,
}: {
  render: (p: PaletteName) => ReactNode;
  /** The Palettes rail shows; Clean Screen (Ctrl+0, M7-06) hides it. */
  rail?: boolean;
}) {
  const stack = paletteStack;
  const layout = useSyncExternalStore(stack.subscribe, stack.layout);
  const shown = useSyncExternalStore(stack.subscribe, stack.get);
  const slideOver = useSyncExternalStore(stack.subscribe, stack.slideOver);
  const view = useViewport();
  const dock = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ p: PaletteName; pointer: number; x: number; moved: boolean } | undefined>(
    undefined,
  );
  const [dragged, setDragged] = useState<PaletteName>();
  const sizing = useRef<Sizing | undefined>(undefined);
  const [sized, setSized] = useState<{ axis: 'x' | 'y'; size: number }>();
  const moving = useRef<Moving | undefined>(undefined);
  const [movedTo, setMovedTo] = useState<{ x: number; y: number }>();
  const [target, setTarget] = useState<DockSide>();
  const [menu, setMenu] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const revealTimer = useRef<number | undefined>(undefined);
  const pointerIn = useRef(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${SLIDE_OVER_BELOW - 0.02}px)`);
    const follow = () => stack.setNarrow(query.matches);
    follow();
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [stack]);

  useEffect(() => () => window.clearTimeout(revealTimer.current), []);

  // A click outside the options menu closes it.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const m = section.current?.querySelector('.palette-menu');
      if (m?.contains(e.target as Node) || menuButton.current?.contains(e.target as Node)) return;
      setMenu(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menu]);

  const floating = movedTo !== undefined || layout.floating;
  const bottom = !floating && layout.side === 'bottom';
  const collapsed = layout.autoHide && !revealed && !menu && movedTo === undefined;
  const railSide = layout.side === 'left' ? 'left' : 'right';
  const floatRect = placeFloating(
    {
      ...layout.float,
      ...movedTo,
      ...(sized?.axis === 'x' && floating && { width: sized.size }),
      ...(sized?.axis === 'y' && floating && { height: sized.size }),
    },
    view,
  );
  const width = sized?.axis === 'x' && !floating ? sized.size : layout.width;
  const height = sized?.axis === 'y' && !floating ? sized.size : layout.height;

  // The width handle sits on the edge facing the drawing area (a floating stack's right edge);
  // the height handle on a bottom dock's top edge or a floating stack's bottom edge.
  const widthSign = floating || layout.side === 'left' ? 1 : -1;
  const heightSign = floating ? 1 : -1;
  const widthNow = floating ? floatRect.width : width;
  const heightNow = floating ? floatRect.height : height;
  const heightRange = floating ? FLOAT_HEIGHT : PALETTE_HEIGHT;

  const reveal = (on: boolean, after = 0) => {
    window.clearTimeout(revealTimer.current);
    if (after === 0) setRevealed(on);
    else revealTimer.current = window.setTimeout(() => setRevealed(on), after);
  };

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
    if (layout.autoHide) reveal(true);
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

  const sizeDown = (axis: 'x' | 'y', e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    sizing.current = {
      pointer: e.pointerId,
      axis,
      from: axis === 'x' ? e.clientX : e.clientY,
      size: axis === 'x' ? widthNow : heightNow,
    };
  };

  const sizeOf = (s: Sizing, e: ReactPointerEvent<HTMLElement>) =>
    s.axis === 'x'
      ? clampPaletteWidth(s.size + widthSign * (e.clientX - s.from))
      : floating
        ? clampFloatHeight(s.size + heightSign * (e.clientY - s.from))
        : clampPaletteHeight(s.size + heightSign * (e.clientY - s.from));

  const sizeMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = sizing.current;
    if (!s || s.pointer !== e.pointerId) return;
    setSized({ axis: s.axis, size: sizeOf(s, e) });
  };

  const applySize = (axis: 'x' | 'y', size: number) => {
    if (floating) {
      if (axis === 'x') stack.sizeFloat(size, floatRect.height);
      else stack.sizeFloat(floatRect.width, size);
    } else if (axis === 'x') stack.resize(size);
    else stack.resizeHeight(size);
  };

  // The size is kept once the drag ends, not on every move.
  const sizeUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = sizing.current;
    if (!s || s.pointer !== e.pointerId) return;
    sizing.current = undefined;
    applySize(s.axis, sizeOf(s, e));
    setSized(undefined);
  };

  const sizeKey = (axis: 'x' | 'y', e: ReactKeyboardEvent) => {
    // The arrow keys move the edge their way, as AutoCAD's splitter; Home/End the least/most.
    const step = e.shiftKey ? STEP * 4 : STEP;
    const [less, more, now, sign, range] =
      axis === 'x'
        ? (['ArrowLeft', 'ArrowRight', widthNow, widthSign, PALETTE_WIDTH] as const)
        : (['ArrowUp', 'ArrowDown', heightNow, heightSign, heightRange] as const);
    const next =
      e.key === less
        ? now - sign * step
        : e.key === more
          ? now + sign * step
          : e.key === 'Home'
            ? range.min
            : e.key === 'End'
              ? range.max
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    applySize(axis, axis === 'x' ? clampPaletteWidth(next) : next);
  };

  /** The drawing area a dragged stack can dock at the edges of. */
  const drawingArea = () =>
    dock.current?.parentElement?.querySelector('.canvas-area')?.getBoundingClientRect();

  const moveDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    // The strip's free part, or its grip: not a tab or another button on it.
    const t = e.target as HTMLElement;
    if (
      t !== e.currentTarget &&
      t.closest('[role="tab"], button:not(.palette-grip), [role="menu"]')
    )
      return;
    const r = section.current?.getBoundingClientRect();
    if (!r) return;
    // A docked stack floats at its floating size with the pointer at the same place on its strip.
    const dx = Math.min(e.clientX - r.left, layout.float.width - 24);
    moving.current = {
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx,
      dy: e.clientY - r.top,
      moved: false,
    };
  };

  const moveMove = (e: ReactPointerEvent<HTMLElement>) => {
    const m = moving.current;
    if (!m || m.pointer !== e.pointerId) return;
    if (!m.moved) {
      if (Math.hypot(e.clientX - m.x, e.clientY - m.y) < DRAG_START) return;
      m.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setMenu(false);
    }
    setMovedTo({ x: e.clientX - m.dx, y: e.clientY - m.dy });
    const area = drawingArea();
    setTarget(
      area &&
        dockTarget(
          { x: e.clientX, y: e.clientY },
          { x: area.left, y: area.top, width: area.width, height: area.height },
        ),
    );
  };

  const moveUp = (e: ReactPointerEvent<HTMLElement>) => {
    const m = moving.current;
    if (!m || m.pointer !== e.pointerId) return;
    moving.current = undefined;
    if (m.moved) {
      if (target) stack.dock(target);
      else stack.float({ x: e.clientX - m.dx, y: e.clientY - m.dy });
    }
    setMovedTo(undefined);
    setTarget(undefined);
  };

  const gripKey = (e: ReactKeyboardEvent) => {
    if (!floating) return;
    const step = e.shiftKey ? STEP * 4 : STEP;
    const [dx, dy] =
      e.key === 'ArrowLeft'
        ? [-step, 0]
        : e.key === 'ArrowRight'
          ? [step, 0]
          : e.key === 'ArrowUp'
            ? [0, -step]
            : e.key === 'ArrowDown'
              ? [0, step]
              : [0, 0];
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    stack.moveFloat(floatRect.x + dx, floatRect.y + dy);
  };

  const place = (p: DockSide | 'float') => {
    setMenu(false);
    if (p === 'float') stack.float();
    else stack.dock(p);
    menuButton.current?.focus();
  };

  const menuKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === 'ArrowDown'
        ? (at + 1) % items.length
        : e.key === 'ArrowUp'
          ? (at - 1 + items.length) % items.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? items.length - 1
              : undefined;
    if (to !== undefined) {
      e.preventDefault();
      items[to]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      e.stopPropagation();
      setMenu(false);
      if (e.key === 'Escape') menuButton.current?.focus();
    }
  };

  useEffect(() => {
    if (!menu) return;
    const m = section.current?.querySelector('.palette-menu');
    (
      m?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      m?.querySelector<HTMLElement>('[role^="menuitem"]')
    )?.focus();
  }, [menu]);

  const stackKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!layout.autoHide && !slideOver) return;
    // Esc in a field or a menu is that field's (it cancels an edit); elsewhere it closes the
    // auto-hidden stack, or slides the slide-over away.
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;
    e.preventDefault();
    if (layout.autoHide) {
      reveal(false);
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    const p = shown;
    stack.slideAway();
    if (p) rail.current?.querySelector<HTMLElement>(`[data-palette="${p}"]`)?.focus();
  };

  // Auto-hide: the pointer resting on the stack or the keyboard in it opens it; it closes once
  // both have left.
  const enter = () => {
    pointerIn.current = true;
    if (layout.autoHide && !revealed) reveal(true, REVEAL_AFTER);
  };
  const leave = () => {
    pointerIn.current = false;
    if (!layout.autoHide || sizing.current || moving.current) return;
    reveal(false, HIDE_AFTER);
  };
  const focusIn = () => {
    if (layout.autoHide) reveal(true);
  };
  const focusOut = (e: React.FocusEvent) => {
    if (!layout.autoHide || section.current?.contains(e.relatedTarget as Node)) return;
    if (!pointerIn.current) reveal(false);
  };

  const style = {
    '--palette-width': `${width}px`,
    '--palette-height': `${height}px`,
    ...(floating && {
      left: `${floatRect.x}px`,
      top: `${floatRect.y}px`,
      width: `${floatRect.width}px`,
      height: collapsed ? undefined : `${floatRect.height}px`,
    }),
  } as CSSProperties;

  return (
    <div
      ref={dock}
      className="palette-dock"
      data-side={layout.side}
      data-rail={railSide}
      data-mode={slideOver ? 'slide-over' : 'docked'}
      data-floating={floating}
      data-autohide={layout.autoHide}
      data-dock-target={target}
    >
      {shown && (
        <section
          ref={section}
          className="palette-stack"
          aria-label="Palette stack"
          data-testid="palette-stack"
          data-floating={floating}
          data-collapsed={collapsed}
          style={style}
          onKeyDown={stackKey}
          onPointerEnter={enter}
          onPointerLeave={leave}
          onFocus={focusIn}
          onBlur={focusOut}
        >
          {!collapsed && !bottom && (
            <div
              className="palette-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Palette width"
              aria-valuemin={PALETTE_WIDTH.min}
              aria-valuemax={PALETTE_WIDTH.max}
              aria-valuenow={widthNow}
              tabIndex={0}
              onPointerDown={(e) => sizeDown('x', e)}
              onPointerMove={sizeMove}
              onPointerUp={sizeUp}
              onPointerCancel={sizeUp}
              onKeyDown={(e) => sizeKey('x', e)}
            />
          )}
          {!collapsed && (floating || bottom) && (
            <div
              className="palette-resize-height"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Palette height"
              aria-valuemin={heightRange.min}
              aria-valuemax={heightRange.max}
              aria-valuenow={heightNow}
              tabIndex={0}
              onPointerDown={(e) => sizeDown('y', e)}
              onPointerMove={sizeMove}
              onPointerUp={sizeUp}
              onPointerCancel={sizeUp}
              onKeyDown={(e) => sizeKey('y', e)}
            />
          )}
          <div
            className="palette-tabs"
            onPointerDown={moveDown}
            onPointerMove={moveMove}
            onPointerUp={moveUp}
            onPointerCancel={moveUp}
          >
            <button
              type="button"
              className="palette-grip"
              aria-label="Move palettes"
              title="Move palettes: drag to float or dock; arrow keys move a floating stack"
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
              onKeyDown={gripKey}
            >
              ⠿
            </button>
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
              ref={menuButton}
              type="button"
              className="palette-options"
              aria-label="Palette options"
              title="Palette options"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            >
              ⋮
            </button>
            {menu && (
              <div
                className="palette-menu"
                role="menu"
                aria-label="Palette options"
                onKeyDown={menuKey}
              >
                {PLACES.map(({ label, place: p }) => (
                  <button
                    key={p}
                    type="button"
                    role="menuitemradio"
                    aria-checked={
                      p === 'float' ? layout.floating : !layout.floating && layout.side === p
                    }
                    tabIndex={-1}
                    onClick={() => place(p)}
                  >
                    {label}
                  </button>
                ))}
                <div role="separator" />
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={layout.autoHide}
                  tabIndex={-1}
                  onClick={() => {
                    setMenu(false);
                    stack.autoHide(!layout.autoHide);
                    reveal(true);
                    menuButton.current?.focus();
                  }}
                >
                  Auto-hide
                </button>
              </div>
            )}
          </div>
          <div
            className="palette-panel"
            id="palette-panel"
            role="tabpanel"
            aria-labelledby={`palette-tab-${shown}`}
            hidden={collapsed}
          >
            {render(shown)}
          </div>
        </section>
      )}
      {railShown && (
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
      )}
    </div>
  );
}
