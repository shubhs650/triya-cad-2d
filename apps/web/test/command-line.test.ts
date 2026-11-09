// M2-02: the command line's mirror of a drawing's command engine (history, prompt, recall),
// completion as AutoCAD's AUTOCOMPLETE offers it, and the prompt split around its options.
import { builtinCommands, type CommandOutput } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { CommandLines, IDLE, completions, follow, promptParts, typed } from '../src/command-line';

describe('the command line state', () => {
  it('follows the log, the prompt and the return to Command:', () => {
    const outputs: CommandOutput[] = [
      { type: 'start', command: 'LINE', transparent: false },
      { type: 'log', line: 'Command: L' },
      {
        type: 'prompt',
        prompt: { kind: 'point', message: 'Specify first point' },
        text: 'Specify first point:',
      },
      { type: 'change', change: {} },
    ];
    const s = outputs.reduce(follow, IDLE);
    expect(s.lines).toEqual(['Command: L']);
    expect(s.promptText).toBe('Specify first point:');
    expect(s.prompt?.kind).toBe('point');
    const idle = follow(s, { type: 'idle' });
    expect([idle.prompt, idle.promptText]).toEqual([undefined, 'Command:']);
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

describe('completions', () => {
  const registry = builtinCommands();
  it('offers the command an alias names, then names that begin with the text', () => {
    expect(completions(registry, 'l')).toEqual([{ name: 'LINE', alias: 'L' }]);
    expect(completions(registry, 'LI')).toEqual([{ name: 'LINE' }]);
    expect(completions(registry, "'li")).toEqual([{ name: 'LINE' }]);
  });

  it('offers nothing for coordinates, blanks or unknown text', () => {
    expect(completions(registry, '0,0')).toEqual([]);
    expect(completions(registry, '')).toEqual([]);
    expect(completions(registry, 'ZZZ')).toEqual([]);
    // An acad.pgp alias of a command not built yet (C, CIRCLE's, now completes CLOSE and COPY).
    expect(completions(registry, 'REC')).toEqual([]);
    expect(completions(registry, 'C')).toEqual([{ name: 'CLOSE' }, { name: 'COPY' }]);
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
