// The ribbon's Layers and Properties dropdowns (M7-02 part 3; AutoCAD 2024 Help, "Layers Panel"
// and "Properties Panel"): the layer, colour, linetype, lineweight and transparency of the
// selection, or with none the current ones, from the drawing's engine (`ribbon-properties`). A
// pick changes them as the Properties palette's General rows do; the lists end with AutoCAD's
// "Select Colors...", "Other..." and "Lineweight Settings...". The layer list also turns a layer
// on or off, thaws or freezes it, and unlocks or locks it, as AutoCAD's layer dropdown does.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { RibbonLayer, RibbonProperties, RibbonStyleKind } from '@triya/engine';
import { lineweightsListed, VARIES } from '../properties';
import { Icon } from './Icon';
import type { IconName } from './icons';
import type { RibbonControl } from './ribbon.config';
import { swatchOf } from './ribbon-properties';

/** One entry of a dropdown's list. */
export interface ControlChoice {
  readonly value: string;
  readonly label: string;
  /** Its colour: a colour's own, a layer's. Undefined for ByLayer and ByBlock. */
  readonly swatch?: string | undefined;
  readonly layer?: RibbonLayer;
  /** The last entries: a dialog or a command instead of a value. */
  readonly opens?: 'select-color' | 'LINETYPE' | 'LWEIGHT' | StyleManager;
}

export interface ControlState {
  /** The value shown: `*VARIES*` when the selection's differ, empty with no drawing. */
  readonly text: string;
  readonly swatch?: string | undefined;
  /** The value picked now; undefined when it varies. */
  readonly selected?: string | undefined;
  readonly choices: readonly ControlChoice[];
}

/** The style dropdowns, the kind of style each lists, and the command that manages them. */
export const STYLE_CONTROLS = {
  'text-style': { kind: 'text', manage: 'STYLE', label: 'Manage Text Styles...' },
  'dim-style': { kind: 'dim', manage: 'DIMSTYLE', label: 'Manage Dimension Styles...' },
  'mleader-style': {
    kind: 'mleader',
    manage: 'MLEADERSTYLE',
    label: 'Manage Multileader Styles...',
  },
  'table-style': { kind: 'table', manage: 'TABLESTYLE', label: 'Manage Table Styles...' },
} as const satisfies Partial<
  Record<RibbonControl, { kind: RibbonStyleKind; manage: string; label: string }>
>;
type StyleManager = (typeof STYLE_CONTROLS)[keyof typeof STYLE_CONTROLS]['manage'];

export const isStyleControl = (c: RibbonControl): c is keyof typeof STYLE_CONTROLS =>
  c in STYLE_CONTROLS;

/** A style dropdown: the drawing's styles by name, the current one picked (AutoCAD's Annotate
 * tab lists them so, ending with "Manage ... Styles..."). */
function styleState(control: keyof typeof STYLE_CONTROLS, p: RibbonProperties): ControlState {
  const { kind, manage, label } = STYLE_CONTROLS[control];
  const styles = p.styles[kind];
  return {
    text: styles.current ?? '',
    selected: styles.current,
    choices: [
      ...styles.names.map((name) => ({ value: name, label: name })),
      { value: '', label, opens: manage },
    ],
  };
}

/** AutoCAD's transparency slider runs 0–90; the list offers its tens. */
const TRANSPARENCIES = Array.from({ length: 10 }, (_, i) => String(i * 10));

/** What a dropdown shows and lists, from the engine's `properties`. */
export function controlState(
  control: RibbonControl,
  p: RibbonProperties | undefined,
  lineweights: 'mm' | 'in',
): ControlState {
  if (p && isStyleControl(control)) return styleState(control, p);
  const sent = p?.rows.find((r) => r.key === control);
  if (!p || !sent) return { text: '', choices: [] };
  const row = control === 'lineweight' ? lineweightsListed(sent, lineweights) : sent;
  const selected = row.varies || row.value === undefined ? undefined : String(row.value);
  let choices: ControlChoice[];
  switch (control) {
    case 'layer':
      choices = p.layers.map((l) => ({
        value: l.handle,
        label: l.name,
        swatch: swatchOf(l.color),
        layer: l,
      }));
      break;
    case 'color':
      choices = [
        ...(row.options ?? []).map((o) => ({ ...o, swatch: swatchOf(o.value) })),
        { value: '', label: 'Select Colors...', opens: 'select-color' },
      ];
      break;
    case 'linetype':
      choices = [...(row.options ?? []), { value: '', label: 'Other...', opens: 'LINETYPE' }];
      break;
    case 'lineweight':
      choices = [
        ...(row.options ?? []),
        { value: '', label: 'Lineweight Settings...', opens: 'LWEIGHT' },
      ];
      break;
    default: {
      // Transparency: the style dropdowns returned above.
      const values = [...TRANSPARENCIES];
      if (selected !== undefined && !/^By/.test(selected) && !values.includes(selected))
        values.push(selected);
      values.sort((a, b) => Number(a) - Number(b));
      choices = [...(row.options ?? []), ...values.map((v) => ({ value: v, label: v }))];
      break;
    }
  }
  const at = choices.find((c) => !c.opens && c.value === selected);
  return {
    text: selected === undefined ? VARIES : (at?.label ?? selected),
    swatch: at?.swatch,
    selected,
    choices,
  };
}

/** A layer's on, frozen and locked toggles, as the layer dropdown lists them. */
const LAYER_TOGGLES: readonly {
  readonly key: 'on' | 'frozen' | 'locked';
  readonly icon: (l: RibbonLayer) => IconName;
  readonly label: (l: RibbonLayer) => string;
}[] = [
  {
    key: 'on',
    icon: (l) => (l.on ? 'eye' : 'eye_off'),
    label: (l) => `${l.on ? 'Turn off' : 'Turn on'} layer ${l.name}`,
  },
  {
    key: 'frozen',
    icon: (l) => (l.frozen ? 'weather_snowflake' : 'weather_sunny'),
    label: (l) => `${l.frozen ? 'Thaw' : 'Freeze'} layer ${l.name}`,
  },
  {
    key: 'locked',
    icon: (l) => (l.locked ? 'lock_closed' : 'lock_open'),
    label: (l) => `${l.locked ? 'Unlock' : 'Lock'} layer ${l.name}`,
  },
];

/** A colour swatch: a filled square, or a hollow one for ByLayer and ByBlock. */
export function Swatch({ color }: { color: string | undefined }) {
  return (
    <span
      className={color ? 'ribbon-swatch' : 'ribbon-swatch none'}
      style={color ? { background: color } : undefined}
      aria-hidden="true"
    />
  );
}

/** A dropdown's list under the dropdown (or the panel button that opened it). */
export function ControlList({
  label,
  anchor,
  state,
  onPick,
  onToggle,
  onClose,
}: {
  label: string;
  anchor: HTMLElement;
  state: ControlState;
  onPick: (choice: ControlChoice) => void;
  /** Flips a layer's on, frozen or locked state. */
  onToggle: (layer: RibbonLayer, key: 'on' | 'frozen' | 'locked') => void;
  onClose: (refocus: boolean) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const at = anchor.getBoundingClientRect();
  const options = (l: HTMLElement) => [...l.querySelectorAll<HTMLElement>('[role="option"]')];
  // The colour and layer lists show swatches; ByLayer's and ByBlock's are hollow.
  const swatches = state.choices.some((c) => c.swatch !== undefined);

  useEffect(() => {
    const l = list.current;
    if (l) {
      const all = options(l);
      (all.find((o) => o.getAttribute('aria-selected') === 'true') ?? all[0])?.focus();
    }
    const away = (e: PointerEvent) => {
      if (!l?.contains(e.target as Node) && !anchor.contains(e.target as Node))
        close.current(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [anchor]);

  const keys = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const all = options(e.currentTarget);
    const i = all.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === 'ArrowDown'
        ? Math.min(i + 1, all.length - 1)
        : e.key === 'ArrowUp'
          ? Math.max(i - 1, 0)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? all.length - 1
              : undefined;
    if (to !== undefined) {
      e.preventDefault();
      all[to]?.focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) {
      e.preventDefault();
      all[i]!.click();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    }
  };

  return (
    <div
      ref={list}
      className="ribbon-menu ribbon-list"
      role="listbox"
      aria-label={label}
      style={{
        left: Math.max(4, Math.min(at.left, window.innerWidth - 260)),
        top: at.bottom + 2,
        minWidth: Math.max(at.width, 160),
      }}
      onKeyDown={keys}
    >
      {state.choices.map((c, i) => (
        <div
          key={`${i}:${c.value}`}
          role="option"
          tabIndex={-1}
          aria-selected={!c.opens && c.value === state.selected}
          className={c.opens ? 'ribbon-option opens' : 'ribbon-option'}
          onClick={() => onPick(c)}
        >
          {swatches && !c.opens && <Swatch color={c.swatch} />}
          <span className="ribbon-menu-label">{c.label}</span>
          {c.layer && (
            <span className="ribbon-layer-states">
              {LAYER_TOGGLES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  tabIndex={-1}
                  className="ribbon-layer-state"
                  aria-label={t.label(c.layer!)}
                  title={t.label(c.layer!)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(c.layer!, t.key);
                  }}
                >
                  <Icon name={t.icon(c.layer!)} size={16} />
                </button>
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
