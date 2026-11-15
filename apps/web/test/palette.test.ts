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
      'AIMLEADEREDITADD',
      'AIMLEADEREDITREMOVE',
      // M3-02 part 4: BREAK, BREAKATPOINT, JOIN, EXPLODE, LENGTHEN, REVERSE and ALIGN.
      'ALIGN',
      // M3-01: ARC and CIRCLE.
      'ARC',
      // M3-07: the inquiry commands.
      'AREA',
      // M3-03: the arrays.
      'ARRAY',
      'ARRAYPATH',
      'ARRAYPOLAR',
      'ARRAYRECT',
      'ATTEDIT',
      'BREAK',
      'BREAKATPOINT',
      // M3-02 part 3: CHAMFER and FILLET.
      'CHAMFER',
      // M3-02 part 5: CHANGE and CHPROP.
      'CHANGE',
      'CHPROP',
      'CIRCLE',
      'CLOSE',
      'CLOSEALL',
      'COPY',
      'COPYBASE',
      'COPYCLIP',
      'CUTCLIP',
      'DIMALIGNED',
      'DIMANGULAR',
      'DIMBASELINE',
      'DIMCONTINUE',
      'DIMDIAMETER',
      'DIMLINEAR',
      'DIMRADIUS',
      'DIST',
      // M3-01 part 5: DIVIDE, MEASURE and SPLINE.
      'DIVIDE',
      'DRAWINGRECOVERY',
      'DRAWORDER',
      'EATTEDIT',
      'ERASE',
      'EXPLODE',
      'EXPORT',
      'EXPORTPDF',
      'EXTEND',
      'FILLET',
      'HATCHTOBACK',
      'ID',
      'JOIN',
      'LENGTHEN',
      'LINE',
      // M3-02 part 5: MATCHPROP.
      'MATCHPROP',
      'MEASURE',
      'MEASUREGEOM',
      'MIRROR',
      'MLEADER',
      'MLEADEREDIT',
      'MOVE',
      'MREDO',
      'MTEXT',
      'OFFSET',
      'OOPS',
      // M3-02 part 6: OVERKILL and SPLINEDIT.
      'OVERKILL',
      'PAN',
      'PASTEBLOCK',
      'PASTECLIP',
      'PASTEORIG',
      // M3-02 part 5: PEDIT.
      'PEDIT',
      // M3-01 part 3: PLINE, POLYGON and RECTANG.
      'PLINE',
      'PLOT',
      'POLYGON',
      'PREVIEW',
      'PRINT',
      'PROPERTIES',
      'PROPERTIESCLOSE',
      'PUBLISH',
      'QSAVE',
      'QUICKPROPERTIES',
      'RECTANG',
      'REDO',
      'REGEN',
      'REGENALL',
      'REVCLOUD',
      'REVERSE',
      'ROTATE',
      'SAVE',
      'SAVEAS',
      'SCALE',
      'SELECT',
      'SETVAR',
      'SPLINE',
      'SPLINEDIT',
      'STRETCH',
      'TEXT',
      'TEXTEDIT',
      'TEXTTOFRONT',
      'TRIM',
      // M2-23: the undo commands run in every drawing.
      'U',
      // M2-56 part 1: the Underlay Layers dialog.
      'ULAYERS',
      'UNDO',
      'VIEW',
      'WIPEOUT',
      'ZOOM',
    ]);
    const erase = commandItems(builtinCommands()).find((i) => i.id === 'ERASE');
    expect(erase?.aliases).toEqual(expect.arrayContaining(['E', 'DEL']));
    const text = commandItems(builtinCommands()).find((i) => i.id === 'TEXT');
    expect(text?.aliases).toEqual(['DT']);
    const mleader = commandItems(builtinCommands()).find((i) => i.id === 'MLEADER');
    expect(mleader?.aliases).toEqual(['MLD']);
    expect(commandItems(builtinCommands()).find((i) => i.id === 'TEXTEDIT')?.aliases).toEqual([
      'ED',
    ]);
    expect(commandItems(builtinCommands()).find((i) => i.id === 'DIMLINEAR')?.aliases).toEqual([
      'DLI',
    ]);
    expect(commandItems(builtinCommands()).find((i) => i.id === 'PROPERTIES')?.aliases).toEqual([
      'CH',
      'MO',
      'PR',
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
