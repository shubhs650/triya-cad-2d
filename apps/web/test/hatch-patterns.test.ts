// M2-35 part 3: the app places a pattern for a hatch given it by name in Properties, from the
// bundled patterns and the user's .pat files.
import { describe, expect, it } from 'vitest';
import { hatchPatternNames, hatchPatternReply } from '../src/hatch-patterns';

const USER = `*MY_LINES, Lines 2 apart\n0, 0,0, 0,2, 1,-1\n*TRIYA_GRID, My grid\n0, 0,0, 0,5\n`;

describe('hatch patterns for Properties', () => {
  it('places a bundled pattern at each hatch’s angle, scale and origin', () => {
    const r = hatchPatternReply([], 'triya_lines0', [
      { angle: 0, scale: 1, origin: { x: 0, y: 0 } },
      { angle: Math.PI / 2, scale: 2, origin: { x: 5, y: 1 } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pattern?.name).toBe('TRIYA_LINES0');
    expect(r.pattern?.custom).toBe(false);
    expect(r.pattern?.lines[0]).toEqual([
      { angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 3 }, dashes: [] },
    ]);
    const turned = r.pattern!.lines[1]![0]!;
    expect(turned.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(turned.base).toEqual({ x: 5, y: 1 });
    expect(turned.offset.x).toBeCloseTo(-6, 12);
    expect(turned.offset.y).toBeCloseTo(0, 12);
  });

  it('calls a pattern from the user’s own files Custom, theirs winning on a shared name', () => {
    const at = [{ angle: 0, scale: 1, origin: { x: 0, y: 0 } }];
    const mine = hatchPatternReply([USER], 'my_lines', at);
    expect(mine).toMatchObject({ ok: true, pattern: { name: 'MY_LINES', custom: true } });
    const grid = hatchPatternReply([USER], 'TRIYA_GRID', at);
    expect(grid).toMatchObject({ ok: true, pattern: { custom: true } });
    if (grid.ok) expect(grid.pattern?.lines[0]).toHaveLength(1);
  });

  it('says a name the library lacks is not there', () => {
    expect(hatchPatternReply([], 'ANSI31', [])).toEqual({
      ok: false,
      message: 'Pattern "ANSI31" is not in the pattern library.',
    });
  });

  it('offers SOLID and the library’s names', () => {
    const names = hatchPatternNames([USER]);
    expect(names[0]).toBe('SOLID');
    expect(names).toContain('TRIYA_LINES45');
    expect(names).toContain('MY_LINES');
    expect(names.filter((n) => n === 'TRIYA_GRID')).toHaveLength(1);
  });
});
