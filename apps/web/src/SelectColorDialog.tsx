// AutoCAD's Select Color dialog (M2-35 part 4; AutoCAD 2024 Help, "Select Color Dialog Box"),
// opened by the Properties palette's "Select Color..." (UI_SPEC.md §7). Three tabs:
// - Index Color: the ACI palette (10–249), the nine standard colours and the six greys, with
//   ByLayer and ByBlock buttons; the swatch under the pointer (or chosen) reads "Index color: n"
//   and its "Red, Green, Blue". The swatches are one tab stop, moved over with the arrow keys.
// - True Color: the HSL or RGB colour model, each channel a number field and a slider.
// - Color Books: the colour books the drawing uses, with the colours of each it uses (Triya
//   ships no books: AutoCAD's are Autodesk's), as -ATTEDIT's COlorbook offers them (M2-27).
// The Color field at the bottom takes what -COLOR takes (a name, 1–255, ByLayer, ByBlock),
// `r,g,b` and `BOOK$COLOR`; Enter is OK, Esc Cancel. The drawing's current colour (nothing
// selected) takes index colours only: CECOLOR holds no true colour in DXF (M2-35 part 1).
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Color, ColorBook } from '@triya/engine';
import { Modal } from './AttributeDialogs';
import {
  ACI_GREYS,
  ACI_PALETTE,
  ACI_STANDARD,
  colorFieldText,
  colorRgb,
  cssOf,
  hslToRgb,
  parseColorField,
  rgbToHsl,
  type Hsl,
  type Rgb,
} from './select-color';
import { aciRgb } from '@triya/render';

type Tab = 'index' | 'true' | 'books';

const TABS: readonly [Tab, string][] = [
  ['index', 'Index Color'],
  ['true', 'True Color'],
  ['books', 'Color Books'],
];

const firstTab = (c: Color | undefined): Tab =>
  c?.kind === 'rgb' ? (c.bookName !== undefined ? 'books' : 'true') : 'index';

export function SelectColorDialog({
  initial,
  books,
  trueColors,
  indexOnly = 'The current color takes an index color only.',
  onOk,
  onCancel,
}: {
  /** The colour the objects share; undefined when it varies. */
  initial: Color | undefined;
  books: readonly ColorBook[];
  /** False for the current colour (CECOLOR): index colours only. */
  trueColors: boolean;
  /** Why a true colour is refused when `trueColors` is false. */
  indexOnly?: string;
  onOk: (c: Color) => void;
  onCancel: () => void;
}) {
  const [color, setColor] = useState<Color | undefined>(initial);
  const [tab, setTab] = useState<Tab>(trueColors ? firstTab(initial) : 'index');
  const [field, setField] = useState(initial ? colorFieldText(initial) : '');
  const [invalid, setInvalid] = useState('');

  const choose = (c: Color) => {
    setColor(c);
    setField(colorFieldText(c));
    setInvalid('');
  };

  /** The Color field's colour, or a reason it is refused. */
  const read = (text: string): Color | string => {
    const c = parseColorField(text, books);
    if (!c) return 'Invalid color.';
    if (c.kind === 'rgb' && !trueColors) return indexOnly;
    return c;
  };

  const ok = () => {
    const typed = field === (color ? colorFieldText(color) : '') ? color : read(field);
    if (typeof typed === 'string') return setInvalid(typed);
    if (!typed) return setInvalid('Invalid color.');
    onOk(typed);
  };

  const shown = color ? colorRgb(color) : undefined;
  const was = initial ? colorRgb(initial) : undefined;

  return (
    <Modal label="Select Color" className="select-color" onOk={ok} onCancel={onCancel}>
      <div role="tablist" className="cad-dialog-tabs">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            disabled={t !== 'index' && !trueColors}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        className="cad-dialog-panel"
        aria-label={TABS.find(([t]) => t === tab)![1]}
      >
        {tab === 'index' && <IndexTab color={color} choose={choose} />}
        {tab === 'true' && <TrueColorTab color={color} choose={choose} />}
        {tab === 'books' && <BooksTab books={books} color={color} choose={choose} />}
      </div>
      <div className="select-color-foot">
        <label className="cad-dialog-field">
          <span>Color:</span>
          <input
            type="text"
            aria-label="Color"
            value={field}
            spellCheck={false}
            aria-invalid={invalid !== ''}
            onChange={(e) => {
              setField(e.currentTarget.value);
              setInvalid('');
            }}
            onBlur={() => {
              const c = read(field);
              if (typeof c === 'string') {
                if (field.trim() !== '') setInvalid(c);
              } else setColor(c);
            }}
          />
        </label>
        <div className="select-color-preview" aria-hidden>
          <span title="New" style={{ background: shown ? cssOf(shown) : 'transparent' }} />
          <span title="Old" style={{ background: was ? cssOf(was) : 'transparent' }} />
        </div>
      </div>
      <p className="select-color-invalid" role="alert">
        {invalid}
      </p>
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

/** One grid of swatches; the arrow keys move within it, Enter and Space choose. */
function Swatches({
  label,
  rows,
  chosen,
  focus,
  choose,
  hover,
}: {
  label: string;
  rows: readonly (readonly number[])[];
  chosen: number | undefined;
  /** The grid's tab stop: the chosen swatch when it is here, else its first. */
  focus: boolean;
  choose: (index: number) => void;
  hover: (index: number | undefined) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stop = rows.flat().includes(chosen ?? -1) ? chosen : rows[0]![0];
  const move = (e: KeyboardEvent, r: number, c: number) => {
    const to: Record<string, [number, number]> = {
      ArrowLeft: [r, c - 1],
      ArrowRight: [r, c + 1],
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      Home: [r, 0],
      End: [r, rows[r]!.length - 1],
    };
    const next = to[e.key];
    if (!next) return;
    e.preventDefault();
    const index = rows[next[0]]?.[next[1]];
    if (index === undefined) return;
    ref.current?.querySelector<HTMLElement>(`[data-aci="${index}"]`)?.focus();
    hover(index);
  };
  return (
    <div ref={ref} role="grid" aria-label={label} className="aci-grid">
      {rows.map((row, r) => (
        <div role="row" key={r}>
          {row.map((index, c) => (
            <button
              key={index}
              type="button"
              role="gridcell"
              data-aci={index}
              aria-label={`Index color ${index}`}
              aria-selected={chosen === index}
              tabIndex={focus && index === stop ? 0 : -1}
              style={{ background: cssOf(aciRgb(index)) }}
              onClick={() => choose(index)}
              onKeyDown={(e) => move(e, r, c)}
              onMouseEnter={() => hover(index)}
              onMouseLeave={() => hover(undefined)}
              onFocus={() => hover(index)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function IndexTab({ color, choose }: { color: Color | undefined; choose: (c: Color) => void }) {
  const [over, setOver] = useState<number | undefined>();
  const chosen = color?.kind === 'aci' ? color.index : undefined;
  const pick = (index: number) => choose({ kind: 'aci', index });
  const info = over ?? chosen;
  const grids: [string, readonly (readonly number[])[]][] = [
    ['AutoCAD Color Index (ACI)', ACI_PALETTE],
    ['Standard colors', [ACI_STANDARD]],
    ['Gray shades', [ACI_GREYS]],
  ];
  // One tab stop across the three grids: the one holding the chosen colour, else the palette.
  const focused = grids.findIndex(([, rows]) => rows.flat().includes(chosen ?? -1));
  return (
    <div className="select-color-index">
      <p className="select-color-caption">AutoCAD Color Index (ACI):</p>
      {grids.map(([label, rows], i) => (
        <Swatches
          key={label}
          label={label}
          rows={rows}
          chosen={chosen}
          focus={i === Math.max(focused, 0)}
          choose={pick}
          hover={setOver}
        />
      ))}
      <p className="select-color-info" data-testid="aci-info">
        {info === undefined ? (
          ' '
        ) : (
          <>
            Index color: {info} <span>Red, Green, Blue: {aciRgb(info).join(',')}</span>
          </>
        )}
      </p>
      <div className="select-color-by">
        <button
          type="button"
          aria-pressed={color?.kind === 'byLayer'}
          onClick={() => choose({ kind: 'byLayer' })}
        >
          ByLayer
        </button>
        <button
          type="button"
          aria-pressed={color?.kind === 'byBlock'}
          onClick={() => choose({ kind: 'byBlock' })}
        >
          ByBlock
        </button>
      </div>
    </div>
  );
}

type Model = 'HSL' | 'RGB';

function TrueColorTab({ color, choose }: { color: Color | undefined; choose: (c: Color) => void }) {
  const [model, setModel] = useState<Model>('HSL');
  const rgb: Rgb = (color && colorRgb(color)) ?? [255, 255, 255];
  // HSL is kept as typed, so a hue survives a trip through grey (which has none).
  const [hsl, setHsl] = useState<Hsl>(() => rgbToHsl(rgb));
  const setRgb = (next: Rgb) => {
    setHsl(rgbToHsl(next));
    choose({ kind: 'rgb', r: next[0], g: next[1], b: next[2] });
  };
  const setHslPart = (next: Hsl) => {
    setHsl(next);
    const [r, g, b] = hslToRgb(next);
    choose({ kind: 'rgb', r, g, b });
  };
  const channels: [string, number, number, (v: number) => void][] =
    model === 'HSL'
      ? [
          ['Hue', hsl.h, 359, (h) => setHslPart({ ...hsl, h })],
          ['Saturation', hsl.s, 100, (s) => setHslPart({ ...hsl, s })],
          ['Luminance', hsl.l, 100, (l) => setHslPart({ ...hsl, l })],
        ]
      : (['Red', 'Green', 'Blue'] as const).map((name, i) => [
          name,
          rgb[i]!,
          255,
          (v: number) => setRgb(rgb.map((c, j) => (j === i ? v : c)) as unknown as Rgb),
        ]);
  return (
    <div className="select-color-true">
      <label className="cad-dialog-field">
        <span>Color model:</span>
        <select value={model} onChange={(e) => setModel(e.currentTarget.value as Model)}>
          <option value="HSL">HSL</option>
          <option value="RGB">RGB</option>
        </select>
      </label>
      {channels.map(([name, value, max, set]) => (
        <div className="select-color-channel" key={name}>
          <label className="cad-dialog-field">
            <span>{name}:</span>
            <input
              type="number"
              min={0}
              max={max}
              step={1}
              value={value}
              onChange={(e) => {
                const v = Math.round(Number(e.currentTarget.value));
                if (Number.isFinite(v)) set(Math.min(Math.max(v, 0), max));
              }}
            />
          </label>
          <input
            type="range"
            aria-label={`${name} slider`}
            min={0}
            max={max}
            step={1}
            value={value}
            onChange={(e) => set(Number(e.currentTarget.value))}
          />
        </div>
      ))}
      <p className="select-color-caption">
        {color?.kind === 'rgb' ? `True color stored as RGB: ${rgb.join(',')}` : ' '}
      </p>
    </div>
  );
}

function BooksTab({
  books,
  color,
  choose,
}: {
  books: readonly ColorBook[];
  color: Color | undefined;
  choose: (c: Color) => void;
}) {
  const inBook = color?.kind === 'rgb' ? color.bookName?.toUpperCase() : undefined;
  const [name, setName] = useState(
    books.find((b) => b.name.toUpperCase() === inBook)?.name ?? books[0]?.name ?? '',
  );
  const book = useMemo(() => books.find((b) => b.name === name), [books, name]);
  if (books.length === 0) {
    return (
      <p className="select-color-caption">
        This drawing uses no color books. Triya ships none: AutoCAD&rsquo;s books are
        Autodesk&rsquo;s. A drawing that uses a book&rsquo;s colors offers them here.
      </p>
    );
  }
  const chosen =
    color?.kind === 'rgb' && color.bookName?.toUpperCase() === name.toUpperCase()
      ? color.colorName?.toUpperCase()
      : undefined;
  return (
    <div className="select-color-books">
      <label className="cad-dialog-field">
        <span>Color book:</span>
        <select value={name} onChange={(e) => setName(e.currentTarget.value)}>
          {books.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <ul aria-label="Colors" className="select-color-book-list">
        {book?.colors.map((c) => {
          const pick = () => {
            const [r, g, b] = c.rgb;
            choose({ kind: 'rgb', r, g, b, bookName: book.name, colorName: c.name });
          };
          return (
            <li key={c.name}>
              <button type="button" aria-pressed={chosen === c.name.toUpperCase()} onClick={pick}>
                <span className="swatch" style={{ background: cssOf(c.rgb) }} aria-hidden />
                {c.name}
                <span className="select-color-rgb">RGB {c.rgb.join(',')}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
