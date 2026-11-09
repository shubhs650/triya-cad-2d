// The status bar's drafting aids (M2-04): GRID, SNAP, ORTHO, POLAR, OTRACK and OSNAP, then
// LWT and TPY, in AutoCAD's order, each with its function key in the tooltip, and OSNAP's menu
// of running object snap modes (AutoCAD's arrow beside the OSNAP button), a checkbox per mode.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { OSNAP, OSNAP_MODES } from '@triya/engine';
import { drafting, isOn, type DraftingToggle } from './drafting';

const TOGGLES: readonly { toggle: DraftingToggle; label: string; title: string }[] = [
  { toggle: 'grid', label: 'GRID', title: 'Grid Display (F7)' },
  { toggle: 'snap', label: 'SNAP', title: 'Snap Mode (F9)' },
  { toggle: 'ortho', label: 'ORTHO', title: 'Ortho Mode (F8)' },
  { toggle: 'polar', label: 'POLAR', title: 'Polar Tracking (F10)' },
  { toggle: 'otrack', label: 'OTRACK', title: 'Object Snap Tracking (F11)' },
  { toggle: 'osnap', label: 'OSNAP', title: 'Object Snap (F3)' },
  { toggle: 'lwt', label: 'LWT', title: 'Show/Hide Lineweight' },
  { toggle: 'tpy', label: 'TPY', title: 'Show/Hide Transparency' },
];

export function DraftingToggles() {
  const state = useSyncExternalStore(drafting.subscribe, drafting.get);
  const [menu, setMenu] = useState(false);
  const close = useCallback(() => setMenu(false), []);
  return (
    <>
      {TOGGLES.map((t) => (
        <span key={t.toggle} className="status-group">
          <button
            type="button"
            className="status-toggle"
            aria-pressed={isOn(state, t.toggle, drafting.drawingLineweights)}
            title={t.title}
            onClick={() => drafting.toggle(t.toggle)}
          >
            {t.label}
          </button>
          {t.toggle === 'osnap' && (
            <button
              type="button"
              className="status-menu-button"
              aria-label="Object snap modes"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            >
              ▴
            </button>
          )}
          {t.toggle === 'osnap' && menu && <OsnapMenu onClose={close} />}
        </span>
      ))}
    </>
  );
}

/** The running object snap modes, each a checkbox; Esc or a click elsewhere closes it. */
function OsnapMenu({ onClose }: { onClose: () => void }) {
  const state = useSyncExternalStore(drafting.subscribe, drafting.get);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitemcheckbox"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);
  const items = () => [
    ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]') ?? []),
  ];
  return (
    <div
      ref={ref}
      className="osnap-menu"
      role="menu"
      aria-label="Object snap modes"
      onKeyDown={(e) => {
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : list.length - 1;
          list[(i + step) % list.length]?.focus();
        }
      }}
    >
      {OSNAP_MODES.map(({ mode, label }) => {
        const checked = (state.osmode & OSNAP[mode]) !== 0;
        return (
          <button
            key={mode}
            type="button"
            role="menuitemcheckbox"
            aria-checked={checked}
            className="osnap-menu-item"
            onClick={() => drafting.setMode(mode, !checked)}
          >
            <span className="osnap-check" aria-hidden="true">
              {checked ? '✓' : ''}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
