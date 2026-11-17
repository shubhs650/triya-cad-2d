// TINSERT's Insert a Block in a Table Cell dialog (M4-16), with AutoCAD 2024's structure and
// labels (AutoCAD Help, "Insert a Block in a Table Cell Dialog Box"; UI_SPEC.md §7): Name, then
// Properties: Scale with AutoFit beside it (Scale greyed while AutoFit is checked), Rotation
// angle (degrees) and Overall cell alignment. OK sends the fields; the engine puts the block in
// the cell. Left out: Browse... and Path (a drawing file inserted as a block waits for INSERT)
// and Help, as Triya's other dialogs leave it.
import type { DialogRequest, PromptAnswer, TableBlockSettings } from '@triya/engine';
import { useId, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'tinsert' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const DEG = Math.PI / 180;
const degrees = (radians: number) => String(Number((radians / DEG).toFixed(6)));

/** AutoCAD's alignment names, 1 top left … 9 bottom right. */
const ALIGNMENTS = [
  'Top Left',
  'Top Center',
  'Top Right',
  'Middle Left',
  'Middle Center',
  'Middle Right',
  'Bottom Left',
  'Bottom Center',
  'Bottom Right',
] as const;

/** A finite number, or undefined. */
const numberOf = (t: string): number | undefined => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

export function InsertCellBlockDialog({ doc, request }: { doc: number; request: Request }) {
  const s = request.settings;
  const [block, setBlock] = useState(s.block ?? request.blocks[0]?.handle ?? '');
  const [scale, setScale] = useState(String(Number(s.scale.toFixed(6))));
  const [autoFit, setAutoFit] = useState(s.autoFit);
  const [rotation, setRotation] = useState(degrees(s.rotation));
  const [alignment, setAlignment] = useState(s.alignment);
  const ids = { name: useId(), scale: useId(), rotation: useId(), alignment: useId() };

  const k = numberOf(scale);
  const turn = numberOf(rotation);
  const scaleValid = autoFit || (k !== undefined && k > 0);
  const valid = block !== '' && scaleValid && turn !== undefined;
  const ok = () => {
    if (!valid) return;
    const settings: TableBlockSettings = {
      block,
      scale: k !== undefined && k > 0 ? k : s.scale,
      autoFit,
      rotation: turn! * DEG,
      alignment,
    };
    answer(doc, { kind: 'dialog', action: 'ok', tableBlock: settings });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });

  return (
    <Modal
      label="Insert a Block in a Table Cell"
      className="cell-block-dialog"
      onOk={ok}
      onCancel={cancel}
    >
      <label className="cad-dialog-field" htmlFor={ids.name}>
        <span>Name:</span>
        <select id={ids.name} value={block} onChange={(e) => setBlock(e.currentTarget.value)}>
          {request.blocks.map((b) => (
            <option key={b.handle} value={b.handle}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="cell-block-group">
        <legend>Properties</legend>
        <div className="cell-block-row">
          <label className="cad-dialog-field" htmlFor={ids.scale}>
            <span>Scale:</span>
            <input
              id={ids.scale}
              type="text"
              inputMode="decimal"
              value={scale}
              disabled={autoFit}
              aria-invalid={!scaleValid}
              onChange={(e) => setScale(e.currentTarget.value)}
            />
          </label>
          <label className="matchprop-check">
            <input
              type="checkbox"
              checked={autoFit}
              onChange={(e) => setAutoFit(e.currentTarget.checked)}
            />
            AutoFit
          </label>
        </div>
        <label className="cad-dialog-field" htmlFor={ids.rotation}>
          <span>Rotation angle:</span>
          <input
            id={ids.rotation}
            type="text"
            inputMode="decimal"
            value={rotation}
            aria-invalid={turn === undefined}
            onChange={(e) => setRotation(e.currentTarget.value)}
          />
        </label>
        <label className="cad-dialog-field" htmlFor={ids.alignment}>
          <span>Overall cell alignment:</span>
          <select
            id={ids.alignment}
            value={alignment}
            onChange={(e) => setAlignment(Number(e.currentTarget.value))}
          >
            {ALIGNMENTS.map((name, k2) => (
              <option key={name} value={k2 + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {!valid && (
        <p role="alert" className="cell-block-error">
          The scale is a number above zero and the rotation angle a number of degrees.
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
