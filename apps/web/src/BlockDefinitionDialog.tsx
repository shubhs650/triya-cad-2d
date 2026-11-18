// BLOCK's Block Definition dialog (M5-01 part 2), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Block Definition Dialog Box"; UI_SPEC.md §7): Name (a list of the drawing's
// blocks that also takes a new name); Base point (Specify On-screen, Pick point, X, Y); Objects
// (Specify On-screen, Select objects, Retain / Convert to block / Delete, how many are selected);
// Behavior (Scale uniformly, Allow exploding); Settings (Block unit); Description; OK and Cancel.
// Picking a block in the Name list shows its Behavior, Block unit and Description. OK asks, as
// AutoCAD's task dialogs do, before redefining a block of the name and before making a block of
// nothing; the engine makes the block (commands/blocks.ts). Pick point and Select objects hand
// the dialog's fields to the engine, which closes it for the pick and opens it again.
//
// M5-02 part 2: "Open in block editor" (bottom left, as AutoCAD has it) shows the block made in
// the Block Editor; it is not offered while the editor is open.
//
// Left out (commands/blocks.ts says why): Z, Quick Select, Annotative and Hyperlink; Help, as
// Triya's other dialogs leave it.
import {
  INSUNITS_NAMES,
  type BlockDefinitionSettings,
  type DialogRequest,
  type PromptAnswer,
} from '@triya/engine';
import { useId, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'block' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** A coordinate as its field shows it. */
const shown = (v: number) => String(Number(v.toFixed(6)));

/** A finite number, or undefined. */
const numberOf = (t: string): number | undefined => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

/** What OK is waiting on: the dialog's own question before the block is made. */
type Asking = 'empty' | 'redefine' | undefined;

export function BlockDefinitionDialog({ doc, request }: { doc: number; request: Request }) {
  const s = request.settings;
  const [name, setName] = useState(s.name);
  const [x, setX] = useState(shown(s.base.x));
  const [y, setY] = useState(shown(s.base.y));
  const [baseOnScreen, setBaseOnScreen] = useState(s.baseOnScreen);
  const [objectsOnScreen, setObjectsOnScreen] = useState(s.objectsOnScreen);
  const [objects, setObjects] = useState(s.objects);
  const [scaleUniformly, setScaleUniformly] = useState(s.scaleUniformly);
  const [allowExploding, setAllowExploding] = useState(s.allowExploding);
  const [units, setUnits] = useState(s.units);
  const [description, setDescription] = useState(s.description);
  const [openInEditor, setOpenInEditor] = useState(s.openInEditor === true);
  const [asking, setAsking] = useState<Asking>(undefined);
  const ids = {
    name: useId(),
    names: useId(),
    x: useId(),
    y: useId(),
    units: useId(),
    description: useId(),
  };

  const bx = numberOf(x);
  const by = numberOf(y);
  const baseValid = baseOnScreen || (bx !== undefined && by !== undefined);
  const existing = request.blocks.find(
    (b) => b.name.toUpperCase() === name.trim().toUpperCase() && name.trim() !== '',
  );

  /** A new name: a block's own shows that block's settings, as AutoCAD's list does. */
  const rename = (next: string) => {
    setName(next);
    const b = request.blocks.find((e) => e.name.toUpperCase() === next.trim().toUpperCase());
    if (!b) return;
    setScaleUniformly(b.scaleUniformly);
    setAllowExploding(b.allowExploding);
    setUnits(b.units);
    setDescription(b.description);
  };

  const settings = (): BlockDefinitionSettings => ({
    name,
    base: { x: bx ?? s.base.x, y: by ?? s.base.y },
    baseOnScreen,
    objectsOnScreen,
    objects,
    scaleUniformly,
    allowExploding,
    units,
    description,
    ...(openInEditor && !request.editing && { openInEditor: true }),
  });
  const pick = (what: 'point' | 'objects') =>
    answer(doc, { kind: 'dialog', action: 'select', block: { settings: settings(), pick: what } });
  const send = () => answer(doc, { kind: 'dialog', action: 'ok', block: { settings: settings() } });
  /** OK: the questions AutoCAD asks first, then the block. */
  const ok = (after: Asking = undefined) => {
    if (!baseValid) return;
    if (after === undefined && !objectsOnScreen && request.selected === 0) {
      setAsking('empty');
      return;
    }
    if (after !== 'redefine' && existing) {
      setAsking('redefine');
      return;
    }
    send();
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });

  return (
    <Modal label="Block Definition" className="block-definition-dialog" onOk={ok} onCancel={cancel}>
      <label className="cad-dialog-field block-definition-name" htmlFor={ids.name}>
        <span>Name:</span>
        <input
          id={ids.name}
          type="text"
          list={ids.names}
          value={name}
          autoComplete="off"
          onChange={(e) => rename(e.currentTarget.value)}
        />
        <datalist id={ids.names}>
          {request.blocks.map((b) => (
            <option key={b.name} value={b.name} />
          ))}
        </datalist>
      </label>
      <div className="block-definition-groups">
        <fieldset className="block-definition-group">
          <legend>Base point</legend>
          <label className="matchprop-check">
            <input
              type="checkbox"
              checked={baseOnScreen}
              onChange={(e) => setBaseOnScreen(e.currentTarget.checked)}
            />
            Specify On-screen
          </label>
          <button type="button" disabled={baseOnScreen} onClick={() => pick('point')}>
            Pick point
          </button>
          <label className="cad-dialog-field" htmlFor={ids.x}>
            <span>X:</span>
            <input
              id={ids.x}
              type="text"
              inputMode="decimal"
              value={x}
              disabled={baseOnScreen}
              aria-invalid={!baseOnScreen && bx === undefined}
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
              disabled={baseOnScreen}
              aria-invalid={!baseOnScreen && by === undefined}
              onChange={(e) => setY(e.currentTarget.value)}
            />
          </label>
        </fieldset>
        <fieldset className="block-definition-group">
          <legend>Objects</legend>
          <label className="matchprop-check">
            <input
              type="checkbox"
              checked={objectsOnScreen}
              onChange={(e) => setObjectsOnScreen(e.currentTarget.checked)}
            />
            Specify On-screen
          </label>
          <button type="button" disabled={objectsOnScreen} onClick={() => pick('objects')}>
            Select objects
          </button>
          <div role="radiogroup" aria-label="Objects" className="block-definition-choices">
            {(
              [
                ['retain', 'Retain'],
                ['convert', 'Convert to block'],
                ['delete', 'Delete'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="matchprop-check">
                <input
                  type="radio"
                  name="block-definition-objects"
                  checked={objects === value}
                  onChange={() => setObjects(value)}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="block-definition-count" data-testid="block-definition-count">
            {request.selected === 0
              ? 'No objects selected'
              : `${request.selected} object${request.selected === 1 ? '' : 's'} selected`}
          </p>
        </fieldset>
        <fieldset className="block-definition-group">
          <legend>Behavior</legend>
          <label className="matchprop-check">
            <input
              type="checkbox"
              checked={scaleUniformly}
              onChange={(e) => setScaleUniformly(e.currentTarget.checked)}
            />
            Scale uniformly
          </label>
          <label className="matchprop-check">
            <input
              type="checkbox"
              checked={allowExploding}
              onChange={(e) => setAllowExploding(e.currentTarget.checked)}
            />
            Allow exploding
          </label>
        </fieldset>
      </div>
      <div className="block-definition-groups">
        <fieldset className="block-definition-group">
          <legend>Settings</legend>
          <label className="cad-dialog-field" htmlFor={ids.units}>
            <span>Block unit:</span>
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
        <fieldset className="block-definition-group block-definition-description">
          <legend>Description</legend>
          <textarea
            id={ids.description}
            aria-label="Description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
        </fieldset>
      </div>
      {request.note !== undefined && (
        <p role="alert" className="cell-block-error">
          {request.note}
        </p>
      )}
      {!baseValid && (
        <p role="alert" className="cell-block-error">
          X and Y are numbers.
        </p>
      )}
      <div className="cad-dialog-buttons block-definition-buttons">
        {!request.editing && (
          <label className="matchprop-check block-definition-open">
            <input
              type="checkbox"
              checked={openInEditor}
              onChange={(e) => setOpenInEditor(e.currentTarget.checked)}
            />
            Open in block editor
          </label>
        )}
        <button type="button" onClick={() => ok()} disabled={!baseValid}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
      {asking === 'empty' && (
        <Modal
          label="Block - Empty Block"
          className="block-definition-ask"
          onOk={() => {
            setAsking(undefined);
            ok('empty');
          }}
          onCancel={() => setAsking(undefined)}
        >
          <p>
            No objects are selected for the block. Do you want to make a block with nothing in it?
          </p>
          <div className="cad-dialog-buttons">
            <button
              type="button"
              onClick={() => {
                setAsking(undefined);
                ok('empty');
              }}
            >
              Make an empty block
            </button>
            <button type="button" onClick={() => setAsking(undefined)}>
              Return to the dialog
            </button>
          </div>
        </Modal>
      )}
      {asking === 'redefine' && existing && (
        <Modal
          label="Block - Redefine Block"
          className="block-definition-ask"
          onOk={() => {
            setAsking(undefined);
            ok('redefine');
          }}
          onCancel={() => setAsking(undefined)}
        >
          <p>
            &ldquo;{existing.name}&rdquo; is already defined. Do you want to redefine it? Every
            reference to it will show the new definition.
          </p>
          <div className="cad-dialog-buttons">
            <button
              type="button"
              onClick={() => {
                setAsking(undefined);
                ok('redefine');
              }}
            >
              Redefine block
            </button>
            <button type="button" onClick={() => setAsking(undefined)}>
              Do not redefine
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
