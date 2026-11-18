// IMAGEADJUST's Image Adjust dialog (M5-04 part 10), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Image Adjust Dialog Box"; UI_SPEC.md §7): Brightness (Dark to Light),
// Contrast and Fade (Low to High), each a slider with its value box, 0–100; the Image Preview,
// which follows every change; Reset (back to 50, 50 and 0). A bitonal image takes no brightness
// or contrast, so both are greyed out for one, as AutoCAD greys them. OK answers with the values,
// which the command sets as one undo step. AutoCAD's Help button is left out, as Triya's other
// dialogs leave it.
import type { DialogRequest, ImageAdjustSettings, PromptAnswer } from '@triya/engine';
import type { RasterPixels } from '@triya/render';
import { useEffect, useId, useMemo, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';
import { IMAGE_ADJUST_DEFAULTS, pngUrl, previewPixels, rgbOf } from './image-adjust';

type Request = Extract<DialogRequest, { type: 'imageadjust' }>;

/** The preview's box, CSS pixels. */
const PREVIEW_BOX = 160;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** What the app hands the dialog to preview the image with. */
export interface ImageAdjustPreview {
  /** The decoded pixels of an image file, when it was supplied. */
  readonly pixels: (fileName: string) => Promise<RasterPixels> | undefined;
  /** The drawing's background, `#rrggbb`, which Fade blends into. */
  readonly background: () => string;
}

/** A value typed in a box: a whole number kept to 0–100, or undefined while it is not one. */
const typed = (text: string): number | undefined => {
  const n = Number(text.trim());
  return text.trim() === '' || !Number.isFinite(n)
    ? undefined
    : Math.min(100, Math.max(0, Math.round(n)));
};

function Setting({
  label,
  low,
  high,
  value,
  disabled,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  // The slider and Reset change the value: the box follows them.
  useEffect(() => setText(String(value)), [value]);
  return (
    <fieldset className="image-adjust-setting" disabled={disabled}>
      <legend>{label}</legend>
      <div className="image-adjust-row">
        <span aria-hidden>{low}</span>
        <input
          type="range"
          aria-label={label}
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
        />
        <span aria-hidden>{high}</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          aria-label={`${label} value`}
          className="image-adjust-value"
          value={text}
          aria-invalid={typed(text) === undefined}
          onChange={(e) => {
            const t = e.currentTarget.value;
            setText(t);
            const v = typed(t);
            if (v !== undefined) onChange(v);
          }}
          onBlur={() => setText(String(value))}
        />
      </div>
    </fieldset>
  );
}

export function ImageAdjustDialog({
  doc,
  request,
  preview,
}: {
  doc: number;
  request: Request;
  preview?: ImageAdjustPreview | undefined;
}) {
  const [values, setValues] = useState<ImageAdjustSettings>({
    brightness: request.brightness,
    contrast: request.contrast,
    fade: request.fade,
  });
  const [pixels, setPixels] = useState<RasterPixels | undefined>();
  useEffect(() => {
    if (!request.file || !preview) return;
    let live = true;
    preview.pixels(request.file)?.then(
      (p) => live && setPixels(p),
      // A file the decoder cannot read previews nothing, as the canvas shows its frame only.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [request.file, preview]);
  const background = preview?.background() ?? '#ffffff';
  const url = useMemo(
    () => pixels && pngUrl(previewPixels(pixels, values, rgbOf(background), PREVIEW_BOX)),
    [pixels, values, background],
  );
  const bitonal = pixels?.bitonal === true;
  const set = (k: keyof ImageAdjustSettings) => (v: number) =>
    setValues((was) => ({ ...was, [k]: v }));
  const ok = () => void answer(doc, { kind: 'dialog', action: 'ok', imageAdjust: values });
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  return (
    <Modal label="Image Adjust" className="image-adjust-dialog" onOk={ok} onCancel={cancel}>
      <div className="image-adjust-body">
        <div className="image-adjust-settings">
          <Setting
            label="Brightness"
            low="Dark"
            high="Light"
            value={values.brightness}
            disabled={bitonal}
            onChange={set('brightness')}
          />
          <Setting
            label="Contrast"
            low="Low"
            high="High"
            value={values.contrast}
            disabled={bitonal}
            onChange={set('contrast')}
          />
          <Setting
            label="Fade"
            low="Low"
            high="High"
            value={values.fade}
            disabled={false}
            onChange={set('fade')}
          />
        </div>
        <fieldset className="image-adjust-preview-group">
          <legend>Image Preview</legend>
          <div
            className="image-adjust-preview"
            data-testid="image-adjust-preview"
            style={{ background }}
          >
            {url ? (
              <img src={url} alt={`Preview of ${request.name ?? request.file ?? 'the image'}`} />
            ) : (
              <span className="image-adjust-none">
                {request.file ? `${request.file} not found` : 'No image file'}
              </span>
            )}
          </div>
        </fieldset>
      </div>
      <div className="cad-dialog-buttons">
        <button
          type="button"
          className="image-adjust-reset"
          onClick={() => setValues(IMAGE_ADJUST_DEFAULTS)}
        >
          Reset
        </button>
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
