// M2-42: SETVAR and a system variable's name typed at `Command:` (AutoCAD 2024 Help, "SETVAR
// (Command)": "Enter variable name or [?] <current>:", "Enter new value for variable_name
// <current>:"; a read-only variable shows its value "(read only)"), with the variables kept in
// the header (an undoable edit), in WIPEOUTVARIABLES (WIPEOUTFRAME) and by the app (asked of the
// view host), and REVCLOUDGRIPS, the app's per-user setting each drawing's grips follow.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  REVCLOUDGRIPS,
  UNKNOWN_VARIABLE,
  builtinCommands,
  insUnitsOf,
  pasteScale,
  systemVariable,
  wipeoutFrame,
  type BusEvent,
  type Clipboard,
  type DocumentInit,
  type HeaderValue,
  type PromptBusOptions,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { LAYER_WALLS, PAPER_SPACE, layer, sampleInit } from '../model/fixtures';

/** The app's side: the variables it keeps, which `sysvar` requests read and set. */
function appHost(values: Record<string, number | string> = { ORTHOMODE: 0, OSMODE: 4133 }) {
  const asked: { name: string; value?: number }[] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op !== 'sysvar') return Promise.resolve({ ok: false, message: 'no' });
      asked.push({ name: r.name, ...(r.value !== undefined && { value: r.value }) });
      if (r.value !== undefined) values[r.name] = r.value;
      const value = values[r.name];
      return Promise.resolve(
        value === undefined ? { ok: false, message: 'Not here.' } : { ok: true, value },
      );
    },
  };
  return { view, values, asked };
}

function withHeader(entries: [string, HeaderValue][], base: DocumentInit = sampleInit()) {
  return { ...base, header: new Map([...(base.header ?? []), ...entries]) };
}

function setup(
  init: DocumentInit = sampleInit(),
  view?: ViewHost,
  options: Partial<PromptBusOptions> = {},
) {
  const model = DocumentModel.create(init);
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    ...(view && { view }),
    ...options,
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  return { model, bus, log };
}

const HEADER: [string, HeaderValue][] = [
  ['$MIRRTEXT', 0],
  ['$INSUNITS', 4],
  ['$FILLMODE', true],
  ['$TEXTSIZE', 2.5],
  ['$LUPREC', 4],
  ['$AUPREC', 0],
  ['$ANGBASE', 0],
  ['$INSBASE', { x: 0, y: 0, z: 0 }],
  ['$DIMPOST', ''],
  ['$DIMBLK', ''],
  ['$CECOLOR', 256],
  ['$CELWEIGHT', -1],
  ['$DWGCODEPAGE', 'ANSI_1252'],
  ['CETRANSPARENCY', 'ByLayer'],
  ['MSLTSCALE', '1'],
];

describe('SETVAR', () => {
  it('reads and sets a header variable, one undo step, Enter keeping it', async () => {
    const s = setup(withHeader(HEADER));
    await s.bus.script(['SETVAR']);
    expect(s.bus.promptText).toBe('Enter variable name or [?]:');
    await s.bus.script(['mirrtext']);
    expect(s.bus.promptText).toBe('Enter new value for MIRRTEXT <0>:');
    await s.bus.script(['1']);
    expect(s.bus.command).toBeUndefined();
    expect(s.model.header.get('$MIRRTEXT')).toBe(1);
    expect(s.bus.undo.state.nextUndo).toBe('SETVAR');
    // The variable SETVAR last took is its default; Enter keeps the value.
    await s.bus.script(['SETVAR']);
    expect(s.bus.promptText).toBe('Enter variable name or [?] <MIRRTEXT>:');
    await s.bus.script(['']);
    expect(s.bus.promptText).toBe('Enter new value for MIRRTEXT <1>:');
    const before = s.bus.undo.state.undoable;
    await s.bus.script(['']);
    expect(s.model.header.get('$MIRRTEXT')).toBe(1);
    expect(s.bus.undo.state.undoable).toBe(before);
    await s.bus.script(['U']);
    expect(s.model.header.get('$MIRRTEXT')).toBe(0);
  });

  it('takes a variable’s name at Command:, as AutoCAD does, after the commands', async () => {
    const s = setup(withHeader(HEADER));
    await s.bus.script(['TEXTSIZE']);
    expect(s.log).toContain('Command: TEXTSIZE');
    expect(s.bus.promptText).toBe('Enter new value for TEXTSIZE <2.5000>:');
    await s.bus.script(['3.5']);
    expect(s.model.header.get('$TEXTSIZE')).toBe(3.5);
    expect(s.bus.undo.state.nextUndo).toBe('TEXTSIZE');
    await s.bus.script(['NOSUCHVAR']);
    expect(s.log.at(-1)).toBe('Unknown command "NOSUCHVAR".  Press F1 for help.');
    // Transparently, inside a command, and back to its prompt.
    await s.bus.script(['LINE', "'MIRRTEXT"]);
    expect(s.bus.promptText).toBe('>>Enter new value for MIRRTEXT <0>:');
    await s.bus.script(['1']);
    expect(s.bus.promptText).toBe('Specify first point:');
    expect(s.model.header.get('$MIRRTEXT')).toBe(1);
  });

  it('refuses a bad value and asks again', async () => {
    const s = setup(withHeader([...HEADER, ['$LTSCALE', 1]]));
    await s.bus.script(['SETVAR', 'MIRRTEXT', '2']);
    expect(s.log.at(-1)).toBe('Value must be between 0 and 1.');
    expect(s.bus.promptText).toBe('Enter new value for MIRRTEXT <0>:');
    await s.bus.script(['0.5']);
    expect(s.log.at(-1)).toBe('Requires an integer value.');
    await s.bus.script(['abc']);
    expect(s.log.at(-1)).toBe('Requires an integer value.');
    await s.bus.script(['']);
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['LTSCALE', '0']);
    expect(s.log.at(-1)).toBe('Value must be positive and nonzero.');
    await s.bus.script(['x']);
    expect(s.log.at(-1)).toBe('Requires numeric value.');
    await s.bus.script(['0.5']);
    expect(s.model.header.get('$LTSCALE')).toBe(0.5);
    await s.bus.script(['CELWEIGHT', '17']);
    expect(s.log.at(-1)).toBe('Invalid lineweight.');
    await s.bus.script(['25']);
    expect(s.model.header.get('$CELWEIGHT')).toBe(25);
  });

  it('says a name is unknown, and shows a read-only variable without asking', async () => {
    const s = setup(withHeader(HEADER));
    await s.bus.script(['SETVAR', 'NOSUCHVAR']);
    expect(s.log.at(-1)).toBe(UNKNOWN_VARIABLE);
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['SETVAR', 'DWGCODEPAGE']);
    expect(s.log.at(-1)).toBe('DWGCODEPAGE = "ANSI_1252" (read only)');
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['EXTMIN']);
    expect(s.log.at(-1)).toBe('EXTMIN = 0.0000,0.0000,0.0000 (read only)');
    // An AcDbVariableDictionary entry Triya does not set yet.
    await s.bus.script(['MSLTSCALE']);
    expect(s.log.at(-1)).toBe('MSLTSCALE = "1" (read only)');
  });

  it('keeps a variable the header holds as a flag a flag', async () => {
    const s = setup(withHeader(HEADER));
    await s.bus.script(['FILLMODE']);
    expect(s.bus.promptText).toBe('Enter new value for FILLMODE <1>:');
    await s.bus.script(['0']);
    expect(s.model.header.get('$FILLMODE')).toBe(false);
  });

  it('sets names, text, colours, angles and points as the header holds them', async () => {
    const init = withHeader(HEADER);
    const frozen = { ...layer('12', 'Frozen'), frozen: true };
    const s = setup({
      ...init,
      tables: { ...init.tables, layers: [...init.tables!.layers!, frozen] },
    });
    await s.bus.script(['CLAYER']);
    expect(s.bus.promptText).toBe('Enter new value for CLAYER <"WALLS">:');
    await s.bus.script(['nowhere']);
    expect(s.log.at(-1)).toBe('No layer named "nowhere".');
    await s.bus.script(['frozen']);
    expect(s.log.at(-1)).toBe('Cannot set a frozen layer current.');
    // Spelled as the layer is; names may hold spaces.
    await s.bus.script(['0']);
    expect(s.model.header.get('$CLAYER')).toBe('0');
    expect(s.model.tables.layers.get(LAYER_WALLS)!.name).toBe('WALLS');
    await s.bus.script(['DIMPOST', '<> mm']);
    expect(s.model.header.get('$DIMPOST')).toBe('<> mm');
    await s.bus.script(['DIMPOST']);
    expect(s.bus.promptText).toBe('Enter new value for DIMPOST <"<> mm">:');
    // "." sets text to nothing.
    await s.bus.script(['.']);
    expect(s.model.header.get('$DIMPOST')).toBe('');
    await s.bus.script(['CECOLOR']);
    expect(s.bus.promptText).toBe('Enter new value for CECOLOR <"BYLAYER">:');
    await s.bus.script(['red']);
    expect(s.model.header.get('$CECOLOR')).toBe(1);
    await s.bus.script(['CECOLOR', 'BYBLOCK']);
    expect(s.model.header.get('$CECOLOR')).toBe(0);
    await s.bus.script(['ANGBASE', '90']);
    expect(s.model.header.get('$ANGBASE')).toBeCloseTo(Math.PI / 2, 12);
    await s.bus.script(['ANGBASE']);
    expect(s.bus.promptText).toBe('Enter new value for ANGBASE <90>:');
    await s.bus.script(['', 'INSBASE']);
    expect(s.bus.promptText).toBe('Enter new value for INSBASE <0.0000,0.0000,0.0000>:');
    await s.bus.script(['3,4']);
    expect(s.model.header.get('$INSBASE')).toEqual({ x: 3, y: 4, z: 0 });
    await s.bus.script(['CETRANSPARENCY', '95']);
    expect(s.log.at(-1)).toBe('Value must be ByLayer, ByBlock or between 0 and 90.');
    await s.bus.script(['40']);
    expect(s.model.header.get('CETRANSPARENCY')).toBe('40');
  });

  it('sets WIPEOUTFRAME in the drawing’s WIPEOUTVARIABLES', async () => {
    const init = { ...sampleInit(), meta: { ...sampleInit().meta, rootDictionary: 'C' } };
    const s = setup(init);
    await s.bus.script(['WIPEOUTFRAME']);
    expect(s.bus.promptText).toBe('Enter new value for WIPEOUTFRAME <1>:');
    await s.bus.script(['3']);
    expect(s.log.at(-1)).toBe('Value must be between 0 and 2.');
    await s.bus.script(['2']);
    expect(wipeoutFrame(s.model)).toBe(2);
    await s.bus.script(['WIPEOUT', 'F']);
    expect(s.bus.promptText).toBe(
      'Enter mode [ON/OFF/Display but not plot] <Display but not plot>:',
    );
  });

  it('asks the app for the variables it keeps', async () => {
    const app = appHost();
    const s = setup(sampleInit(), app.view);
    await s.bus.script(['ORTHOMODE']);
    expect(s.bus.promptText).toBe('Enter new value for ORTHOMODE <0>:');
    await s.bus.script(['1']);
    expect(app.values['ORTHOMODE']).toBe(1);
    expect(app.asked).toEqual([{ name: 'ORTHOMODE' }, { name: 'ORTHOMODE', value: 1 }]);
    // Checked before the app is asked; not an edit of the drawing.
    await s.bus.script(['SETVAR', 'OSMODE', '40000']);
    expect(s.log.at(-1)).toBe('Value must be between 0 and 32767.');
    await s.bus.script(['']);
    await s.bus.script(['POLARANG']);
    expect(s.log.at(-1)).toBe('Not here.');
    expect(s.bus.undo.state.undoable).toBe(0);
    // Without an app (scripts), SETVAR says so.
    const bare = setup();
    await bare.bus.script(['REVCLOUDGRIPS']);
    expect(bare.log.at(-1)).toBe('There is no view to change.');
  });

  it('lists variables matching wild cards with ?', async () => {
    const s = setup(withHeader(HEADER), appHost({ ORTHOMODE: 1 }).view);
    await s.bus.script(['SETVAR', '?']);
    expect(s.bus.promptText).toBe('Enter variable(s) to list <*>:');
    await s.bus.script(['MIRR*,ORTHO*,DWGCODE*']);
    expect(s.log.slice(-3)).toEqual([
      'DWGCODEPAGE       "ANSI_1252"       (read only)',
      'MIRRTEXT          0',
      'ORTHOMODE         1',
    ]);
    await s.bus.script(['SETVAR', '?', '']);
    // Every header variable, WIPEOUTFRAME and the app's that answered, by name.
    const listed = s.log.slice(s.log.indexOf('Enter variable(s) to list <*>:') + 1);
    expect(listed.some((l) => l.startsWith('WIPEOUTFRAME      1'))).toBe(true);
    expect(listed.some((l) => l.startsWith('OSMODE'))).toBe(false);
  });

  it('pastes by the INSUNITS SETVAR set, not the one the drawing opened with', async () => {
    const s = setup(withHeader(HEADER));
    expect(s.model.meta.insUnits).toBe(4);
    await s.bus.script(['INSUNITS', '25']);
    expect(s.log.at(-1)).toBe('Value must be between 0 and 24.');
    await s.bus.script(['1']);
    expect(insUnitsOf(s.model)).toBe(1);
    // Millimetres pasted into what is now an inch drawing.
    expect(pasteScale(s.model, { insUnits: 4 } as Clipboard)).toBeCloseTo(1 / 25.4, 12);
  });

  it('knows which header variables hold integers', () => {
    const model = DocumentModel.create(withHeader(HEADER));
    expect(systemVariable(model, 'textsize')).toMatchObject({ kind: 'real', positive: true });
    expect(systemVariable(model, 'MIRRTEXT')).toMatchObject({ kind: 'integer', min: 0, max: 1 });
    expect(systemVariable(model, 'DIMBLK')).toMatchObject({ kind: 'name', empty: true });
    expect(systemVariable(model, '$TEXTSIZE')).toBeUndefined();
    expect(systemVariable(model, 'ORTHOMODE')).toMatchObject({ store: 'app' });
    expect(systemVariable(model, 'LINE')).toBeUndefined();
  });
});

// M2-59: the variables AutoCAD works out and nobody sets (AutoCAD 2024 Help, "System Variables":
// CTAB, DATE, CDATE, VIEWSIZE, VIEWCTR, DWGNAME, DWGPREFIX, DWGTITLED, DBMOD), each read only.
describe('computed variables', () => {
  /** 14 November 2026, 14:37:33.12 local time. */
  const clock = { now: () => new Date(2026, 10, 14, 14, 37, 33, 120) };
  /** A canvas showing 40 × 20 units around (5, 2.5). */
  const canvas: ViewHost = {
    request: (r): Promise<ViewReply> =>
      Promise.resolve(
        r.op === 'get'
          ? { ok: true, view: { center: { x: 5, y: 2.5 }, height: 20, width: 40, paper: false } }
          : { ok: false, message: 'no' },
      ),
  };

  it('tells the date and time, as a Julian date and as a calendar date', async () => {
    const s = setup(sampleInit(), undefined, { clock });
    // AutoCAD's Julian dates count whole days at midnight: 1 January 2020 is day 2458850.
    await s.bus.script(['DATE']);
    expect(s.log.at(-1)).toBe('DATE = 2461359.60941111 (read only)');
    expect(s.bus.command).toBeUndefined();
    // CDATE: YYYYMMDD.HHMMSS and hundredths.
    await s.bus.script(['SETVAR', 'cdate']);
    expect(s.log.at(-1)).toBe('CDATE = 20261114.14373312 (read only)');
    expect(s.bus.undo.state.undoable).toBe(0);
  });

  it('names the tab shown', async () => {
    const model = setup(sampleInit());
    await model.bus.script(['CTAB']);
    expect(model.log.at(-1)).toBe('CTAB = "Model" (read only)');
    const paper = setup(sampleInit(), undefined, { space: () => PAPER_SPACE });
    await paper.bus.script(['CTAB']);
    expect(paper.log.at(-1)).toBe('CTAB = "Layout1" (read only)');
  });

  it('measures the view shown, and says when no canvas shows one', async () => {
    const s = setup(withHeader([['$LUPREC', 2]]), canvas);
    await s.bus.script(['VIEWSIZE']);
    expect(s.log.at(-1)).toBe('VIEWSIZE = 20.00 (read only)');
    await s.bus.script(['VIEWCTR']);
    expect(s.log.at(-1)).toBe('VIEWCTR = 5.00,2.50,0.00 (read only)');
    const bare = setup();
    await bare.bus.script(['VIEWSIZE']);
    expect(bare.log.at(-1)).toBe('There is no view to change.');
  });

  it('asks the app for the drawing’s file name and whether it has unsaved changes', async () => {
    const app = appHost({ DWGNAME: 'plan.dxf', DWGPREFIX: '', DWGTITLED: 1, DBMOD: 1 });
    const s = setup(sampleInit(), app.view);
    await s.bus.script(['DWGNAME']);
    expect(s.log.at(-1)).toBe('DWGNAME = "plan.dxf" (read only)');
    await s.bus.script(['DWGPREFIX']);
    expect(s.log.at(-1)).toBe('DWGPREFIX = "" (read only)');
    await s.bus.script(['DWGTITLED']);
    expect(s.log.at(-1)).toBe('DWGTITLED = 1 (read only)');
    await s.bus.script(['DBMOD']);
    expect(s.log.at(-1)).toBe('DBMOD = 1 (read only)');
    // Read, never set.
    expect(app.asked.every((a) => a.value === undefined)).toBe(true);
  });

  it('are listed by SETVAR ?, those no host answers left out', async () => {
    const s = setup(sampleInit(), canvas, { clock });
    await s.bus.script(['SETVAR', '?', 'C*,DATE,VIEW*,DWG*']);
    const listed = s.log.slice(
      s.log.indexOf('Enter variable(s) to list <*>: C*,DATE,VIEW*,DWG*') + 1,
    );
    expect(listed).toEqual([
      'CDATE             20261114.14373312 (read only)',
      'CLAYER            "WALLS"',
      'CTAB              "Model"           (read only)',
      'DATE              2461359.60941111  (read only)',
      // A value too long for its column still has a space before the note.
      'VIEWCTR           5.0000,2.5000,0.0000 (read only)',
      'VIEWSIZE          20.0000           (read only)',
    ]);
    const model = DocumentModel.create(sampleInit());
    expect(systemVariable(model, 'ctab')).toMatchObject({ store: 'computed', readOnly: true });
    expect(systemVariable(model, 'DWGNAME')).toMatchObject({ store: 'app', readOnly: true });
  });
});

describe('REVCLOUDGRIPS', () => {
  it('is a session setting of each drawing, never an undo step', () => {
    const session = new EngineSession(sampleInit());
    const off = session.edit({ kind: 'sysvar', name: REVCLOUDGRIPS, value: 0 });
    expect(off).toMatchObject({ ok: true });
    expect(session.model.header.get(REVCLOUDGRIPS)).toBe(0);
    expect(session.undoState.undoable).toBe(0);
    // Again: nothing changes.
    expect(session.edit({ kind: 'sysvar', name: REVCLOUDGRIPS, value: 0 })).toEqual({
      ok: true,
      change: {},
    });
    // 1, AutoCAD's initial value, is no entry.
    session.edit({ kind: 'sysvar', name: REVCLOUDGRIPS, value: 1 });
    expect(session.model.header.has(REVCLOUDGRIPS)).toBe(false);
  });
});
