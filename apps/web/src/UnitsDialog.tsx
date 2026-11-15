// UNITS' Drawing Units dialog (M3-09), with AutoCAD 2024's structure and labels (AutoCAD Help,
// "Drawing Units Dialog Box", "Direction Control Dialog Box"; UI_SPEC.md §7): Length (Type,
// Precision), Angle (Type, Precision, Clockwise), Insertion scale ("Units to scale inserted
// content"), Sample Output, then OK, Cancel and Direction..., which opens Direction Control over
// it: Base Angle East, North, West, South or Other, Other's Angle typed or picked ("Pick an
// angle" closes both for the engine's "Pick angle" and the engine opens them again). The
// Lighting group is left out: lights are a PRD non-goal (13). Help is left out, as Triya's other
// dialogs leave it. OK sends the settings; the engine sets what changed as one undo step.
import {
  INSUNITS_NAMES,
  unitsSample,
  type DialogRequest,
  type PromptAnswer,
  type UnitsSettings,
} from '@triya/engine';
import { useId, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';
import {
  ANGLE_TYPES,
  BASE_ANGLES,
  LENGTH_TYPES,
  anglePrecisionFor,
  anglePrecisions,
  angleText,
  baseAngleName,
  lengthPrecisions,
  typedAngle,
  type Choice,
} from './units-dialog';

type Request = Extract<DialogRequest, { type: 'units' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

function Select({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: number;
  choices: readonly Choice[];
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label className="cad-dialog-field units-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))}>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function UnitsDialog({ doc, request }: { doc: number; request: Request }) {
  const [s, setS] = useState<UnitsSettings>(request.settings);
  const [direction, setDirection] = useState(request.direction === true);
  const set = (patch: Partial<UnitsSettings>) => setS((was) => ({ ...was, ...patch }));
  const ok = () => void answer(doc, { kind: 'dialog', action: 'ok', units: s });
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  const [point, polar] = unitsSample(s);
  const insertion = INSUNITS_NAMES.map((label, value) => ({ value, label }));
  return (
    <>
      <Modal label="Drawing Units" className="units-dialog" onOk={ok} onCancel={cancel}>
        <div className="units-groups">
          <fieldset className="units-group">
            <legend>Length</legend>
            <Select
              label="Type:"
              value={s.lunits}
              choices={LENGTH_TYPES}
              onChange={(lunits) => set({ lunits })}
            />
            <Select
              label="Precision:"
              value={s.luprec}
              choices={lengthPrecisions(s.lunits)}
              onChange={(luprec) => set({ luprec })}
            />
          </fieldset>
          <fieldset className="units-group">
            <legend>Angle</legend>
            <Select
              label="Type:"
              value={s.aunits}
              choices={ANGLE_TYPES}
              onChange={(aunits) => set({ aunits, auprec: anglePrecisionFor(aunits, s.auprec) })}
            />
            <Select
              label="Precision:"
              value={s.auprec}
              choices={anglePrecisions(s.aunits, request.settings.auprec)}
              onChange={(auprec) => set({ auprec })}
            />
            <label className="cad-dialog-check">
              <input
                type="checkbox"
                checked={s.clockwise}
                onChange={(e) => set({ clockwise: e.currentTarget.checked })}
              />
              Clockwise
            </label>
          </fieldset>
        </div>
        <fieldset className="units-group">
          <legend>Insertion scale</legend>
          <Select
            label="Units to scale inserted content:"
            value={s.insunits}
            choices={insertion}
            onChange={(insunits) => set({ insunits })}
          />
        </fieldset>
        <fieldset className="units-group">
          <legend>Sample Output</legend>
          <output className="units-sample" aria-label="Sample Output">
            <span>{point}</span>
            <span>{polar}</span>
          </output>
        </fieldset>
        <div className="cad-dialog-buttons">
          <button type="button" onClick={ok}>
            OK
          </button>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" onClick={() => setDirection(true)}>
            Direction...
          </button>
        </div>
      </Modal>
      {direction && (
        <DirectionControl
          settings={s}
          onOk={(angbase) => {
            set({ angbase });
            setDirection(false);
          }}
          onCancel={() => setDirection(false)}
          onPick={(draft) =>
            void answer(doc, { kind: 'dialog', action: 'select', units: { ...s, ...draft } })
          }
        />
      )}
    </>
  );
}

/** Direction Control: the direction of angle 0 (ANGBASE), over Drawing Units. */
function DirectionControl({
  settings,
  onOk,
  onCancel,
  onPick,
}: {
  settings: UnitsSettings;
  onOk: (angbase: number) => void;
  onCancel: () => void;
  onPick: (draft: Partial<UnitsSettings>) => void;
}) {
  const named = baseAngleName(settings.angbase);
  const [choice, setChoice] = useState<string>(named ?? 'Other');
  const [text, setText] = useState(angleText(settings.angbase, settings.aunits, settings.auprec));
  const other = choice === 'Other';
  const typed = typedAngle(text);
  const valid = !other || typed !== undefined;
  const angle = other ? typed : BASE_ANGLES.find((b) => b.label === choice)!.angle;
  const ok = () => {
    if (angle !== undefined) onOk(angle);
  };
  return (
    <Modal label="Direction Control" className="units-direction" onOk={ok} onCancel={onCancel}>
      <fieldset className="units-group units-base">
        <legend>Base Angle</legend>
        {BASE_ANGLES.map((b) => (
          <label key={b.label} className="cad-dialog-check">
            <input
              type="radio"
              name="angbase"
              checked={choice === b.label}
              onChange={() => setChoice(b.label)}
            />
            {b.label}
            <span className="units-base-angle">
              {angleText(b.angle, settings.aunits, settings.auprec)}
            </span>
          </label>
        ))}
        <label className="cad-dialog-check">
          <input type="radio" name="angbase" checked={other} onChange={() => setChoice('Other')} />
          Other
        </label>
        <label className="cad-dialog-field units-other">
          <span>Angle:</span>
          <input
            type="text"
            value={text}
            disabled={!other}
            aria-invalid={!valid}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <button
            type="button"
            disabled={!other}
            onClick={() => onPick({ angbase: typed ?? settings.angbase })}
          >
            Pick an angle
          </button>
        </label>
      </fieldset>
      {!valid && (
        <p role="alert" className="dsettings-error">
          Angle must be an angle, such as 45, 45d30&apos; or N 45d E.
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={!valid}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
