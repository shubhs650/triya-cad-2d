// LWEIGHT's Lineweight Settings (M5-08 part 3), with AutoCAD 2024's structure and labels (AutoCAD
// Help, "Lineweight Settings Dialog Box"; UI_SPEC.md §7): the Lineweights list (ByLayer, ByBlock,
// Default, then every lineweight, each drawn at its width), Units for Listing (LWUNITS), Display
// Lineweight (LWDISPLAY, the status bar's LWT), Default (LWDEFAULT), Adjust Display Scale and the
// Current Lineweight. Apply & Close sets the per-user settings here, as DSETTINGS' dialog does,
// and answers with the lineweight chosen, which the command makes current (CELWEIGHT). The list
// is a listbox: the arrow keys, Home and End move through it. AutoCAD's Help button is left out,
// as Triya's other dialogs leave it.
import {
  LINEWEIGHTS,
  lineweightText,
  type DialogRequest,
  type Lineweight,
  type LineweightUnits,
  type PromptAnswer,
} from '@triya/engine';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { drafting, LWSCALE_RANGE } from './drafting';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'lweight' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const CHOICES: readonly Lineweight[] = ['ByLayer', 'ByBlock', 'Default', ...LINEWEIGHTS];

/** The sample bar's height in CSS pixels: the lineweight at 96 per inch, at least one. */
const sampleHeight = (w: Lineweight, lwDefault: number): number => {
  const h = typeof w === 'number' ? w : w === 'Default' ? lwDefault : 25;
  return Math.max(1, Math.round((h / 100) * (96 / 25.4)));
};

export function LineweightDialog({ doc, request }: { doc: number; request: Request }) {
  const state = drafting.get();
  const lwtWas = drafting.isOn('lwt');
  const [chosen, setChosen] = useState<Lineweight>(request.lineweight);
  const [units, setUnits] = useState<LineweightUnits>(state.lwUnits === 0 ? 'in' : 'mm');
  const [display, setDisplay] = useState(lwtWas);
  const [lwDefault, setLwDefault] = useState(state.lwDefault);
  const [scale, setScale] = useState(state.lwScale);
  const list = useRef<HTMLDivElement>(null);
  const ok = () => {
    drafting.configure({
      lwUnits: units === 'in' ? 0 : 1,
      lwDefault,
      lwScale: scale,
      // LWT keeps following each drawing's LWDISPLAY unless the box was turned.
      ...(display !== lwtWas && { lwt: display }),
    });
    void answer(doc, { kind: 'dialog', action: 'ok', lineweight: chosen });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  const label = (w: Lineweight) =>
    w === 'Default' ? `Default (${lineweightText(lwDefault, units)})` : lineweightText(w, units);
  const keys = (e: KeyboardEvent) => {
    const at = CHOICES.indexOf(chosen);
    const to =
      e.key === 'ArrowDown'
        ? Math.min(CHOICES.length - 1, at + 1)
        : e.key === 'ArrowUp'
          ? Math.max(0, at - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? CHOICES.length - 1
              : undefined;
    if (to === undefined) return;
    e.preventDefault();
    setChosen(CHOICES[to]!);
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${to}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  };
  return (
    <Modal label="Lineweight Settings" className="lweight-dialog" onOk={ok} onCancel={cancel}>
      <div className="lweight-body">
        <fieldset className="lweight-list-group">
          <legend id="lweight-list-label">Lineweights</legend>
          <div
            ref={list}
            role="listbox"
            aria-labelledby="lweight-list-label"
            aria-activedescendant={`lweight-${CHOICES.indexOf(chosen)}`}
            className="lweight-list"
            tabIndex={0}
            autoFocus
            onKeyDown={keys}
          >
            {CHOICES.map((w, i) => (
              <div
                key={String(w)}
                id={`lweight-${i}`}
                data-index={i}
                role="option"
                aria-selected={w === chosen}
                onClick={() => setChosen(w)}
              >
                <span
                  className="lweight-sample"
                  aria-hidden
                  style={{ height: sampleHeight(w, lwDefault) }}
                />
                <span>{label(w)}</span>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="lweight-settings">
          <fieldset>
            <legend>Units for Listing</legend>
            <label>
              <input
                type="radio"
                name="lwunits"
                checked={units === 'mm'}
                onChange={() => setUnits('mm')}
              />
              Millimeters (mm)
            </label>
            <label>
              <input
                type="radio"
                name="lwunits"
                checked={units === 'in'}
                onChange={() => setUnits('in')}
              />
              Inches (in)
            </label>
          </fieldset>
          <label className="lweight-check">
            <input
              type="checkbox"
              checked={display}
              onChange={(e) => setDisplay(e.target.checked)}
            />
            Display Lineweight
          </label>
          <label className="lweight-default">
            <span aria-hidden>Default</span>
            <select
              aria-label="Default"
              value={lwDefault}
              onChange={(e) => setLwDefault(Number(e.target.value))}
            >
              {LINEWEIGHTS.map((w) => (
                <option key={w} value={w}>
                  {lineweightText(w, units)}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Adjust Display Scale</legend>
            <div className="lweight-scale">
              <span aria-hidden>Min</span>
              <input
                type="range"
                aria-label="Adjust Display Scale"
                min={LWSCALE_RANGE.min}
                max={LWSCALE_RANGE.max}
                step={LWSCALE_RANGE.step}
                value={scale}
                aria-valuetext={`${scale}×`}
                onChange={(e) => setScale(Number(e.target.value))}
              />
              <span aria-hidden>Max</span>
            </div>
          </fieldset>
        </div>
      </div>
      <p className="lweight-current">
        Current Lineweight: <output>{lineweightText(chosen, units)}</output>
      </p>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          Apply &amp; Close
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
