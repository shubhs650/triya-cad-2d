// XATTACH's Attach External Reference dialog (M5-04 part 6), with the structure and labels of
// AutoCAD's (AutoCAD Help, "Attach External Reference Dialog Box"; UI_SPEC.md §7): Name (the
// drawing's xrefs) with Browse..., Reference Type (Attachment, Overlay), Path type, Scale (Specify
// On-screen, X, Y, Z, Uniform Scale), Insertion point (Specify On-screen, X, Y), Rotation (Specify
// on-screen, Angle), Block Unit (Unit, Factor) and Show Details' Found in and Saved path; OK and
// Cancel. What is Specify On-screen is asked at the command line once the dialog closes
// (commands/xref-attach.ts).
//
// Browse... picks the drawing (AutoCAD's Select Reference File dialog): the app reads its INSUNITS
// for Block Unit, and on OK keeps the file so the xref loads from it at once (App.tsx
// `xrefSources`). The xref names the file alone: a browser cannot tell a file's folder, so Path
// type is No path (Full path and Relative path greyed), which Triya and AutoCAD look for beside
// the drawing. Left out: the preview (a DXF keeps no thumbnail Triya reads), the insertion
// point's Z, Locate using Geographic Data and Help.
import type { DialogRequest, XrefAttachEntry, XrefAttachSettings } from '@triya/engine';
import { INSUNITS_NAMES, insUnitsScale } from '@triya/engine';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'xrefattach' }>;

/** What the app does with the drawing files Browse... picks. */
export interface XrefFiles {
  /** The file's INSUNITS, or why it cannot be attached. */
  units(file: File): Promise<number>;
  /** OK attaches the file: the app keeps it to load the xref from. */
  attach(file: File): void;
}

/** A number as its field shows it. */
const shown = (v: number) => String(Number(v.toFixed(6)));

/** A finite number, or undefined. */
const numberOf = (t: string): number | undefined => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

const baseName = (fileName: string) =>
  fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || fileName;

/** A file picked with Browse..., not in the drawing yet. */
interface Picked extends XrefAttachEntry {
  readonly file: File;
}

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

function Check({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="matchprop-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

export function XrefAttachDialog({
  doc,
  request,
  files,
}: {
  doc: number;
  request: Request;
  files?: XrefFiles | undefined;
}) {
  const s = request.settings;
  const [picked, setPicked] = useState<Picked>();
  const [name, setName] = useState(request.xrefs[0]?.name ?? '');
  const [problem, setProblem] = useState<string>();
  const [overlay, setOverlay] = useState(s.overlay);
  const [pointOnScreen, setPointOnScreen] = useState(s.pointOnScreen);
  const [px, setPx] = useState(shown(s.point.x));
  const [py, setPy] = useState(shown(s.point.y));
  const [scaleOnScreen, setScaleOnScreen] = useState(s.scaleOnScreen);
  const [sx, setSx] = useState(shown(s.scale.x));
  const [sy, setSy] = useState(shown(s.scale.y));
  const [sz, setSz] = useState(shown(s.scale.z));
  const [uniform, setUniform] = useState(s.uniformScale);
  const [rotationOnScreen, setRotationOnScreen] = useState(s.rotationOnScreen);
  const [angle, setAngle] = useState(shown((s.rotation * 180) / Math.PI));
  const [details, setDetails] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const nameId = useId();
  const pathTypeId = useId();

  // A drawing without xrefs opens on Browse..., as AutoCAD opens on picking the file.
  useEffect(() => {
    if (request.xrefs.length === 0) browse.current?.focus();
  }, [request.xrefs.length]);

  const entries = useMemo(
    () =>
      picked ? [picked, ...request.xrefs.filter((e) => e.name !== picked.name)] : request.xrefs,
    [picked, request.xrefs],
  );
  const xref = entries.find((e) => e.name === name);
  // An xref the drawing has keeps the type it was attached with.
  const known = xref !== undefined && xref !== picked;

  const take = async (file: File) => {
    let units: number;
    try {
      units = files ? await files.units(file) : 0;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : `${file.name} cannot be attached.`);
      return;
    }
    // A file the drawing has an xref of is that xref; the engine numbers a name taken otherwise.
    const same = request.xrefs.find((e) => e.fileName.toLowerCase() === file.name.toLowerCase());
    const entry: Picked = {
      name: same?.name ?? baseName(file.name),
      fileName: file.name,
      units: same?.units ?? units,
      overlay: same?.overlay ?? overlay,
      file,
    };
    setProblem(undefined);
    setPicked(same ? undefined : entry);
    setName(entry.name);
  };

  const values = {
    px: numberOf(px),
    py: numberOf(py),
    sx: numberOf(sx),
    sy: uniform ? numberOf(sx) : numberOf(sy),
    sz: uniform ? numberOf(sx) : numberOf(sz),
    angle: numberOf(angle),
  };
  const scaleValid =
    scaleOnScreen ||
    (values.sx !== undefined &&
      values.sy !== undefined &&
      values.sz !== undefined &&
      values.sx !== 0 &&
      values.sy !== 0 &&
      values.sz !== 0);
  const valid =
    xref !== undefined &&
    (pointOnScreen || (values.px !== undefined && values.py !== undefined)) &&
    scaleValid &&
    (rotationOnScreen || values.angle !== undefined);

  const settings = (): XrefAttachSettings => ({
    overlay: known ? xref.overlay : overlay,
    pointOnScreen,
    point: { x: values.px ?? s.point.x, y: values.py ?? s.point.y },
    scaleOnScreen,
    scale: {
      x: values.sx ?? s.scale.x,
      y: values.sy ?? s.scale.y,
      z: values.sz ?? s.scale.z,
    },
    uniformScale: uniform,
    rotationOnScreen,
    rotation: values.angle === undefined ? s.rotation : (values.angle * Math.PI) / 180,
  });
  const ok = () => {
    if (!valid || !xref) return;
    if (picked && xref === picked) files?.attach(picked.file);
    void engines.command(doc, {
      kind: 'answer',
      answer: {
        kind: 'dialog',
        action: 'ok',
        xrefAttach: {
          file: { fileName: xref.fileName, units: xref.units },
          settings: settings(),
        },
      },
    });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });

  const unit = xref ? (INSUNITS_NAMES[xref.units] ?? INSUNITS_NAMES[0]!) : '';
  const factor = xref ? insUnitsScale(xref.units, request.units) : undefined;

  return (
    <Modal
      label="Attach External Reference"
      className="image-attach-dialog"
      onOk={ok}
      onCancel={cancel}
    >
      <div className="insert-dialog-head">
        <div className="image-attach-name">
          <label className="cad-dialog-field insert-dialog-name" htmlFor={nameId}>
            <span>Name:</span>
            <select id={nameId} value={name} onChange={(e) => setName(e.currentTarget.value)}>
              {xref === undefined && <option value={name}>{name}</option>}
              {entries.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <button ref={browse} type="button" onClick={() => input.current?.click()}>
            Browse...
          </button>
          <input
            ref={input}
            type="file"
            accept=".dwg,.dxf"
            hidden
            aria-label="Select Reference File"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) void take(f);
            }}
          />
          <p className="insert-dialog-unit">
            Path: <span data-testid="xref-attach-path">{xref?.fileName ?? ''}</span>
          </p>
        </div>
      </div>
      <div className="block-definition-groups">
        <fieldset className="block-definition-group">
          <legend>Reference Type</legend>
          <label className="matchprop-check">
            <input
              type="radio"
              name="xref-attach-type"
              checked={!(known ? xref.overlay : overlay)}
              disabled={known}
              onChange={() => setOverlay(false)}
            />
            Attachment
          </label>
          <label className="matchprop-check">
            <input
              type="radio"
              name="xref-attach-type"
              checked={known ? xref.overlay : overlay}
              disabled={known}
              onChange={() => setOverlay(true)}
            />
            Overlay
          </label>
        </fieldset>
        <fieldset className="block-definition-group">
          <legend>Path type</legend>
          <label className="cad-dialog-field" htmlFor={pathTypeId}>
            <span className="visually-hidden">Path type</span>
            <select id={pathTypeId} value="none" disabled>
              <option value="full" disabled>
                Full path
              </option>
              <option value="relative" disabled>
                Relative path
              </option>
              <option value="none">No path</option>
            </select>
          </label>
        </fieldset>
      </div>
      <div className="block-definition-groups">
        <fieldset className="block-definition-group">
          <legend>Scale</legend>
          <Check label="Specify On-screen" checked={scaleOnScreen} onChange={setScaleOnScreen} />
          <NumberField label="X:" value={sx} onChange={setSx} disabled={scaleOnScreen} />
          <NumberField label="Y:" value={sy} onChange={setSy} disabled={scaleOnScreen || uniform} />
          <NumberField label="Z:" value={sz} onChange={setSz} disabled={scaleOnScreen || uniform} />
          <Check
            label="Uniform Scale"
            checked={uniform}
            onChange={setUniform}
            disabled={scaleOnScreen}
          />
        </fieldset>
        <fieldset className="block-definition-group">
          <legend>Insertion point</legend>
          <Check label="Specify On-screen" checked={pointOnScreen} onChange={setPointOnScreen} />
          <NumberField label="X:" value={px} onChange={setPx} disabled={pointOnScreen} />
          <NumberField label="Y:" value={py} onChange={setPy} disabled={pointOnScreen} />
        </fieldset>
        <fieldset className="block-definition-group">
          <legend>Rotation</legend>
          <Check
            label="Specify on-screen"
            checked={rotationOnScreen}
            onChange={setRotationOnScreen}
          />
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
            Unit: <span data-testid="xref-attach-unit">{unit}</span>
          </p>
          <p className="insert-dialog-unit">
            Factor:{' '}
            <span data-testid="xref-attach-factor">
              {factor === undefined ? '' : shown(factor)}
            </span>
          </p>
        </fieldset>
      </div>
      {details && (
        <fieldset className="block-definition-group image-attach-details">
          <legend>Path</legend>
          <p className="insert-dialog-unit">
            Found in:{' '}
            <span data-testid="xref-attach-found">
              {picked && xref === picked ? picked.fileName : ''}
            </span>
          </p>
          <p className="insert-dialog-unit">
            Saved path: <span data-testid="xref-attach-saved">{xref?.fileName ?? ''}</span>
          </p>
        </fieldset>
      )}
      {(problem ?? request.note) !== undefined && (
        <p role="alert" className="cell-block-error">
          {problem ?? request.note}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => setDetails(!details)}>
          {details ? 'Hide Details' : 'Show Details'}
        </button>
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
