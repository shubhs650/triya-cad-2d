// HATCH's Hatch and Gradient dialog and HATCHEDIT's Hatch Edit dialog (M4-07 part 5), with
// AutoCAD 2024's structure and labels (AutoCAD 2024 Help, "Hatch and Gradient Dialog Box",
// "Hatch Edit Dialog Box"; UI_SPEC.md §7). The engine keeps what they hold
// (`commands/draw/hatch-dialog.ts`); each button that picks in the drawing sends the dialog's
// state and the engine opens it again when the picking is done.
//
//   Hatch | Gradient tabs          Boundaries, Options, Inherit Properties
//   More options (the arrow):      Islands, Boundary retention, Boundary set, Gap tolerance,
//                                  Inherit options
//   Preview, OK, Cancel
//
// The Pattern list's "..." opens the Hatch Pattern Palette: the library's patterns as
// swatches, Predefined (the bundled set, SOLID first) and Custom (the user's .pat files, M1-50).
// Triya's patterns are its own (TRIYA_*), so the palette has no ANSI or ISO tabs. Custom
// patterns are listed in Pattern when the Type is Custom (AutoCAD's separate Custom pattern
// list holds the same names). Annotative (DEC-013, DEC-058) and Associative (DEC-015) are shown
// unchecked and unavailable; so are Relative to paper space, ISO pen width (no ISO patterns)
// and a Region boundary (Triya cannot make regions). Hatch Edit greys what does not apply to
// a hatch made: Retain boundaries, Boundary set and Gap tolerance.
import {
  GRADIENTS,
  HATCH_SOLID,
  HATCH_USER,
  colorLabel,
  colorValue,
  parseColorValue,
  type Color,
  type DialogRequest,
  type HatchDialogButton,
  type HatchDialogState,
  type HatchDrawOrder,
  type HatchSettings,
  type PromptAnswer,
} from '@triya/engine';
import { PatternLibrary } from '@triya/hatch';
import { patternLibrary } from '@triya/render';
import { useMemo, useState, type ReactNode } from 'react';
import { Modal } from './AttributeDialogs';
import { SelectColorDialog } from './SelectColorDialog';
import { engines } from './engine/registry';
import { gradientSwatch, patternSwatch, userSwatch } from './hatch-swatch';
import { colorRgb, cssOf } from './select-color';

type Request = Extract<DialogRequest, { type: 'hatch' }>;
type Plain = HatchSettings['gradient']['color1'];
type Picking = 'color' | 'background' | 'color1' | 'color2';

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const SELECT_COLOR = '\u0000select';
const CURRENT = 'use current';
const DEFAULT_PATTERN = 'TRIYA_LINES45';
const DEG = Math.PI / 180;
const ANGLES = Array.from({ length: 24 }, (_, i) => String(i * 15));
const SCALES = ['0.25', '0.5', '0.75', '1', '1.25', '1.5', '1.75', '2'];
const STANDARD = [1, 2, 3, 4, 5, 6, 7].map((index): Color => ({ kind: 'aci', index }));
const POSITIONS = ['Bottom left', 'Bottom right', 'Top right', 'Top left', 'Center'];
const STYLES: readonly [HatchSettings['style'], string][] = [
  ['normal', 'Normal'],
  ['outer', 'Outer'],
  ['ignore', 'Ignore'],
];

const isGradient = (name: string) => GRADIENTS.some(([n]) => n === name);

/** A plain colour (ACI or true colour) as CSS. */
const css = (c: Plain) => cssOf(colorRgb(c) ?? [0, 0, 0]);

/** GFCLRLUM's shade of `c`: 0 black, 0.5 the colour itself, 1 white. */
function shade(c: Plain, tint: number): string {
  const [r, g, b] = colorRgb(c) ?? [0, 0, 0];
  const to = tint < 0.5 ? 0 : 255;
  const t = tint < 0.5 ? 1 - tint * 2 : (tint - 0.5) * 2;
  const mix = (v: number) => Math.round(v + (to - v) * t);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

const degrees = (radians: number) => String(Number((radians / DEG).toFixed(6)));

export function HatchDialog({
  doc,
  request,
  patternSources,
}: {
  doc: number;
  request: Request;
  /** The user's .pat files (M1-50), ahead of the bundled patterns. */
  patternSources: readonly string[];
}) {
  const { type: _t, edit, layers, boundaries, boundarySet, ...initial } = request;
  const [st, setSt] = useState<HatchDialogState>(initial);
  // The pattern the Hatch tab shows while the Gradient tab is the fill.
  const [pattern, setPattern] = useState(
    isGradient(initial.settings.pattern) ? DEFAULT_PATTERN : initial.settings.pattern,
  );
  const [picking, setPicking] = useState<Picking>();
  const [palette, setPalette] = useState(false);
  const library = useMemo(() => patternLibrary(patternSources), [patternSources]);
  const own = useMemo(() => new PatternLibrary(...patternSources).names(), [patternSources]);
  const s = st.settings;
  const set = (patch: Partial<HatchSettings>) =>
    setSt((x) => ({ ...x, settings: { ...x.settings, ...patch } }));
  const update = (patch: Partial<HatchDialogState>) => setSt((x) => ({ ...x, ...patch }));
  const gradientTab = st.tab === 'gradient';
  const type = pattern === HATCH_USER ? 'user' : s.custom ? 'custom' : 'predefined';
  const predefined = [HATCH_SOLID, ...library.names().filter((n) => !own.includes(n))];
  const names = type === 'custom' ? own : predefined;

  /** The state sent: the tab shown is the fill. */
  const sent = (): HatchDialogState => ({
    ...st,
    settings: { ...s, pattern: gradientTab ? s.gradient.name : pattern },
  });
  const send = (button?: HatchDialogButton) =>
    answer(doc, {
      kind: 'dialog',
      action: button ? 'apply' : 'ok',
      hatch: { state: sent(), ...(button && { button }) },
    });
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  const choosePattern = (name: string, custom: boolean) => {
    setPattern(name);
    set({ custom });
  };
  const chooseType = (t: string) => {
    if (t === 'user') choosePattern(HATCH_USER, false);
    else if (t === 'custom') choosePattern(own[0] ?? DEFAULT_PATTERN, true);
    else choosePattern(DEFAULT_PATTERN, false);
  };
  const solid = pattern === HATCH_SOLID;
  const swatch =
    type === 'user'
      ? userSwatch(s.angle, s.double)
      : solid
        ? undefined
        : library.get(pattern) && patternSwatch(library.get(pattern)!, s.angle);
  const g = s.gradient;
  const second = g.oneColor ? shade(g.color1, g.tint) : css(g.color2);

  const picked = (c: Color) => {
    const plain = c.kind === 'rgb' ? { kind: 'rgb' as const, r: c.r, g: c.g, b: c.b } : c;
    if (picking === 'color') set({ color: c });
    else if (plain.kind === 'aci' || plain.kind === 'rgb') {
      if (picking === 'background') set({ background: plain });
      else set({ gradient: { ...g, [picking === 'color1' ? 'color1' : 'color2']: plain } });
    }
    setPicking(undefined);
  };

  return (
    <Modal
      label={edit ? 'Hatch Edit' : 'Hatch and Gradient'}
      className="hatch-dialog"
      onOk={() => void send()}
      onCancel={cancel}
    >
      <div className={`hatch-body${st.more ? ' hatch-more-open' : ''}`}>
        <div className="hatch-main">
          <div role="tablist" className="cad-dialog-tabs">
            {(['hatch', 'gradient'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={st.tab === t}
                onClick={() => update({ tab: t })}
              >
                {t === 'hatch' ? 'Hatch' : 'Gradient'}
              </button>
            ))}
          </div>
          {!gradientTab ? (
            <div role="tabpanel" className="cad-dialog-panel hatch-panel" aria-label="Hatch">
              <fieldset>
                <legend>Type and pattern</legend>
                <Field label="Type:">
                  <select value={type} onChange={(e) => chooseType(e.target.value)}>
                    <option value="predefined">Predefined</option>
                    <option value="user">User defined</option>
                    <option value="custom" disabled={own.length === 0}>
                      Custom
                    </option>
                  </select>
                </Field>
                <Field label="Pattern:">
                  <select
                    value={pattern}
                    disabled={type === 'user'}
                    onChange={(e) => choosePattern(e.target.value, type === 'custom')}
                  >
                    {!names.includes(pattern) && type !== 'user' && (
                      <option value={pattern}>{pattern}</option>
                    )}
                    {names.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Hatch Pattern Palette"
                    disabled={type === 'user'}
                    onClick={() => setPalette(true)}
                  >
                    ...
                  </button>
                </Field>
                <Field label="Color:">
                  <ColorList
                    label="Hatch color"
                    value={s.color}
                    first={[CURRENT, 'Use Current']}
                    byLayer
                    onChange={(c) => set({ color: c })}
                    onSelect={() => setPicking('color')}
                  />
                  <ColorList
                    label="Background color"
                    value={s.background}
                    first={['none', 'None']}
                    disabled={solid}
                    onChange={(c) => set({ background: c as Plain | undefined })}
                    onSelect={() => setPicking('background')}
                  />
                </Field>
                <div className="hatch-swatch-row">
                  <span>Swatch:</span>
                  <Swatch
                    label={type === 'user' ? 'User defined' : pattern}
                    path={swatch}
                    solid={solid}
                    onClick={type === 'user' ? undefined : () => setPalette(true)}
                  />
                </div>
              </fieldset>
              <fieldset>
                <legend>Angle and scale</legend>
                <div className="cad-dialog-grid">
                  <Field label="Angle:">
                    <NumberField
                      value={degrees(s.angle)}
                      list="hatch-angles"
                      disabled={solid}
                      onChange={(v) => set({ angle: v * DEG })}
                    />
                  </Field>
                  <Field label="Scale:">
                    <NumberField
                      value={String(s.scale)}
                      list="hatch-scales"
                      disabled={solid || type === 'user'}
                      positive
                      onChange={(v) => set({ scale: v })}
                    />
                  </Field>
                  <Check
                    checked={type === 'user' && s.double}
                    disabled={type !== 'user'}
                    onChange={(double) => set({ double })}
                  >
                    Double
                  </Check>
                  <Check checked={false} disabled onChange={() => {}}>
                    Relative to paper space
                  </Check>
                  <Field label="Spacing:">
                    <NumberField
                      value={String(s.spacing)}
                      disabled={type !== 'user'}
                      positive
                      onChange={(v) => set({ spacing: v })}
                    />
                  </Field>
                  <Field label="ISO pen width:">
                    <select disabled>
                      <option />
                    </select>
                  </Field>
                </div>
              </fieldset>
              <fieldset>
                <legend>Hatch origin</legend>
                <Radio
                  name="hatch-origin"
                  checked={!st.specified}
                  onChange={() => update({ specified: false })}
                >
                  Use current origin
                </Radio>
                <Radio
                  name="hatch-origin"
                  checked={st.specified}
                  onChange={() => update({ specified: true })}
                >
                  Specified origin
                </Radio>
                <div className="hatch-indent">
                  <button
                    type="button"
                    disabled={!st.specified}
                    onClick={() => void send('origin')}
                  >
                    Click to set new origin
                  </button>
                  <div className="cad-dialog-check">
                    <Check
                      checked={st.extents > 0}
                      disabled={!st.specified}
                      onChange={(on) => update({ extents: on ? 1 : 0 })}
                    >
                      Default to boundary extents
                    </Check>
                    <select
                      aria-label="Boundary extents position"
                      value={String(Math.max(1, st.extents))}
                      disabled={!st.specified || st.extents === 0}
                      onChange={(e) => update({ extents: Number(e.target.value) })}
                    >
                      {POSITIONS.map((p, i) => (
                        <option key={p} value={String(i + 1)}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Check
                    checked={st.storeOrigin}
                    disabled={!st.specified}
                    onChange={(storeOrigin) => update({ storeOrigin })}
                  >
                    Store as default origin
                  </Check>
                </div>
              </fieldset>
            </div>
          ) : (
            <div role="tabpanel" className="cad-dialog-panel hatch-panel" aria-label="Gradient">
              <fieldset>
                <legend>Color</legend>
                <div className="hatch-gradient-colors">
                  <div>
                    <Radio
                      name="gradient-colors"
                      checked={g.oneColor}
                      onChange={() => set({ gradient: { ...g, oneColor: true } })}
                    >
                      One color
                    </Radio>
                    <ColorButton
                      label="Color 1"
                      color={css(g.color1)}
                      onClick={() => setPicking('color1')}
                    />
                  </div>
                  <div>
                    <Radio
                      name="gradient-colors"
                      checked={!g.oneColor}
                      onChange={() => set({ gradient: { ...g, oneColor: false } })}
                    >
                      Two color
                    </Radio>
                    {g.oneColor ? (
                      <label className="hatch-tint">
                        <span>Shade</span>
                        <input
                          type="range"
                          aria-label="Shade and tint"
                          min={0}
                          max={100}
                          value={Math.round(g.tint * 100)}
                          onChange={(e) =>
                            set({ gradient: { ...g, tint: Number(e.target.value) / 100 } })
                          }
                        />
                        <span>Tint</span>
                      </label>
                    ) : (
                      <ColorButton
                        label="Color 2"
                        color={css(g.color2)}
                        onClick={() => setPicking('color2')}
                      />
                    )}
                  </div>
                </div>
              </fieldset>
              <div role="radiogroup" aria-label="Gradient pattern" className="hatch-gradients">
                {GRADIENTS.map(([name, , description]) => (
                  <button
                    key={name}
                    type="button"
                    role="radio"
                    aria-checked={g.name === name}
                    aria-label={description}
                    title={name}
                    style={{ background: gradientSwatch(name, css(g.color1), second) }}
                    onClick={() => set({ gradient: { ...g, name } })}
                  />
                ))}
              </div>
              <fieldset>
                <legend>Orientation</legend>
                <div className="cad-dialog-grid">
                  <Check
                    checked={g.centered}
                    onChange={(centered) => set({ gradient: { ...g, centered } })}
                  >
                    Centered
                  </Check>
                  <Field label="Angle:">
                    <NumberField
                      value={degrees(g.angle)}
                      list="hatch-angles"
                      onChange={(v) => set({ gradient: { ...g, angle: v * DEG } })}
                    />
                  </Field>
                </div>
              </fieldset>
            </div>
          )}
          <datalist id="hatch-angles">
            {ANGLES.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
          <datalist id="hatch-scales">
            {SCALES.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div className="hatch-side">
          <fieldset>
            <legend>Boundaries</legend>
            <button type="button" onClick={() => void send('pick')}>
              Add: Pick points
            </button>
            <button type="button" onClick={() => void send('select')}>
              Add: Select objects
            </button>
            <button type="button" disabled={boundaries === 0} onClick={() => void send('remove')}>
              Remove boundaries
            </button>
            <button type="button" disabled={!edit} onClick={() => void send('recreate')}>
              Recreate boundary
            </button>
            <button type="button" disabled={boundaries === 0} onClick={() => void send('view')}>
              View Selections
            </button>
          </fieldset>
          <fieldset>
            <legend>Options</legend>
            <Check checked={false} disabled onChange={() => {}}>
              Annotative
            </Check>
            <Check checked={false} disabled onChange={() => {}}>
              Associative
            </Check>
            <Check checked={s.separate} onChange={(separate) => set({ separate })}>
              Create separate hatches
            </Check>
            <Field label="Draw order:">
              <select
                value={s.drawOrder}
                onChange={(e) => set({ drawOrder: e.target.value as HatchDrawOrder })}
              >
                <option value="none">{edit ? 'Do not change' : 'Do not assign'}</option>
                <option value="back">Send to back</option>
                <option value="front">Bring to front</option>
                <option value="behind">Send behind boundary</option>
                <option value="above">Bring in front of boundary</option>
              </select>
            </Field>
            <Field label="Layer:">
              <select
                value={s.layer ?? ''}
                onChange={(e) => set({ layer: e.target.value === '' ? undefined : e.target.value })}
              >
                <option value="">Use Current</option>
                {s.layer !== undefined && !layers.includes(s.layer) && (
                  <option value={s.layer}>{s.layer}</option>
                )}
                {layers.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Transparency
              value={st.transparency}
              onChange={(transparency) => update({ transparency })}
            />
          </fieldset>
          <button type="button" onClick={() => void send('inherit')}>
            Inherit Properties
          </button>
          <button
            type="button"
            className="hatch-more"
            aria-expanded={st.more}
            onClick={() => update({ more: !st.more })}
          >
            {st.more ? 'Fewer options' : 'More options'}
          </button>
        </div>
        {st.more && (
          <div className="hatch-side hatch-advanced" aria-label="More options">
            <fieldset>
              <legend>Islands</legend>
              <Check checked={s.islands} disabled={edit} onChange={(islands) => set({ islands })}>
                Island detection
              </Check>
              {STYLES.map(([value, label]) => (
                <Radio
                  key={value}
                  name="hatch-islands"
                  checked={s.style === value}
                  disabled={!s.islands}
                  onChange={() => set({ style: value })}
                >
                  {label}
                </Radio>
              ))}
            </fieldset>
            <fieldset>
              <legend>Boundary retention</legend>
              <Check
                checked={!edit && s.retain}
                disabled={edit}
                onChange={(retain) => set({ retain })}
              >
                Retain boundaries
              </Check>
              <Field label="Object type:">
                <select disabled={edit || !s.retain} value="polyline">
                  <option value="polyline">Polyline</option>
                  <option value="region" disabled>
                    Region
                  </option>
                </select>
              </Field>
            </fieldset>
            <fieldset>
              <legend>Boundary set</legend>
              <div className="cad-dialog-check">
                <select
                  aria-label="Boundary set"
                  disabled={edit}
                  value={boundarySet ? 'set' : 'view'}
                >
                  <option value="view">Current viewport</option>
                  {boundarySet && <option value="set">Existing set</option>}
                </select>
                <button type="button" disabled={edit} onClick={() => void send('boundarySet')}>
                  New
                </button>
              </div>
            </fieldset>
            <fieldset>
              <legend>Gap tolerance</legend>
              <Field label="Tolerance:">
                <NumberField
                  value={String(s.gap)}
                  disabled={edit}
                  max={5000}
                  onChange={(gap) => set({ gap })}
                />
                <span>units</span>
              </Field>
            </fieldset>
            <fieldset>
              <legend>Inherit options</legend>
              <Radio
                name="hatch-inherit"
                checked={!st.inheritOrigin}
                onChange={() => update({ inheritOrigin: false })}
              >
                Use current origin
              </Radio>
              <Radio
                name="hatch-inherit"
                checked={st.inheritOrigin}
                onChange={() => update({ inheritOrigin: true })}
              >
                Use source hatch origin
              </Radio>
            </fieldset>
          </div>
        )}
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" disabled={boundaries === 0} onClick={() => void send('preview')}>
          Preview
        </button>
        <button type="button" onClick={() => void send()}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
      {picking && (
        <SelectColorDialog
          initial={
            picking === 'color'
              ? s.color
              : picking === 'background'
                ? s.background
                : g[picking === 'color1' ? 'color1' : 'color2']
          }
          books={[]}
          trueColors
          onOk={picked}
          onCancel={() => setPicking(undefined)}
        />
      )}
      {palette && (
        <PatternPalette
          predefined={predefined}
          custom={own}
          current={pattern}
          swatch={(n) => (n === HATCH_SOLID ? undefined : patternSwatch(library.get(n)!, 0))}
          onOk={(name) => {
            choosePattern(name, own.includes(name));
            setPalette(false);
          }}
          onCancel={() => setPalette(false)}
        />
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="cad-dialog-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Check({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  children: string;
}) {
  return (
    <label className="cad-dialog-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

function Radio({
  name,
  checked,
  disabled,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: string;
}) {
  return (
    <label className="cad-dialog-check">
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      {children}
    </label>
  );
}

/**
 * A typed number, set as each keystroke makes one the field takes; a value it refuses shows
 * until the field loses focus, when it goes back.
 */
function NumberField({
  value,
  list,
  disabled,
  positive,
  max,
  onChange,
}: {
  value: string;
  list?: string;
  disabled?: boolean;
  positive?: boolean;
  max?: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState<string>();
  return (
    <input
      type="text"
      inputMode="decimal"
      list={list}
      value={text ?? value}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        const ok =
          e.target.value.trim() !== '' &&
          Number.isFinite(v) &&
          (!positive || v > 0) &&
          (max === undefined || (v >= 0 && v <= max));
        if (ok) onChange(v);
      }}
      onBlur={() => setText(undefined)}
    />
  );
}

/** A colour list: `first` (Use Current, None), ByLayer and ByBlock, the seven, Select Color... */
function ColorList({
  label,
  value,
  first,
  byLayer,
  disabled,
  onChange,
  onSelect,
}: {
  label: string;
  value: Color | undefined;
  first: readonly [string, string];
  byLayer?: boolean;
  disabled?: boolean;
  onChange: (c: Color | undefined) => void;
  onSelect: () => void;
}) {
  const shown: Color[] = [
    ...(byLayer ? [{ kind: 'byLayer' } as const, { kind: 'byBlock' } as const] : []),
    ...STANDARD,
  ];
  const current = value ? colorValue(value) : first[0];
  return (
    <select
      aria-label={label}
      value={current}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        if (v === SELECT_COLOR) onSelect();
        else onChange(v === first[0] ? undefined : parseColorValue(v));
      }}
    >
      <option value={first[0]}>{first[1]}</option>
      {value && !shown.some((c) => colorValue(c) === current) && (
        <option value={current}>{colorLabel(value)}</option>
      )}
      {shown.map((c) => (
        <option key={colorValue(c)} value={colorValue(c)}>
          {colorLabel(c)}
        </option>
      ))}
      <option value={SELECT_COLOR}>Select Color...</option>
    </select>
  );
}

/** A gradient colour: its swatch, and "..." opening Select Color. */
function ColorButton({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <span className="hatch-color-button">
      <span className="hatch-color-chip" style={{ background: color }} aria-hidden="true" />
      <button type="button" aria-label={`${label}: Select Color`} onClick={onClick}>
        ...
      </button>
    </span>
  );
}

/** A pattern's swatch (solid: filled), a button opening the palette when it has one. */
function Swatch({
  label,
  path,
  solid,
  onClick,
}: {
  label: string;
  path: string | undefined;
  solid: boolean;
  onClick?: (() => void) | undefined;
}) {
  const picture = (
    <svg viewBox="0 0 100 100" width="64" height="32" preserveAspectRatio="xMidYMid slice">
      {solid ? (
        <rect width="100" height="100" fill="currentColor" />
      ) : (
        <path
          d={path ?? ''}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
  return onClick ? (
    <button type="button" className="hatch-swatch" aria-label={`Swatch ${label}`} onClick={onClick}>
      {picture}
    </button>
  ) : (
    <span className="hatch-swatch" role="img" aria-label={`Swatch ${label}`}>
      {picture}
    </span>
  );
}

/** Transparency: Use Current, ByLayer, ByBlock or a value 0–90 by a slider. */
function Transparency({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const named = value === CURRENT || value === 'ByLayer' || value === 'ByBlock';
  const percent = named ? 0 : Number(value);
  return (
    <>
      <Field label="Transparency:">
        <select
          value={named ? value : 'value'}
          onChange={(e) => onChange(e.target.value === 'value' ? '0' : e.target.value)}
        >
          <option value={CURRENT}>Use Current</option>
          <option value="ByLayer">ByLayer</option>
          <option value="ByBlock">ByBlock</option>
          <option value="value">Specify Value</option>
        </select>
      </Field>
      <div className="cad-dialog-check">
        <input
          type="range"
          aria-label="Transparency value"
          min={0}
          max={90}
          value={percent}
          disabled={named}
          onChange={(e) => onChange(e.target.value)}
        />
        <span>{named ? '' : `${percent}`}</span>
      </div>
    </>
  );
}

/** The Hatch Pattern Palette: the library's patterns as swatches, by tab. */
function PatternPalette({
  predefined,
  custom,
  current,
  swatch,
  onOk,
  onCancel,
}: {
  predefined: readonly string[];
  custom: readonly string[];
  current: string;
  swatch: (name: string) => string | undefined;
  onOk: (name: string) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState(custom.includes(current) ? 'custom' : 'predefined');
  const [chosen, setChosen] = useState(current);
  const names = tab === 'custom' ? custom : predefined;
  return (
    <Modal
      label="Hatch Pattern Palette"
      className="hatch-palette"
      onOk={() => onOk(chosen)}
      onCancel={onCancel}
    >
      <div role="tablist" className="cad-dialog-tabs">
        {[
          ['predefined', 'Predefined'],
          ['custom', 'Custom'],
        ].map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            disabled={t === 'custom' && custom.length === 0}
            onClick={() => setTab(t!)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="listbox" aria-label="Patterns" className="hatch-palette-grid">
        {names.map((n) => (
          <button
            key={n}
            type="button"
            role="option"
            aria-selected={n === chosen}
            onClick={() => setChosen(n)}
            onDoubleClick={() => onOk(n)}
          >
            <Swatch label={n} path={swatch(n)} solid={n === HATCH_SOLID} />
            <span>{n}</span>
          </button>
        ))}
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => onOk(chosen)}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
