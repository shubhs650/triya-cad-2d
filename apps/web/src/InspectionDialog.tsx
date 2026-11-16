// DIMINSPECT's Inspection Dimension dialog (M4-02 part 4), with AutoCAD 2024's structure and
// labels (AutoCAD Help, "Inspection Dimension Dialog Box"; UI_SPEC.md §7): Select dimensions and
// Remove Inspection, the Shape (Round, Angular, None), and Label/Inspection Rate, each a check
// box and its value. OK gives the selected dimensions the settings; Remove Inspection takes them
// off; Esc is Cancel. AutoCAD's Help button is left out, as Triya's other dialogs leave it.
import type { DialogRequest, InspectionSettings, PromptAnswer } from '@triya/engine';
import { useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'diminspect' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const SHAPES: readonly [InspectionSettings['shape'], string][] = [
  ['round', 'Round'],
  ['angular', 'Angular'],
  ['none', 'None'],
];

export function InspectionDialog({ doc, request }: { doc: number; request: Request }) {
  const s = request.settings;
  const [shape, setShape] = useState(s.shape);
  const [labelOn, setLabelOn] = useState(s.label !== undefined);
  const [label, setLabel] = useState(s.label ?? '');
  const [rateOn, setRateOn] = useState(s.rate !== undefined);
  const [rate, setRate] = useState(s.rate ?? '100%');
  const settings = (): InspectionSettings => ({
    shape,
    ...(labelOn && { label }),
    ...(rateOn && { rate }),
  });
  const none = request.selected === 0;
  const ok = () => {
    if (none) return;
    void answer(doc, { kind: 'dialog', action: 'ok', inspection: settings() });
  };
  const select = () =>
    void answer(doc, { kind: 'dialog', action: 'select', inspection: settings() });
  const remove = () => void answer(doc, { kind: 'dialog', action: 'remove' });
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  return (
    <Modal label="Inspection Dimension" className="inspection-dialog" onOk={ok} onCancel={cancel}>
      <div className="inspection-select">
        <button type="button" onClick={select}>
          Select dimensions
        </button>
        <span role="status">
          {none
            ? 'No dimensions selected'
            : `${request.selected} dimension${request.selected === 1 ? '' : 's'} selected`}
        </span>
        <button type="button" onClick={remove} disabled={none}>
          Remove Inspection
        </button>
      </div>
      <fieldset className="inspection-shape">
        <legend>Shape</legend>
        {SHAPES.map(([value, name]) => (
          <label key={value}>
            <input
              type="radio"
              name="inspection-shape"
              checked={shape === value}
              onChange={() => setShape(value)}
            />
            {name}
          </label>
        ))}
      </fieldset>
      <fieldset className="inspection-fields">
        <legend>Label/Inspection rate</legend>
        <label>
          <input type="checkbox" checked={labelOn} onChange={(e) => setLabelOn(e.target.checked)} />
          Label
        </label>
        <input
          type="text"
          aria-label="Label value"
          value={label}
          disabled={!labelOn}
          onChange={(e) => setLabel(e.target.value)}
        />
        <label>
          <input type="checkbox" checked={rateOn} onChange={(e) => setRateOn(e.target.checked)} />
          Inspection rate
        </label>
        <input
          type="text"
          aria-label="Inspection rate value"
          value={rate}
          disabled={!rateOn}
          onChange={(e) => setRate(e.target.value)}
        />
      </fieldset>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={none}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
