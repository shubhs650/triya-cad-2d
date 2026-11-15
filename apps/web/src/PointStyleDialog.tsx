// DDPTYPE's Point Style dialog (M3-01 part 6), with AutoCAD 2024's structure and labels (AutoCAD
// Help, "Point Style Dialog Box"; UI_SPEC.md §7): the twenty point styles as pictures (PDMODE),
// Point Size, and whether it is relative to the screen (a percentage, PDSIZE negative) or in
// absolute units (PDSIZE positive). PDSIZE 0 is AutoCAD's 5% of the screen and opens as that.
// The styles are a radio group, so the arrow keys move through them; Enter is OK, Esc Cancel.
// AutoCAD's Help button is left out, as Triya's other dialogs leave it.
import { POINT_MODES, type DialogRequest, type PromptAnswer } from '@triya/engine';
import { useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'pointstyle' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** PDSIZE 0: "5 percent of the drawing area height" (AutoCAD 2024 Help, "PDSIZE"). */
const DEFAULT_PERCENT = 5;

/** A PDMODE value drawn as the dialog's picture of it: the figure, then its circle and square. */
function PointFigure({ mode }: { mode: number }) {
  const figure = mode & 7;
  const c = 16;
  const h = 8;
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        {figure === 0 && <circle cx={c} cy={c} r="1.5" fill="currentColor" />}
        {figure === 2 && <path d={`M${c - h} ${c}H${c + h}M${c} ${c - h}V${c + h}`} />}
        {figure === 3 && (
          <path d={`M${c - h} ${c - h}L${c + h} ${c + h}M${c - h} ${c + h}L${c + h} ${c - h}`} />
        )}
        {figure === 4 && <path d={`M${c} ${c}V${c - h}`} />}
        {mode & 32 ? <circle cx={c} cy={c} r={h / 2 + 2} /> : null}
        {mode & 64 ? (
          <rect x={c - h / 2 - 2} y={c - h / 2 - 2} width={h + 4} height={h + 4} />
        ) : null}
      </g>
    </svg>
  );
}

/** The style's name for assistive technology, as PDMODE's help describes the value. */
function modeName(mode: number): string {
  const figure = ['Dot', 'Nothing', 'Plus', 'Cross', 'Tick'][mode & 7]!;
  const ring = mode & 96;
  const around =
    ring === 32
      ? ' in a circle'
      : ring === 64
        ? ' in a square'
        : ring === 96
          ? ' in a circle and square'
          : '';
  return `${figure}${around} (PDMODE ${mode})`;
}

export function PointStyleDialog({ doc, request }: { doc: number; request: Request }) {
  const [mode, setMode] = useState(POINT_MODES.includes(request.mode) ? request.mode : 0);
  const [relative, setRelative] = useState(request.size <= 0);
  const shown = request.size === 0 ? DEFAULT_PERCENT : Math.abs(request.size);
  const [text, setText] = useState(shown.toFixed(4));
  const value = Number(text.trim());
  const valid = text.trim() !== '' && Number.isFinite(value) && value > 0;
  const ok = () => {
    if (!valid) return;
    // OK with 5% kept on a drawing at PDSIZE 0 keeps 0, which AutoCAD sizes the same.
    const size =
      relative && request.size === 0 && value === DEFAULT_PERCENT ? 0 : relative ? -value : value;
    void answer(doc, { kind: 'dialog', action: 'ok', pointStyle: { mode, size } });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  return (
    <Modal label="Point Style" className="point-style-dialog" onOk={ok} onCancel={cancel}>
      <div className="point-style-grid" role="radiogroup" aria-label="Point style">
        {POINT_MODES.map((m) => (
          <label key={m} className="point-style-tile" title={modeName(m)}>
            <input
              type="radio"
              name="pdmode"
              aria-label={modeName(m)}
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            <PointFigure mode={m} />
          </label>
        ))}
      </div>
      <label className="point-style-size">
        Point Size:
        <input
          type="text"
          inputMode="decimal"
          value={text}
          aria-invalid={!valid}
          onChange={(e) => setText(e.target.value)}
        />
        <span>{relative ? '%' : 'Units'}</span>
      </label>
      {!valid && (
        <p role="alert" className="point-style-error">
          Point Size must be a number above zero.
        </p>
      )}
      <fieldset className="point-style-relative">
        <label>
          <input type="radio" name="pdsize" checked={relative} onChange={() => setRelative(true)} />
          Set Size Relative to Screen
        </label>
        <label>
          <input
            type="radio"
            name="pdsize"
            checked={!relative}
            onChange={() => setRelative(false)}
          />
          Set Size in Absolute Units
        </label>
      </fieldset>
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
