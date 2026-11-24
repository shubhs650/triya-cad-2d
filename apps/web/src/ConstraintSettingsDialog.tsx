// CONSTRAINTSETTINGS' Constraint Settings dialog (M9-05 part 3), with AutoCAD 2024's structure and
// labels (AutoCAD Help, "Constraint Settings Dialog Box", "Geometric Tab", "Dimensional Tab",
// "AutoConstrain Tab"; UI_SPEC.md §7). It opens on the tab shown last (AUTOCONSTRAIN's Settings:
// AutoConstrain), edits a copy of the user's settings and sets them on OK; Cancel (or Esc) leaves
// them as they were.
//
// Left out or greyed: Infer geometric constraints is greyed until CONSTRAINTINFER is built (a
// later part of M9-05); Only display constraint bars for objects in the current plane is left
// out, as Triya draws in one plane (PRD non-goal: no 3D); Show lock icon for annotational
// constraints (DIMCONSTRAINTICON) is left out until annotational constraints draw a lock.
import {
  CONSTRAINT_BAR_ALL,
  CONSTRAINT_BAR_BITS,
  GEOMETRIC_CONSTRAINT_KINDS,
  type AutoConstrainKind,
  type DialogRequest,
} from '@triya/engine';
import { useEffect, useState } from 'react';
import { Modal } from './AttributeDialogs';
import {
  CONSTRAINT_SETTINGS_TABS,
  CONSTRAINT_TYPE_LABELS,
  NAME_FORMATS,
  draftOf,
  draftPatch,
  draftProblem,
  moveRow,
  resetAutoConstrain,
  withApply,
  withBar,
  type ConstraintSettingsDraft,
} from './constraint-settings';
import { drafting } from './drafting';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'csettings' }>;
type Tab = (typeof CONSTRAINT_SETTINGS_TABS)[number]['tab'];

/** The tab shown last, which CONSTRAINTSETTINGS opens on (AutoCAD remembers it). */
let lastTab: Tab = 'geometric';

export function ConstraintSettingsDialog({ doc, request }: { doc: number; request: Request }) {
  const [tab, setTab] = useState<Tab>(request.tab ?? lastTab);
  const [d, setD] = useState<ConstraintSettingsDraft>(() => draftOf(drafting.get()));
  const problem = draftProblem(d);
  const set = (patch: Partial<ConstraintSettingsDraft>) => setD((was) => ({ ...was, ...patch }));
  useEffect(() => {
    lastTab = tab;
  }, [tab]);
  const ok = () => {
    if (problem) return;
    drafting.configure(draftPatch(d));
    void engines.command(doc, { kind: 'answer', answer: { kind: 'dialog', action: 'ok' } });
  };
  // Cancel closes the dialog only: AUTOCONSTRAIN's Settings asks for objects again, as AutoCAD's.
  const cancel = () =>
    void engines.command(doc, { kind: 'answer', answer: { kind: 'dialog', action: 'cancel' } });
  const label = CONSTRAINT_SETTINGS_TABS.find((t) => t.tab === tab)!.label;
  return (
    <Modal label="Constraint Settings" className="csettings" onOk={ok} onCancel={cancel}>
      <div role="tablist" className="cad-dialog-tabs">
        {CONSTRAINT_SETTINGS_TABS.map(({ tab: t, label }) => (
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
      <div role="tabpanel" className="cad-dialog-panel" aria-label={label}>
        {tab === 'geometric' && <GeometricTab d={d} set={set} />}
        {tab === 'dimensional' && <DimensionalTab d={d} set={set} />}
        {tab === 'autoconstrain' && <AutoConstrainTab d={d} set={set} setD={setD} />}
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

interface TabProps {
  d: ConstraintSettingsDraft;
  set: (patch: Partial<ConstraintSettingsDraft>) => void;
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

function GeometricTab({ d, set }: TabProps) {
  return (
    <div className="dsettings-tab">
      <Check checked={false} disabled onChange={() => undefined}>
        Infer geometric constraints
      </Check>
      <fieldset className="csettings-bars">
        <legend>Constraint bar display settings</legend>
        <div className="csettings-kinds">
          {GEOMETRIC_CONSTRAINT_KINDS.map((k) => (
            <Check
              key={k}
              checked={(d.barMode & CONSTRAINT_BAR_BITS[k]) !== 0}
              onChange={(on) => set({ barMode: withBar(d.barMode, k, on) })}
            >
              {CONSTRAINT_TYPE_LABELS[k]}
            </Check>
          ))}
        </div>
        <div className="dsettings-mode-buttons">
          <button type="button" onClick={() => set({ barMode: CONSTRAINT_BAR_ALL })}>
            Select All
          </button>
          <button type="button" onClick={() => set({ barMode: 0 })}>
            Clear All
          </button>
        </div>
      </fieldset>
      <label className="csettings-transparency">
        Constraint bar transparency
        <input
          type="range"
          min={10}
          max={90}
          value={d.transparency}
          onChange={(e) => set({ transparency: Number(e.currentTarget.value) })}
        />
        <output>{d.transparency}</output>
      </label>
      <Check checked={d.showApplied} onChange={(showApplied) => set({ showApplied })}>
        Show constraint bars after applying constraints to selected objects
      </Check>
      <Check checked={d.showSelected} onChange={(showSelected) => set({ showSelected })}>
        Temporarily display constraint bars when objects are selected
      </Check>
    </div>
  );
}

function DimensionalTab({ d, set }: TabProps) {
  return (
    <div className="dsettings-tab">
      <fieldset>
        <legend>Dimensional constraint format</legend>
        <label className="csettings-row">
          Dimension name format:
          <select
            value={d.nameFormat}
            onChange={(e) => set({ nameFormat: Number(e.currentTarget.value) as 0 | 1 | 2 })}
          >
            {NAME_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <Check checked={d.showHidden} onChange={(showHidden) => set({ showHidden })}>
        Show hidden dynamic constraints for selected objects
      </Check>
    </div>
  );
}

function AutoConstrainTab({
  d,
  set,
  setD,
}: TabProps & { setD: (f: (d: ConstraintSettingsDraft) => ConstraintSettingsDraft) => void }) {
  const [row, setRow] = useState(0);
  const move = (by: -1 | 1) => {
    const to = row + by;
    if (to < 0 || to >= d.order.length) return;
    set({ order: moveRow(d.order, row, by) });
    setRow(to);
  };
  const apply = (kind: AutoConstrainKind, on: boolean) =>
    set({ order: withApply(d.order, kind, on) });
  return (
    <div className="dsettings-tab">
      <div className="csettings-auto">
        <table className="csettings-order" aria-label="Constraint types">
          <thead>
            <tr>
              <th scope="col">Priority</th>
              <th scope="col">Constraint Type</th>
              <th scope="col">Apply</th>
            </tr>
          </thead>
          <tbody>
            {d.order.map((o, i) => (
              <tr
                key={o.kind}
                aria-selected={i === row}
                data-kind={o.kind}
                tabIndex={i === row ? 0 : -1}
                onClick={() => setRow(i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' && i > 0) setRow(i - 1);
                  else if (e.key === 'ArrowDown' && i < d.order.length - 1) setRow(i + 1);
                  else return;
                  e.preventDefault();
                }}
              >
                <td>{i + 1}</td>
                <td>{CONSTRAINT_TYPE_LABELS[o.kind]}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Apply ${CONSTRAINT_TYPE_LABELS[o.kind]}`}
                    checked={o.apply}
                    onChange={(e) => apply(o.kind, e.currentTarget.checked)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="csettings-order-buttons">
          <button type="button" onClick={() => move(-1)} disabled={row === 0}>
            Move Up
          </button>
          <button type="button" onClick={() => move(1)} disabled={row === d.order.length - 1}>
            Move Down
          </button>
          <button
            type="button"
            onClick={() => set({ order: d.order.map((o) => ({ ...o, apply: true })) })}
          >
            Select All
          </button>
          <button
            type="button"
            onClick={() => set({ order: d.order.map((o) => ({ ...o, apply: false })) })}
          >
            Clear All
          </button>
          <button
            type="button"
            onClick={() => {
              setD(resetAutoConstrain);
              setRow(0);
            }}
          >
            Reset
          </button>
        </div>
      </div>
      <Check checked={d.tangentTouch} onChange={(tangentTouch) => set({ tangentTouch })}>
        Tangent objects must share an intersection point
      </Check>
      <Check
        checked={d.perpendicularTouch}
        onChange={(perpendicularTouch) => set({ perpendicularTouch })}
      >
        Perpendicular objects must share an intersection point
      </Check>
      <fieldset>
        <legend>Tolerances</legend>
        <label className="csettings-row">
          Distance:
          <input
            type="text"
            value={d.distance}
            onChange={(e) => set({ distance: e.currentTarget.value })}
          />
        </label>
        <label className="csettings-row">
          Angle:
          <input
            type="text"
            value={d.angle}
            onChange={(e) => set({ angle: e.currentTarget.value })}
          />
        </label>
      </fieldset>
    </div>
  );
}
