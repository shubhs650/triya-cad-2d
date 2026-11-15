// M2-02: the command line's mirror of a drawing's command engine (history, prompt, recall),
// completion as AutoCAD's AUTOCOMPLETE offers it, and the prompt split around its options.
import {
  builtinCommands,
  DECIMAL_UNITS,
  DEFAULT_ANGLES,
  type CommandOutput,
  type Prompt,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  CommandLines,
  IDLE,
  clipboardCommand,
  completions,
  follow,
  holdsKey,
  promptParts,
  replayAhead,
  typed,
  variableNames,
} from '../src/command-line';

describe('the command line state', () => {
  it('follows the log, the prompt and the return to Command:', () => {
    const outputs: CommandOutput[] = [
      { type: 'start', command: 'LINE', transparent: false },
      { type: 'log', line: 'Command: L' },
      {
        type: 'prompt',
        prompt: { kind: 'point', message: 'Specify first point' },
        text: 'Specify first point:',
        units: { ...DECIMAL_UNITS, lunits: 4 },
        angles: DEFAULT_ANGLES,
      },
      { type: 'change', change: {} },
    ];
    const s = outputs.reduce(follow, IDLE);
    expect(s.lines).toEqual(['Command: L']);
    expect(s.promptText).toBe('Specify first point:');
    expect(s.prompt?.kind).toBe('point');
    // Dynamic Input shows the cursor's values in the units the prompt came with (M2-35 part 20).
    expect(s.units).toEqual({ units: { ...DECIMAL_UNITS, lunits: 4 }, angles: DEFAULT_ANGLES });
    const idle = follow(s, { type: 'idle' });
    expect([idle.prompt, idle.promptText]).toEqual([undefined, 'Command:']);
  });

  it('shows no prompt while a command waits on a dialog (M2-41)', () => {
    const at: CommandOutput = {
      type: 'prompt',
      prompt: { kind: 'point', message: 'Specify opposite corner' },
      text: 'Specify opposite corner:',
      units: DECIMAL_UNITS,
      angles: DEFAULT_ANGLES,
    };
    const s = follow(follow(IDLE, at), { type: 'waiting', command: 'PLOT' });
    expect([s.prompt, s.promptText]).toEqual([undefined, '']);
  });

  it('keeps typed input for recall, without blanks or repeats', () => {
    const s = ['L', 'L', '  ', '0,0'].reduce(typed, IDLE);
    expect(s.recent).toEqual(['L', '0,0']);
  });

  it('keeps one state per drawing and tells its listeners', () => {
    const lines = new CommandLines();
    let heard = 0;
    const stop = lines.subscribe(() => heard++);
    lines.follow(1, { type: 'log', line: 'Command: L' });
    lines.typed(2, 'L');
    lines.follow(1, { type: 'preview', geometry: [] });
    expect(lines.get(1).lines).toEqual(['Command: L']);
    expect(lines.get(2).recent).toEqual(['L']);
    expect([heard, lines.version()]).toEqual([2, 2]);
    lines.forget(2);
    lines.forget(3);
    expect(lines.get(2)).toBe(IDLE);
    expect(heard).toBe(3);
    stop();
    lines.typed(1, 'X');
    expect(heard).toBe(3);
  });
});

describe('type-ahead (M2-47 part 3)', () => {
  const name: Prompt = { kind: 'string', message: 'Enter view name to save', spaces: true };
  const option: Prompt = { kind: 'keyword', message: 'Enter an option', options: ['Save'] };

  it('counts the input sent and the input the engine has read', () => {
    const lines = new CommandLines();
    expect([lines.send(1), lines.send(1), lines.send(2)]).toEqual([1, 2, 1]);
    expect(lines.get(1)).toMatchObject({ sent: 2, read: 0 });
    lines.follow(1, { type: 'read', seq: 1 });
    expect(lines.get(1)).toMatchObject({ sent: 2, read: 1 });
    // Reads come in order; an older one never moves it back.
    lines.follow(1, { type: 'read', seq: 2 });
    lines.follow(1, { type: 'read', seq: 1 });
    expect(lines.get(1).read).toBe(2);
  });

  it('holds every key typed before the engine read the last input, and every key after it', () => {
    const reading = { ...IDLE, sent: 2, read: 1 };
    const caughtUp = { ...IDLE, sent: 2, read: 2 };
    // Only the prompt a key reaches knows whether a space is Enter, and whether Dynamic Input
    // reads a point as relative (M2-71), so letters and Enter wait for it too.
    for (const key of [' ', 'w', '5', 'Enter', 'Backspace']) {
      expect(holdsKey(reading, [], key)).toBe(true);
      expect(holdsKey(caughtUp, [], key)).toBe(false);
    }
    // Once a key is held, the keys after it are too, Tab (Dynamic Input's next field) with them.
    for (const key of ['w', ' ', 'Enter', 'Backspace', 'Tab']) {
      expect(holdsKey(caughtUp, [' '], key)).toBe(true);
    }
    // Keys that type nothing are not held; Tab alone still steps AutoSnap or completes.
    for (const key of ['Shift', 'ArrowUp', 'F2']) {
      expect(holdsKey(reading, [' '], key)).toBe(false);
    }
    expect(holdsKey(reading, [], 'Tab')).toBe(false);
    // Esc waits behind the keys typed before it, and cancels at once with nothing held, or when
    // pressed again.
    expect(holdsKey(reading, ['1'], 'Escape')).toBe(true);
    expect(holdsKey(reading, [], 'Escape')).toBe(false);
    expect(holdsKey(reading, ['1', 'Escape'], 'Escape')).toBe(false);
  });

  it('replays held keys on the prompt they reach: a space in a name is typed', () => {
    const keys = [' ', 'w', 'o', 'r', 'd', 's', 'Enter'];
    expect(replayAhead('Two', keys, name)).toEqual({ text: '', keys: [], submit: 'Two words' });
    expect(replayAhead('Two', keys.slice(0, -1), name)).toEqual({ text: 'Two words', keys: [] });
  });

  it('replays a space as Enter where it is one, and holds the rest for the next prompt', () => {
    expect(replayAhead('S', [' ', 'T', 'w', 'o'], option)).toEqual({
      text: '',
      keys: ['T', 'w', 'o'],
      submit: 'S',
    });
    expect(replayAhead('', [' ', 'x'], undefined)).toEqual({ text: '', keys: ['x'], submit: '' });
  });

  it('replays Backspace', () => {
    expect(replayAhead('Tw', ['x', 'Backspace', 'o'], name)).toEqual({ text: 'Two', keys: [] });
  });

  it('stops at Esc, dropping the text typed before it', () => {
    expect(replayAhead('1', [',', '1', 'Escape', 'L'], name)).toEqual({
      text: '',
      keys: ['Escape', 'L'],
    });
  });

  it('skips Tab, which only moves between Dynamic Input fields', () => {
    expect(replayAhead('', ['1', 'Tab', '2'], name)).toEqual({ text: '12', keys: [] });
  });
});

describe('completions', () => {
  const registry = builtinCommands();
  it('offers the command an alias names, then names that begin with the text', () => {
    // LENGTHEN (M3-02 part 4) and LIST (M3-07 part 2) begin with L too; LI is LIST's alias.
    expect(completions(registry, 'l')).toEqual([
      { name: 'LINE', alias: 'L' },
      { name: 'LENGTHEN' },
      { name: 'LIST' },
    ]);
    expect(completions(registry, 'LI')).toEqual([{ name: 'LIST', alias: 'LI' }, { name: 'LINE' }]);
    expect(completions(registry, "'lin")).toEqual([{ name: 'LINE' }]);
  });

  it('offers nothing for coordinates, blanks or unknown text', () => {
    expect(completions(registry, '0,0')).toEqual([]);
    expect(completions(registry, '')).toEqual([]);
    expect(completions(registry, 'ZZZ')).toEqual([]);
    // An acad.pgp alias of a command not built yet (BO, BOUNDARY's) completes nothing; SPL,
    // SPLINE's since M3-01 part 5, completes SPLINE (then SPLINEDIT, M3-02 part 6); REC,
    // RECTANG's since M3-01 part 3, completes RECTANG; C, CIRCLE's since M3-01, completes CIRCLE
    // first, then CHAMFER, CHANGE, CHPROP, CLASSICGROUP, CLOSE, COPY and the Clipboard commands.
    expect(completions(registry, 'BO')).toEqual([]);
    expect(completions(registry, 'SPL')).toEqual([
      { name: 'SPLINE', alias: 'SPL' },
      { name: 'SPLINEDIT' },
    ]);
    expect(completions(registry, 'REC')[0]).toEqual({ name: 'RECTANG', alias: 'REC' });
    expect(completions(registry, 'C')).toEqual([
      { name: 'CIRCLE', alias: 'C' },
      { name: 'CHAMFER' },
      { name: 'CHANGE' },
      { name: 'CHPROP' },
      // CLASSICGROUP, the Object Grouping dialog (M3-08).
      { name: 'CLASSICGROUP' },
      { name: 'CLOSE' },
      { name: 'CLOSEALL' },
      { name: 'COPY' },
      { name: 'COPYBASE' },
      { name: 'COPYCLIP' },
      { name: 'CUTCLIP' },
    ]);
  });
});

// M2-59 part 5: AutoCAD's AUTOCOMPLETEMODE lists system variables too, after the commands.
describe('completions of system variables', () => {
  const registry = builtinCommands();
  const variables = variableNames(
    new Map<string, unknown>([
      ['$LTSCALE', 1],
      ['$LUNITS', 2],
      ['$CLAYER', '0'],
      ['CETRANSPARENCY', 'ByLayer'],
    ]),
  );

  it('offers the variables the drawing has and those the app keeps', () => {
    expect(variables).toContain('LTSCALE');
    expect(variables).toContain('ORTHOMODE');
    expect(variables).toContain('CTAB');
    expect(variables).not.toContain('DIMSCALE');
    expect(completions(registry, 'lts', variables)).toEqual([{ name: 'LTSCALE', variable: true }]);
    expect(completions(registry, "'ortho", variables)).toEqual([
      { name: 'ORTHOMODE', variable: true },
    ]);
  });

  it('lists them after the commands', () => {
    const c = completions(registry, 'C', variables);
    const first = c.findIndex((s) => s.variable);
    expect(c.slice(0, first).map((s) => s.name)).toEqual([
      'CIRCLE',
      'CHAMFER',
      'CHANGE',
      'CHPROP',
      'CLASSICGROUP',
      'CLOSE',
      'CLOSEALL',
      'COPY',
      'COPYBASE',
      'COPYCLIP',
      'CUTCLIP',
    ]);
    expect(c.slice(first).map((s) => s.name)).toEqual([
      'CDATE',
      'CETRANSPARENCY',
      'CLAYER',
      'CTAB',
    ]);
    // Without variables (a drawing not open), commands only.
    expect(completions(registry, 'lts')).toEqual([]);
  });
});

describe('promptParts', () => {
  it('splits the prompt around its options, defaults kept after', () => {
    expect(promptParts('Specify next point or [Close/Undo]:', ['Close', 'Undo'])).toEqual({
      before: 'Specify next point or',
      options: ['Close', 'Undo'],
      after: ':',
    });
    expect(promptParts('>>Specify radius or [Diameter] <2.0000>:', ['Diameter'])).toEqual({
      before: '>>Specify radius or',
      options: ['Diameter'],
      after: '<2.0000>:',
    });
  });

  it('leaves a prompt without options whole', () => {
    expect(promptParts('Command:', undefined)).toEqual({
      before: 'Command:',
      options: [],
      after: '',
    });
    expect(promptParts('Odd:', ['X'])).toEqual({ before: 'Odd:', options: [], after: '' });
  });
});

describe('clipboardCommand (M2-14 part 2)', () => {
  const press = (key: string, o: { shift?: boolean; meta?: boolean; alt?: boolean } = {}) =>
    clipboardCommand({
      key,
      ctrlKey: !o.meta,
      metaKey: o.meta === true,
      shiftKey: o.shift === true,
      altKey: o.alt === true,
    });

  it('binds the Clipboard keys as AutoCAD does', () => {
    expect(press('c')).toBe('COPYCLIP');
    expect(press('x')).toBe('CUTCLIP');
    expect(press('v')).toBe('PASTECLIP');
    expect(press('C', { shift: true })).toBe('COPYBASE');
    expect(press('V', { shift: true })).toBe('PASTEBLOCK');
    expect(press('v', { meta: true })).toBe('PASTECLIP');
  });

  it('leaves other keys alone', () => {
    expect(press('x', { shift: true })).toBeUndefined();
    expect(press('c', { alt: true })).toBeUndefined();
    expect(
      clipboardCommand({
        key: 'c',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeUndefined();
  });
});
