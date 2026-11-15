// AutoCAD's Grip Colors dialog (M3-05 part 5; AutoCAD 2024 Help, "Grip Colors Dialog Box",
// opened by the Options dialog's Selection tab "Grip Colors..."): the colours of unselected
// grips (GRIPCOLOR), selected grips (GRIPHOT), the grip the cursor pauses on (GRIPHOVER) and the
// grips' contour (GRIPCONTOUR). Each list holds the seven standard colours, the colour set if it
// is another, and "Select Color...", which opens the Select Color dialog over this one (index
// colours only: the variables are ACIs). OK keeps the four, Cancel leaves them.
import { useId, useState } from 'react';
import { aciRgb, type GripColors } from '@triya/render';
import { Modal } from './AttributeDialogs';
import { SelectColorDialog } from './SelectColorDialog';
import { cssOf } from './select-color';

const STANDARD: readonly [string, number][] = [
  ['Red', 1],
  ['Yellow', 2],
  ['Green', 3],
  ['Cyan', 4],
  ['Blue', 5],
  ['Magenta', 6],
  ['White', 7],
];

/** The lists in the dialog's order, each labelled as AutoCAD labels it. */
const ROWS: readonly [keyof GripColors, string][] = [
  ['unselected', 'Unselected grip color:'],
  ['selected', 'Selected grip color:'],
  ['hover', 'Hover grip color:'],
  ['contour', 'Grip contour color:'],
];

const SELECT_COLOR = 'select-color';

const colorName = (aci: number): string =>
  STANDARD.find(([, i]) => i === aci)?.[0] ?? `Color ${aci}`;

export function GripColorsDialog({
  initial,
  onOk,
  onCancel,
}: {
  initial: GripColors;
  onOk: (colors: GripColors) => void;
  onCancel: () => void;
}) {
  const [colors, setColors] = useState<GripColors>(initial);
  // The list whose "Select Color..." was chosen: the Select Color dialog shows while it is set.
  const [picking, setPicking] = useState<keyof GripColors | undefined>();
  const id = useId();
  return (
    <Modal
      label="Grip Colors"
      className="grip-colors"
      onOk={() => onOk(colors)}
      onCancel={onCancel}
    >
      <div className="grip-colors-rows">
        {ROWS.map(([key, label]) => {
          const value = colors[key];
          return (
            <div key={key} className="cad-dialog-field">
              <label htmlFor={`${id}-${key}`}>{label}</label>
              <span className="grip-colors-choice">
                <span
                  className="grip-colors-swatch"
                  aria-hidden="true"
                  style={{ background: cssOf(aciRgb(value)) }}
                />
                <select
                  id={`${id}-${key}`}
                  value={String(value)}
                  onChange={(e) => {
                    if (e.currentTarget.value === SELECT_COLOR) setPicking(key);
                    else setColors({ ...colors, [key]: Number(e.currentTarget.value) });
                  }}
                >
                  {!STANDARD.some(([, i]) => i === value) && (
                    <option value={String(value)}>{colorName(value)}</option>
                  )}
                  {STANDARD.map(([name, i]) => (
                    <option key={i} value={String(i)}>
                      {name}
                    </option>
                  ))}
                  <option value={SELECT_COLOR}>Select Color...</option>
                </select>
              </span>
            </div>
          );
        })}
      </div>
      {picking && (
        <SelectColorDialog
          initial={{ kind: 'aci', index: colors[picking] }}
          books={[]}
          trueColors={false}
          indexOnly="A grip color takes an index color only."
          onOk={(c) => {
            // ByLayer and ByBlock (0 and 256) are no grip colour: they leave it as it was.
            if (c.kind === 'aci' && c.index >= 1 && c.index <= 255)
              setColors({ ...colors, [picking]: c.index });
            setPicking(undefined);
          }}
          onCancel={() => setPicking(undefined)}
        />
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => onOk(colors)}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
