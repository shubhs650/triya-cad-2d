// The Layer Properties Manager's property dialogs (M5-05 part 2; AutoCAD 2024 Help, "Select
// Linetype Dialog Box", "Lineweight Dialog Box", "Layer Transparency Dialog Box"), opened from a
// layer's Linetype, Lineweight and Transparency cells (its Color cell opens Select Color). Each
// starts from the value of the row clicked; OK sets it on every layer selected.
// - Select Linetype: Loaded linetypes (Linetype, Appearance, Description), one chosen; Load...
//   loads from a .lin file, which waits for M5-08's loader and is greyed until then.
// - Lineweight: the list of AutoCAD's lineweights and Default, with Original and New below.
// - Layer Transparency: "Transparency value (0-90)", typed or picked in tens.
// Enter is OK and Esc Cancel in each (`Modal`); every list is keyboard operable.
import { useRef, useState, type KeyboardEvent } from 'react';
import {
  LINEWEIGHTS,
  lineweightLabel,
  type Handle,
  type LinetypeRecord,
  type Lineweight,
} from '@triya/engine';
import { Modal } from './AttributeDialogs';
import { linetypeDashes, parseLayerTransparency } from './layers';

/** The Appearance column's sample, in CSS pixels. */
const SAMPLE_WIDTH = 96;

function Appearance({ linetype }: { linetype: LinetypeRecord }) {
  const dashes = linetypeDashes(linetype.elements, SAMPLE_WIDTH);
  return (
    <svg
      className="linetype-sample"
      width={SAMPLE_WIDTH}
      height="8"
      viewBox={`0 0 ${SAMPLE_WIDTH} 8`}
      aria-hidden
    >
      <line
        x1="0"
        y1="4"
        x2={SAMPLE_WIDTH}
        y2="4"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray={dashes?.join(' ')}
      />
    </svg>
  );
}

function Buttons({ ok, cancel }: { ok: () => void; cancel: () => void }) {
  return (
    <div className="cad-dialog-buttons">
      <button type="button" onClick={ok}>
        OK
      </button>
      <button type="button" onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}

export function SelectLinetypeDialog({
  initial,
  linetypes,
  onOk,
  onCancel,
}: {
  initial: Handle;
  /** The loaded linetypes, by name (`layerLinetypes`). */
  linetypes: readonly LinetypeRecord[];
  onOk: (linetype: Handle) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<Handle | undefined>(
    linetypes.some((l) => l.handle === initial) ? initial : linetypes[0]?.handle,
  );
  const list = useRef<HTMLDivElement>(null);
  const ok = () => {
    if (chosen !== undefined) onOk(chosen);
  };
  const keys = (e: KeyboardEvent) => {
    const at = linetypes.findIndex((l) => l.handle === chosen);
    const to =
      e.key === 'ArrowDown'
        ? at + 1
        : e.key === 'ArrowUp'
          ? at - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? linetypes.length - 1
              : undefined;
    const next = to === undefined ? undefined : linetypes[to];
    if (!next) return;
    e.preventDefault();
    setChosen(next.handle);
    list.current
      ?.querySelector(`[data-handle="${next.handle}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <Modal label="Select Linetype" className="layer-linetype" onOk={ok} onCancel={onCancel}>
      <p className="cad-dialog-title">Select Linetype</p>
      <span id="layer-linetypes-label">Loaded linetypes</span>
      <div className="linetype-head" aria-hidden>
        <span>Linetype</span>
        <span>Appearance</span>
        <span>Description</span>
      </div>
      <div
        ref={list}
        role="listbox"
        aria-labelledby="layer-linetypes-label"
        aria-activedescendant={chosen === undefined ? undefined : `layer-linetype-${chosen}`}
        className="linetype-list"
        tabIndex={0}
        autoFocus
        onKeyDown={keys}
      >
        {linetypes.map((l) => (
          <div
            key={l.handle}
            id={`layer-linetype-${l.handle}`}
            data-handle={l.handle}
            role="option"
            aria-selected={l.handle === chosen}
            onClick={() => setChosen(l.handle)}
            onDoubleClick={() => onOk(l.handle)}
          >
            <span>{l.name}</span>
            <Appearance linetype={l} />
            <span>{l.description}</span>
          </div>
        ))}
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" disabled title="Loading a linetype comes with the Linetype Manager.">
          Load...
        </button>
      </div>
    </Modal>
  );
}

/** Default, then AutoCAD's lineweights, as the Lineweight dialog lists them. */
const WEIGHTS: readonly Lineweight[] = ['Default', ...LINEWEIGHTS];

export function LineweightDialog({
  initial,
  onOk,
  onCancel,
}: {
  initial: Lineweight;
  onOk: (w: Lineweight) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<Lineweight>(initial);
  const ok = () => onOk(chosen);
  return (
    <Modal label="Lineweight" className="layer-lineweight" onOk={ok} onCancel={onCancel}>
      <p className="cad-dialog-title">Lineweight</p>
      <label className="layer-lineweight-list">
        <span>Lineweights:</span>
        <select
          size={12}
          aria-label="Lineweights"
          autoFocus
          value={String(chosen)}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setChosen(v === 'Default' ? 'Default' : Number(v));
          }}
          onDoubleClick={ok}
        >
          {WEIGHTS.map((w) => (
            <option key={w} value={String(w)}>
              {lineweightLabel(w)}
            </option>
          ))}
        </select>
      </label>
      <p>Original: {lineweightLabel(initial)}</p>
      <p>New: {lineweightLabel(chosen)}</p>
      <Buttons ok={ok} cancel={onCancel} />
    </Modal>
  );
}

/** The Transparency value list's choices: AutoCAD's 0 to 90 in tens. */
const TRANSPARENCIES = Array.from({ length: 10 }, (_, i) => String(i * 10));

export function LayerTransparencyDialog({
  initial,
  onOk,
  onCancel,
}: {
  /** A percentage, 0 to 90. */
  initial: number;
  onOk: (percent: number) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(String(initial));
  const [invalid, setInvalid] = useState('');
  const ok = () => {
    const v = parseLayerTransparency(text);
    if (typeof v === 'string') setInvalid(v);
    else onOk(v);
  };
  return (
    <Modal label="Layer Transparency" className="layer-transparency" onOk={ok} onCancel={onCancel}>
      <p className="cad-dialog-title">Layer Transparency</p>
      <label className="cad-dialog-field">
        <span>Transparency value (0-90):</span>
        <input
          type="text"
          inputMode="numeric"
          list="layer-transparency-values"
          aria-label="Transparency value (0-90)"
          aria-invalid={invalid !== ''}
          autoFocus
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setInvalid('');
          }}
        />
        <datalist id="layer-transparency-values">
          {TRANSPARENCIES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      <p className="message error" role="alert">
        {invalid}
      </p>
      <Buttons ok={ok} cancel={onCancel} />
    </Modal>
  );
}
