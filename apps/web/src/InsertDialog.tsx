// INSERT's Insert dialog (M5-01 part 3), with the structure and labels of AutoCAD's Insert dialog
// (AutoCAD Help, "Insert Dialog Box", CLASSICINSERT in AutoCAD 2024; UI_SPEC.md §7): Name (the
// drawing's blocks) with the block's preview; Insertion point (Specify On-screen, X, Y); Scale
// (Specify On-screen, X, Y, Z, Uniform Scale); Rotation (Specify On-screen, Angle); Block Unit
// (Unit, Factor); Explode; and the Blocks palette's Repeat Placement; OK and Cancel. What is
// Specify On-screen is asked at the command line once the dialog closes (commands/blocks.ts).
//
// As AutoCAD's dialog does, Explode and a block that scales uniformly take X's factor alone (Y
// and Z greyed), and Explode is greyed for a block that may not be exploded. The Angle is in
// degrees. Left out: Browse... and Path (a drawing file as the block, a later part of M5-01),
// Locate using Geographic Data, the insertion point's Z, and Help.
import type { DialogRequest, InsertDialogSettings, PromptAnswer } from '@triya/engine';
import { INSUNITS_NAMES } from '@triya/engine';
import { useId, useMemo, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { StylePreview } from './StylePreview';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'insert' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** A number as its field shows it. */
const shown = (v: number) => String(Number(v.toFixed(6)));

/** A finite number, or undefined. */
const numberOf = (t: string): number | undefined => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

const PREVIEW = { width: 120, height: 90 };

/** A text field of a group, disabled while its group is Specify On-screen. */
function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <label className="cad-dialog-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        aria-invalid={!disabled && numberOf(value) === undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}

function OnScreen({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="matchprop-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      Specify On-screen
    </label>
  );
}

export function InsertDialog({ doc, request }: { doc: number; request: Request }) {
  const s = request.settings;
  const [name, setName] = useState(s.name);
  const [pointOnScreen, setPointOnScreen] = useState(s.pointOnScreen);
  const [x, setX] = useState(shown(s.point.x));
  const [y, setY] = useState(shown(s.point.y));
  const [scaleOnScreen, setScaleOnScreen] = useState(s.scaleOnScreen);
  const [sx, setSx] = useState(shown(s.scale.x));
  const [sy, setSy] = useState(shown(s.scale.y));
  const [sz, setSz] = useState(shown(s.scale.z));
  const [uniformScale, setUniformScale] = useState(s.uniformScale);
  const [rotationOnScreen, setRotationOnScreen] = useState(s.rotationOnScreen);
  const [angle, setAngle] = useState(shown((s.rotation * 180) / Math.PI));
  const [explode, setExplode] = useState(s.explode);
  const [repeat, setRepeat] = useState(s.repeat);
  const nameId = useId();

  const block = request.blocks.find((b) => b.name === name);
  const explodeAllowed = block?.allowExploding !== false;
  const exploding = explode && explodeAllowed;
  // Y and Z follow X: Uniform Scale, Explode, or a block that scales uniformly.
  const uniform = uniformScale || exploding || block?.scaleUniformly === true;
  const preview = useMemo(
    () => (block ? { kind: 'block' as const, block: block.handle } : undefined),
    [block],
  );

  const values = {
    x: numberOf(x),
    y: numberOf(y),
    sx: numberOf(sx),
    sy: numberOf(sy),
    sz: numberOf(sz),
    angle: numberOf(angle),
  };
  const valid =
    block !== undefined &&
    (pointOnScreen || (values.x !== undefined && values.y !== undefined)) &&
    (scaleOnScreen ||
      (values.sx !== undefined &&
        (uniform || (values.sy !== undefined && values.sz !== undefined)))) &&
    (rotationOnScreen || values.angle !== undefined);

  const settings = (): InsertDialogSettings => ({
    name,
    pointOnScreen,
    point: { x: values.x ?? s.point.x, y: values.y ?? s.point.y },
    scaleOnScreen,
    scale: {
      x: values.sx ?? s.scale.x,
      y: values.sy ?? s.scale.y,
      z: values.sz ?? s.scale.z,
    },
    uniformScale,
    rotationOnScreen,
    rotation: values.angle === undefined ? s.rotation : (values.angle * Math.PI) / 180,
    explode: exploding,
    repeat: repeat && pointOnScreen,
  });
  const ok = () => {
    if (valid) answer(doc, { kind: 'dialog', action: 'ok', insert: { settings: settings() } });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });

  return (
    <Modal label="Insert" className="insert-dialog" onOk={ok} onCancel={cancel}>
      <div className="insert-dialog-head">
        <label className="cad-dialog-field insert-dialog-name" htmlFor={nameId}>
          <span>Name:</span>
          <select id={nameId} value={name} onChange={(e) => setName(e.currentTarget.value)}>
            {block === undefined && <option value={name}>{name}</option>}
            {request.blocks.map((b) => (
              <option key={b.handle} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <StylePreview doc={doc} preview={preview} size={PREVIEW} testId="insert-preview" />
      </div>
      <div className="block-definition-groups">
        <fieldset className="block-definition-group">
          <legend>Insertion point</legend>
          <OnScreen checked={pointOnScreen} onChange={setPointOnScreen} />
          <NumberField label="X:" value={x} onChange={setX} disabled={pointOnScreen} />
          <NumberField label="Y:" value={y} onChange={setY} disabled={pointOnScreen} />
        </fieldset>
        <fieldset className="block-definition-group">
          <legend>Scale</legend>
          <OnScreen checked={scaleOnScreen} onChange={setScaleOnScreen} />
          <NumberField label="X:" value={sx} onChange={setSx} disabled={scaleOnScreen} />
          <NumberField
            label="Y:"
            value={uniform ? sx : sy}
            onChange={setSy}
            disabled={scaleOnScreen || uniform}
          />
          <NumberField
            label="Z:"
            value={uniform ? sx : sz}
            onChange={setSz}
            disabled={scaleOnScreen || uniform}
          />
          <label className="matchprop-check">
            <input
              type="checkbox"
              checked={uniform}
              disabled={exploding || block?.scaleUniformly === true}
              onChange={(e) => setUniformScale(e.currentTarget.checked)}
            />
            Uniform Scale
          </label>
        </fieldset>
        <fieldset className="block-definition-group">
          <legend>Rotation</legend>
          <OnScreen checked={rotationOnScreen} onChange={setRotationOnScreen} />
          <NumberField
            label="Angle:"
            value={angle}
            onChange={setAngle}
            disabled={rotationOnScreen}
          />
        </fieldset>
        <fieldset className="block-definition-group">
          <legend>Block Unit</legend>
          <p className="insert-dialog-unit">
            Unit: <span data-testid="insert-unit">{block ? INSUNITS_NAMES[block.units] : ''}</span>
          </p>
          <p className="insert-dialog-unit">
            Factor: <span data-testid="insert-factor">{block ? shown(block.factor) : ''}</span>
          </p>
        </fieldset>
      </div>
      <div className="insert-dialog-options">
        <label className="matchprop-check">
          <input
            type="checkbox"
            checked={exploding}
            disabled={!explodeAllowed}
            onChange={(e) => setExplode(e.currentTarget.checked)}
          />
          Explode
        </label>
        <label className="matchprop-check">
          <input
            type="checkbox"
            checked={repeat && pointOnScreen}
            disabled={!pointOnScreen}
            onChange={(e) => setRepeat(e.currentTarget.checked)}
          />
          Repeat Placement
        </label>
      </div>
      {request.note !== undefined && (
        <p role="alert" className="cell-block-error">
          {request.note}
        </p>
      )}
      {request.blocks.length === 0 && (
        <p role="alert" className="cell-block-error">
          The drawing has no blocks to insert.
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={!valid}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
