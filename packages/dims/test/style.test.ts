// The DIMVAR defaults the Properties palette shows (engine `DIMVAR_DEFAULTS`, M2-35 part 5) are
// the ones the dimension engine draws with (style.ts DEFAULTS): AutoCAD's imperial STANDARD.
import { describe, expect, it } from 'vitest';
import { DIMVAR_DEFAULTS, type AnnotationTables } from '@triya/engine';
import { dimStyle } from '../src/index';

describe('the DIMVAR defaults', () => {
  it('are the same in the Properties palette and the dimension engine', () => {
    // A drawing with no dimension style at all: every value is a default.
    const none = new Map();
    const tables = { dimStyles: none, appIds: none, textStyles: none, linetypes: none };
    const drawing = { tables, blocks: none, entityByHandle: () => undefined };
    const drawn = dimStyle('27', undefined, drawing as unknown as AnnotationTables).vars;
    const shared = Object.keys(DIMVAR_DEFAULTS).filter((k) => k in drawn);
    expect(shared.length).toBeGreaterThan(30);
    for (const k of shared) expect([k, drawn[k]]).toEqual([k, DIMVAR_DEFAULTS[k]]);
  });
});
