// SELECTSIMILAR's Select Similar Settings dialog (M3-04 part 3), with AutoCAD 2024's structure
// and labels (AutoCAD Help, "Select Similar Settings Dialog Box"; UI_SPEC.md §7): the
// properties that must match for an object of the same type to be selected, a checkbox each
// under "Similar Based On", Select All and Clear All, then OK and Cancel. OK sets
// SELECTSIMILARMODE's bits; Cancel (or Esc) goes back to "Select objects" with them as they were.
import { SIMILAR_BITS, type DialogRequest, type PromptAnswer } from '@triya/engine';
import { useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'selectsimilar' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const BOXES: readonly [number, string][] = [
  [SIMILAR_BITS.color, 'Color'],
  [SIMILAR_BITS.layer, 'Layer'],
  [SIMILAR_BITS.linetype, 'Linetype'],
  [SIMILAR_BITS.linetypeScale, 'Linetype scale'],
  [SIMILAR_BITS.lineweight, 'Lineweight'],
  [SIMILAR_BITS.plotStyle, 'Plot style'],
  [SIMILAR_BITS.objectStyle, 'Object style'],
  [SIMILAR_BITS.name, 'Name'],
];
const ALL = BOXES.reduce((m, [bit]) => m | bit, 0);

export function SelectSimilarDialog({ doc, request }: { doc: number; request: Request }) {
  const [mode, setMode] = useState(request.mode);
  const ok = () => answer(doc, { kind: 'dialog', action: 'ok', selectSimilar: mode });
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  return (
    <Modal label="Select Similar Settings" className="matchprop-dialog" onOk={ok} onCancel={cancel}>
      <fieldset>
        <legend>Similar Based On</legend>
        {BOXES.map(([bit, label]) => (
          <label key={label} className="matchprop-check">
            <input
              type="checkbox"
              checked={(mode & bit) !== 0}
              onChange={(e) => setMode(e.target.checked ? mode | bit : mode & ~bit)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => setMode(mode | ALL)}>
          Select All
        </button>
        <button type="button" onClick={() => setMode(mode & ~ALL)}>
          Clear All
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
