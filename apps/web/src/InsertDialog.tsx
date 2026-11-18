// INSERT's Insert dialog (M5-01 part 3), with the structure and labels of AutoCAD's Insert dialog
// (AutoCAD Help, "Insert Dialog Box", CLASSICINSERT in AutoCAD 2024; UI_SPEC.md §7): Name (the
// drawing's blocks) with the block's preview; Insertion point (Specify On-screen, X, Y); Scale
// (Specify On-screen, X, Y, Z, Uniform Scale); Rotation (Specify On-screen, Angle); Block Unit
// (Unit, Factor); Explode; and the Blocks palette's Repeat Placement; OK and Cancel. What is
// Specify On-screen is asked at the command line once the dialog closes (commands/blocks.ts).
//
// As AutoCAD's dialog does, Explode and a block that scales uniformly take X's factor alone (Y
// and Z greyed), and Explode is greyed for a block that may not be exploded. The Angle is in
// degrees. Browse... (M5-01 part 4) picks a drawing file, read at once, which becomes the block
// named after it (the Name list shows it, Path its file, Block Unit its units); OK asks before
// redefining a block of that name, and Do not redefine inserts the block as it is. Left out:
// Locate using Geographic Data, the insertion point's Z, and Help.
import type {
  Clipboard,
  DialogRequest,
  InsertDialogFile,
  InsertDialogSettings,
  PromptAnswer,
} from '@triya/engine';
import { INSUNITS_NAMES, fileBlockName, insUnitsScale } from '@triya/engine';
import { useId, useMemo, useRef, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { StylePreview } from './StylePreview';
import { browsedDrawing } from './block-file-io';
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

/** The drawing file Browse... picked: its name and, once read, its model space. */
interface Browsed {
  readonly file: string;
  /** Its block's name, as Browse... named it. */
  readonly name: string;
  /** Undefined: the file the dialog was opened with, which the engine keeps. */
  readonly content?: Clipboard;
  readonly units: number;
}

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
  const [browsed, setBrowsed] = useState<Browsed | undefined>(() =>
    request.file === undefined ? undefined : { file: request.file, name: s.name, units: 0 },
  );
  const [reading, setReading] = useState<string | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameId = useId();

  // The file's block is the one named until another is picked in the list.
  const fromFile = browsed !== undefined && browsed.name === name ? browsed : undefined;
  const block = fromFile ? undefined : request.blocks.find((b) => b.name === name);
  const existing = fromFile
    ? request.blocks.find((b) => b.name.toUpperCase() === name.toUpperCase())
    : undefined;
  const explodeAllowed = fromFile !== undefined || block?.allowExploding !== false;
  const exploding = explode && explodeAllowed;
  // Y and Z follow X: Uniform Scale, Explode, or a block that scales uniformly.
  const uniform = uniformScale || exploding || block?.scaleUniformly === true;
  const preview = useMemo(
    () => (block ? { kind: 'block' as const, block: block.handle } : undefined),
    [block],
  );
  const unit = fromFile ? (fromFile.content?.insUnits ?? fromFile.units) : block?.units;
  const factor =
    unit === undefined ? undefined : fromFile ? insUnitsScale(unit, request.units) : block!.factor;

  /** Browse...: the file read now, its block named after it. */
  const browse = async (f: File) => {
    setReading(`Reading ${f.name}...`);
    try {
      const content = await browsedDrawing(f);
      const named = fileBlockName(f.name);
      setBrowsed({ file: f.name, name: named, content, units: content.insUnits ?? 0 });
      setName(named);
      setReading(undefined);
    } catch (e) {
      setReading(`${f.name} could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const values = {
    x: numberOf(x),
    y: numberOf(y),
    sx: numberOf(sx),
    sy: numberOf(sy),
    sz: numberOf(sz),
    angle: numberOf(angle),
  };
  const valid =
    (block !== undefined || fromFile !== undefined) &&
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
  const send = (redefine: boolean) => {
    const drawing: InsertDialogFile | undefined = fromFile && {
      file: fromFile.file,
      ...(fromFile.content && { content: fromFile.content }),
      redefine,
    };
    answer(doc, {
      kind: 'dialog',
      action: 'ok',
      insert: { settings: settings(), ...(drawing && { drawing }) },
    });
  };
  /** OK: a file whose block's name the drawing has asks first, as AutoCAD does. */
  const ok = () => {
    if (!valid) return;
    if (existing) setAsking(true);
    else send(false);
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });

  return (
    <Modal label="Insert" className="insert-dialog" onOk={ok} onCancel={cancel}>
      <div className="insert-dialog-head">
        <label className="cad-dialog-field insert-dialog-name" htmlFor={nameId}>
          <span>Name:</span>
          <select id={nameId} value={name} onChange={(e) => setName(e.currentTarget.value)}>
            {(block === undefined || fromFile !== undefined) && (
              <option value={name}>{name}</option>
            )}
            {request.blocks
              .filter((b) => fromFile === undefined || b.name !== name)
              .map((b) => (
                <option key={b.handle} value={b.name}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        <div className="insert-dialog-browse">
          <button type="button" onClick={() => fileInput.current?.click()}>
            Browse...
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".dxf,.dwg"
            hidden
            aria-label="Drawing file to insert"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) void browse(f);
            }}
          />
          <p className="insert-dialog-path">
            Path: <span data-testid="insert-path">{fromFile?.file ?? ''}</span>
          </p>
        </div>
        {/* A file's block is not in the drawing yet, so nothing is previewed: a canvas of its
            own, not the last block's drawing. */}
        <StylePreview
          key={fromFile ? 'file' : 'block'}
          doc={doc}
          preview={preview}
          size={PREVIEW}
          testId="insert-preview"
        />
      </div>
      {reading !== undefined && (
        <p role="status" className="insert-dialog-path">
          {reading}
        </p>
      )}
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
            Unit:{' '}
            <span data-testid="insert-unit">{unit === undefined ? '' : INSUNITS_NAMES[unit]}</span>
          </p>
          <p className="insert-dialog-unit">
            Factor:{' '}
            <span data-testid="insert-factor">{factor === undefined ? '' : shown(factor)}</span>
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
      {request.blocks.length === 0 && fromFile === undefined && (
        <p role="alert" className="cell-block-error">
          The drawing has no blocks to insert. Browse... inserts a drawing file.
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
      {asking && existing && (
        <Modal
          label="Block - Redefine Block"
          className="block-definition-ask"
          onOk={() => {
            setAsking(false);
            send(true);
          }}
          onCancel={() => setAsking(false)}
        >
          <p>
            &ldquo;{existing.name}&rdquo; is already defined. Do you want to redefine it from{' '}
            {fromFile?.file}? Every reference to it will show the new definition.
          </p>
          <div className="cad-dialog-buttons">
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                send(true);
              }}
            >
              Redefine block
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                send(false);
              }}
            >
              Do not redefine
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
