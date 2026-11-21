// The Layer Properties Manager's property dialogs (M5-05 part 2; AutoCAD 2024 Help, "Select
// Linetype Dialog Box", "Lineweight Dialog Box", "Layer Transparency Dialog Box"), opened from a
// layer's Linetype, Lineweight and Transparency cells (its Color cell opens Select Color). Each
// starts from the value of the row clicked; OK sets it on every layer selected.
// - Select Linetype: Loaded linetypes (Linetype, Appearance, Description), one chosen; Load...
//   opens Load or Reload Linetypes (M5-08) and loads the linetypes picked, one LINETYPE step.
// - Lineweight: the list of AutoCAD's lineweights and Default, with Original and New below.
// - Layer Transparency: "Transparency value (0-90)", typed or picked in tens.
// - Select Plot Style (M6-07; AutoCAD 2024 Help, "Select Plot Style Dialog Box"), from the Plot
//   Style and VP Plot Style cells of a drawing with named plot styles: the drawing's plot styles
//   (ACAD_PLOTSTYLENAME), Normal first, with Original and New below. Help's Active Plot Style
//   Table list and Editor button edit .stb files, which the manager does not; they are left out.
// Enter is OK and Esc Cancel in each (`Modal`); every list is keyboard operable.
import { useRef, useState, type KeyboardEvent } from 'react';
import {
  LINEWEIGHTS,
  lineweightText,
  type Handle,
  type LinetypeRecord,
  type Lineweight,
  type LineweightUnits,
  type SymbolTableRecord,
} from '@triya/engine';
import { Modal } from './AttributeDialogs';
import { parseLayerTransparency } from './layers';
import { LinetypeAppearance, LoadLinetypesDialog } from './LinetypeManager';
import type { LinetypeDefinition } from '@triya/engine';
import type { LinetypeFiles } from './linetype-files';

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
  files,
  onLoad,
}: {
  initial: Handle;
  /** The loaded linetypes, by name (`layerLinetypes`). */
  linetypes: readonly LinetypeRecord[];
  onOk: (linetype: Handle) => void;
  onCancel: () => void;
  /** The linetype files Load... reads (M5-08); without them Load... is greyed. */
  files?: LinetypeFiles | undefined;
  /** Loads the linetypes picked; the handles of those loaded, or undefined when refused. */
  onLoad?: (linetypes: LinetypeDefinition[], reload: boolean) => Promise<Handle[] | undefined>;
}) {
  const [loading, setLoading] = useState(false);
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
            <LinetypeAppearance elements={l.elements} />
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
        <button type="button" disabled={!files || !onLoad} onClick={() => setLoading(true)}>
          Load...
        </button>
      </div>
      {loading && files && onLoad && (
        <LoadLinetypesDialog
          files={files}
          loaded={linetypes.map((l) => l.name)}
          onOk={(defs, reload) => {
            setLoading(false);
            void onLoad(defs, reload).then((handles) => {
              // The first linetype loaded is chosen, as AutoCAD's list selects it.
              if (handles?.[0] !== undefined) setChosen(handles[0]);
            });
          }}
          onCancel={() => setLoading(false)}
        />
      )}
    </Modal>
  );
}

/** Default, then AutoCAD's lineweights, as the Lineweight dialog lists them. */
const WEIGHTS: readonly Lineweight[] = ['Default', ...LINEWEIGHTS];

export function LineweightDialog({
  units = 'mm',
  initial,
  onOk,
  onCancel,
}: {
  /** LWUNITS: the list in millimetres or inches (M5-08). */
  units?: LineweightUnits;
  initial: Lineweight;
  onOk: (w: Lineweight) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<Lineweight>(initial);
  const ok = () => onOk(chosen);
  const lineweightLabel = (w: Lineweight) => (typeof w === 'number' ? lineweightText(w, units) : w);
  return (
    <Modal label="Lineweight" className="layer-lineweight" onOk={ok} onCancel={onCancel}>
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

export function SelectPlotStyleDialog({
  initial,
  styles,
  onOk,
  onCancel,
}: {
  /** The plot style the layer (or the viewport) has now. */
  initial: Handle | undefined;
  /** The drawing's named plot styles, in the order listed. */
  styles: readonly SymbolTableRecord[];
  onOk: (style: Handle) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<Handle | undefined>(initial ?? styles[0]?.handle);
  const name = (h: Handle | undefined) => styles.find((s) => s.handle === h)?.name ?? '';
  const ok = () => {
    if (chosen !== undefined) onOk(chosen);
    else onCancel();
  };
  return (
    <Modal label="Select Plot Style" className="layer-plot-style" onOk={ok} onCancel={onCancel}>
      <label className="layer-plot-style-list">
        <span>Plot styles:</span>
        <select
          size={10}
          aria-label="Plot styles"
          autoFocus
          value={chosen ?? ''}
          onChange={(e) => setChosen(e.currentTarget.value)}
          onDoubleClick={ok}
        >
          {styles.map((s) => (
            <option key={s.handle} value={s.handle}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <p>Original: {name(initial)}</p>
      <p>New: {name(chosen)}</p>
      <Buttons ok={ok} cancel={onCancel} />
    </Modal>
  );
}
