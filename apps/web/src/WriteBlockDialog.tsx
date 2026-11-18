// WBLOCK's Write Block dialog (M5-01 part 4), with AutoCAD 2024's structure and labels (AutoCAD
// Help, "Write Block Dialog Box"; UI_SPEC.md §7): Source (Block with the drawing's blocks, Entire
// drawing, Objects); Base point (Pick point, X, Y); Objects (Select objects, Retain / Convert to
// block / Delete from drawing, how many are selected); Destination (File name and path, Insert
// units); OK and Cancel. Base point and Objects apply to Objects only, greyed otherwise, as
// AutoCAD greys them. Picking a block names the file after it. Pick point and Select objects hand
// the dialog's fields to the engine, which closes it for the pick and opens it again
// (commands/wblock.ts); OK writes the file, which the browser downloads (DXF, DEC-047).
//
// Left out: Z (Triya draws the plan), Quick Select (QSELECT is its own command), the file
// browser's [...] (the browser picks where the download goes), and Help.
import {
  INSUNITS_NAMES,
  type DialogRequest,
  type PromptAnswer,
  type WriteBlockSettings,
  type WriteBlockSource,
} from '@triya/engine';
import { useId, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'wblock' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** A coordinate as its field shows it. */
const shown = (v: number) => String(Number(v.toFixed(6)));

/** A finite number, or undefined. */
const numberOf = (t: string): number | undefined => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

const SOURCES: readonly (readonly [WriteBlockSource, string])[] = [
  ['block', 'Block'],
  ['drawing', 'Entire drawing'],
  ['objects', 'Objects'],
];

export function WriteBlockDialog({ doc, request }: { doc: number; request: Request }) {
  const s = request.settings;
  const [source, setSource] = useState(s.source);
  const [block, setBlock] = useState(s.block);
  const [x, setX] = useState(shown(s.base.x));
  const [y, setY] = useState(shown(s.base.y));
  const [objects, setObjects] = useState(s.objects);
  const [file, setFile] = useState(s.file);
  const [units, setUnits] = useState(s.units);
  const ids = { block: useId(), x: useId(), y: useId(), file: useId(), units: useId() };

  const onObjects = source === 'objects';
  const bx = numberOf(x);
  const by = numberOf(y);
  const valid =
    file.trim() !== '' &&
    (!onObjects || (bx !== undefined && by !== undefined)) &&
    (source !== 'block' || block !== '');

  const settings = (): WriteBlockSettings => ({
    source,
    block,
    base: { x: bx ?? s.base.x, y: by ?? s.base.y },
    objects,
    file,
    units,
  });
  const pick = (what: 'point' | 'objects') =>
    answer(doc, { kind: 'dialog', action: 'select', wblock: { settings: settings(), pick: what } });
  const ok = () => {
    if (valid) answer(doc, { kind: 'dialog', action: 'ok', wblock: { settings: settings() } });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  /** Block's list: the file named after the block picked, as AutoCAD names it. */
  const pickBlock = (name: string) => {
    setBlock(name);
    setFile(`${name}.dxf`);
  };

  return (
    <Modal label="Write Block" className="block-definition-dialog" onOk={ok} onCancel={cancel}>
      <fieldset className="block-definition-group">
        <legend>Source</legend>
        <div role="radiogroup" aria-label="Source" className="write-block-sources">
          {SOURCES.map(([value, label]) => (
            <label key={value} className="matchprop-check">
              <input
                type="radio"
                name="write-block-source"
                checked={source === value}
                disabled={value === 'block' && request.blocks.length === 0}
                onChange={() => {
                  setSource(value);
                  if (value === 'block' && block !== '') setFile(`${block}.dxf`);
                }}
              />
              {label}
            </label>
          ))}
          <select
            id={ids.block}
            aria-label="Block"
            value={block}
            disabled={source !== 'block'}
            onChange={(e) => pickBlock(e.currentTarget.value)}
          >
            {request.blocks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <div className="block-definition-groups">
        <fieldset className="block-definition-group" disabled={!onObjects}>
          <legend>Base point</legend>
          <button type="button" onClick={() => pick('point')}>
            Pick point
          </button>
          <label className="cad-dialog-field" htmlFor={ids.x}>
            <span>X:</span>
            <input
              id={ids.x}
              type="text"
              inputMode="decimal"
              value={x}
              aria-invalid={onObjects && bx === undefined}
              onChange={(e) => setX(e.currentTarget.value)}
            />
          </label>
          <label className="cad-dialog-field" htmlFor={ids.y}>
            <span>Y:</span>
            <input
              id={ids.y}
              type="text"
              inputMode="decimal"
              value={y}
              aria-invalid={onObjects && by === undefined}
              onChange={(e) => setY(e.currentTarget.value)}
            />
          </label>
        </fieldset>
        <fieldset className="block-definition-group" disabled={!onObjects}>
          <legend>Objects</legend>
          <button type="button" onClick={() => pick('objects')}>
            Select objects
          </button>
          <div role="radiogroup" aria-label="Objects" className="block-definition-choices">
            {(
              [
                ['retain', 'Retain'],
                ['convert', 'Convert to block'],
                ['delete', 'Delete from drawing'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="matchprop-check">
                <input
                  type="radio"
                  name="write-block-objects"
                  checked={objects === value}
                  onChange={() => setObjects(value)}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="block-definition-count" data-testid="write-block-count">
            {request.selected === 0
              ? 'No objects selected'
              : `${request.selected} object${request.selected === 1 ? '' : 's'} selected`}
          </p>
        </fieldset>
      </div>
      <fieldset className="block-definition-group">
        <legend>Destination</legend>
        <label className="cad-dialog-field" htmlFor={ids.file}>
          <span>File name and path:</span>
          <input
            id={ids.file}
            type="text"
            value={file}
            autoComplete="off"
            aria-invalid={file.trim() === ''}
            onChange={(e) => setFile(e.currentTarget.value)}
          />
        </label>
        <label className="cad-dialog-field" htmlFor={ids.units}>
          <span>Insert units:</span>
          <select
            id={ids.units}
            value={units}
            onChange={(e) => setUnits(Number(e.currentTarget.value))}
          >
            {INSUNITS_NAMES.map((label, value) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {request.note !== undefined && (
        <p role="alert" className="cell-block-error">
          {request.note}
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
