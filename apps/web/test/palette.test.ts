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
  it("shows a command's keys from the keyboard map (M3-10 part 2)", () => {
    const keys = (name: string) => (name === 'PLOT' ? 'Ctrl+P' : '');
    const all = commandItems(builtinCommands(), keys);
    expect(all.find((i) => i.id === 'PLOT')?.keys).toBe('Ctrl+P');
    expect(all.find((i) => i.id === 'ZOOM')).not.toHaveProperty('keys');
  });

  it('lists every command with its aliases', () => {
    const zoom = commandItems(builtinCommands()).find((i) => i.id === 'ZOOM');
    expect(zoom).toEqual({ id: 'ZOOM', kind: 'command', label: 'ZOOM', aliases: ['Z'] });
    expect(commandItems(builtinCommands()).map((i) => i.id)).toEqual([
      // M4-03 part 2: dimension styles at the command line.
      '-DIMSTYLE',
      // M5-04 part 4: the image commands.
      '-IMAGEADJUST',
      // M4-04: a text style made at the command line.
      '-STYLE',
      // M4-05: a table on the command line.
      '-TABLE',
      // M3-09: the Drawing Units questions at the command line.
      '-UNITS',
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
      'ARRAYCLOSE',
      'ARRAYEDIT',
      'ARRAYPATH',
      'ARRAYPOLAR',
      'ARRAYRECT',
      // M5-03 part 1: ATTDEF and ATTDISP.
      'ATTDEF',
      'ATTDISP',
      'ATTEDIT',
      // M5-02 part 2: references given their block's attributes.
      'ATTSYNC',
      // M5-01 part 1: blocks made and inserted at the command line, and BASE.
      'BASE',
      // M5-03 part 2: the Block Attribute Manager.
      'BATTMAN',
      // M5-02 part 1: the Block Editor.
      'BCLOSE',
      'BEDIT',
      'BLOCK',
      'BREAK',
      'BREAKATPOINT',
      'BSAVE',
      // M4-08: CENTERLINE and CENTERMARK; part 3 the commands that edit them.
      'CENTERDISASSOCIATE',
      'CENTERLINE',
      'CENTERMARK',
      'CENTERREASSOCIATE',
      'CENTERRESET',
      // M3-02 part 3: CHAMFER and FILLET.
      'CHAMFER',
      // M3-02 part 5: CHANGE and CHPROP.
      'CHANGE',
      'CHPROP',
      'CIRCLE',
      // M3-08: the Object Grouping dialog, GROUP, GROUPEDIT and UNGROUP.
      'CLASSICGROUP',
      'CLOSE',
      'CLOSEALL',
      'COPY',
      'COPYBASE',
      'COPYCLIP',
      'CUTCLIP',
      // M3-01 part 6: the Point Style dialog.
      'DDPTYPE',
      'DIMALIGNED',
      'DIMANGULAR',
      // M4-02 part 1: DIMARC, DIMJOGGED, DIMJOGLINE and DIMORDINATE.
      'DIMARC',
      'DIMBASELINE',
      // M4-02 part 4: DIMBREAK and DIMINSPECT.
      'DIMBREAK',
      'DIMCONTINUE',
      'DIMDIAMETER',
      // M4-02 part 3: DIMDISASSOCIATE and DIMREASSOCIATE.
      'DIMDISASSOCIATE',
      // M4-02 part 2: DIMEDIT, DIMOVERRIDE, DIMSPACE, DIMTEDIT and QDIM.
      'DIMEDIT',
      'DIMINSPECT',
      'DIMJOGGED',
      'DIMJOGLINE',
      'DIMLINEAR',
      'DIMORDINATE',
      'DIMOVERRIDE',
      'DIMRADIUS',
      'DIMREASSOCIATE',
      'DIMSPACE',
      // M4-03: the Dimension Style Manager.
      'DIMSTYLE',
      'DIMTEDIT',
      'DIST',
      // M3-01 part 5: DIVIDE, MEASURE and SPLINE.
      'DIVIDE',
      // M3-01 part 4: DONUT, ELLIPSE, POINT, RAY and XLINE.
      'DONUT',
      'DRAWINGRECOVERY',
      'DRAWORDER',
      // M3-06 part 1: the Drafting Settings dialog, OSNAP on its Object Snap tab.
      'DSETTINGS',
      'EATTEDIT',
      'ELLIPSE',
      'ERASE',
      'EXPLODE',
      'EXPORT',
      'EXPORTPDF',
      'EXTEND',
      // M5-04 part 1: the References palette.
      'EXTERNALREFERENCES',
      'EXTERNALREFERENCESCLOSE',
      // M4-10 part 2: the Field dialog.
      'FIELD',
      'FILLET',
      'FILTER',
      'FIND',
      // M4-07 part 3: GRADIENT (HATCH with a gradient).
      'GRADIENT',
      // M3-06 part 2: GRID and SNAP.
      'GRID',
      'GROUP',
      'GROUPEDIT',
      // M4-07 part 1: HATCH and -HATCH on the command line.
      'HATCH',
      // M4-07 part 4: HATCHEDIT and -HATCHEDIT.
      'HATCHEDIT',
      'HATCHTOBACK',
      'ID',
      'IMAGEADJUST',
      'IMAGEATTACH',
      'IMAGECLIP',
      'IMAGEQUALITY',
      'INSERT',
      'JOIN',
      // M4-09 part 1: JUSTIFYTEXT and SCALETEXT.
      'JUSTIFYTEXT',
      // M5-06 part 1: the layer tool row.
      'LAYCUR',
      // M5-06 part 2: LAYDEL, LAYERP, LAYERPMODE and LAYMRG.
      'LAYDEL',
      'LAYERP',
      'LAYERPMODE',
      'LAYERSTATE',
      'LAYFRZ',
      'LAYISO',
      'LAYLCK',
      'LAYMCH',
      'LAYMCUR',
      'LAYMRG',
      'LAYOFF',
      'LAYON',
      'LAYTHW',
      'LAYULK',
      'LAYUNISO',
      'LAYWALK',
      'LENGTHEN',
      'LINE',
      // M5-08: the Linetype Manager, -LINETYPE and LTSCALE.
      'LINETYPE',
      'LIST',
      'LTSCALE',
      // M3-02 part 5: MATCHPROP.
      'MATCHPROP',
      'MEASURE',
      'MEASUREGEOM',
      'MIRROR',
      'MLEADER',
      // M4-04 part 3: MLEADERALIGN and MLEADERCOLLECT.
      'MLEADERALIGN',
      'MLEADERCOLLECT',
      'MLEADEREDIT',
      // M4-04 part 2: the Multileader Style Manager.
      'MLEADERSTYLE',
      'MOVE',
      'MREDO',
      'MTEXT',
      'OFFSET',
      'OOPS',
      'OSNAP',
      // M3-02 part 6: OVERKILL and SPLINEDIT.
      'OVERKILL',
      'PAN',
      'PASTEBLOCK',
      'PASTECLIP',
      'PASTEORIG',
      // M5-04 part 8: PDFATTACH.
      'PDFATTACH',
      // M3-02 part 5: PEDIT.
      'PEDIT',
      // M3-01 part 3: PLINE, POLYGON and RECTANG.
      'PLINE',
      'PLOT',
      'POINT',
      'POLYGON',
      'PREVIEW',
      'PRINT',
      'PROPERTIES',
      'PROPERTIESCLOSE',
      'PUBLISH',
      'QDIM',
      'QSAVE',
      'QSELECT',
      'QUICKPROPERTIES',
      'RAY',
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
      'SCALETEXT',
      'SELECT',
      'SELECTSIMILAR',
      'SETVAR',
      'SNAP',
      // M4-09 part 4: the Check Spelling dialog.
      'SPELL',
      'SPLINE',
      'SPLINEDIT',
      'STRETCH',
      // M4-04: the Text Style dialog.
      'STYLE',
      // M4-05 part 2: the Insert Table dialog and the cell editor.
      'TABLE',
      // M4-05 part 3: table cells selected, the Table Cell menu.
      'TABLECELL',
      'TABLEDIT',
      // M4-05 part 5: the Table Style dialog.
      'TABLESTYLE',
      'TEXT',
      // M4-09 part 3.
      'TEXTALIGN',
      'TEXTEDIT',
      'TEXTTOFRONT',
      // M4-16: a block in a table cell.
      'TINSERT',
      // M4-11: the Geometric Tolerance dialog.
      'TOLERANCE',
      'TRIM',
      // M2-23: the undo commands run in every drawing.
      'U',
      // M3-06 part 7: the UCS in plan and its icon.
      'UCS',
      'UCSICON',
      // M2-56 part 1: the Underlay Layers dialog.
      'ULAYERS',
      'UNDO',
      'UNGROUP',
      // M3-09: the Drawing Units dialog.
      'UNITS',
      // M4-10 part 1.
      'UPDATEFIELD',
      'VIEW',
      // M5-01 part 4: the Write Block dialog.
      'WBLOCK',
      'WIPEOUT',
      // M5-04 part 6: drawings attached and overlaid.
      'XATTACH',
      // M5-04 part 7: xref-dependent definitions bound one by one.
      'XBIND',
      // M5-04 part 3: references clipped.
      'XCLIP',
      'XLINE',
      'XREF',
      'ZOOM',
    ]);
    const erase = commandItems(builtinCommands()).find((i) => i.id === 'ERASE');
    expect(erase?.aliases).toEqual(expect.arrayContaining(['E', 'DEL']));
    const text = commandItems(builtinCommands()).find((i) => i.id === 'TEXT');
    // The registry's own aliases (DTEXT) are listed too since M3-10 (`aliasesOf`).
    expect(text?.aliases).toEqual(['DT', 'DTEXT']);
    const mleader = commandItems(builtinCommands()).find((i) => i.id === 'MLEADER');
    expect(mleader?.aliases).toEqual(['MLD']);
    expect(commandItems(builtinCommands()).find((i) => i.id === 'TEXTEDIT')?.aliases).toEqual([
      'DDEDIT',
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
