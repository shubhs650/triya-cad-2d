// M3-10 part 2: the keyboard map (AutoCAD's default shortcut keys) and the user's keys over it.
import { describe, expect, it } from 'vitest';
import {
  BROWSER_KEYS,
  KEY_ACTIONS,
  Keymap,
  assignable,
  chordOf,
  commandOf,
  keepsForText,
  keyAction,
  keysText,
  normalizeChord,
  normalizeKeyOverrides,
  type KeyPress,
} from '../src/keymap';

const press = (
  key: string,
  o: { shift?: boolean; meta?: boolean; alt?: boolean; ctrl?: boolean; code?: string } = {},
): KeyPress => ({
  key,
  ...(o.code !== undefined && { code: o.code }),
  ctrlKey: o.ctrl ?? (!o.meta && o.ctrl !== false),
  metaKey: o.meta === true,
  shiftKey: o.shift === true,
  altKey: o.alt === true,
});
const plain = (key: string, o: { shift?: boolean; code?: string } = {}) =>
  press(key, { ...o, ctrl: false });

describe('chordOf', () => {
  it('writes chords as AutoCAD does: Ctrl, Alt, Shift, then the key', () => {
    expect(chordOf(press('p', { shift: true }))).toBe('Ctrl+Shift+P');
    expect(chordOf(press('P', { shift: true, alt: true }))).toBe('Ctrl+Alt+Shift+P');
    expect(chordOf(press('1'))).toBe('Ctrl+1');
    expect(chordOf(plain('F3'))).toBe('F3');
    expect(chordOf(plain('f10'))).toBe('F10');
    expect(chordOf(press('PageUp', { shift: true }))).toBe('Ctrl+Shift+PageUp');
    expect(chordOf(press(' '))).toBe('Ctrl+Space');
    expect(chordOf(plain('a'))).toBe('A');
  });

  it('takes Cmd on a Mac for Ctrl', () => {
    expect(chordOf(press('z', { meta: true }))).toBe('Ctrl+Z');
    expect(chordOf(press('Z', { meta: true, shift: true }))).toBe('Ctrl+Shift+Z');
  });

  it('names the physical letter or digit, whatever Shift or Option types', () => {
    expect(chordOf(press('!', { shift: true, code: 'Digit1' }))).toBe('Ctrl+Shift+1');
    expect(chordOf(press('π', { alt: true, ctrl: false, code: 'KeyP' }))).toBe('Alt+P');
  });

  it('names the physical punctuation key, whatever Shift types (M3-06 part 5)', () => {
    expect(chordOf(plain('>', { shift: true, code: 'Period' }))).toBe('Shift+.');
    expect(chordOf(plain('<', { shift: true, code: 'Comma' }))).toBe('Shift+,');
    expect(chordOf(plain(':', { shift: true, code: 'Semicolon' }))).toBe('Shift+;');
    expect(chordOf(plain('"', { shift: true, code: 'Quote' }))).toBe("Shift+'");
    expect(chordOf(plain('}', { shift: true, code: 'BracketRight' }))).toBe('Shift+]');
  });

  it('has no chord for a modifier alone', () => {
    expect(chordOf(press('Control'))).toBeUndefined();
    expect(chordOf(plain('Shift', { shift: true }))).toBeUndefined();
    expect(chordOf(press('Meta', { meta: true }))).toBeUndefined();
    expect(chordOf(plain('Dead'))).toBeUndefined();
    expect(chordOf(plain('MediaPlayPause'))).toBeUndefined();
  });
});

describe('normalizeChord', () => {
  it('reads chords as people write them', () => {
    expect(normalizeChord('ctrl+shift+p')).toBe('Ctrl+Shift+P');
    expect(normalizeChord('Shift + Ctrl + s')).toBe('Ctrl+Shift+S');
    expect(normalizeChord('Cmd+K')).toBe('Ctrl+K');
    expect(normalizeChord('Option+F1')).toBe('Alt+F1');
    expect(normalizeChord('f12')).toBe('F12');
    expect(normalizeChord('Ctrl+pageup')).toBe('Ctrl+PageUp');
    expect(normalizeChord('Ctrl++')).toBe('Ctrl++');
  });

  it('refuses what is not a chord', () => {
    expect(normalizeChord('')).toBeUndefined();
    expect(normalizeChord('Hyper+K')).toBeUndefined();
    expect(normalizeChord('Ctrl+Banana')).toBeUndefined();
  });
});

describe('assignable', () => {
  it('takes function keys and keys with Ctrl or Alt', () => {
    expect(assignable('F1')).toBe(true);
    expect(assignable('Shift+F5')).toBe(true);
    expect(assignable('Ctrl+L')).toBe(true);
    expect(assignable('Alt+Shift+L')).toBe(true);
    expect(assignable('Ctrl+Enter')).toBe(true);
  });

  it('takes Shift alone or Shift with a typing key for a held override (M3-06 part 5)', () => {
    expect(assignable('Shift', true)).toBe(true);
    expect(assignable('Shift+E', true)).toBe(true);
    expect(assignable('Shift+.', true)).toBe(true);
    expect(assignable('E', true)).toBe(false);
    expect(assignable('Ctrl+Shift+E', true)).toBe(false);
    expect(assignable('Shift+F3', true)).toBe(false);
    expect(assignable('Shift+Space', true)).toBe(false);
    expect(assignable('Shift')).toBe(false);
    expect(normalizeChord('shift')).toBe('Shift');
    expect(normalizeKeyOverrides({ 'override:END': ['Shift+N', 'Ctrl+N'] })).toEqual({
      'override:END': ['Shift+N'],
    });
  });

  it('leaves typing keys and Esc, Enter, Tab and Space to the command line', () => {
    expect(assignable('L')).toBe(false);
    expect(assignable('Shift+L')).toBe(false);
    expect(assignable('Escape')).toBe(false);
    expect(assignable('Enter')).toBe(false);
    expect(assignable('Shift+Tab')).toBe(false);
    expect(assignable('Space')).toBe(false);
  });
});

describe('the default keyboard map', () => {
  const map = new Keymap();
  const run = (key: string, o?: Parameters<typeof press>[1]) =>
    map.actionFor(chordOf(press(key, o))!);

  it("has AutoCAD's function keys", () => {
    expect(
      ['F2', 'F3', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].map((k) => map.actionFor(k)),
    ).toEqual([
      'history',
      'drafting:osnap',
      'drafting:grid',
      'drafting:ortho',
      'drafting:snap',
      'drafting:polar',
      'drafting:otrack',
      'dyn',
    ]);
  });

  it("has AutoCAD's Ctrl keys for the drafting aids", () => {
    expect(['F', 'G', 'L', 'B', 'U'].map((k) => map.actionFor(`Ctrl+${k}`))).toEqual([
      'drafting:osnap',
      'drafting:grid',
      'drafting:ortho',
      'drafting:snap',
      'drafting:polar',
    ]);
    expect(map.actionFor('Ctrl+Shift+P')).toBe('drafting:qp');
    expect(map.actionFor('Ctrl+W')).toBe('drafting:sc');
    // M3-08's group selection: AutoCAD's Toggle Groups and PICKSTYLE keys.
    expect(map.actionFor('Ctrl+Shift+A')).toBe('drafting:groups');
    expect(map.actionFor('Ctrl+H')).toBe('drafting:groups');
    expect(map.keysOf('drafting:osnap')).toEqual(['F3', 'Ctrl+F']);
  });

  it('binds the Clipboard keys as AutoCAD does (M2-14 part 2)', () => {
    expect(run('c')).toBe('command:COPYCLIP');
    expect(run('x')).toBe('command:CUTCLIP');
    expect(run('v')).toBe('command:PASTECLIP');
    expect(run('C', { shift: true })).toBe('command:COPYBASE');
    expect(run('V', { shift: true })).toBe('command:PASTEBLOCK');
    expect(run('v', { meta: true })).toBe('command:PASTECLIP');
    expect(run('x', { shift: true })).toBeUndefined();
    expect(run('c', { alt: true })).toBeUndefined();
    expect(map.actionFor('C')).toBeUndefined();
  });

  it('binds Ctrl+Z to U and Ctrl+Y to REDO (M2-23), Cmd+Shift+Z too', () => {
    expect(run('z')).toBe('command:U');
    expect(run('Z')).toBe('command:U');
    expect(run('y')).toBe('command:REDO');
    expect(run('z', { meta: true })).toBe('command:U');
    expect(run('Z', { shift: true, meta: true })).toBe('command:REDO');
    expect(run('z', { alt: true })).toBeUndefined();
    expect(run('y', { shift: true })).toBeUndefined();
  });

  it('has the file, window and command line keys', () => {
    expect(
      [
        'Ctrl+N',
        'Ctrl+O',
        'Ctrl+S',
        'Ctrl+Shift+S',
        'Ctrl+P',
        'Ctrl+1',
        'Ctrl+K',
        'Ctrl+A',
        'Ctrl+J',
        'Ctrl+M',
      ].map((k) => map.actionFor(k)),
    ).toEqual([
      'file:new',
      'file:open',
      'file:save',
      'file:saveas',
      'command:PLOT',
      'properties',
      'palette',
      'select-all',
      'enter',
      'enter',
    ]);
  });

  it('gives each key one action and every key is assignable', () => {
    const keys = KEY_ACTIONS.flatMap((a) => a.keys);
    expect(new Set(keys).size).toBe(keys.length);
    const bad = KEY_ACTIONS.flatMap((a) =>
      a.keys.filter((k) => !assignable(k, a.hold) || normalizeChord(k) !== k),
    );
    expect(bad).toEqual([]);
    expect(new Set(KEY_ACTIONS.map((a) => a.id)).size).toBe(KEY_ACTIONS.length);
  });

  // M3-06 part 5: AutoCAD's temporary override keys (acad.cuix's Temporary Overrides), held.
  it("has AutoCAD's temporary override keys, held", () => {
    const map = new Keymap();
    const held = KEY_ACTIONS.filter((a) => a.hold).map((a) => [a.id, map.keysOf(a.id)]);
    expect(held).toEqual([
      ['override:ortho', ['Shift']],
      ['override:polar', ['Shift+X', 'Shift+.']],
      ['override:otrack', ['Shift+Q', 'Shift+]']],
      ['override:osnap', ['Shift+A', "Shift+'"]],
      ['override:disable', ['Shift+D', 'Shift+L']],
      ['override:enforce', ['Shift+S', 'Shift+;']],
      ['override:END', ['Shift+E', 'Shift+P']],
      ['override:MID', ['Shift+M', 'Shift+V']],
      ['override:CEN', ['Shift+C', 'Shift+,']],
    ]);
    expect(KEY_ACTIONS.filter((a) => a.hold).every((a) => a.group === 'Temporary Override')).toBe(
      true,
    );
  });

  it('knows the keys a browser tab keeps', () => {
    expect(BROWSER_KEYS.has('Ctrl+W')).toBe(true);
    expect(BROWSER_KEYS.has('Ctrl+P')).toBe(false);
  });

  // M7-06: AutoCAD 2024's default shortcut keys (acad.cuix's Shortcut Keys, Help's "Keyboard
  // Shortcuts Reference"), every one: the action Triya runs for it, or null with the reason it
  // has none. A key added to or left out of the map changes this table.
  const AUTOCAD_KEYS: Readonly<Record<string, string | readonly [null, string]>> = {
    F1: [null, 'Help: Triya has no help window (M7-07 has the learn links)'],
    F2: 'history',
    'Ctrl+F2': 'history',
    F3: 'drafting:osnap',
    F4: [null, '3D Object Snap: PRD non-goal 1'],
    F5: [null, 'Isoplane: PRD non-goal 7'],
    F6: [null, 'Dynamic UCS: PRD non-goal 1'],
    F7: 'drafting:grid',
    F8: 'drafting:ortho',
    F9: 'drafting:snap',
    F10: 'drafting:polar',
    F11: 'drafting:otrack',
    F12: 'dyn',
    'Alt+F8': [null, 'VBA macros: PRD non-goal 9'],
    'Alt+F11': [null, 'VBA editor: PRD non-goal 9'],
    'Ctrl+0': 'cleanscreen',
    'Ctrl+1': 'properties',
    'Ctrl+2': 'designcenter',
    'Ctrl+3': [null, 'Tool Palettes: Triya has none (DesignCenter holds the library)'],
    'Ctrl+4': [null, 'Sheet Set Manager: PRD non-goal 8'],
    'Ctrl+6': [null, 'dbConnect: PRD non-goal 4 (no linked data)'],
    'Ctrl+7': [null, 'Markup Set Manager: DWF markups, PRD non-goal 8'],
    'Ctrl+8': [null, 'QuickCalc: Triya has no calculator'],
    'Ctrl+9': [null, 'Command line on/off: M7-06 part 3'],
    'Ctrl+A': 'select-all',
    'Ctrl+Shift+A': 'drafting:groups',
    'Ctrl+B': 'drafting:snap',
    'Ctrl+C': 'command:COPYCLIP',
    'Ctrl+Shift+C': 'command:COPYBASE',
    'Ctrl+D': [null, 'Dynamic UCS: PRD non-goal 1'],
    'Ctrl+E': [null, 'Isoplane: PRD non-goal 7'],
    'Ctrl+F': 'drafting:osnap',
    'Ctrl+G': 'drafting:grid',
    'Ctrl+H': 'drafting:groups',
    'Ctrl+Shift+H': 'palettes',
    'Ctrl+I': [null, 'COORDS: M7-06 part 3'],
    'Ctrl+Shift+I': [null, 'Infer Constraints: M9-05'],
    'Ctrl+J': 'enter',
    'Ctrl+M': 'enter',
    // AutoCAD's HYPERLINK: Triya has no hyperlinks to edit, and Ctrl+K is its command palette.
    'Ctrl+K': 'palette',
    'Ctrl+L': 'drafting:ortho',
    'Ctrl+N': 'file:new',
    'Ctrl+O': 'file:open',
    'Ctrl+P': 'command:PLOT',
    'Ctrl+Shift+P': 'drafting:qp',
    'Ctrl+Q': 'command:QUIT',
    'Ctrl+R': 'viewport:next',
    'Ctrl+S': 'file:save',
    'Ctrl+Shift+S': 'file:saveas',
    'Ctrl+T': [null, 'Tablet: PRD non-goal 11'],
    'Ctrl+U': 'drafting:polar',
    'Ctrl+V': 'command:PASTECLIP',
    'Ctrl+Shift+V': 'command:PASTEBLOCK',
    'Ctrl+W': 'drafting:sc',
    'Ctrl+X': 'command:CUTCLIP',
    'Ctrl+Y': 'command:REDO',
    'Ctrl+Z': 'command:U',
    'Ctrl+[': 'cancel',
    'Ctrl+\\': 'cancel',
    'Ctrl+PageUp': 'layout:previous',
    'Ctrl+PageDown': 'layout:next',
    'Ctrl+Tab': 'file:nextdoc',
    'Ctrl+Shift+Tab': 'file:previousdoc',
  };

  it("has every one of AutoCAD's default keys, or says why not (M7-06)", () => {
    const got = Object.fromEntries(
      Object.entries(AUTOCAD_KEYS).map(([k, want]) => [
        k,
        typeof want === 'string' ? map.actionFor(k) : map.actionFor(k) === undefined ? want : k,
      ]),
    );
    expect(got).toEqual(AUTOCAD_KEYS);
  });

  it("has no default key but AutoCAD's, the Mac's redo and Windows' drawing keys (M7-06)", () => {
    // Triya's own: the Mac's redo key, and Windows' keys for the next and previous document
    // window (Ctrl+F6, Ctrl+Shift+F6), which a browser tab lets through where Ctrl+Tab is kept.
    const extra = ['Ctrl+F6', 'Ctrl+Shift+F6', 'Ctrl+Shift+Z'];
    const own = KEY_ACTIONS.filter((a) => !a.hold)
      .flatMap((a) => a.keys)
      .filter((k) => !(k in AUTOCAD_KEYS));
    expect(own).toEqual(extra);
    expect(extra.map((k) => map.actionFor(k))).toEqual([
      'file:nextdoc',
      'file:previousdoc',
      'command:REDO',
    ]);
  });
});

describe('the user keys over the defaults', () => {
  it('gives any command a key, taking it from its default owner', () => {
    const next = new Keymap().assign('command:LINE', 'Ctrl+L');
    expect(next).toEqual({ 'command:LINE': ['Ctrl+L'], 'drafting:ortho': ['F8'] });
    const map = new Keymap(next);
    expect(map.actionFor('Ctrl+L')).toBe('command:LINE');
    expect(map.keysOf('drafting:ortho')).toEqual(['F8']);
    expect(map.keysOf('command:LINE')).toEqual(['Ctrl+L']);
    expect(map.actions().map((a) => a.id)).toContain('command:LINE');
  });

  it('removes a key and puts an action back on its defaults', () => {
    const map = new Keymap(new Keymap().remove('drafting:osnap', 'Ctrl+F'));
    expect(map.overrides).toEqual({ 'drafting:osnap': ['F3'] });
    expect(map.actionFor('Ctrl+F')).toBeUndefined();
    expect(map.actionFor('F3')).toBe('drafting:osnap');
    expect(map.restore('drafting:osnap')).toEqual({});
  });

  it('keeps no override that says what the defaults say', () => {
    const map = new Keymap(new Keymap().remove('drafting:osnap', 'Ctrl+F'));
    expect(map.assign('drafting:osnap', 'Ctrl+F')).toEqual({});
    expect(new Keymap().assign('drafting:osnap', 'F3')).toEqual({});
  });

  it('moves a key from one command to another, a command left without keys dropped', () => {
    const map = new Keymap({ 'command:LINE': ['Ctrl+Alt+L'] });
    expect(map.assign('command:CIRCLE', 'Ctrl+Alt+L')).toEqual({
      'command:CIRCLE': ['Ctrl+Alt+L'],
    });
    expect(map.assign('command:LINE', 'Ctrl+Alt+L')).toBe(map.overrides);
  });

  it("lets the user's keys win over a default owner even unsaved as such", () => {
    const map = new Keymap({ 'command:LINE': ['Ctrl+L'] });
    expect(map.actionFor('Ctrl+L')).toBe('command:LINE');
    expect(map.keysOf('drafting:ortho')).toEqual(['F8']);
  });

  it('reads stored overrides, leaving out what it cannot use', () => {
    expect(
      normalizeKeyOverrides({
        'command:LINE': ['ctrl+alt+l', 'L', 'Ctrl+Alt+L', 7],
        'drafting:osnap': [],
        'no-such-action': ['F1'],
        'command:lower': ['F1'],
        'drafting:grid': 'F7',
      }),
    ).toEqual({ 'command:LINE': ['Ctrl+Alt+L'], 'drafting:osnap': [] });
    expect(normalizeKeyOverrides(undefined)).toEqual({});
    expect(normalizeKeyOverrides([1])).toEqual({});
  });

  it('names actions, commands among them', () => {
    expect(keyAction('drafting:osnap')?.label).toBe('Object Snap on/off');
    expect(keyAction('command:LINE')).toEqual({
      id: 'command:LINE',
      label: 'LINE',
      group: 'Command',
      keys: [],
    });
    expect(keyAction('bogus')).toBeUndefined();
    expect(commandOf('command:-PLOT')).toBe('-PLOT');
    expect(keysText(['F3', 'Ctrl+F'])).toBe('F3, Ctrl+F');
  });
});

describe('keepsForText', () => {
  const none = { kind: 'none', empty: true } as const;
  const emptyCommand = { kind: 'command', empty: true } as const;
  const typedCommand = { kind: 'command', empty: false } as const;
  const emptyInput = { kind: 'input', empty: true } as const;
  const typedInput = { kind: 'input', empty: false } as const;
  const text = { kind: 'text', empty: true } as const;

  it('leaves Ctrl+A to a field holding text', () => {
    expect(
      [none, emptyCommand, typedCommand, emptyInput, typedInput, text].map((f) =>
        keepsForText('Ctrl+A', f),
      ),
    ).toEqual([false, false, true, false, true, true]);
  });

  it('leaves the Clipboard and undo keys wherever text is typed but an empty command line', () => {
    for (const k of ['Ctrl+C', 'Ctrl+V', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z']) {
      expect(
        [none, emptyCommand, typedCommand, emptyInput, typedInput, text].map((f) =>
          keepsForText(k, f),
        ),
      ).toEqual([false, false, true, true, true, true]);
    }
  });

  it('leaves bold, italic and underline to a text editor, and the rest to the map', () => {
    expect(keepsForText('Ctrl+B', text)).toBe(true);
    expect(keepsForText('Ctrl+B', typedInput)).toBe(false);
    expect(keepsForText('F3', text)).toBe(false);
    expect(keepsForText('Ctrl+P', typedCommand)).toBe(false);
  });
});
