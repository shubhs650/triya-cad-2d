// M2-02 part 2: the Ctrl+K palette's fuzzy search over commands, aliases and app actions.
import { builtinCommands } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { commandItems, fuzzyScore, rankItems, type PaletteItem } from '../src/palette';

const items: PaletteItem[] = [
  ...commandItems(builtinCommands()),
  { id: 'settings', kind: 'action', label: 'Settings', aliases: [] },
  { id: 'dyn', kind: 'action', label: 'Dynamic Input', aliases: [], keys: 'F12' },
];

describe('palette search', () => {
  it('lists every command with its aliases', () => {
    const zoom = commandItems(builtinCommands()).find((i) => i.id === 'ZOOM');
    expect(zoom).toEqual({ id: 'ZOOM', kind: 'command', label: 'ZOOM', aliases: ['Z'] });
    expect(commandItems(builtinCommands()).map((i) => i.id)).toEqual([
      'LINE',
      'PAN',
      'REGEN',
      'REGENALL',
      'SELECT',
      'VIEW',
      'ZOOM',
    ]);
  });

  it('scores whole, prefix, word-start and scattered matches in that order', () => {
    expect(fuzzyScore('zoom', 'ZOOM')).toBe(1000);
    expect(fuzzyScore('reg', 'REGENALL')).toBeGreaterThan(fuzzyScore('ra', 'REGENALL')!);
    expect(fuzzyScore('di', 'Dynamic Input')).toBeGreaterThan(fuzzyScore('dm', 'Dynamic Input')!);
    expect(fuzzyScore('xyz', 'ZOOM')).toBeUndefined();
    expect(fuzzyScore('', 'ZOOM')).toBe(0);
  });

  it('ranks an exact alias first and keeps everything for an empty query', () => {
    expect(rankItems(items, 'z')[0]!.id).toBe('ZOOM');
    expect(rankItems(items, 'l')[0]!.id).toBe('LINE');
    expect(rankItems(items, 'regen').map((i) => i.id)).toEqual(['REGEN', 'REGENALL']);
    expect(rankItems(items, 'dyn')[0]!.id).toBe('dyn');
    expect(rankItems(items, '  ')).toHaveLength(items.length);
    expect(rankItems(items, 'qqq')).toEqual([]);
  });
});
