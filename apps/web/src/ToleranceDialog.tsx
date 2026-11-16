// TOLERANCE's Geometric Tolerance dialog (M4-11), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Geometric Tolerance Dialog Box", "Symbol Dialog Box", "Material Condition
// Dialog Box"; UI_SPEC.md §7): two rows of Sym, Tolerance 1, Tolerance 2, Datum 1, Datum 2 and
// Datum 3; Height and Projected Tolerance Zone; Datum Identifier. Sym opens the Symbol dialog
// (the fourteen geometric characteristics and an empty box for none), each material condition
// box the Material Condition dialog (MMC, LMC, RFS, empty), and a tolerance's first box and
// Projected Tolerance Zone toggle their symbol. The symbols are drawn from the bundled GD&T font
// (`oet-gdt`, M1-54), as the frame will draw them. Every box is a button, so the dialog works
// from the keyboard; Enter is OK, Esc Cancel (in a symbol dialog, Esc closes it alone). AutoCAD's
// Help button is left out, as Triya's other dialogs leave it.
import {
  GDT_CHARACTERISTICS,
  GDT_MATERIALS,
  type DialogRequest,
  type GdtDatum,
  type GdtFrame,
  type GdtMaterial,
  type GdtRow,
  type GdtTolerance,
  type PromptAnswer,
} from '@triya/engine';
import { useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';
import { BUNDLED_FONTS } from './fonts';

type Request = Extract<DialogRequest, { type: 'tolerance' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** A glyph of the bundled GD&T font: its advance and strokes (x, y pairs, y up). */
type Glyph = readonly [number, readonly (readonly number[])[]];

let glyphs: Readonly<Record<string, Glyph>> | undefined;

/** The GD&T font's glyph for a letter, read from the bundled font once. */
function glyphOf(letter: string): Glyph | undefined {
  if (!glyphs) {
    const source = BUNDLED_FONTS.shx?.find((f) => f.name === 'oet-gdt')?.source;
    glyphs =
      typeof source === 'string'
        ? (JSON.parse(source) as { glyphs: Record<string, Glyph> }).glyphs
        : {};
  }
  return glyphs[String(letter.charCodeAt(0))];
}

/** The font's cap height (its `above`): the symbols fill it. */
const ABOVE = 42;

/** A GD&T symbol, drawn from its glyph's strokes. */
function GdtSymbol({ letter }: { letter: string }) {
  const g = glyphOf(letter);
  if (!g) return null;
  return (
    <svg className="gdt-symbol" viewBox={`0 ${-ABOVE - 4} ${g[0]} ${ABOVE + 8}`} aria-hidden="true">
      <g transform="scale(1,-1)" fill="none" stroke="currentColor" strokeWidth="3.5">
        {g[1].map((s, i) => (
          <polyline
            key={i}
            points={s.reduce((pts, v, k) => (k % 2 === 0 ? `${pts} ${v}` : `${pts},${v}`), '')}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </g>
    </svg>
  );
}

const characteristic = (letter: string) =>
  GDT_CHARACTERISTICS.find((c) => c.letter === letter)?.name;
const condition = (letter: GdtMaterial) => GDT_MATERIALS.find((m) => m.letter === letter)?.name;

/** Which picker is open: the Symbol dialog for a row, or Material Condition for one box. */
type Picker =
  | { readonly kind: 'symbol'; readonly row: number }
  | {
      readonly kind: 'material';
      readonly row: number;
      readonly field: MaterialField;
    };

type ToleranceField = 'tolerance1' | 'tolerance2';
type DatumField = 'datum1' | 'datum2' | 'datum3';
type MaterialField = ToleranceField | DatumField;

/** The Symbol and Material Condition dialogs: a grid of symbol boxes, the empty one last. */
function SymbolPicker({
  label,
  choices,
  onPick,
  onCancel,
}: {
  label: string;
  choices: readonly { readonly letter: string; readonly name: string }[];
  onPick: (letter: string) => void;
  onCancel: () => void;
}) {
  return (
    <Modal label={label} className="gdt-picker" onOk={onCancel} onCancel={onCancel}>
      <div className="gdt-picker-grid">
        {[...choices, { letter: '', name: 'None' }].map((c) => (
          <button
            key={c.letter || 'none'}
            type="button"
            className="gdt-box"
            title={c.name}
            aria-label={c.name}
            onClick={() => onPick(c.letter)}
          >
            {c.letter && <GdtSymbol letter={c.letter} />}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function ToleranceDialog({ doc, request }: { doc: number; request: Request }) {
  const [frame, setFrame] = useState<GdtFrame>(request.frame);
  const [picker, setPicker] = useState<Picker | undefined>();
  const setRow = (i: number, patch: Partial<GdtRow>) =>
    setFrame((f) => {
      const rows = [...f.rows] as [GdtRow, GdtRow];
      rows[i] = { ...rows[i]!, ...patch };
      return { ...f, rows };
    });
  const ok = () => void answer(doc, { kind: 'dialog', action: 'ok', tolerance: frame });
  const cancel = () => engines.command(doc, { kind: 'cancel' });

  const materialBox = (i: number, field: MaterialField, value: GdtMaterial, name: string) => (
    <button
      type="button"
      className="gdt-box"
      aria-label={`${name} material condition, row ${i + 1}`}
      title={condition(value) ?? 'Material condition'}
      onClick={() => setPicker({ kind: 'material', row: i, field })}
    >
      {value && <GdtSymbol letter={value} />}
    </button>
  );
  const tolerance = (i: number, field: ToleranceField, t: GdtTolerance, name: string) => (
    <div className="gdt-cell" role="group" aria-label={`${name}, row ${i + 1}`}>
      <button
        type="button"
        className="gdt-box"
        aria-label={`${name} diameter, row ${i + 1}`}
        aria-pressed={t.diameter}
        title="Diameter"
        onClick={() => setRow(i, { [field]: { ...t, diameter: !t.diameter } })}
      >
        {t.diameter && <GdtSymbol letter="n" />}
      </button>
      <input
        type="text"
        aria-label={`${name} value, row ${i + 1}`}
        value={t.value}
        onChange={(e) => setRow(i, { [field]: { ...t, value: e.target.value } })}
      />
      {materialBox(i, field, t.material, name)}
    </div>
  );
  const datum = (i: number, field: DatumField, d: GdtDatum, name: string) => (
    <div className="gdt-cell" role="group" aria-label={`${name}, row ${i + 1}`}>
      <input
        type="text"
        aria-label={`${name} value, row ${i + 1}`}
        value={d.value}
        onChange={(e) => setRow(i, { [field]: { ...d, value: e.target.value } })}
      />
      {materialBox(i, field, d.material, name)}
    </div>
  );
  const pick = (letter: string) => {
    if (!picker) return;
    if (picker.kind === 'symbol') setRow(picker.row, { symbol: letter });
    else {
      const row = frame.rows[picker.row]!;
      setRow(picker.row, {
        [picker.field]: { ...row[picker.field], material: letter as GdtMaterial },
      });
    }
    setPicker(undefined);
  };

  return (
    <Modal label="Geometric Tolerance" className="tolerance-dialog" onOk={ok} onCancel={cancel}>
      <div className="gdt-grid">
        <span className="gdt-head">Sym</span>
        <span className="gdt-head">Tolerance 1</span>
        <span className="gdt-head">Tolerance 2</span>
        <span className="gdt-head">Datum 1</span>
        <span className="gdt-head">Datum 2</span>
        <span className="gdt-head">Datum 3</span>
        {frame.rows.map((r, i) => (
          <div key={i} className="gdt-row" role="group" aria-label={`Row ${i + 1}`}>
            <button
              type="button"
              className="gdt-box"
              aria-label={`Sym, row ${i + 1}`}
              title={characteristic(r.symbol) ?? 'Symbol'}
              onClick={() => setPicker({ kind: 'symbol', row: i })}
            >
              {r.symbol && <GdtSymbol letter={r.symbol} />}
            </button>
            {tolerance(i, 'tolerance1', r.tolerance1, 'Tolerance 1')}
            {tolerance(i, 'tolerance2', r.tolerance2, 'Tolerance 2')}
            {datum(i, 'datum1', r.datum1, 'Datum 1')}
            {datum(i, 'datum2', r.datum2, 'Datum 2')}
            {datum(i, 'datum3', r.datum3, 'Datum 3')}
          </div>
        ))}
      </div>
      <div className="gdt-zone">
        <label>
          Height:
          <input
            type="text"
            value={frame.height}
            onChange={(e) => setFrame({ ...frame, height: e.target.value })}
          />
        </label>
        <span id="gdt-zone-label">Projected Tolerance Zone:</span>
        <button
          type="button"
          className="gdt-box"
          aria-labelledby="gdt-zone-label"
          aria-pressed={frame.projectedZone}
          onClick={() => setFrame({ ...frame, projectedZone: !frame.projectedZone })}
        >
          {frame.projectedZone && <GdtSymbol letter="p" />}
        </button>
      </div>
      <label className="gdt-identifier">
        Datum Identifier:
        <input
          type="text"
          value={frame.datumIdentifier}
          onChange={(e) => setFrame({ ...frame, datumIdentifier: e.target.value })}
        />
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
      {picker && (
        <SymbolPicker
          label={picker.kind === 'symbol' ? 'Symbol' : 'Material Condition'}
          choices={picker.kind === 'symbol' ? GDT_CHARACTERISTICS : GDT_MATERIALS}
          onPick={pick}
          onCancel={() => setPicker(undefined)}
        />
      )}
    </Modal>
  );
}
