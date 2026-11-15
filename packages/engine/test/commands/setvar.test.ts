// M2-42: SETVAR and a system variable's name typed at `Command:` (AutoCAD 2024 Help, "SETVAR
// (Command)": "Enter variable name or [?] <current>:", "Enter new value for variable_name
// <current>:"; a read-only variable shows its value "(read only)"), with the variables kept in
// the header (an undoable edit), in WIPEOUTVARIABLES (WIPEOUTFRAME) and by the app (asked of the
// view host), and REVCLOUDGRIPS, the app's per-user setting each drawing's grips follow.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PICKFIRST,
  PromptBus,
  REVCLOUDGRIPS,
  UNKNOWN_VARIABLE,
  builtinCommands,
  insUnitsOf,
  pasteScale,
  standardMLeaderStyle,
  systemVariable,
  wipeoutFrame,
  type BusEvent,
  type Clipboard,
  type DocumentInit,
  type HeaderValue,
  type PromptBusOptions,
  type TableStyleRecord,
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
  ['CVIEWDETAILSTYLE', 'Metric50'],
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
    // An AcDbVariableDictionary entry naming what Triya does not keep (a detail view style).
    await s.bus.script(['CVIEWDETAILSTYLE']);
    expect(s.log.at(-1)).toBe('CVIEWDETAILSTYLE = "Metric50" (read only)');
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

  it('asks the app for the per-user settings AutoCAD keeps in the registry (M2-59)', async () => {
    // AutoCAD 2024 Help: AUTOSNAP 0–63 (bits 1 marker, 2 tooltip, 4 magnet, 8 polar tracking,
    // 16 object snap tracking, 32 their tooltips); AUTOSNAPSIZE 1–20; DYNMODE −3–3 (a negative
    // value is off, keeping what F12 turns back on); PICKFIRST 0 or 1.
    const app = appHost({ AUTOSNAP: 63, AUTOSNAPSIZE: 5, DYNMODE: 3, PICKFIRST: 1 });
    const s = setup(sampleInit(), app.view);
    await s.bus.script(['AUTOSNAP']);
    expect(s.bus.promptText).toBe('Enter new value for AUTOSNAP <63>:');
    await s.bus.script(['64']);
    expect(s.log.at(-1)).toBe('Value must be between 0 and 63.');
    await s.bus.script(['39']);
    expect(app.values['AUTOSNAP']).toBe(39);
    await s.bus.script(['AUTOSNAPSIZE', '21']);
    expect(s.log.at(-1)).toBe('Value must be between 1 and 20.');
    await s.bus.script(['10']);
    expect(app.values['AUTOSNAPSIZE']).toBe(10);
    await s.bus.script(['DYNMODE', '-4']);
    expect(s.log.at(-1)).toBe('Value must be between -3 and 3.');
    await s.bus.script(['-3']);
    expect(app.values['DYNMODE']).toBe(-3);
    await s.bus.script(['PICKFIRST', '2']);
    expect(s.log.at(-1)).toBe('Value must be between 0 and 1.');
    await s.bus.script(['0']);
    expect(app.values['PICKFIRST']).toBe(0);
    // Not edits of the drawing.
    expect(s.bus.undo.state.undoable).toBe(0);
    const model = DocumentModel.create(sampleInit());
    for (const name of ['AUTOSNAP', 'AUTOSNAPSIZE', 'DYNMODE', 'PICKFIRST']) {
      expect(systemVariable(model, name.toLowerCase()), name).toMatchObject({ store: 'app' });
    }
  });

  it('asks the app for GRIPSIZE, the grip box size AutoCAD keeps per user (M2-59 part 3)', async () => {
    // AutoCAD 2024 Help, GRIPSIZE: "Sets the size of the grip box in pixels", 1 to 255,
    // initially 5, saved in the registry.
    const app = appHost({ GRIPSIZE: 5 });
    const s = setup(sampleInit(), app.view);
    await s.bus.script(['GRIPSIZE']);
    expect(s.bus.promptText).toBe('Enter new value for GRIPSIZE <5>:');
    await s.bus.script(['0']);
    expect(s.log.at(-1)).toBe('Value must be between 1 and 255.');
    await s.bus.script(['256']);
    expect(s.log.at(-1)).toBe('Value must be between 1 and 255.');
    await s.bus.script(['12']);
    expect(app.values['GRIPSIZE']).toBe(12);
    expect(s.bus.undo.state.undoable).toBe(0);
    const model = DocumentModel.create(sampleInit());
    expect(systemVariable(model, 'gripsize')).toMatchObject({ store: 'app', kind: 'integer' });
  });

  it('asks the app for ROLLOVERTIPS, the rollover tooltips AutoCAD keeps per user (M2-35 part 21)', async () => {
    // AutoCAD 2024 Help, ROLLOVERTIPS: "Controls the display of rollover tooltips in the
    // application", 0 off, 1 on, initially 1, saved in the registry.
    const app = appHost({ ROLLOVERTIPS: 1 });
    const s = setup(sampleInit(), app.view);
    await s.bus.script(['ROLLOVERTIPS']);
    expect(s.bus.promptText).toBe('Enter new value for ROLLOVERTIPS <1>:');
    await s.bus.script(['2']);
    expect(s.log.at(-1)).toBe('Value must be between 0 and 1.');
    await s.bus.script(['0']);
    expect(app.values['ROLLOVERTIPS']).toBe(0);
    expect(s.bus.undo.state.undoable).toBe(0);
    const model = DocumentModel.create(sampleInit());
    expect(systemVariable(model, 'rollovertips')).toMatchObject({ store: 'app', kind: 'integer' });
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
    expect(systemVariable(model, 'textsize')).toMatchObject({ kind: 'distance', positive: true });
    expect(systemVariable(model, 'MIRRTEXT')).toMatchObject({ kind: 'integer', min: 0, max: 1 });
    expect(systemVariable(model, 'DIMBLK')).toMatchObject({ kind: 'name', empty: true });
    expect(systemVariable(model, '$TEXTSIZE')).toBeUndefined();
    expect(systemVariable(model, 'ORTHOMODE')).toMatchObject({ store: 'app' });
    expect(systemVariable(model, 'LINE')).toBeUndefined();
  });
});

// M2-59: the variables AutoCAD works out and nobody sets (AutoCAD 2024 Help, "System Variables":
// CTAB, DATE, CDATE, VIEWSIZE, VIEWCTR, DWGNAME, DWGPREFIX, DWGTITLED, DBMOD), each read only.
// M2-59 part 4: the AcDbVariableDictionary's DICTIONARYVARs AutoCAD saves outside the HEADER
// section. Each holds text; SETVAR shows and takes the numeric ones as numbers, and the ones
// naming a style or scale take a name the drawing has, as the save checks.
describe('distance variables (M2-35 part 23)', () => {
  // AutoCAD shows and reads a length-valued variable in the drawing's units, as its other
  // prompts' defaults (RTOS, `formatDistance`; typed with `parseDistance`): TEXTSIZE under
  // Architectural units reads `<0'-0 3/16">` and takes `1/4` or `1'6"`.
  const ARCHITECTURAL: [string, HeaderValue][] = [
    ...HEADER,
    ['$LUNITS', 4],
    ['$TEXTSIZE', 0.1875],
    ['$FILLETRAD', 0],
    ['$DIMTXT', 0.125],
    ['$DIMCEN', -0.09],
    ['$LTSCALE', 1],
    ['$LIMMAX', { x: 144, y: 96 }],
  ];

  it('shows a length in the drawing’s units and takes one typed in them', async () => {
    const s = setup(withHeader(ARCHITECTURAL));
    await s.bus.script(['TEXTSIZE']);
    expect(s.bus.promptText).toBe('Enter new value for TEXTSIZE <0\'-0 3/16">:');
    await s.bus.script(['1/4']);
    expect(s.model.header.get('$TEXTSIZE')).toBe(0.25);
    await s.bus.script(['SETVAR', 'FILLETRAD']);
    expect(s.bus.promptText).toBe('Enter new value for FILLETRAD <0\'-0">:');
    await s.bus.script(['1\'6-1/2"']);
    expect(s.model.header.get('$FILLETRAD')).toBe(18.5);
    // A dimension variable: DIMCEN's negative value (centre lines) keeps its sign.
    await s.bus.script(['DIMCEN']);
    expect(s.bus.promptText).toBe('Enter new value for DIMCEN <-0\'-0 1/16">:');
    await s.bus.script(['', 'DIMTXT', '3/32']);
    expect(s.model.header.get('$DIMTXT')).toBe(0.09375);
    // A factor stays a plain number.
    await s.bus.script(['LTSCALE']);
    expect(s.bus.promptText).toBe('Enter new value for LTSCALE <1.0000>:');
  });

  it('refuses what is no length, and a length out of range, and asks again', async () => {
    const s = setup(withHeader(ARCHITECTURAL));
    await s.bus.script(['TEXTSIZE', 'abc']);
    expect(s.log.at(-1)).toBe('Requires numeric distance.');
    await s.bus.script(['0\'0"']);
    expect(s.log.at(-1)).toBe('Value must be positive and nonzero.');
    expect(s.bus.promptText).toBe('Enter new value for TEXTSIZE <0\'-0 3/16">:');
    await s.bus.script(['2"']);
    expect(s.model.header.get('$TEXTSIZE')).toBe(2);
    await s.bus.script(['DIMTXT', '-1']);
    expect(s.log.at(-1)).toBe('Value must be positive and nonzero.');
  });

  it('shows points in the drawing’s units, SCREENSIZE in pixels', async () => {
    const s = setup(withHeader(ARCHITECTURAL));
    await s.bus.script(['LIMMAX']);
    expect(s.bus.promptText).toBe('Enter new value for LIMMAX <12\'-0",8\'-0">:');
    await s.bus.script(['', 'SETVAR', '?', 'TEXTSIZE,INSBASE']);
    expect(s.log.slice(-2)).toEqual([
      'INSBASE           0\'-0",0\'-0",0\'-0"',
      'TEXTSIZE          0\'-0 3/16"',
    ]);
    const sized: ViewHost = {
      request: (r): Promise<ViewReply> =>
        Promise.resolve(
          r.op === 'get'
            ? {
                ok: true,
                view: { center: { x: 30, y: 6 }, height: 24, width: 48, paper: false },
                screen: { width: 1180, height: 590 },
              }
            : { ok: false, message: 'no' },
        ),
    };
    const v = setup(withHeader(ARCHITECTURAL), sized);
    await v.bus.script(['SCREENSIZE']);
    expect(v.log.at(-1)).toBe('SCREENSIZE = 1180.0000,590.0000 (read only)');
    await v.bus.script(['VIEWSIZE']);
    expect(v.log.at(-1)).toBe('VIEWSIZE = 2\'-0" (read only)');
    await v.bus.script(['VIEWCTR']);
    expect(v.log.at(-1)).toBe('VIEWCTR = 2\'-6",0\'-6",0\'-0" (read only)');
  });

  it('keeps a DICTIONARYVAR length as the text AutoCAD writes', async () => {
    const s = setup(withHeader([...ARCHITECTURAL, ['CENTEREXE', '0.120000']]));
    await s.bus.script(['CENTEREXE']);
    expect(s.bus.promptText).toBe('Enter new value for CENTEREXE <0\'-0 1/8">:');
    await s.bus.script(['1/4"']);
    expect(s.model.header.get('CENTEREXE')).toBe('0.250000');
  });

  it('reads a decimal drawing’s lengths as numbers, sums among them', async () => {
    const s = setup(withHeader([...HEADER, ['$FILLETRAD', 0]]));
    await s.bus.script(['FILLETRAD']);
    expect(s.bus.promptText).toBe('Enter new value for FILLETRAD <0.0000>:');
    await s.bus.script(['2.5*2']);
    expect(s.model.header.get('$FILLETRAD')).toBe(5);
  });
});

describe('angle variables (M2-35 part 24)', () => {
  // AutoCAD shows and reads an angle-valued variable in the drawing's angular units, as its
  // other prompts' defaults (ANGTOS, `formatAngle`; typed as any angle, `parseAngleValue`):
  // ANGBASE, CHAMFERD, SNAPANG and DIMJOGANG, which the drawing keeps in radians.
  const SURVEYOR: [string, HeaderValue][] = [
    ...HEADER,
    ['$AUNITS', 4],
    ['$AUPREC', 2],
    ['$ANGBASE', Math.PI / 2],
    ['$CHAMFERD', 0],
    ['$DIMJOGANG', Math.PI / 4],
  ];

  it('shows an angle in the drawing’s units and takes one typed in any of them', async () => {
    const s = setup(withHeader(SURVEYOR));
    await s.bus.script(['ANGBASE']);
    expect(s.bus.promptText).toBe('Enter new value for ANGBASE <N>:');
    await s.bus.script(["N 45d30' W"]);
    expect(s.model.header.get('$ANGBASE')).toBeCloseTo((135.5 * Math.PI) / 180, 12);
    await s.bus.script(['DIMJOGANG']);
    expect(s.bus.promptText).toBe("Enter new value for DIMJOGANG <N 45d0' E>:");
    await s.bus.script(['50g']);
    expect(s.model.header.get('$DIMJOGANG')).toBeCloseTo(Math.PI / 4, 12);
    await s.bus.script(['SETVAR', 'CHAMFERD', '0.5r']);
    expect(s.model.header.get('$CHAMFERD')).toBeCloseTo(0.5, 12);
    // A plain number is decimal degrees whatever AUNITS says, as at any angle prompt.
    await s.bus.script(['CHAMFERD', '30']);
    expect(s.model.header.get('$CHAMFERD')).toBeCloseTo(Math.PI / 6, 12);
    await s.bus.script(['SETVAR', '?', 'ANGBASE,CHAMFERD']);
    expect(s.log.slice(-2)).toEqual([
      "ANGBASE           N 45d30' W",
      "CHAMFERD          N 60d0' E",
    ]);
  });

  it('shows degrees, grads and radians with AUPREC, a negative angle as its turn', async () => {
    const units = (aunits: number, auprec: number): [string, HeaderValue][] => [
      ...HEADER,
      ['$AUNITS', aunits],
      ['$AUPREC', auprec],
      ['$ANGBASE', -Math.PI / 2],
      ['$DIMJOGANG', Math.PI / 4],
    ];
    const deg = setup(withHeader(units(0, 1)));
    await deg.bus.script(['ANGBASE']);
    expect(deg.bus.promptText).toBe('Enter new value for ANGBASE <270.0>:');
    const dms = setup(withHeader(units(1, 4)));
    await dms.bus.script(['DIMJOGANG']);
    expect(dms.bus.promptText).toBe('Enter new value for DIMJOGANG <45d0\'0">:');
    await dms.bus.script(["22d30'"]);
    expect(dms.model.header.get('$DIMJOGANG')).toBeCloseTo((22.5 * Math.PI) / 180, 12);
    const grads = setup(withHeader(units(2, 2)));
    await grads.bus.script(['DIMJOGANG']);
    expect(grads.bus.promptText).toBe('Enter new value for DIMJOGANG <50.00g>:');
    const radians = setup(withHeader(units(3, 3)));
    await radians.bus.script(['DIMJOGANG']);
    expect(radians.bus.promptText).toBe('Enter new value for DIMJOGANG <0.785r>:');
  });

  it('refuses what is no angle, and DIMJOGANG outside 5 to 90 degrees, and asks again', async () => {
    const s = setup(withHeader(SURVEYOR));
    await s.bus.script(['ANGBASE', 'abc']);
    expect(s.log.at(-1)).toBe('Requires valid numeric angle.');
    expect(s.bus.promptText).toBe('Enter new value for ANGBASE <N>:');
    await s.bus.script(['', 'DIMJOGANG', '4']);
    expect(s.log.at(-1)).toBe('Value must be between 5 and 90.');
    await s.bus.script(['120g']);
    expect(s.log.at(-1)).toBe('Value must be between 5 and 90.');
    await s.bus.script(['90']);
    expect(s.model.header.get('$DIMJOGANG')).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('AcDbVariableDictionary variables (M2-59 part 4)', () => {
  const tableStyle = (handle: string, name: string): TableStyleRecord => ({
    handle,
    name,
    description: '',
    flowDirection: 0,
    styleFlags: 0,
    horizontalMargin: 0.06,
    verticalMargin: 0.06,
    suppressTitle: false,
    suppressHeader: false,
    cellStyles: [],
  });
  function dictionaryInit(): DocumentInit {
    const init = withHeader([
      ...HEADER,
      ['CMLEADERSTYLE', 'Standard'],
      ['CTABLESTYLE', 'STANDARD'],
      ['CANNOSCALE', '1:1'],
      ['CANNOSCALEVALUE', 1],
      ['MSLTSCALE', '0'],
      ['LAYEREVAL', '0'],
      ['LAYERNOTIFY', '0'],
      ['LIGHTINGUNITS', '2'],
      ['HIDETEXT', '1'],
      ['CENTEREXE', '3.500000'],
      ['HPTRANSPARENCY', 'ByLayer'],
      ['CENTERLTYPEFILE', 'acadiso.lin'],
    ]);
    return {
      ...init,
      meta: {
        ...init.meta,
        annotationScales: [
          { name: '1:1', value: 1 },
          { name: '1:50', value: 0.02 },
          { name: '1/4" = 1\'-0"', value: 1 / 48 },
        ],
      },
      tables: {
        ...init.tables,
        mleaderStyles: [
          { handle: '35', ...standardMLeaderStyle(true, undefined) },
          { handle: '36', ...standardMLeaderStyle(true, undefined), name: 'Callout' },
        ],
        tableStyles: [tableStyle('37', 'Standard'), tableStyle('38', 'Schedule')],
      },
    };
  }

  it('sets the current multileader and table styles to a style the drawing has', async () => {
    const s = setup(dictionaryInit());
    await s.bus.script(['CMLEADERSTYLE']);
    expect(s.bus.promptText).toBe('Enter new value for CMLEADERSTYLE <"Standard">:');
    await s.bus.script(['Detail']);
    expect(s.log.at(-1)).toBe('No multileader style named "Detail".');
    // Spelled as the style is, whatever the case typed.
    await s.bus.script(['callout']);
    expect(s.model.header.get('CMLEADERSTYLE')).toBe('Callout');
    expect(s.bus.undo.state.nextUndo).toBe('CMLEADERSTYLE');
    await s.bus.script(['SETVAR', 'ctablestyle']);
    expect(s.bus.promptText).toBe('Enter new value for CTABLESTYLE <"STANDARD">:');
    await s.bus.script(['.']);
    expect(s.log.at(-1)).toBe('CTABLESTYLE cannot name nothing.');
    await s.bus.script(['SCHEDULE']);
    expect(s.model.header.get('CTABLESTYLE')).toBe('Schedule');
    await s.bus.script(['U']);
    expect(s.model.header.get('CTABLESTYLE')).toBe('STANDARD');
  });

  it('sets the annotation scale to one of the drawing’s scales, CANNOSCALEVALUE following', async () => {
    const s = setup(dictionaryInit());
    await s.bus.script(['CANNOSCALE']);
    expect(s.bus.promptText).toBe('Enter new value for CANNOSCALE <"1:1">:');
    await s.bus.script(['1:100']);
    expect(s.log.at(-1)).toBe('No annotation scale named "1:100".');
    await s.bus.script(['1:50']);
    expect(s.model.header.get('CANNOSCALE')).toBe('1:50');
    expect(s.model.header.get('CANNOSCALEVALUE')).toBe(0.02);
    // Names may hold spaces and quotes.
    await s.bus.script(['CANNOSCALE', '1/4" = 1\'-0"']);
    expect(s.model.header.get('CANNOSCALE')).toBe('1/4" = 1\'-0"');
    expect(s.model.header.get('CANNOSCALEVALUE')).toBeCloseTo(1 / 48, 12);
    await s.bus.script(['CANNOSCALEVALUE']);
    expect(s.log.at(-1)).toBe('CANNOSCALEVALUE = 0.0208 (read only)');
    // One undo step puts both back.
    await s.bus.script(['U']);
    expect(s.model.header.get('CANNOSCALE')).toBe('1:50');
    expect(s.model.header.get('CANNOSCALEVALUE')).toBe(0.02);
  });

  it('shows and takes the numeric ones as numbers, kept as the text AutoCAD writes', async () => {
    const s = setup(dictionaryInit());
    await s.bus.script(['MSLTSCALE']);
    expect(s.bus.promptText).toBe('Enter new value for MSLTSCALE <0>:');
    await s.bus.script(['2']);
    expect(s.log.at(-1)).toBe('Value must be between 0 and 1.');
    await s.bus.script(['1']);
    expect(s.model.header.get('MSLTSCALE')).toBe('1');
    await s.bus.script(['LAYEREVAL', '3']);
    expect(s.log.at(-1)).toBe('Value must be between 0 and 2.');
    await s.bus.script(['2']);
    expect(s.model.header.get('LAYEREVAL')).toBe('2');
    await s.bus.script(['LAYERNOTIFY', '16']);
    expect(s.log.at(-1)).toBe('Value must be between 0 and 15.');
    await s.bus.script(['15']);
    expect(s.model.header.get('LAYERNOTIFY')).toBe('15');
    await s.bus.script(['HIDETEXT', '0']);
    expect(s.model.header.get('HIDETEXT')).toBe('0');
    await s.bus.script(['LIGHTINGUNITS', '1.5']);
    expect(s.log.at(-1)).toBe('Requires an integer value.');
    await s.bus.script(['0']);
    expect(s.model.header.get('LIGHTINGUNITS')).toBe('0');
    await s.bus.script(['CENTEREXE']);
    expect(s.bus.promptText).toBe('Enter new value for CENTEREXE <3.5000>:');
    await s.bus.script(['-1']);
    expect(s.log.at(-1)).toBe('Value must be positive or zero.');
    await s.bus.script(['0.12']);
    expect(s.model.header.get('CENTEREXE')).toBe('0.120000');
    await s.bus.script(['HPTRANSPARENCY', '50']);
    expect(s.model.header.get('HPTRANSPARENCY')).toBe('50');
    await s.bus.script(['HPTRANSPARENCY', 'byblock']);
    expect(s.model.header.get('HPTRANSPARENCY')).toBe('ByBlock');
    // Enter keeps a value without an edit.
    const before = s.bus.undo.state.undoable;
    await s.bus.script(['MSLTSCALE', '']);
    expect(s.bus.undo.state.undoable).toBe(before);
    // A file name Triya reads nothing from stays as the drawing has it.
    await s.bus.script(['CENTERLTYPEFILE']);
    expect(s.log.at(-1)).toBe('CENTERLTYPEFILE = "acadiso.lin" (read only)');
  });

  it('sets a HEADER variable’s DICTIONARYVAR twin with it', async () => {
    // AutoCAD's files state HIDETEXT, XCLIPFRAME, DIMASSOC, … in both places; both must agree.
    const s = setup(withHeader([...HEADER, ['$HIDETEXT', 1], ['HIDETEXT', '1']]));
    await s.bus.script(['HIDETEXT']);
    expect(s.bus.promptText).toBe('Enter new value for HIDETEXT <1>:');
    await s.bus.script(['0']);
    expect(s.model.header.get('$HIDETEXT')).toBe(0);
    expect(s.model.header.get('HIDETEXT')).toBe('0');
    await s.bus.script(['U']);
    expect(s.model.header.get('$HIDETEXT')).toBe(1);
    expect(s.model.header.get('HIDETEXT')).toBe('1');
  });

  it('shows a DICTIONARYVAR whose text is no number as the text', async () => {
    const s = setup(withHeader([...HEADER, ['LAYEREVAL', 'x'], ['CANNOSCALE', '1:1']]));
    await s.bus.script(['LAYEREVAL']);
    expect(s.bus.promptText).toBe('Enter new value for LAYEREVAL <"x">:');
    await s.bus.script(['1']);
    expect(s.model.header.get('LAYEREVAL')).toBe('1');
    // A drawing without a scale list has no scale to name.
    await s.bus.script(['CANNOSCALE', '1:1']);
    expect(s.log.at(-1)).toBe('No annotation scale named "1:1".');
  });

  it('lists them with SETVAR ?', async () => {
    const s = setup(dictionaryInit());
    await s.bus.script(['SETVAR', '?', 'C*STYLE,MSLTSCALE,CANNO*']);
    expect(s.log.filter((l) => /^(C[A-Z]*STYLE|MSLTSCALE|CANNO)/.test(l))).toEqual([
      'CANNOSCALE        "1:1"',
      'CANNOSCALEVALUE   1.0000            (read only)',
      'CMLEADERSTYLE     "Standard"',
      'CTABLESTYLE       "STANDARD"',
      'CVIEWDETAILSTYLE  "Metric50"        (read only)',
      'MSLTSCALE         0',
    ]);
  });
});

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
    expect(model.bus.promptText).toBe('Enter new value for CTAB <"Model">:');
    const paper = setup(sampleInit(), undefined, { space: () => PAPER_SPACE });
    await paper.bus.script(['CTAB']);
    expect(paper.bus.promptText).toBe('Enter new value for CTAB <"Layout1">:');
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

  it('measures the canvas in pixels (SCREENSIZE), and says when no canvas shows one', async () => {
    // AutoCAD 2024 Help, "SCREENSIZE": the current viewport's size in pixels, X and Y.
    const sized: ViewHost = {
      request: (r): Promise<ViewReply> =>
        Promise.resolve(
          r.op === 'get'
            ? {
                ok: true,
                view: { center: { x: 5, y: 2.5 }, height: 20, width: 40, paper: false },
                screen: { width: 1180, height: 590 },
              }
            : { ok: false, message: 'no' },
        ),
    };
    const s = setup(sampleInit(), sized);
    await s.bus.script(['SCREENSIZE']);
    expect(s.log.at(-1)).toBe('SCREENSIZE = 1180.0000,590.0000 (read only)');
    // A host that measures no pixels.
    const unsized = setup(sampleInit(), canvas);
    await unsized.bus.script(['SCREENSIZE']);
    expect(unsized.log.at(-1)).toBe('No view is shown.');
    const bare = setup();
    await bare.bus.script(['SCREENSIZE']);
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
      'CTAB              "Model"',
      'DATE              2461359.60941111  (read only)',
      // A value too long for its column still has a space before the note.
      'VIEWCTR           5.0000,2.5000,0.0000 (read only)',
      'VIEWSIZE          20.0000           (read only)',
    ]);
    const model = DocumentModel.create(sampleInit());
    expect(systemVariable(model, 'ctab')).toMatchObject({ store: 'computed', kind: 'name' });
    expect(systemVariable(model, 'ctab')?.readOnly).toBeUndefined();
    expect(systemVariable(model, 'DWGNAME')).toMatchObject({ store: 'app', readOnly: true });
  });
});

// M2-59 part 5: CTAB and TILEMODE switch tabs (AutoCAD 2024 Help, "CTAB": "Returns the name of
// the current layout in the drawing. Provides a means for the user to determine which tab is
// active"; "TILEMODE": 0 "Makes the last active layout tab active", 1 "Makes the Model tab
// active"). The tabs are the app's: a `tab` request shows one, and no undo step is made, as a
// tab clicked makes none. AutoCAD's own TILEMODE is kept in the header; Triya's tabs never wrote
// it, so it is read from the tab shown, as CTAB is.
describe('CTAB and TILEMODE', () => {
  /** The app's layout tabs: `tab` requests show the one named, or the last layout shown. */
  function tabsHost(reply: ViewReply = { ok: true }) {
    const asked: { name?: string }[] = [];
    const view: ViewHost = {
      request: (r): Promise<ViewReply> => {
        if (r.op !== 'tab') return Promise.resolve({ ok: false, message: 'no' });
        asked.push(r.name === undefined ? {} : { name: r.name });
        return Promise.resolve(reply);
      },
    };
    return { view, asked };
  }

  it('CTAB shows the layout named, in any case, and asks again for one the drawing lacks', async () => {
    const tabs = tabsHost();
    const s = setup(sampleInit(), tabs.view);
    await s.bus.script(['CTAB', 'sheet9']);
    expect(s.log.at(-1)).toBe('No layout named "sheet9".');
    expect(s.bus.promptText).toBe('Enter new value for CTAB <"Model">:');
    await s.bus.script(['layout1']);
    expect(s.bus.command).toBeUndefined();
    // As the drawing spells it; a tab switch is no edit and no undo step.
    expect(tabs.asked).toEqual([{ name: 'Layout1' }]);
    expect(s.bus.undo.state.undoable).toBe(0);
    const paper = setup(sampleInit(), tabs.view, { space: () => PAPER_SPACE });
    await paper.bus.script(['SETVAR', 'ctab', 'MODEL']);
    expect(tabs.asked.at(-1)).toEqual({ name: 'Model' });
    // The tab shown already: nothing to switch.
    await paper.bus.script(['CTAB', 'Layout1']);
    expect(tabs.asked).toHaveLength(2);
  });

  it('TILEMODE is 1 on the Model tab and 0 on a layout, and switches between them', async () => {
    const tabs = tabsHost();
    const model = setup(withHeader([['$TILEMODE', 0]]), tabs.view);
    await model.bus.script(['TILEMODE']);
    expect(model.bus.promptText).toBe('Enter new value for TILEMODE <1>:');
    await model.bus.script(['2']);
    expect(model.log.at(-1)).toBe('Value must be between 0 and 1.');
    // 0: the last layout shown, which the app knows.
    await model.bus.script(['0']);
    expect(tabs.asked).toEqual([{}]);
    await model.bus.script(['TILEMODE', '1']);
    expect(tabs.asked).toHaveLength(1);
    const paper = setup(sampleInit(), tabs.view, { space: () => PAPER_SPACE });
    await paper.bus.script(['TILEMODE']);
    expect(paper.bus.promptText).toBe('Enter new value for TILEMODE <0>:');
    await paper.bus.script(['1']);
    expect(tabs.asked.at(-1)).toEqual({ name: 'Model' });
    // The header's TILEMODE is the file's, never changed by a tab.
    expect(model.model.header.get('$TILEMODE')).toBe(0);
    expect(model.bus.undo.state.undoable).toBe(0);
    expect(systemVariable(model.model, 'TILEMODE')).toMatchObject({
      store: 'computed',
      kind: 'switch',
    });
  });

  it('switch no tab inside another command, and tell why the app cannot', async () => {
    const tabs = tabsHost();
    const s = setup(sampleInit(), tabs.view);
    // The command running draws in the space it started in: shown, not set.
    await s.bus.script(['LINE', "'TILEMODE"]);
    expect(s.log.slice(-2)).toEqual([
      'TILEMODE = 1 (read only while a command runs)',
      'Resuming LINE command.',
    ]);
    expect(tabs.asked).toEqual([]);
    expect(s.bus.command).toBe('LINE');
    const refused = setup(
      sampleInit(),
      tabsHost({ ok: false, message: 'No layout is open.' }).view,
    );
    await refused.bus.script(['CTAB', 'Layout1']);
    expect(refused.log.at(-1)).toBe('No layout is open.');
    const bare = setup();
    await bare.bus.script(['TILEMODE', '0']);
    expect(bare.log.at(-1)).toBe('There is no view to change.');
  });
});

describe('PICKFIRST', () => {
  it('is a session setting of each drawing’s command line, never an edit or undo step', () => {
    const session = new EngineSession(sampleInit());
    expect(session.edit({ kind: 'sysvar', name: PICKFIRST, value: 0 })).toEqual({
      ok: true,
      change: {},
    });
    expect(session.pickfirst).toBe(false);
    expect(session.undoState.undoable).toBe(0);
    expect(session.model.header.has(PICKFIRST)).toBe(false);
    session.edit({ kind: 'sysvar', name: PICKFIRST, value: 1 });
    expect(session.pickfirst).toBe(true);
  });
});

describe('PICKADD and PICKAUTO', () => {
  it('are session settings of each drawing’s "Select objects", in their ranges', () => {
    const session = new EngineSession(sampleInit());
    expect(session.edit({ kind: 'sysvar', name: 'PICKADD', value: 0 })).toEqual({
      ok: true,
      change: {},
    });
    expect(session.edit({ kind: 'sysvar', name: 'PICKAUTO', value: 7 })).toEqual({
      ok: true,
      change: {},
    });
    expect(session.undoState.undoable).toBe(0);
    expect(session.edit({ kind: 'sysvar', name: 'PICKADD', value: 4 })).toEqual({
      ok: false,
      message: 'Cannot set PICKADD to 4.',
    });
    expect(session.edit({ kind: 'sysvar', name: 'PICKAUTO', value: 1.5 })).toMatchObject({
      ok: false,
    });
  });

  it('PICKSTYLE and GROUPDISPLAYMODE are session settings of its grips on groups (M3-13)', () => {
    const session = new EngineSession(sampleInit());
    expect(session.edit({ kind: 'sysvar', name: 'PICKSTYLE', value: 3 })).toEqual({
      ok: true,
      change: {},
    });
    expect(session.edit({ kind: 'sysvar', name: 'GROUPDISPLAYMODE', value: 0 })).toEqual({
      ok: true,
      change: {},
    });
    expect(session.edit({ kind: 'sysvar', name: 'GROUPDISPLAYMODE', value: 3 })).toEqual({
      ok: false,
      message: 'Cannot set GROUPDISPLAYMODE to 3.',
    });
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
