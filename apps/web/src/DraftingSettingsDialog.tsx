// DSETTINGS' Drafting Settings dialog (M3-06 part 1), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Drafting Settings Dialog Box" and its "Polar Tracking Tab", "Object Snap Tab"
// and "Quick Properties Tab" pages; UI_SPEC.md §7). The Snap and Grid tab came with part 2, its
// Polar spacing and Snap type (Grid snap or PolarSnap) and the Polar Tracking tab's Polar Angle
// measurement with part 3; Isometric snap is PRD non-goal 7 (DEC-060), so Grid snap has no
// Rectangular/Isometric choice. Grid style (GRIDSTYLE, per user; Block editor is kept but
// disabled, as Triya has no block editor) and Grid behavior (GRIDDISPLAY, in the drawing's
// `*Active` VPORT) came with part 6. The Dynamic Input tab came with part 4, its Pointer Input
// Settings on the tab itself rather than in a dialog of their own; part 8 added Pointer Input's
// Visibility and the Dimension Input Settings there too, Show additional tips, and the Drafting
// Tooltip Appearance dialog (`TooltipAppearanceDialog`). The Selection Cycling tab came with
// M3-04 part 7; 3D Object Snap is out of scope (PRD non-goal: no 3D).
// It opens on the tab shown last (OSNAP: Object Snap), edits a copy of the drafting aids and
// sets them on OK; Cancel (or Esc) leaves them as they were. Options... is left out: Triya's
// Settings panel is not a dialog to open over it.
import {
  GRID_DISPLAY,
  OSNAP,
  OSNAP_MODES,
  type DialogRequest,
  type PromptAnswer,
} from '@triya/engine';
import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { markerSvgPath } from './canvas/autosnap';
import {
  GRIDSTYLE_LAYOUT,
  GRIDSTYLE_MODEL,
  QP_QUADRANTS,
  angleText,
  drafting,
  type QpQuadrant,
} from './drafting';
import {
  DRAFTING_SETTINGS_TABS,
  addAngle,
  draftOf,
  draftPatch,
  draftProblem,
  equalSpacing,
  gridBehavior,
  snapGridOf,
  typeSpacing,
  type DraftingSettingsDraft,
  type SpacingDraft,
} from './drafting-settings';
import { engines } from './engine/registry';
import { POLAR_ANGLES } from './preferences';
import { GRIP_MEASURES } from './dynamic-input';
import { TOOLTIP_SIZES, TOOLTIP_TRANSPARENCY, type TooltipAppearance } from './tooltip-appearance';

type Request = Extract<DialogRequest, { type: 'dsettings' }>;
type Tab = (typeof DRAFTING_SETTINGS_TABS)[number]['tab'];

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** The tab shown last, which DSETTINGS opens on (AutoCAD remembers it). */
let lastTab: Tab = 'snap';

const ALL_MODES = OSNAP_MODES.reduce((bits, m) => bits | OSNAP[m.mode], 0);

export function DraftingSettingsDialog({ doc, request }: { doc: number; request: Request }) {
  const [tab, setTab] = useState<Tab>(request.tab ?? lastTab);
  const [d, setD] = useState<DraftingSettingsDraft>(() =>
    draftOf(drafting.get(), request.snapGrid),
  );
  const problem = draftProblem(d);
  const set = (patch: Partial<DraftingSettingsDraft>) => setD((was) => ({ ...was, ...patch }));
  useEffect(() => {
    lastTab = tab;
  }, [tab]);
  const ok = () => {
    if (problem) return;
    drafting.configure(draftPatch(d, drafting.get()));
    const snapGrid = snapGridOf(d);
    void answer(doc, { kind: 'dialog', action: 'ok', ...(snapGrid && { snapGrid }) });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  return (
    <Modal label="Drafting Settings" className="dsettings" onOk={ok} onCancel={cancel}>
      <div role="tablist" className="cad-dialog-tabs">
        {DRAFTING_SETTINGS_TABS.map(({ tab: t, label }) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="cad-dialog-panel" aria-label={tabLabel(tab)}>
        {tab === 'snap' && <SnapGridTab d={d} set={set} />}
        {tab === 'polar' && <PolarTab d={d} set={set} />}
        {tab === 'osnap' && <ObjectSnapTab d={d} set={set} />}
        {tab === 'dyn' && <DynamicInputTab d={d} set={set} />}
        {tab === 'qp' && <QuickPropertiesTab d={d} set={set} />}
        {tab === 'sc' && <SelectionCyclingTab d={d} set={set} />}
      </div>
      {problem && (
        <p role="alert" className="dsettings-error">
          {problem}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={problem !== undefined}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

const tabLabel = (t: Tab) => DRAFTING_SETTINGS_TABS.find((x) => x.tab === t)!.label;

interface TabProps {
  d: DraftingSettingsDraft;
  set: (patch: Partial<DraftingSettingsDraft>) => void;
}

function Check({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <label className="cad-dialog-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {children}
    </label>
  );
}

function Radio({
  name,
  checked,
  onChange,
  disabled,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <label className="cad-dialog-check">
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      {children}
    </label>
  );
}

function Spacing({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  return (
    <label className="cad-dialog-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}

/** GRIDSTYLE's bit 2: the block editor's grid, which Triya keeps but has no editor for. */
const GRIDSTYLE_BLOCK = 2;

/**
 * Snap and Grid: SNAP (F9) and GRID (F7) on and off, the drawing's snap and grid spacing with
 * Equal X and Y spacing and Major line every, Polar spacing and Snap type, Grid style and Grid
 * behavior. As in AutoCAD, PolarSnap disables the snap spacing and Grid snap the polar distance,
 * and Allow subdivision below grid spacing needs Adaptive grid.
 */
function SnapGridTab({ d, set }: TabProps) {
  const id = useId();
  const g = d.spacing;
  const none = g === undefined;
  const polarSnap = d.snapType === 1;
  const setG = (next: SpacingDraft) => set({ spacing: next });
  const field = (f: 'snapX' | 'snapY' | 'gridX' | 'gridY') => (text: string) =>
    g && setG(typeSpacing(g, f, text));
  const style = (bit: number) => (on: boolean) =>
    set({ gridStyle: on ? d.gridStyle | bit : d.gridStyle & ~bit });
  const behaviour = g && gridBehavior(g);
  const noBehaviour = g?.gridDisplay === undefined;
  const turn = (bit: number) => (on: boolean) =>
    g && setG({ ...g, gridDisplay: on ? (g.gridDisplay ?? 0) | bit : (g.gridDisplay ?? 0) & ~bit });
  return (
    <div className="dsettings-tab dsettings-columns">
      <div>
        <Check checked={d.snap} onChange={(snap) => set({ snap })}>
          Snap On (F9)
        </Check>
        <fieldset>
          <legend>Snap spacing</legend>
          <Spacing
            label="Snap X spacing:"
            value={g?.snapX ?? ''}
            disabled={none || polarSnap}
            onChange={field('snapX')}
          />
          <Spacing
            label="Snap Y spacing:"
            value={g?.snapY ?? ''}
            disabled={none || polarSnap}
            onChange={field('snapY')}
          />
          <Check
            checked={g?.equal ?? false}
            disabled={none || polarSnap}
            onChange={(on) => g && setG(equalSpacing(g, on))}
          >
            Equal X and Y spacing
          </Check>
        </fieldset>
        <fieldset>
          <legend>Polar spacing</legend>
          <Spacing
            label="Polar distance:"
            value={d.polarDist}
            disabled={!polarSnap}
            onChange={(polarDist) => set({ polarDist })}
          />
        </fieldset>
        <fieldset>
          <legend>Snap type</legend>
          <Radio name={`${id}-type`} checked={!polarSnap} onChange={() => set({ snapType: 0 })}>
            Grid snap
          </Radio>
          <Radio name={`${id}-type`} checked={polarSnap} onChange={() => set({ snapType: 1 })}>
            PolarSnap
          </Radio>
        </fieldset>
      </div>
      <div>
        <Check checked={d.grid} onChange={(grid) => set({ grid })}>
          Grid On (F7)
        </Check>
        <fieldset>
          <legend>Grid style</legend>
          <p className="dsettings-note">Display dotted grid in:</p>
          <Check checked={(d.gridStyle & GRIDSTYLE_MODEL) !== 0} onChange={style(GRIDSTYLE_MODEL)}>
            2D model space
          </Check>
          <Check
            checked={(d.gridStyle & GRIDSTYLE_BLOCK) !== 0}
            disabled
            onChange={style(GRIDSTYLE_BLOCK)}
          >
            Block editor
          </Check>
          <Check
            checked={(d.gridStyle & GRIDSTYLE_LAYOUT) !== 0}
            onChange={style(GRIDSTYLE_LAYOUT)}
          >
            Sheet/layout
          </Check>
        </fieldset>
        <fieldset>
          <legend>Grid spacing</legend>
          <Spacing
            label="Grid X spacing:"
            value={g?.gridX ?? ''}
            disabled={none}
            onChange={field('gridX')}
          />
          <Spacing
            label="Grid Y spacing:"
            value={g?.gridY ?? ''}
            disabled={none}
            onChange={field('gridY')}
          />
          <Spacing
            label="Major line every:"
            value={g?.major ?? ''}
            disabled={none}
            onChange={(major) => g && setG({ ...g, major })}
          />
        </fieldset>
        <fieldset>
          <legend>Grid behavior</legend>
          <Check
            checked={behaviour?.adaptive ?? false}
            disabled={noBehaviour}
            onChange={turn(GRID_DISPLAY.adaptive)}
          >
            Adaptive grid
          </Check>
          <Check
            checked={behaviour?.subdivide ?? false}
            disabled={noBehaviour || !behaviour?.adaptive}
            onChange={turn(GRID_DISPLAY.subdivide)}
          >
            Allow subdivision below grid spacing
          </Check>
          <Check
            checked={behaviour?.beyondLimits ?? false}
            disabled={noBehaviour}
            onChange={turn(GRID_DISPLAY.beyondLimits)}
          >
            Display grid beyond Limits
          </Check>
          <Check
            checked={behaviour?.follow ?? false}
            disabled={noBehaviour}
            onChange={turn(GRID_DISPLAY.follow)}
          >
            Follow Dynamic UCS
          </Check>
        </fieldset>
        {none && (
          <p className="dsettings-note">This drawing has no current viewport to keep spacing in.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Polar Tracking: on and off (F10), the Increment angle, the Additional angles with New and
 * Delete, and Object Snap Tracking Settings (orthogonally only, or along all polar angles).
 */
function PolarTab({ d, set }: TabProps) {
  const id = useId();
  const [selected, setSelected] = useState<number | undefined>();
  const [typing, setTyping] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const commit = () => {
    if (typing === undefined) return;
    if (typing.trim() === '') {
      setTyping(undefined);
      setError(undefined);
      return;
    }
    const r = addAngle(d.angles, typing);
    if ('problem' in r) {
      setError(r.problem);
      input.current?.focus();
      return;
    }
    set({ angles: r.angles });
    setSelected(r.angles.at(-1));
    setTyping(undefined);
    setError(undefined);
  };
  return (
    <div className="dsettings-tab">
      <Check checked={d.polar} onChange={(polar) => set({ polar })}>
        Polar Tracking On (F10)
      </Check>
      <fieldset>
        <legend>Polar Angle Settings</legend>
        <label className="cad-dialog-field">
          <span>Increment angle:</span>
          <select
            value={String(d.polarAngle)}
            onChange={(e) => set({ polarAngle: Number(e.currentTarget.value) })}
          >
            {POLAR_ANGLES.map((a) => (
              <option key={a} value={String(a)}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <Check checked={d.additional} onChange={(additional) => set({ additional })}>
          Additional angles
        </Check>
        <div className="dsettings-angles">
          <div
            role="listbox"
            aria-label="Additional angles"
            id={`${id}-angles`}
            tabIndex={0}
            className="dsettings-angle-list"
            aria-disabled={!d.additional}
            onKeyDown={(e) => {
              const i = selected === undefined ? -1 : d.angles.indexOf(selected);
              const next =
                e.key === 'ArrowDown'
                  ? d.angles[i + 1]
                  : e.key === 'ArrowUp'
                    ? d.angles[i - 1]
                    : undefined;
              if (next !== undefined) {
                e.preventDefault();
                setSelected(next);
              }
            }}
          >
            {d.angles.map((a) => (
              <div
                key={a}
                role="option"
                aria-selected={selected === a}
                onClick={() => setSelected(a)}
              >
                {angleText(a)}
              </div>
            ))}
            {typing !== undefined && (
              <input
                ref={input}
                autoFocus
                aria-label="New additional angle"
                inputMode="decimal"
                value={typing}
                aria-invalid={error !== undefined}
                onChange={(e) => setTyping(e.currentTarget.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  // Enter takes the angle and Esc drops it: neither closes the dialog.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    commit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setTyping(undefined);
                    setError(undefined);
                  }
                }}
              />
            )}
          </div>
          <div className="dsettings-angle-buttons">
            <button
              type="button"
              disabled={!d.additional || typing !== undefined || d.angles.length >= 10}
              onClick={() => setTyping('')}
            >
              New
            </button>
            <button
              type="button"
              disabled={!d.additional || selected === undefined}
              onClick={() => {
                set({ angles: d.angles.filter((a) => a !== selected) });
                setSelected(undefined);
              }}
            >
              Delete
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="dsettings-error">
            {error}
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend>Object Snap Tracking Settings</legend>
        <Radio
          name={`${id}-track`}
          checked={!d.trackPolar}
          onChange={() => set({ trackPolar: false })}
        >
          Track orthogonally only
        </Radio>
        <Radio
          name={`${id}-track`}
          checked={d.trackPolar}
          onChange={() => set({ trackPolar: true })}
        >
          Track using all polar angle settings
        </Radio>
      </fieldset>
      <fieldset>
        <legend>Polar Angle measurement</legend>
        <Radio
          name={`${id}-measure`}
          checked={!d.relative}
          onChange={() => set({ relative: false })}
        >
          Absolute
        </Radio>
        <Radio name={`${id}-measure`} checked={d.relative} onChange={() => set({ relative: true })}>
          Relative to last segment
        </Radio>
      </fieldset>
    </div>
  );
}

/** A mode's marker, drawn as AutoSnap draws it on the canvas. */
function Marker({ mode }: { mode: (typeof OSNAP_MODES)[number]['mode'] }) {
  return (
    <svg viewBox="-7 -7 14 14" width="14" height="14" aria-hidden="true" className="osnap-marker">
      <path d={markerSvgPath(mode, 5)} fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

/** Object Snap: on and off (F3), Object Snap Tracking (F11), the modes, Select All and Clear All. */
function ObjectSnapTab({ d, set }: TabProps) {
  return (
    <div className="dsettings-tab">
      <div className="dsettings-row">
        <Check checked={d.osnap} onChange={(osnap) => set({ osnap })}>
          Object Snap On (F3)
        </Check>
        <Check checked={d.otrack} onChange={(otrack) => set({ otrack })}>
          Object Snap Tracking On (F11)
        </Check>
      </div>
      <fieldset>
        <legend>Object Snap modes</legend>
        <div className="dsettings-modes">
          {OSNAP_MODES.map(({ mode, label }) => (
            <label key={mode} className="cad-dialog-check">
              <input
                type="checkbox"
                checked={(d.modes & OSNAP[mode]) !== 0}
                onChange={(e) =>
                  set({
                    modes: e.currentTarget.checked ? d.modes | OSNAP[mode] : d.modes & ~OSNAP[mode],
                  })
                }
              />
              <Marker mode={mode} />
              {label}
            </label>
          ))}
        </div>
        <div className="dsettings-mode-buttons">
          <button type="button" onClick={() => set({ modes: ALL_MODES })}>
            Select All
          </button>
          <button type="button" onClick={() => set({ modes: 0 })}>
            Clear All
          </button>
        </div>
      </fieldset>
    </div>
  );
}

/**
 * Quick Properties: whether it shows on selection (Ctrl+Shift+P) and for which objects, where
 * (by the cursor in a quadrant, some pixels away, or static), and whether it collapses.
 */
/**
 * Dynamic Input (AutoCAD 2024 Help, "Dynamic Input Tab (Drafting Settings Dialog Box)" and
 * "Pointer Input Settings Dialog Box"): what the tooltip at the cursor shows while F12 has it on.
 */
function DynamicInputTab({ d, set }: TabProps) {
  const id = useId();
  const off = !d.dynPointer;
  const [appearance, setAppearance] = useState(false);
  const fieldsTogether = d.dynDiVis === 2;
  return (
    <div className="dsettings-tab">
      <Check checked={d.dynPointer} onChange={(dynPointer) => set({ dynPointer })}>
        Enable Pointer Input
      </Check>
      <fieldset className="dsettings-sub" disabled={off}>
        <legend>Pointer Input Settings: for second or next points, default to</legend>
        <Radio
          name={`${id}-format`}
          checked={!d.dynCartesian}
          onChange={() => set({ dynCartesian: false })}
        >
          Polar format
        </Radio>
        <Radio
          name={`${id}-format`}
          checked={d.dynCartesian}
          onChange={() => set({ dynCartesian: true })}
        >
          Cartesian format
        </Radio>
        <Radio
          name={`${id}-coords`}
          checked={!d.dynAbsolute}
          onChange={() => set({ dynAbsolute: false })}
        >
          Relative coordinates
        </Radio>
        <Radio
          name={`${id}-coords`}
          checked={d.dynAbsolute}
          onChange={() => set({ dynAbsolute: true })}
        >
          Absolute coordinates
        </Radio>
      </fieldset>
      <fieldset className="dsettings-sub" disabled={off}>
        <legend>Visibility: show coordinate tooltips</legend>
        <Radio
          name={`${id}-pivis`}
          checked={d.dynPiVis === 0}
          onChange={() => set({ dynPiVis: 0 })}
        >
          As soon as I type coordinate data
        </Radio>
        <Radio
          name={`${id}-pivis`}
          checked={d.dynPiVis === 1}
          onChange={() => set({ dynPiVis: 1 })}
        >
          When a command asks for a point
        </Radio>
        <Radio
          name={`${id}-pivis`}
          checked={d.dynPiVis === 2}
          onChange={() => set({ dynPiVis: 2 })}
        >
          Always - even when not in a command
        </Radio>
      </fieldset>
      <Check checked={d.dynDimension} onChange={(dynDimension) => set({ dynDimension })}>
        Enable Dimension Input where possible
      </Check>
      <fieldset className="dsettings-sub" disabled={!d.dynDimension}>
        <legend>Dimension Input Settings: visibility when grip stretching</legend>
        <Radio
          name={`${id}-divis`}
          checked={d.dynDiVis === 0}
          onChange={() => set({ dynDiVis: 0 })}
        >
          Show only 1 dimension input field at a time
        </Radio>
        <Radio
          name={`${id}-divis`}
          checked={d.dynDiVis === 1}
          onChange={() => set({ dynDiVis: 1 })}
        >
          Show 2 dimension input fields at a time
        </Radio>
        <Radio
          name={`${id}-divis`}
          checked={d.dynDiVis === 2}
          onChange={() => set({ dynDiVis: 2 })}
        >
          Show the following dimension input fields simultaneously:
        </Radio>
        <div className="dsettings-sub">
          {GRIP_MEASURES.map((m) => (
            <Check
              key={m.measure}
              checked={(d.dynDiGrip & m.bit) !== 0}
              disabled={!fieldsTogether}
              onChange={(on) => set({ dynDiGrip: on ? d.dynDiGrip | m.bit : d.dynDiGrip & ~m.bit })}
            >
              {m.label}
            </Check>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Dynamic Prompts</legend>
        <Check checked={d.dynPrompt} onChange={(dynPrompt) => set({ dynPrompt })}>
          Show command prompting and command input near the crosshairs
        </Check>
        <Check checked={d.dynInfoTips} onChange={(dynInfoTips) => set({ dynInfoTips })}>
          Show additional tips with command prompting
        </Check>
      </fieldset>
      <button type="button" onClick={() => setAppearance(true)}>
        Drafting Tooltip Appearance...
      </button>
      {appearance && (
        <TooltipAppearanceDialog
          value={d.tooltip}
          onOk={(tooltip) => {
            set({ tooltip });
            setAppearance(false);
          }}
          onCancel={() => setAppearance(false)}
        />
      )}
    </div>
  );
}

/**
 * Tooltip Appearance (AutoCAD 2024 Help, "Tooltip Appearance Dialog Box"): the drafting
 * tooltips' colour in model space and on layouts (AutoCAD's Colors... opens Drawing Window
 * Colors for it; here the two colours sit in the dialog, empty following the theme), their size
 * and transparency, and whether they apply to every drafting tooltip or Dynamic Input's only.
 */
export function TooltipAppearanceDialog({
  value,
  onOk,
  onCancel,
}: {
  value: TooltipAppearance;
  onOk: (t: TooltipAppearance) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [t, setT] = useState(value);
  const set = (patch: Partial<TooltipAppearance>) => setT((was) => ({ ...was, ...patch }));
  const colour = (key: 'modelColor' | 'layoutColor', label: string) => (
    <div className="cad-dialog-field">
      <label className="cad-dialog-check">
        <input
          type="checkbox"
          checked={t[key] !== undefined}
          onChange={(e) => set({ [key]: e.currentTarget.checked ? '#fffbe0' : undefined })}
        />
        {label}
      </label>
      <input
        type="color"
        aria-label={`${label} colour`}
        value={t[key] ?? '#fffbe0'}
        disabled={t[key] === undefined}
        onChange={(e) => set({ [key]: e.currentTarget.value })}
      />
    </div>
  );
  return (
    <Modal
      label="Tooltip Appearance"
      className="tooltip-appearance"
      onOk={() => onOk(t)}
      onCancel={onCancel}
    >
      <fieldset>
        <legend>Colors</legend>
        {colour('modelColor', 'Model space')}
        {colour('layoutColor', 'Layout')}
      </fieldset>
      <label className="cad-dialog-field">
        <span>Size</span>
        <input
          type="range"
          min={TOOLTIP_SIZES.min}
          max={TOOLTIP_SIZES.max}
          value={t.size}
          onChange={(e) => set({ size: Number(e.currentTarget.value) })}
        />
        <output>{t.size}</output>
      </label>
      <label className="cad-dialog-field">
        <span>Transparency</span>
        <input
          type="range"
          min={TOOLTIP_TRANSPARENCY.min}
          max={TOOLTIP_TRANSPARENCY.max}
          value={t.transparency}
          onChange={(e) => set({ transparency: Number(e.currentTarget.value) })}
        />
        <output>{t.transparency}%</output>
      </label>
      <fieldset>
        <legend>Apply to</legend>
        <Radio name={`${id}-apply`} checked={t.all} onChange={() => set({ all: true })}>
          Override OS settings for all drafting tooltips
        </Radio>
        <Radio name={`${id}-apply`} checked={!t.all} onChange={() => set({ all: false })}>
          Use settings only for Dynamic Input tooltips
        </Radio>
      </fieldset>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => onOk(t)}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function QuickPropertiesTab({ d, set }: TabProps) {
  const id = useId();
  const cursor = d.qpLocation === 0;
  return (
    <div className="dsettings-tab">
      <Check checked={d.qp} onChange={(qp) => set({ qp })}>
        Display the Quick Properties palette on selection (Ctrl+Shift+P)
      </Check>
      <fieldset>
        <legend>Palette Display</legend>
        <Radio name={`${id}-display`} checked={d.qpMode === 1} onChange={() => set({ qpMode: 1 })}>
          All objects
        </Radio>
        <Radio name={`${id}-display`} checked={d.qpMode === 2} onChange={() => set({ qpMode: 2 })}>
          Only objects with specified properties
        </Radio>
      </fieldset>
      <fieldset>
        <legend>Palette Location</legend>
        <Radio name={`${id}-location`} checked={cursor} onChange={() => set({ qpLocation: 0 })}>
          Cursor-dependent
        </Radio>
        <div className="dsettings-sub">
          <label className="cad-dialog-field">
            <span>Quadrant</span>
            <select
              value={d.quadrant}
              disabled={!cursor}
              onChange={(e) => set({ quadrant: e.currentTarget.value as QpQuadrant })}
            >
              {QP_QUADRANTS.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
          <label className="cad-dialog-field">
            <span>Distance in pixels</span>
            <input
              type="text"
              inputMode="numeric"
              value={d.distance}
              disabled={!cursor}
              onChange={(e) => set({ distance: e.currentTarget.value })}
            />
          </label>
        </div>
        <Radio name={`${id}-location`} checked={!cursor} onChange={() => set({ qpLocation: 1 })}>
          Static
        </Radio>
      </fieldset>
      <fieldset>
        <legend>Palette Behavior</legend>
        <Check checked={d.collapse} onChange={(collapse) => set({ collapse })}>
          Collapse palette automatically
        </Check>
        <label className="cad-dialog-field dsettings-sub">
          <span>Minimum number of rows</span>
          <input
            type="text"
            inputMode="numeric"
            value={d.rows}
            disabled={!d.collapse}
            onChange={(e) => set({ rows: e.currentTarget.value })}
          />
        </label>
      </fieldset>
    </div>
  );
}

/**
 * Selection Cycling (AutoCAD 2024 Help, "Selection Cycling Tab (Drafting Settings Dialog Box)"):
 * Allow selection cycling (SELECTIONCYCLING, Ctrl+W), Display selection cycling list box, and
 * where the list shows: Cursor dependent, in a Quadrant of the pick and Distance in pixels away,
 * or Static, where it was dragged; Show title bar.
 */
function SelectionCyclingTab({ d, set }: TabProps) {
  const id = useId();
  const list = d.sc && d.scList;
  const cursor = d.scLocation === 0;
  return (
    <div className="dsettings-tab">
      <Check checked={d.sc} onChange={(sc) => set({ sc })}>
        Allow selection cycling (Ctrl+W)
      </Check>
      <fieldset disabled={!d.sc}>
        <legend>Selection cycling list box</legend>
        <Check checked={d.scList} onChange={(scList) => set({ scList })}>
          Display selection cycling list box
        </Check>
        <fieldset disabled={!list}>
          <legend>Display location</legend>
          <Radio name={`${id}-location`} checked={cursor} onChange={() => set({ scLocation: 0 })}>
            Cursor dependent
          </Radio>
          <div className="dsettings-sub">
            <label className="cad-dialog-field">
              <span>Quadrant</span>
              <select
                value={d.scQuadrant}
                disabled={!cursor}
                onChange={(e) => set({ scQuadrant: e.currentTarget.value as QpQuadrant })}
              >
                {QP_QUADRANTS.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cad-dialog-field">
              <span>Distance in pixels</span>
              <input
                type="text"
                inputMode="numeric"
                value={d.scDistance}
                disabled={!cursor}
                onChange={(e) => set({ scDistance: e.currentTarget.value })}
              />
            </label>
          </div>
          <Radio name={`${id}-location`} checked={!cursor} onChange={() => set({ scLocation: 1 })}>
            Static
          </Radio>
        </fieldset>
        <Check
          checked={d.scTitleBar}
          disabled={!list}
          onChange={(scTitleBar) => set({ scTitleBar })}
        >
          Show title bar
        </Check>
      </fieldset>
    </div>
  );
}
