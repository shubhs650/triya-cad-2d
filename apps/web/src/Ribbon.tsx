// The ribbon (M7-01, UI_SPEC.md §2–§3, DEC-017): tabs over panels of items from
// ribbon/ribbon.config.ts, laid out by ribbon/layout.ts for the viewport's breakpoint. When the
// unprotected panels do not fit, one more of them gives up its room per render (measured before
// paint) until they fit or none is left, after which they scroll sideways; Home's Draw, Modify
// and Annotation panels never compress and never scroll. Double-clicking a tab minimizes the
// ribbon to its tabs, as in AutoCAD; a tab clicked then pops its panels over the drawing.
//
// An item runs as the command typed at the command line would (`invoke`, cancelling a running
// command unless it is transparent), then types its keywords; a toggle flips the drafting
// setting. Items that run commands are greyed out with no drawing open.
//
// M7-02: items show their Fluent or CAD icons (ribbon/icons.ts), and a rich tooltip (AutoCAD's:
// name, what it does, command, aliases, keys) after the pointer rests on one for TOOLTIP_DELAY, or
// at once when the keyboard focuses it.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { drafting, type DraftingToggle } from './drafting';
import { paletteStack, type PaletteName } from './palette-stack';
import type { PreferencesStore, Theme } from './preferences';
import { engines } from './engine/registry';
import { Icon } from './ribbon/Icon';
import { tooltipOf, type Tooltip } from './ribbon/tooltips';
import { keymap } from './shortcuts';
import { appRegistry } from './user-aliases';
import { ROWS, breakpointOf, layoutTab, type PanelLayout } from './ribbon/layout';
import {
  RIBBON_TABS,
  type ItemSize,
  type RibbonItem,
  type RibbonRun,
} from './ribbon/ribbon.config';

const viewport = {
  subscribe(changed: () => void) {
    window.addEventListener('resize', changed);
    return () => window.removeEventListener('resize', changed);
  },
  width: () => window.innerWidth,
};

/** How long the pointer rests on an item before its tooltip shows (AutoCAD's is about 1 s). */
export const TOOLTIP_DELAY = 500;

const tooltipSources = {
  aliasesOf: (command: string) => appRegistry.aliasesOf(command),
  keysOf: (action: string) => keymap().keysOf(action),
};

/** The icon's size in pixels for an item size: big over a large button's label. */
const iconSize = (size: ItemSize) => (size === 'large-label' ? 32 : 20);

const noSubscription = () => () => {};

const toggleOf = (run: RibbonRun): DraftingToggle | undefined =>
  'action' in run && run.action.startsWith('drafting:')
    ? (run.action.slice('drafting:'.length) as DraftingToggle)
    : undefined;

/** The app's own windows a ribbon item opens (`app:<name>`): the aliases and the keys. */
export type AppWindow = 'aliases' | 'shortcuts';

export interface RibbonProps {
  readonly doc: number | undefined;
  /** The colour theme's store, for View > Interface > Theme. */
  readonly preferences?: PreferencesStore | undefined;
  readonly onOpenWindow?: ((window: AppWindow) => void) | undefined;
}

const actionArg = (run: RibbonRun, prefix: string): string | undefined =>
  'action' in run && run.action.startsWith(prefix) ? run.action.slice(prefix.length) : undefined;

function runItem(
  run: RibbonRun,
  doc: number | undefined,
  { preferences, onOpenWindow }: Omit<RibbonProps, 'doc'>,
): void {
  const palette = actionArg(run, 'palette:');
  if (palette !== undefined) return paletteStack.set(palette as PaletteName);
  const theme = actionArg(run, 'theme:');
  if (theme !== undefined) return preferences?.update({ theme: theme as Theme });
  const win = actionArg(run, 'app:');
  if (win !== undefined) return onOpenWindow?.(win as AppWindow);
  const t = toggleOf(run);
  if (t !== undefined) {
    const on = 'on' in run ? run.on : undefined;
    if (on === undefined || drafting.isOn(t) !== on) drafting.toggle(t);
    return;
  }
  if (!('command' in run) || doc === undefined) return;
  engines.command(doc, { kind: 'invoke', name: run.command });
  // The keywords answer the command's first prompts in order, as a ribbon macro types them.
  for (const text of run.keys ?? []) engines.command(doc, { kind: 'submit', text });
}

/** A mouse click leaves the focus on the page, so Enter and Space go to the command line. */
function blurIfClicked(e: ReactMouseEvent<HTMLElement>) {
  if (e.detail > 0) e.currentTarget.blur();
}

interface TipState {
  readonly tip: Tooltip;
  readonly anchor: HTMLElement;
}

interface MenuState {
  readonly id: string;
  readonly label: string;
  readonly items: readonly RibbonItem[];
  readonly anchor: HTMLElement;
  /** A split button's list: picking an entry makes it the button's. */
  readonly split?: RibbonItem;
}

export function Ribbon({ doc, preferences, onOpenWindow }: RibbonProps) {
  const width = useSyncExternalStore(viewport.subscribe, viewport.width);
  const draftingState = useSyncExternalStore(drafting.subscribe, drafting.get);
  const theme = useSyncExternalStore(
    preferences?.subscribe ?? noSubscription,
    () => preferences?.get().theme,
  );
  const [tabId, setTabId] = useState(RIBBON_TABS[0]!.id);
  const [minimized, setMinimized] = useState(false);
  const [popped, setPopped] = useState(false);
  const [menu, setMenu] = useState<MenuState | undefined>();
  const [tip, setTip] = useState<TipState | undefined>();
  const tipTimer = useRef<number | undefined>(undefined);
  /** The entry each split button runs, by its id: the one picked last. */
  const [picked, setPicked] = useState<ReadonlyMap<string, RibbonItem>>(new Map());
  const tab = RIBBON_TABS.find((t) => t.id === tabId)!;
  const bp = breakpointOf(width);
  // Compression steps hold for one tab at one width; a new width starts from none again.
  const fitKey = `${tabId}:${width}`;
  const [fit, setFit] = useState({ key: '', steps: 0 });
  const steps = fit.key === fitKey ? fit.steps : 0;
  const layout = layoutTab(tab, bp, steps);
  const rest = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const bodyShown = !minimized || popped;

  useLayoutEffect(() => {
    const r = rest.current;
    if (!bodyShown || !r || layout.exhausted) return;
    if (r.scrollWidth > r.clientWidth + 1) setFit({ key: fitKey, steps: steps + 1 });
  });

  // A popped ribbon closes on a click elsewhere, as AutoCAD's does.
  useEffect(() => {
    if (!popped) return;
    const away = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !(e.target as Element).closest?.('.ribbon-menu')
      )
        setPopped(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [popped]);

  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  const hideTip = () => {
    window.clearTimeout(tipTimer.current);
    setTip(undefined);
  };
  /** Shows `item`'s tooltip under `anchor`, after the rest delay unless `now`. */
  const showTip = (item: RibbonItem, anchor: HTMLElement, now: boolean) => {
    window.clearTimeout(tipTimer.current);
    const show = () => setTip({ tip: tooltipOf(item, current(item), tooltipSources), anchor });
    if (now) show();
    else tipTimer.current = window.setTimeout(show, TOOLTIP_DELAY);
  };

  const run = (item: RibbonItem) => {
    hideTip();
    if (item.unavailable) return;
    runItem(item.run, doc, { preferences, onOpenWindow });
    setMenu(undefined);
    setPopped(false);
  };
  const disabled = (item: RibbonItem) =>
    item.unavailable !== undefined || (doc === undefined && 'command' in item.run);
  const current = (item: RibbonItem) => (item.menu ? (picked.get(item.id) ?? item.menu[0]!) : item);
  const pressed = (item: RibbonItem) => {
    const t = toggleOf(item.run);
    return t === undefined || 'on' in item.run ? undefined : drafting.isOn(t);
  };
  // `draftingState` re-renders the toggles' pressed state when a setting changes elsewhere.
  void draftingState;

  const openMenu = (m: MenuState) => {
    hideTip();
    setMenu((was) => (was?.id === m.id ? undefined : m));
  };

  const button = (item: RibbonItem, size: ItemSize) => {
    const now = current(item);
    const main = (
      <button
        key="main"
        type="button"
        className={`ribbon-item ${size}`}
        data-item={item.id}
        aria-label={item.label}
        aria-describedby={tip?.anchor.dataset['item'] === item.id ? 'ribbon-tooltip' : undefined}
        // An unavailable item stays hoverable (a disabled button hears no pointer) for the
        // tooltip that says why it cannot run.
        disabled={disabled(now) && !now.unavailable}
        aria-disabled={now.unavailable ? true : undefined}
        aria-pressed={pressed(now)}
        onClick={(e) => {
          blurIfClicked(e);
          run(now);
        }}
        onPointerEnter={(e) => showTip(item, e.currentTarget, false)}
        onPointerLeave={hideTip}
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) showTip(item, e.currentTarget, true);
        }}
        onBlur={hideTip}
      >
        <Icon name={now.icon} size={iconSize(size)} />
        {size !== 'icon' && <span className="ribbon-label">{item.label}</span>}
      </button>
    );
    if (!item.menu) return main;
    const id = `split:${item.id}`;
    return (
      <span key={item.id} className={`ribbon-split ${size}`}>
        {main}
        <button
          type="button"
          className="ribbon-split-arrow"
          aria-label={`${item.label} options`}
          aria-haspopup="menu"
          aria-expanded={menu?.id === id}
          onClick={(e) =>
            openMenu({
              id,
              label: item.label,
              items: item.menu!,
              anchor: e.currentTarget,
              split: item,
            })
          }
        >
          ▾
        </button>
      </span>
    );
  };

  const panel = (p: PanelLayout) => {
    const id = `panel:${p.panel.id}`;
    const more = (label: string, icon?: RibbonItem['icon']) => (
      <button
        type="button"
        className={p.state === 'collapsed' ? 'ribbon-panel-button' : 'ribbon-overflow'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={menu?.id === id}
        onClick={(e) =>
          openMenu({ id, label: p.panel.label, items: p.overflow, anchor: e.currentTarget })
        }
      >
        {icon && <Icon name={icon} />}
        <span aria-hidden="true">▾</span>
      </button>
    );
    return (
      <section
        key={p.panel.id}
        className="ribbon-panel"
        role="group"
        aria-label={p.panel.label}
        data-panel={p.panel.id}
        data-state={p.state}
      >
        <div className="ribbon-panel-items">
          {p.state === 'collapsed'
            ? more(p.panel.label, p.panel.items[0]!.icon)
            : p.shown.map((s) => (
                <span key={s.item.id} className={`ribbon-cell ${s.size}`}>
                  {button(s.item, s.size)}
                </span>
              ))}
          {p.state === 'compressed' && more(`More ${p.panel.label} tools`)}
        </div>
        <div className="ribbon-panel-title" aria-hidden="true">
          {p.panel.label}
        </div>
      </section>
    );
  };

  const tabKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const to =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : undefined;
    const n = e.key === 'End' ? RIBBON_TABS.length - 1 : to;
    if (n === undefined) return;
    e.preventDefault();
    const next = RIBBON_TABS[(n + RIBBON_TABS.length) % RIBBON_TABS.length]!;
    setTabId(next.id);
    e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  const protectedPanels = layout.panels.filter((p) => p.protected);
  const otherPanels = layout.panels.filter((p) => !p.protected);
  return (
    <div
      ref={root}
      className={minimized ? 'ribbon minimized' : 'ribbon'}
      data-breakpoint={bp}
      data-steps={steps}
      data-testid="ribbon"
    >
      <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
        {RIBBON_TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            className="ribbon-tab"
            aria-selected={t.id === tabId}
            aria-controls="ribbon-body"
            tabIndex={t.id === tabId ? 0 : -1}
            title={
              minimized
                ? 'Double-click to show the full ribbon'
                : 'Double-click to minimize the ribbon'
            }
            onClick={() => {
              setTabId(t.id);
              if (minimized) setPopped((p) => !(p && t.id === tabId));
            }}
            onDoubleClick={() => {
              setMinimized((m) => !m);
              setPopped(false);
            }}
            onKeyDown={(e) => tabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {bodyShown && (
        <div
          id="ribbon-body"
          className={popped ? 'ribbon-body popped' : 'ribbon-body'}
          role="tabpanel"
          aria-label={tab.label}
          style={{ '--ribbon-rows': ROWS[bp] } as CSSProperties}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && tip) hideTip();
            else if (e.key === 'Escape' && popped) setPopped(false);
          }}
        >
          {protectedPanels.length > 0 && (
            <div className="ribbon-protected">{protectedPanels.map(panel)}</div>
          )}
          <div className="ribbon-rest" ref={rest}>
            {otherPanels.map(panel)}
          </div>
        </div>
      )}
      {tip && !menu && <RibbonTooltip {...tip} />}
      {menu && (
        <RibbonMenu
          menu={menu}
          disabled={disabled}
          checked={(item) => {
            const th = actionArg(item.run, 'theme:');
            if (th !== undefined) return th === (theme ?? 'system');
            const t = toggleOf(item.run);
            return t !== undefined && 'on' in item.run
              ? drafting.isOn(t) === item.run.on
              : undefined;
          }}
          onPick={(item) => {
            if (menu.split) setPicked((m) => new Map(m).set(menu.split!.id, item));
            run(item);
            menu.anchor.focus();
          }}
          onClose={(refocus) => {
            setMenu(undefined);
            if (refocus) menu.anchor.focus();
          }}
        />
      )}
    </div>
  );
}

/** A split button's list or a panel's overflow list, under the button that opened it. */
function RibbonMenu({
  menu,
  disabled,
  checked,
  onPick,
  onClose,
}: {
  menu: MenuState;
  disabled: (item: RibbonItem) => boolean;
  checked: (item: RibbonItem) => boolean | undefined;
  onPick: (item: RibbonItem) => void;
  onClose: (refocus: boolean) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const at = menu.anchor.getBoundingClientRect();
  const entries = (l: HTMLElement) => [...l.querySelectorAll<HTMLElement>('[role^="menuitem"]')];

  useEffect(() => {
    const l = list.current;
    if (l)
      entries(l)
        .find((e) => !e.hasAttribute('disabled'))
        ?.focus();
    const away = (e: PointerEvent) => {
      if (!l?.contains(e.target as Node) && !menu.anchor.contains(e.target as Node))
        close.current(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [menu]);

  const keys = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const all = entries(e.currentTarget).filter((x) => !x.hasAttribute('disabled'));
    const i = all.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === 'ArrowDown'
        ? (i + 1) % all.length
        : e.key === 'ArrowUp'
          ? (i - 1 + all.length) % all.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? all.length - 1
              : undefined;
    if (to !== undefined) {
      e.preventDefault();
      all[to]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    }
  };

  const entry = (item: RibbonItem, heading?: string) => {
    const isChecked = checked(item);
    return (
      <button
        key={item.id}
        type="button"
        role={isChecked === undefined ? 'menuitem' : 'menuitemradio'}
        aria-checked={isChecked}
        data-item={item.id}
        disabled={disabled(item)}
        aria-label={heading ? `${heading}: ${item.label}` : undefined}
        onClick={() => onPick(item)}
      >
        <Icon name={item.icon} />
        <span className="ribbon-menu-label">{item.label}</span>
      </button>
    );
  };

  return (
    <div
      ref={list}
      className="ribbon-menu"
      role="menu"
      aria-label={menu.label}
      style={{ left: Math.min(at.left, window.innerWidth - 240), top: at.bottom + 2 }}
      onKeyDown={keys}
    >
      {menu.items.map((item) =>
        // A split button in an overflow list shows its entries under its name.
        menu.split || !item.menu ? (
          entry(item)
        ) : (
          <div key={item.id} role="group" aria-label={item.label}>
            <div className="ribbon-menu-heading" aria-hidden="true">
              {item.label}
            </div>
            {item.menu.map((e) => entry(e, item.label))}
          </div>
        ),
      )}
    </div>
  );
}

/** An item's rich tooltip under it, as AutoCAD's: name, what it does, command, aliases, keys. */
function RibbonTooltip({ tip, anchor }: TipState) {
  const at = anchor.getBoundingClientRect();
  const rows: [string, string][] = [];
  if (tip.command) rows.push(['Command', [tip.command, ...(tip.keywords ?? [])].join(' ')]);
  if (tip.aliases.length)
    rows.push([tip.aliases.length > 1 ? 'Aliases' : 'Alias', tip.aliases.join(', ')]);
  if (tip.keys.length) rows.push([tip.keys.length > 1 ? 'Keys' : 'Key', tip.keys.join(', ')]);
  return (
    <div
      id="ribbon-tooltip"
      className="ribbon-tooltip"
      role="tooltip"
      style={{ left: Math.max(4, Math.min(at.left, window.innerWidth - 284)), top: at.bottom + 6 }}
    >
      <div className="ribbon-tooltip-title">{tip.title}</div>
      {tip.description && <p className="ribbon-tooltip-text">{tip.description}</p>}
      {tip.unavailable && <p className="ribbon-tooltip-unavailable">{tip.unavailable}</p>}
      {rows.length > 0 && (
        <dl className="ribbon-tooltip-meta">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>
                <kbd>{v}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
