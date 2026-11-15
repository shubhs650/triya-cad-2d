// The Keyboard Shortcuts dialog (M3-10 part 2, PRD FR-C5): AutoCAD's CUI editor's Keyboard
// Shortcuts > Shortcut Keys, for the keyboard map. The list shows every action with keys, its
// Keys and Category, as the CUI's Shortcut Keys pane does; searching lists every command too, so
// any command can take a key. The selected action's keys can be removed, and a new key pressed
// in "Press new shortcut key" shows what it is "Currently assigned to" before Assign moves it
// (AutoCAD's Shortcut Keys dialog). OK keeps the map with the settings and every key follows it
// at once; Esc or Cancel leaves it unchanged.
import { useMemo, useState } from 'react';
import { Modal } from './AttributeDialogs';
import {
  BROWSER_KEYS,
  Keymap,
  assignable,
  chordOf,
  keyAction,
  type Chord,
  type KeyAction,
  type KeyOverrides,
} from './keymap';
import { appRegistry } from './user-aliases';

/** Whether Triya runs as the installed app, whose window hears the keys a browser tab keeps. */
function installedApp(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
}

/** The actions the list shows for a search: names, command names and keys, case ignored. */
export function shortcutRows(map: Keymap, commands: readonly string[], query: string): KeyAction[] {
  const listed = map.actions();
  const q = query.trim().toUpperCase();
  if (q === '') return [...listed];
  const ids = new Set(listed.map((a) => a.id));
  const all = [
    ...listed,
    ...commands.filter((c) => !ids.has(`command:${c}`)).map((c) => keyAction(`command:${c}`)!),
  ];
  return all.filter(
    (a) =>
      a.label.toUpperCase().includes(q) ||
      map.keysOf(a.id).some((k) => k.toUpperCase().includes(q)),
  );
}

export function KeyboardShortcuts({
  overrides,
  onOk,
  onCancel,
}: {
  /** The user's keys kept now. */
  overrides: KeyOverrides;
  onOk: (overrides: KeyOverrides) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(overrides);
  const map = useMemo(() => new Keymap(draft), [draft]);
  const [query, setQuery] = useState('');
  const rows = useMemo(() => shortcutRows(map, appRegistry.names(), query), [map, query]);
  const [selected, setSelected] = useState<string | undefined>(rows[0]?.id);
  const row = rows.find((r) => r.id === selected) ?? rows[0];
  const [pending, setPending] = useState<Chord | undefined>();
  const installed = useMemo(installedApp, []);
  const browserKey = (k: Chord) => !installed && BROWSER_KEYS.has(k);

  const owner = pending === undefined ? undefined : map.actionFor(pending);
  const problem =
    pending === undefined
      ? undefined
      : !assignable(pending)
        ? 'Shortcut keys need Ctrl or Alt, or a function key (F1–F12): keys typed alone go to the command line, where aliases name commands.'
        : undefined;
  const canAssign = row !== undefined && pending !== undefined && !problem && owner !== row.id;
  const select = (id: string) => {
    setSelected(id);
    setPending(undefined);
  };
  const assign = () => {
    if (!canAssign) return;
    setDraft(map.assign(row.id, pending));
    setPending(undefined);
  };
  const keysCell = (id: string) =>
    map
      .keysOf(id)
      .map((k) => (browserKey(k) ? `${k} †` : k))
      .join(', ');

  return (
    <Modal
      label="Keyboard Shortcuts"
      className="keyboard-shortcuts"
      onOk={() => onOk(draft)}
      onCancel={onCancel}
    >
      <label className="keyboard-shortcuts-search">
        Search
        <input
          type="search"
          value={query}
          placeholder="Command, action or key"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="keyboard-shortcuts-list">
        <table className="eattedit-list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Keys</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody
            role="listbox"
            aria-label="Shortcut keys"
            tabIndex={0}
            onKeyDown={(e) => {
              const i = rows.findIndex((r) => r.id === row?.id);
              const next =
                e.key === 'ArrowDown' ? rows[i + 1] : e.key === 'ArrowUp' ? rows[i - 1] : undefined;
              if (next) {
                e.preventDefault();
                select(next.id);
              }
            }}
          >
            {rows.map((r) => (
              <tr
                key={r.id}
                role="option"
                aria-selected={r.id === row?.id}
                onClick={() => select(r.id)}
              >
                <td>{r.label}</td>
                <td>{keysCell(r.id)}</td>
                <td>{r.group}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="keyboard-shortcuts-empty">Nothing matches.</p>}
      </div>
      {row && (
        <fieldset className="keyboard-shortcuts-edit">
          <legend>{row.label}</legend>
          <ul className="keyboard-shortcuts-keys" aria-label="Keys">
            {map.keysOf(row.id).map((k) => (
              <li key={k}>
                <kbd>{k}</kbd>
                {browserKey(k) && ' †'}
                <button
                  type="button"
                  aria-label={`Remove ${k}`}
                  onClick={() => setDraft(map.remove(row.id, k))}
                >
                  Remove
                </button>
              </li>
            ))}
            {map.keysOf(row.id).length === 0 && <li>No keys</li>}
          </ul>
          <label className="keyboard-shortcuts-press">
            Press new shortcut key:
            <input
              readOnly
              value={pending ?? ''}
              placeholder="Press keys"
              onKeyDown={(e) => {
                const chord = chordOf(e.nativeEvent);
                // Tab moves on, Esc cancels the dialog; Enter assigns the key pressed.
                if (chord === undefined || chord === 'Tab' || chord === 'Shift+Tab') return;
                if (chord === 'Escape') return;
                if (chord === 'Enter' && canAssign) {
                  e.preventDefault();
                  e.stopPropagation();
                  assign();
                  return;
                }
                if (chord === 'Enter') return;
                e.preventDefault();
                e.stopPropagation();
                setPending(chord === 'Backspace' || chord === 'Delete' ? undefined : chord);
              }}
            />
          </label>
          {pending !== undefined && (
            <p className="keyboard-shortcuts-owner" aria-live="polite">
              Currently assigned to: {owner === undefined ? 'unassigned' : keyAction(owner)?.label}
            </p>
          )}
          {problem && <p className="keyboard-shortcuts-problem">{problem}</p>}
          <div className="keyboard-shortcuts-row">
            <button type="button" disabled={!canAssign} onClick={assign}>
              Assign
            </button>
            <button
              type="button"
              disabled={draft[row.id] === undefined}
              onClick={() => {
                setDraft(map.restore(row.id));
                setPending(undefined);
              }}
            >
              Default keys
            </button>
          </div>
        </fieldset>
      )}
      {!installed && (
        <p className="keyboard-shortcuts-note">
          † A browser tab keeps Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+Page Up/Down for itself:
          these keys reach Triya when it runs as an installed app.
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button
          type="button"
          disabled={Object.keys(draft).length === 0}
          onClick={() => {
            setDraft({});
            setPending(undefined);
          }}
        >
          Reset All
        </button>
        <span className="alias-editor-gap" />
        <button type="button" onClick={() => onOk(draft)}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
