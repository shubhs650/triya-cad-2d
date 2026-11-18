// ATTDEF's Attribute Definition dialog (M5-03 part 1), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Attribute Definition Dialog Box"; UI_SPEC.md §7): Mode (Invisible, Constant,
// Verify, Preset, Lock position, Multiple lines); Attribute (Tag, Prompt, Default, a multiline
// default's `...` opening the In-Place Text Editor); Insertion Point (Specify on-screen, X, Y);
// Text Settings (Justification, Text style, Annotative, Text height, Rotation, Boundary width,
// each length or angle with its button to pick it on screen); Align below previous attribute
// definition; OK and Cancel. As AutoCAD's dialog does, Constant greys Prompt, Verify and Preset;
// Multiple lines enables Boundary width and drops Align and Fit; a fixed-height style greys Text
// height (showing the style's), Align greys it and Rotation, Fit greys Rotation; Align below
// greys Insertion Point and Text Settings. The engine checks the fields and makes the
// definition (commands/attdef.ts), reopening the dialog with a note when it refuses them.
//
// Left out (commands/attdef.ts says why): Z, Annotative (shown greyed, DEC-058), the Default's
// Insert Field button, and Help, as Triya's other dialogs leave it.
import type { AttdefSettings, DialogRequest, PromptAnswer } from '@triya/engine';
import { useId, useState } from 'react';
import { Modal, shownValue, storedValue } from './AttributeDialogs';
import { NumberField, OnScreen, numberOf, shown } from './ImageAttachDialog';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'attdefine' }>;
type Pick = 'height' | 'rotation' | 'width' | 'value';

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** TEXT's justifications as the dialog's Justification list names them. */
const JUSTIFICATIONS: readonly (readonly [string, string])[] = [
  ['Left', 'Left'],
  ['Center', 'Center'],
  ['Right', 'Right'],
  ['Align', 'Align'],
  ['Middle', 'Middle'],
  ['Fit', 'Fit'],
  ['TL', 'Top left'],
  ['TC', 'Top center'],
  ['TR', 'Top right'],
  ['ML', 'Middle left'],
  ['MC', 'Middle center'],
  ['MR', 'Middle right'],
  ['BL', 'Bottom left'],
  ['BC', 'Bottom center'],
  ['BR', 'Bottom right'],
];

const MODES = [
  ['invisible', 'Invisible'],
  ['constant', 'Constant'],
  ['verify', 'Verify'],
  ['preset', 'Preset'],
  ['lockPosition', 'Lock position'],
  ['multiline', 'Multiple lines'],
] as const;
type ModeKey = (typeof MODES)[number][0];

const degrees = (r: number) => shown((r * 180) / Math.PI);

export function AttdefDialog({ doc, request }: { doc: number; request: Request }) {
  const s = request.settings;
  const [modes, setModes] = useState<Record<ModeKey, boolean>>({
    invisible: s.invisible,
    constant: s.constant,
    verify: s.verify,
    preset: s.preset,
    lockPosition: s.lockPosition,
    multiline: s.multiline,
  });
  const [tag, setTag] = useState(s.tag);
  const [promptText, setPrompt] = useState(s.prompt);
  const [value, setValue] = useState(s.value);
  const [pointOnScreen, setPointOnScreen] = useState(s.pointOnScreen);
  const [x, setX] = useState(shown(s.point.x));
  const [y, setY] = useState(shown(s.point.y));
  const [justify, setJustify] = useState(s.justify);
  const [style, setStyle] = useState(s.style);
  const [height, setHeight] = useState(shown(s.height));
  const [rotation, setRotation] = useState(degrees(s.rotation));
  const [width, setWidth] = useState(shown(s.width));
  const [alignBelow, setAlignBelow] = useState(s.alignBelow && request.canAlignBelow);
  const ids = { tag: useId(), prompt: useId(), value: useId(), justify: useId(), style: useId() };

  const multiline = modes.multiline;
  const fixed = request.styles.find((e) => e.name === style && e.height > 0);
  const twoPoints = justify === 'Align' || justify === 'Fit';
  const choices = multiline
    ? JUSTIFICATIONS.filter(([j]) => j !== 'Align' && j !== 'Fit')
    : JUSTIFICATIONS;
  const textOff = alignBelow;
  const heightOff = textOff || fixed !== undefined || justify === 'Align';
  const rotationOff = textOff || twoPoints;
  const widthOff = textOff || !multiline;
  const pointOff = alignBelow || pointOnScreen || twoPoints;

  const numbers = {
    x: numberOf(x),
    y: numberOf(y),
    height: numberOf(height),
    rotation: numberOf(rotation),
    width: numberOf(width),
  };
  const valid =
    (pointOff || (numbers.x !== undefined && numbers.y !== undefined)) &&
    (heightOff || (numbers.height !== undefined && numbers.height > 0)) &&
    (rotationOff || numbers.rotation !== undefined) &&
    (widthOff || (numbers.width !== undefined && numbers.width >= 0));

  const toggle = (key: ModeKey, on: boolean) => {
    setModes((m) => ({ ...m, [key]: on }));
    // Align and Fit have no MTEXT attachment: a multiline attribute starts Left.
    if (key === 'multiline' && on && (justify === 'Align' || justify === 'Fit')) setJustify('Left');
  };

  const settings = (): AttdefSettings => ({
    ...modes,
    tag,
    prompt: promptText,
    value,
    pointOnScreen,
    point: { x: numbers.x ?? s.point.x, y: numbers.y ?? s.point.y },
    justify,
    style,
    height: fixed ? fixed.height : (numbers.height ?? s.height),
    rotation: numbers.rotation === undefined ? s.rotation : (numbers.rotation * Math.PI) / 180,
    width: numbers.width ?? s.width,
    alignBelow,
  });
  const pick = (what: Pick) =>
    answer(doc, {
      kind: 'dialog',
      action: 'select',
      attdefine: { settings: settings(), pick: what },
    });
  const ok = () => {
    if (valid) answer(doc, { kind: 'dialog', action: 'ok', attdefine: { settings: settings() } });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });

  /** A length or angle field with its button to pick it on screen. */
  const picked = (
    label: string,
    what: Exclude<Pick, 'value'>,
    v: string,
    set: (v: string) => void,
    off: boolean,
  ) => (
    <div className="attdef-picked">
      <NumberField label={label} value={v} onChange={set} disabled={off} />
      <button
        type="button"
        aria-label={`Pick ${label.replace(/:$/, '').toLowerCase()}`}
        title={`Specify ${label.replace(/:$/, '').toLowerCase()} on-screen`}
        disabled={off}
        onClick={() => pick(what)}
      >
        Pick
      </button>
    </div>
  );

  return (
    <Modal label="Attribute Definition" className="attdef-define" onOk={ok} onCancel={cancel}>
      <div className="attdef-columns">
        <div className="attdef-column">
          <fieldset className="block-definition-group">
            <legend>Mode</legend>
            {MODES.map(([key, label]) => (
              <label key={key} className="matchprop-check">
                <input
                  type="checkbox"
                  checked={modes[key]}
                  disabled={(key === 'verify' || key === 'preset') && modes.constant}
                  onChange={(e) => toggle(key, e.currentTarget.checked)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="block-definition-group">
            <legend>Insertion Point</legend>
            <OnScreen checked={pointOnScreen} onChange={setPointOnScreen} />
            <NumberField label="X:" value={x} onChange={setX} disabled={pointOff} />
            <NumberField label="Y:" value={y} onChange={setY} disabled={pointOff} />
          </fieldset>
        </div>
        <div className="attdef-column">
          <fieldset className="block-definition-group">
            <legend>Attribute</legend>
            <label className="cad-dialog-field" htmlFor={ids.tag}>
              <span>Tag:</span>
              <input
                id={ids.tag}
                type="text"
                value={tag}
                autoComplete="off"
                onChange={(e) => setTag(e.currentTarget.value)}
              />
            </label>
            <label className="cad-dialog-field" htmlFor={ids.prompt}>
              <span>Prompt:</span>
              <input
                id={ids.prompt}
                type="text"
                value={modes.constant ? '' : promptText}
                disabled={modes.constant}
                autoComplete="off"
                onChange={(e) => setPrompt(e.currentTarget.value)}
              />
            </label>
            <div className="attdef-picked">
              <label className="cad-dialog-field" htmlFor={ids.value}>
                <span>Default:</span>
                {multiline ? (
                  <textarea
                    id={ids.value}
                    rows={2}
                    value={shownValue(value, true)}
                    onChange={(e) => setValue(storedValue(e.currentTarget.value, true))}
                  />
                ) : (
                  <input
                    id={ids.value}
                    type="text"
                    value={value}
                    autoComplete="off"
                    onChange={(e) => setValue(e.currentTarget.value)}
                  />
                )}
              </label>
              {multiline && (
                <button
                  type="button"
                  aria-label="Edit the default in the multiline text editor"
                  title="Edit the default in the multiline text editor"
                  onClick={() => pick('value')}
                >
                  ...
                </button>
              )}
            </div>
          </fieldset>
          <fieldset className="block-definition-group">
            <legend>Text Settings</legend>
            <label className="cad-dialog-field" htmlFor={ids.justify}>
              <span>Justification:</span>
              <select
                id={ids.justify}
                value={justify}
                disabled={textOff}
                onChange={(e) => setJustify(e.currentTarget.value)}
              >
                {choices.map(([j, label]) => (
                  <option key={j} value={j}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cad-dialog-field" htmlFor={ids.style}>
              <span>Text style:</span>
              <select
                id={ids.style}
                value={style}
                disabled={textOff}
                onChange={(e) => setStyle(e.currentTarget.value)}
              >
                {request.styles.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="matchprop-check">
              <input type="checkbox" checked={false} disabled readOnly />
              Annotative
            </label>
            {picked(
              'Text height:',
              'height',
              fixed ? shown(fixed.height) : height,
              setHeight,
              heightOff,
            )}
            {picked('Rotation:', 'rotation', rotation, setRotation, rotationOff)}
            {picked('Boundary width:', 'width', width, setWidth, widthOff)}
          </fieldset>
        </div>
      </div>
      <label className="matchprop-check attdef-align-below">
        <input
          type="checkbox"
          checked={alignBelow}
          disabled={!request.canAlignBelow}
          onChange={(e) => setAlignBelow(e.currentTarget.checked)}
        />
        Align below previous attribute definition
      </label>
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
