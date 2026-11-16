// STYLE's Text Style dialog (M4-04), with AutoCAD 2024's structure and labels (AutoCAD Help,
// "Text Style Dialog Box", "New Text Style Dialog Box"; UI_SPEC.md §7):
//
//   Current text style: <name>
//   Styles | Font (Font Name, Font Style or Big Font, Use Big Font)  | Set Current
//          | Size (Annotative, Height)                               | New...
//   List   | Effects (Upside down, Backwards, Vertical,              | Delete
//          |          Width Factor, Oblique Angle)                   |
//                                                      Apply  Close
//
// The fields edit the selected style until Apply sends them; choosing another style, Set Current
// or Close with changes not applied asks AutoCAD's "The current style has been modified. Do you
// want to save your changes?" first. The list's shortcut menu (right-click, Shift+F10 or the
// menu key) has Set current, Rename and Delete; F2 renames and Delete deletes, as in a Windows
// list. Each action is made at once and the engine opens the dialog again; Close (and Esc) only
// closes it, everything done being one undo step.
//
// Font Name lists the fonts the drawing's styles name, AutoCAD's SHX fonts (drawn by the bundled
// ones) and the user's font files; a browser cannot list the computer's TrueType families
// without asking, so those come as the user adds them (Settings, Fonts). Font Style is a
// TrueType font's (Regular, Italic, Bold, Bold Italic); an SHX font has Use Big Font instead,
// which turns it into the Big Font list, and Vertical. Annotative is shown and never set
// (DEC-013, DEC-058). The preview waits for a later part.
import {
  isTrueTypeFont,
  textStyleProblem,
  type DialogRequest,
  type PromptAnswer,
  type TextStyleAction,
  type TextStyleSettings,
} from '@triya/engine';
import { SHX_EQUIVALENTS } from '@triya/text';
import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'textstyle' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** AutoCAD's SHX fonts, which the bundled fonts draw. */
const SHX_FONTS: readonly string[] = Object.keys(SHX_EQUIVALENTS).map((n) => `${n}.shx`);

const FONT_STYLES = ['Regular', 'Italic', 'Bold', 'Bold Italic'] as const;
type FontStyle = (typeof FONT_STYLES)[number];

const fontStyleOf = (s: TextStyleSettings): FontStyle =>
  s.bold ? (s.italic ? 'Bold Italic' : 'Bold') : s.italic ? 'Italic' : 'Regular';

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** The names in `lists`, each once whatever its case, sorted. */
function merged(...lists: readonly (readonly string[])[]): string[] {
  const out = new Map<string, string>();
  for (const l of lists)
    for (const n of l) if (!out.has(n.toUpperCase())) out.set(n.toUpperCase(), n);
  return [...out.values()].sort(byName);
}

const same = (a: TextStyleSettings, b: TextStyleSettings) =>
  (Object.keys(a) as (keyof TextStyleSettings)[]).every((k) => a[k] === b[k]);

/** AutoCAD's next free `stylen` name. */
function nextStyleName(names: readonly string[]): string {
  const taken = new Set(names.map((n) => n.toUpperCase()));
  let n = 1;
  while (taken.has(`STYLE${n}`)) n++;
  return `style${n}`;
}

/**
 * What waits on the "save your changes?" question. `follows`: Yes applies and then does it too
 * (Close, Set Current); choosing another style after Yes is left to the drafter, as the dialog
 * opens again on the style applied.
 */
type Pending = { readonly then: () => void; readonly follows: boolean };

export function TextStyleDialog({
  doc,
  request,
  fonts = [],
}: {
  doc: number;
  request: Request;
  /** The user's font files (M1-38), offered in Font Name and Big Font. */
  fonts?: readonly string[];
}) {
  const [selected, setSelected] = useState(request.selected);
  const [list, setList] = useState<'all' | 'used'>('all');
  const style = request.styles.find((s) => s.name === selected);
  const [draft, setDraft] = useState<TextStyleSettings | undefined>(style?.settings);
  const [useBigFont, setUseBigFont] = useState(style ? style.settings.bigFont !== '' : false);
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [naming, setNaming] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const id = useId();

  const send = (textstyle: TextStyleAction) =>
    answer(doc, { kind: 'dialog', action: 'apply', textstyle });
  const close = () => answer(doc, { kind: 'dialog', action: 'ok' });
  const styles = request.styles.filter(
    (s) => list === 'all' || s.used || s.name === request.current,
  );
  const readOnly = style?.xref === true;
  const shown: TextStyleSettings | undefined = draft && {
    ...draft,
    bigFont: useBigFont ? draft.bigFont : '',
  };
  const modified = !!style && !!shown && !same(shown, style.settings);
  const problem = shown && textStyleProblem(shown);

  const select = (name: string) => {
    const s = request.styles.find((x) => x.name === name);
    setSelected(name);
    setDraft(s?.settings);
    setUseBigFont(s ? s.settings.bigFont !== '' : false);
  };
  /** Runs `then`, asking first whether to apply changes the selected style has not taken. */
  const leave = (then: () => void, follows = true) => {
    if (modified && !readOnly) setPending({ then, follows });
    else then();
  };
  const apply = () => {
    if (style && shown && !problem) void send({ op: 'apply', name: style.name, settings: shown });
  };
  const set = (patch: Partial<TextStyleSettings>) => draft && setDraft({ ...draft, ...patch });

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const names = styles.map((s) => s.name);
      const i = names.indexOf(selected);
      const next =
        names[Math.max(0, Math.min(names.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next && next !== selected) leave(() => select(next), false);
    } else if (e.key === 'F2' && style) {
      e.preventDefault();
      setRenaming(style.name);
    } else if (e.key === 'Delete' && style) {
      e.preventDefault();
      void send({ op: 'delete', name: style.name });
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = (e.target as HTMLElement).getBoundingClientRect();
      setMenu({ x: r.left + 16, y: r.top + 16 });
    }
  };
  const contextMenu = (e: MouseEvent, name: string) => {
    e.preventDefault();
    if (name !== selected) leave(() => select(name), false);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const fontNames = merged(request.fonts, SHX_FONTS, fonts);
  const bigFontNames = merged(
    request.bigFonts,
    fonts.filter((f) => /\.shx$/i.test(f)),
  );
  const ttf = shown ? isTrueTypeFont(shown.font) : false;

  return (
    <Modal
      label="Text Style"
      className="textstyle-dialog"
      onOk={() => leave(close)}
      onCancel={() => leave(close)}
    >
      <p className="dimstyle-current">
        Current text style: <strong data-testid="textstyle-current">{request.current}</strong>
      </p>
      <div className="textstyle-body">
        <div className="dimstyle-left">
          <span id={`${id}-styles`}>Styles:</span>
          <ul
            role="listbox"
            aria-labelledby={`${id}-styles`}
            className="dimstyle-list"
            tabIndex={0}
            onKeyDown={keys}
          >
            {styles.map((s) => (
              <li
                key={s.name}
                role="option"
                aria-selected={s.name === selected}
                onClick={() => s.name !== selected && leave(() => select(s.name), false)}
                onDoubleClick={() => setRenaming(s.name)}
                onContextMenu={(e) => contextMenu(e, s.name)}
              >
                {renaming === s.name ? (
                  <RenameInput
                    name={s.name}
                    onDone={(to) => {
                      setRenaming(undefined);
                      if (to !== undefined && to !== s.name)
                        void send({ op: 'rename', name: s.name, to });
                    }}
                  />
                ) : (
                  <>
                    {s.name === request.current && <span aria-label="current">▸ </span>}
                    {s.annotative && <span aria-label="annotative">▲ </span>}
                    {s.name}
                  </>
                )}
              </li>
            ))}
          </ul>
          <label className="cad-dialog-field">
            <span className="visually-hidden">List</span>
            <select
              aria-label="List"
              value={list}
              onChange={(e) => setList(e.target.value as 'all' | 'used')}
            >
              <option value="all">All styles</option>
              <option value="used">Styles in use</option>
            </select>
          </label>
        </div>
        {shown && style ? (
          <div className="textstyle-groups">
            <fieldset disabled={readOnly}>
              <legend>Font</legend>
              <label className="cad-dialog-field">
                <span>Font Name:</span>
                <select
                  value={shown.font}
                  onChange={(e) => {
                    const font = e.target.value;
                    const toTtf = isTrueTypeFont(font);
                    set({
                      font,
                      ...(toTtf ? { vertical: false } : { bold: false, italic: false }),
                    });
                    if (toTtf) setUseBigFont(false);
                  }}
                >
                  {!fontNames.includes(shown.font) && (
                    <option value={shown.font}>{shown.font}</option>
                  )}
                  {fontNames.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              {useBigFont && !ttf ? (
                <label className="cad-dialog-field">
                  <span>Big Font:</span>
                  <select value={shown.bigFont} onChange={(e) => set({ bigFont: e.target.value })}>
                    {!bigFontNames.includes(shown.bigFont) && (
                      <option value={shown.bigFont}>{shown.bigFont}</option>
                    )}
                    {bigFontNames.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="cad-dialog-field">
                  <span>Font Style:</span>
                  <select
                    value={fontStyleOf(shown)}
                    disabled={!ttf}
                    onChange={(e) => {
                      const v = e.target.value as FontStyle;
                      set({ bold: v.startsWith('Bold'), italic: v.endsWith('Italic') });
                    }}
                  >
                    {FONT_STYLES.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="cad-dialog-check">
                <input
                  type="checkbox"
                  checked={useBigFont && !ttf}
                  disabled={ttf}
                  onChange={(e) => {
                    setUseBigFont(e.target.checked);
                    if (e.target.checked && draft && draft.bigFont === '')
                      set({ bigFont: bigFontNames[0] ?? '' });
                  }}
                />
                Use Big Font
              </label>
            </fieldset>
            <fieldset disabled={readOnly}>
              <legend>Size</legend>
              <label className="cad-dialog-check">
                <input type="checkbox" checked={style.annotative} disabled />
                Annotative
              </label>
              <NumberField
                label="Height"
                value={shown.height}
                onChange={(height) => set({ height })}
              />
            </fieldset>
            <fieldset disabled={readOnly}>
              <legend>Effects</legend>
              <label className="cad-dialog-check">
                <input
                  type="checkbox"
                  checked={shown.upsideDown}
                  onChange={(e) => set({ upsideDown: e.target.checked })}
                />
                Upside down
              </label>
              <label className="cad-dialog-check">
                <input
                  type="checkbox"
                  checked={shown.backwards}
                  onChange={(e) => set({ backwards: e.target.checked })}
                />
                Backwards
              </label>
              <label className="cad-dialog-check">
                <input
                  type="checkbox"
                  checked={shown.vertical && !ttf}
                  disabled={ttf}
                  onChange={(e) => set({ vertical: e.target.checked })}
                />
                Vertical
              </label>
              <NumberField
                label="Width Factor"
                value={shown.widthFactor}
                onChange={(widthFactor) => set({ widthFactor })}
              />
              <NumberField
                label="Oblique Angle"
                value={shown.obliqueAngle}
                onChange={(obliqueAngle) => set({ obliqueAngle })}
              />
            </fieldset>
          </div>
        ) : (
          <div className="textstyle-groups" />
        )}
        <div className="dimstyle-buttons textstyle-buttons">
          <button
            type="button"
            disabled={!style || readOnly || style.name === request.current}
            onClick={() => style && leave(() => void send({ op: 'current', name: style.name }))}
          >
            Set Current
          </button>
          <button type="button" disabled={!shown} onClick={() => setNaming(true)}>
            New...
          </button>
          <button
            type="button"
            disabled={!style}
            onClick={() => style && void send({ op: 'delete', name: style.name })}
          >
            Delete
          </button>
        </div>
      </div>
      {(problem ?? request.note) !== undefined && (
        <p className="dimstyle-note" role="status">
          {problem ?? request.note}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" disabled={!modified || readOnly || !!problem} onClick={apply}>
          Apply
        </button>
        <button type="button" onClick={() => leave(close)}>
          Close
        </button>
      </div>
      {menu && style && (
        <div
          role="menu"
          aria-label="Style"
          className="dimstyle-menu"
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setMenu(undefined);
            }
          }}
          onMouseLeave={() => setMenu(undefined)}
        >
          {(
            [
              ['Set current', () => leave(() => void send({ op: 'current', name: style.name }))],
              ['Rename', () => setRenaming(style.name)],
              ['Delete', () => void send({ op: 'delete', name: style.name })],
            ] as const
          ).map(([label, act]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(undefined);
                act();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {naming && shown && (
        <NewTextStyle
          suggested={nextStyleName(request.styles.map((s) => s.name))}
          onCancel={() => setNaming(false)}
          onOk={(name) => {
            setNaming(false);
            void send({ op: 'new', name, settings: shown });
          }}
        />
      )}
      {pending && style && shown && (
        <Modal
          label="Text Style - Apply Changes"
          onOk={() => {
            setPending(undefined);
            if (problem) return;
            void send({ op: 'apply', name: style.name, settings: shown });
            if (pending.follows) pending.then();
          }}
          onCancel={() => setPending(undefined)}
        >
          <p>The current style has been modified. Do you want to save your changes?</p>
          <div className="cad-dialog-buttons">
            <button
              type="button"
              disabled={!!problem}
              onClick={() => {
                setPending(undefined);
                // Applied first: the engine takes the answers in order.
                void send({ op: 'apply', name: style.name, settings: shown });
                if (pending.follows) pending.then();
              }}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => {
                setPending(undefined);
                pending.then();
              }}
            >
              No
            </button>
            <button type="button" onClick={() => setPending(undefined)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/** "New Text Style": Style Name, OK, Cancel. */
function NewTextStyle(props: {
  suggested: string;
  onCancel: () => void;
  onOk: (name: string) => void;
}) {
  const [name, setName] = useState(props.suggested);
  const ok = () => name.trim() !== '' && props.onOk(name.trim());
  return (
    <Modal label="New Text Style" onOk={ok} onCancel={props.onCancel}>
      <label className="cad-dialog-field">
        <span>Style Name:</span>
        <input
          type="text"
          autoFocus
          value={name}
          maxLength={255}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" disabled={name.trim() === ''} onClick={ok}>
          OK
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function RenameInput({ name, onDone }: { name: string; onDone: (to?: string) => void }) {
  const [text, setText] = useState(name);
  return (
    <input
      type="text"
      aria-label="New name"
      autoFocus
      value={text}
      maxLength={255}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text.trim())}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onDone(text.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onDone(undefined);
        }
      }}
    />
  );
}

/** A typed number, set as each keystroke makes one; text that is not one shows until blur. */
function NumberField(props: { label: string; value: number; onChange: (v: number) => void }) {
  const shown = String(Number(props.value.toPrecision(10)));
  const [text, setText] = useState<string>();
  return (
    <label className="cad-dialog-field">
      <span>{props.label}:</span>
      <input
        type="text"
        inputMode="decimal"
        value={text ?? shown}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(v)) props.onChange(v);
        }}
        onBlur={() => setText(undefined)}
      />
    </label>
  );
}
