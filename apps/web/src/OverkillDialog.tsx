// OVERKILL's Delete Duplicate Objects dialog (M3-02 part 6), with AutoCAD 2024's structure and
// labels (AutoCAD Help, "Delete Duplicate Objects Dialog Box"; UI_SPEC.md §7): Object
// Comparison Settings (Tolerance and the properties to ignore) and Options. The two polyline
// sub-options are greyed while Optimize segments within polylines is off, as AutoCAD's are.
// OK runs OVERKILL with these settings; Cancel (or Esc) ends the command.
import type {
  DialogRequest,
  OverkillProperty,
  OverkillSettings,
  PromptAnswer,
} from '@triya/engine';
import { useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'overkill' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const PROPERTIES: readonly [OverkillProperty, string][] = [
  ['color', 'Color'],
  ['layer', 'Layer'],
  ['linetype', 'Linetype'],
  ['ltScale', 'Linetype scale'],
  ['lineweight', 'Lineweight'],
  ['thickness', 'Thickness'],
  ['transparency', 'Transparency'],
  ['plotStyle', 'Plot style'],
  ['material', 'Material'],
];

type Flag =
  | 'optimizePolylines'
  | 'ignoreWidths'
  | 'keepPolylines'
  | 'combinePartial'
  | 'combineEndToEnd'
  | 'keepAssociative';

export function OverkillDialog({ doc, request }: { doc: number; request: Request }) {
  const [s, setS] = useState<OverkillSettings>(request.settings);
  const [tolerance, setTolerance] = useState(String(request.settings.tolerance));
  const tol = Number(tolerance);
  const valid = tolerance.trim() !== '' && Number.isFinite(tol) && tol >= 0;
  const ok = () => {
    if (valid) answer(doc, { kind: 'dialog', action: 'ok', overkill: { ...s, tolerance: tol } });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  const ignored = new Set(s.ignore);
  const flag = (key: Flag, label: string, disabled = false, sub = false) => (
    <label key={key} className={`overkill-check${sub ? ' overkill-sub' : ''}`}>
      <input
        type="checkbox"
        disabled={disabled}
        checked={s[key]}
        onChange={(e) => setS({ ...s, [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  return (
    <Modal label="Delete Duplicate Objects" className="overkill-dialog" onOk={ok} onCancel={cancel}>
      <fieldset>
        <legend>Object Comparison Settings</legend>
        <label className="overkill-tolerance">
          Tolerance:
          <input
            type="text"
            inputMode="decimal"
            value={tolerance}
            aria-invalid={!valid}
            onChange={(e) => setTolerance(e.target.value)}
          />
        </label>
        <fieldset className="overkill-ignore">
          <legend>Ignore object property:</legend>
          {PROPERTIES.map(([key, label]) => (
            <label key={key} className="overkill-check">
              <input
                type="checkbox"
                checked={ignored.has(key)}
                onChange={(e) =>
                  setS({
                    ...s,
                    ignore: PROPERTIES.map(([k]) => k).filter((k) =>
                      k === key ? e.target.checked : ignored.has(k),
                    ),
                  })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
      </fieldset>
      <fieldset className="overkill-options">
        <legend>Options</legend>
        {flag('optimizePolylines', 'Optimize segments within polylines')}
        {flag('ignoreWidths', 'Ignore polyline segment width', !s.optimizePolylines, true)}
        {flag('keepPolylines', 'Do not break polylines', !s.optimizePolylines, true)}
        {flag('combinePartial', 'Combine co-linear objects that partially overlap')}
        {flag('combineEndToEnd', 'Combine co-linear objects when aligned end to end')}
        {flag('keepAssociative', 'Maintain associative objects')}
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
