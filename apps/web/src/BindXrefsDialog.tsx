// The Bind Xrefs dialog (M5-04 part 2): what the External References palette's Bind opens, with
// AutoCAD 2024's labels ("Bind Xrefs/DGN Underlays Dialog Box"; Triya attaches no DGN): Bind Type
// Bind, which renames the xref's named objects `xref$n$name`, or Insert, which strips the xref's
// name and uses the drawing's own definitions where names repeat. Enter is OK, Esc Cancel.
import { useState } from 'react';
import { Modal } from './AttributeDialogs';

export function BindXrefsDialog({
  names,
  onOk,
  onCancel,
}: {
  /** The xrefs being bound, as the palette lists them. */
  names: readonly string[];
  /** OK: `insert` for Insert. */
  onOk: (insert: boolean) => void;
  onCancel: () => void;
}) {
  const [insert, setInsert] = useState(false);
  const ok = () => onOk(insert);
  return (
    <Modal label="Bind Xrefs" className="bind-xrefs" onOk={ok} onCancel={onCancel}>
      <p className="bind-xrefs-names">{names.join(', ')}</p>
      <fieldset className="block-definition-group">
        <legend>Bind Type</legend>
        <div role="radiogroup" aria-label="Bind Type" className="block-definition-choices">
          {(
            [
              [false, 'Bind'],
              [true, 'Insert'],
            ] as const
          ).map(([value, label]) => (
            <label key={label} className="matchprop-check">
              <input
                type="radio"
                name="bind-type"
                checked={insert === value}
                autoFocus={insert === value}
                onChange={() => setInsert(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
