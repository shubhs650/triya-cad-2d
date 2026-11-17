// IMAGEATTACH's Attach Image dialog (M5-04 part 5), with the structure and labels of AutoCAD's
// (AutoCAD Help, "Attach Image Dialog Box"; UI_SPEC.md §7): Name (the drawing's images) with
// Browse..., the preview, Path type, Insertion point (Specify on-screen, X, Y), Scale (Specify
// on-screen, the factor), Rotation (Specify on-screen, Angle), and Show Details' Image Information
// (Resolution, Current AutoCAD unit, Image size in pixels and in units); OK and Cancel. What is
// Specify on-screen is asked at the command line once the dialog closes (commands/image-attach.ts).
//
// Browse... picks the file (AutoCAD's Select Reference File dialog). Its header gives the size and
// resolution (raster-info.ts); on OK its bytes go to the app's images, so the image draws at once,
// and the definition names the file alone: a browser cannot tell a file's folder, so Path type is
// No path (Full path and Relative path greyed), which Triya and AutoCAD look for beside the drawing.
// Left out: the insertion point's Z and Help.
import type { DialogRequest, ImageAttachEntry, ImageAttachSettings } from '@triya/engine';
import { INSUNITS_NAMES, attachedImageSize } from '@triya/engine';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';
import { rasterInfo } from './raster-info';

type Request = Extract<DialogRequest, { type: 'imageattach' }>;

/** The image formats Browse... offers: those `decodeRaster` draws (images.ts `isRasterFile`). */
const ACCEPT = '.bmp,.dib,.rle,.jpg,.jpeg,.jpe,.jfif,.png,.tif,.tiff,.gif';

/** A number as its field shows it. */
const shown = (v: number) => String(Number(v.toFixed(6)));

/** A finite number, or undefined. */
const numberOf = (t: string): number | undefined => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

/** A file picked with Browse..., not in the drawing yet. */
interface Picked extends ImageAttachEntry {
  readonly bytes: Uint8Array;
  readonly url: string;
}

const baseName = (fileName: string) =>
  fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || fileName;

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
      Specify on-screen
    </label>
  );
}

export function ImageAttachDialog({
  doc,
  request,
  onImageFile,
}: {
  doc: number;
  request: Request;
  /** The picked file's bytes, on OK: the app's images serve them to the drawing. */
  onImageFile?: ((fileName: string, bytes: Uint8Array) => void) | undefined;
}) {
  const s = request.settings;
  const [picked, setPicked] = useState<Picked>();
  const [name, setName] = useState(request.images[0]?.name ?? '');
  const [problem, setProblem] = useState<string>();
  const [pointOnScreen, setPointOnScreen] = useState(s.pointOnScreen);
  const [x, setX] = useState(shown(s.point.x));
  const [y, setY] = useState(shown(s.point.y));
  const [scaleOnScreen, setScaleOnScreen] = useState(s.scaleOnScreen);
  const [scale, setScale] = useState(shown(s.scale));
  const [rotationOnScreen, setRotationOnScreen] = useState(s.rotationOnScreen);
  const [angle, setAngle] = useState(shown((s.rotation * 180) / Math.PI));
  const [details, setDetails] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const nameId = useId();
  const pathTypeId = useId();

  // A drawing without images opens on Browse..., as AutoCAD opens on picking the file.
  useEffect(() => {
    if (request.images.length === 0) browse.current?.focus();
  }, [request.images.length]);
  useEffect(() => () => (picked ? URL.revokeObjectURL(picked.url) : undefined), [picked]);

  const entries = useMemo(
    () =>
      picked ? [picked, ...request.images.filter((e) => e.name !== picked.name)] : request.images,
    [picked, request.images],
  );
  const image = entries.find((e) => e.name === name);

  const take = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = rasterInfo(bytes);
    if (!info) {
      setProblem(`${file.name} is not an image file Triya can attach.`);
      return;
    }
    // A name the drawing has for another file is numbered by the engine; the list shows the file's.
    const known = request.images.find((e) => e.fileName.toLowerCase() === file.name.toLowerCase());
    const entry: Picked = {
      name: known?.name ?? baseName(file.name),
      fileName: file.name,
      width: info.width,
      height: info.height,
      ...(info.ppi && { ppi: info.ppi }),
      bytes,
      url: URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>])),
    };
    setProblem(undefined);
    setPicked(entry);
    setName(entry.name);
  };

  const values = {
    x: numberOf(x),
    y: numberOf(y),
    scale: numberOf(scale),
    angle: numberOf(angle),
  };
  const valid =
    image !== undefined &&
    (pointOnScreen || (values.x !== undefined && values.y !== undefined)) &&
    (scaleOnScreen || (values.scale !== undefined && values.scale > 0)) &&
    (rotationOnScreen || values.angle !== undefined);

  const settings = (): ImageAttachSettings => ({
    pointOnScreen,
    point: { x: values.x ?? s.point.x, y: values.y ?? s.point.y },
    scaleOnScreen,
    scale: values.scale ?? s.scale,
    rotationOnScreen,
    rotation: values.angle === undefined ? s.rotation : (values.angle * Math.PI) / 180,
  });
  const ok = () => {
    if (!valid || !image) return;
    if (picked && image === picked) onImageFile?.(picked.fileName, picked.bytes);
    const file = {
      fileName: image.fileName,
      width: image.width,
      height: image.height,
      ...(image.ppi && { ppi: image.ppi }),
    };
    void engines.command(doc, {
      kind: 'answer',
      answer: { kind: 'dialog', action: 'ok', imageAttach: { file, settings: settings() } },
    });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });

  const unit = INSUNITS_NAMES[request.units] ?? INSUNITS_NAMES[0]!;
  const size = image ? attachedImageSize(request.units, image, 1) : undefined;

  return (
    <Modal label="Attach Image" className="image-attach-dialog" onOk={ok} onCancel={cancel}>
      <div className="insert-dialog-head">
        <div className="image-attach-name">
          <label className="cad-dialog-field insert-dialog-name" htmlFor={nameId}>
            <span>Name:</span>
            <select id={nameId} value={name} onChange={(e) => setName(e.currentTarget.value)}>
              {image === undefined && <option value={name}>{name}</option>}
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
            accept={ACCEPT}
            hidden
            aria-label="Select Image File"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) void take(f);
            }}
          />
          <p className="insert-dialog-unit">
            Path: <span data-testid="image-attach-path">{image?.fileName ?? ''}</span>
          </p>
          <label className="cad-dialog-field" htmlFor={pathTypeId}>
            <span>Path type:</span>
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
        </div>
        <div className="image-attach-preview" aria-label="Preview">
          {picked && image === picked && (
            <img src={picked.url} alt={`Preview of ${picked.fileName}`} />
          )}
        </div>
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
          <NumberField label="Scale:" value={scale} onChange={setScale} disabled={scaleOnScreen} />
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
      </div>
      {details && (
        <fieldset className="block-definition-group image-attach-details">
          <legend>Image Information</legend>
          <p className="insert-dialog-unit">
            Resolution: Horizontal:{' '}
            <span data-testid="image-attach-hres">{image?.ppi ? shown(image.ppi.x) : 'None'}</span>{' '}
            Vertical:{' '}
            <span data-testid="image-attach-vres">{image?.ppi ? shown(image.ppi.y) : 'None'}</span>
          </p>
          <p className="insert-dialog-unit">
            Current AutoCAD unit: <span data-testid="image-attach-unit">{unit}</span>
          </p>
          <p className="insert-dialog-unit">
            Image size in pixels: Width:{' '}
            <span data-testid="image-attach-px">
              {image ? `${image.width}, Height: ${image.height}` : ''}
            </span>
          </p>
          <p className="insert-dialog-unit">
            Image size in units: Width:{' '}
            <span data-testid="image-attach-size">
              {size ? `${shown(size.x)}, Height: ${shown(size.y)}` : ''}
            </span>
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
