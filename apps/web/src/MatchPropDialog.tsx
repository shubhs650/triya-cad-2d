// MATCHPROP's Property Settings dialog (M3-02 part 5), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Property Settings Dialog Box"; UI_SPEC.md §7): Basic Properties and Special
// Properties, a checkbox each, OK, Cancel and the checkboxes all on or off. Plot Style is greyed
// in a colour-dependent drawing. Center object is shown greyed: MATCHPROP does not copy it yet
// (M4-08's center marks); Viewport is copied (M3-16), Table (M4-05 part 5). Cancel (or Esc) goes back to "Select destination object(s)" with the
// settings as they were, as AutoCAD's does.
import type { DialogRequest, MatchSettings, PromptAnswer } from '@triya/engine';
import { useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'matchprop' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const BASIC: readonly [keyof MatchSettings, string][] = [
  ['color', 'Color'],
  ['layer', 'Layer'],
  ['linetype', 'Linetype'],
  ['ltScale', 'Linetype Scale'],
  ['lineweight', 'Lineweight'],
  ['transparency', 'Transparency'],
  ['thickness', 'Thickness'],
  ['plotStyle', 'Plot Style'],
];

const SPECIAL: readonly [keyof MatchSettings | undefined, string][] = [
  ['dimension', 'Dimension'],
  ['polyline', 'Polyline'],
  ['material', 'Material'],
  ['text', 'Text'],
  ['viewport', 'Viewport'],
  ['multileader', 'Multileader'],
  ['hatch', 'Hatch'],
  ['table', 'Table'],
  [undefined, 'Center object'],
];

export function MatchPropDialog({ doc, request }: { doc: number; request: Request }) {
  const [s, setS] = useState<MatchSettings>(request.settings);
  const ok = () => answer(doc, { kind: 'dialog', action: 'ok', matchprop: s });
  // The prompt takes Esc as an answer: back to "Select destination object(s)".
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  const box = (key: keyof MatchSettings | undefined, label: string) => {
    const off = key === undefined || (key === 'plotStyle' && !request.plotStyles);
    return (
      <label key={label} className="matchprop-check">
        <input
          type="checkbox"
          disabled={off}
          checked={key !== undefined && !off && s[key]}
          onChange={(e) => key && setS({ ...s, [key]: e.target.checked })}
        />
        {label}
      </label>
    );
  };
  return (
    <Modal label="Property Settings" className="matchprop-dialog" onOk={ok} onCancel={cancel}>
      <fieldset>
        <legend>Basic Properties</legend>
        {BASIC.map(([k, l]) => box(k, l))}
      </fieldset>
      <fieldset>
        <legend>Special Properties</legend>
        {SPECIAL.map(([k, l]) => box(k, l))}
      </fieldset>
      <div className="cad-dialog-buttons">
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
