// M4-04 part 1: STYLE's Text Style dialog and -STYLE on the PromptBus (AutoCAD 2024 Help,
// "STYLE (Command)", "Text Style Dialog Box", "-STYLE (Command)"): Set Current, New, Apply,
// Rename and Delete, each made at once with the dialog opened again, all one undo step; -STYLE
// asks the name, font, height, width factor, obliquing angle, backwards, upside-down and (for an
// SHX font) vertical, and makes the style current.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  isTrueTypeFont,
  textStyleSettings,
  type EntityGeometry,
  type HeaderValue,
  type TextStyleAction,
  type TextStyleRecord,
  type TextStyleRequest,
  type TextStyleSettings,
} from '../../src/index';
import { entityInit, record, sampleInit } from '../model/fixtures';

const STANDARD = '30';
const NOTES = '31';
const TITLE = '32';
const SPARE = '33';
const XREF = '34';
const SHAPES = '35';
const LABELS = '36';
const ANNO = '37';
const ANNO_APP = '13';

const textStyle = (
  handle: string,
  name: string,
  extra: Partial<TextStyleRecord> = {},
): TextStyleRecord => ({
  handle,
  name,
  font: 'txt',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 0.2,
  generation: 0,
  trueTypeFlags: 0,
  ...extra,
});

const text = (style: string): EntityGeometry =>
  ({
    kind: 'TEXT',
    value: 'A',
    style,
    position: { x: 0, y: 0 },
    height: 2.5,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
    backward: false,
    upsideDown: false,
  }) as EntityGeometry;

function setup(header: [string, HeaderValue][] = []) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    header: new Map<string, HeaderValue>([
      ...(base.header ?? []),
      ['$TEXTSTYLE', 'Standard'],
      ['$DIMTXSTY', 'Standard'],
      ...header,
    ]),
    tables: {
      ...base.tables,
      appIds: [record('12', 'ACAD'), record(ANNO_APP, 'AcadAnnotative')],
      textStyles: [
        textStyle(STANDARD, 'Standard'),
        textStyle(NOTES, 'Notes', { font: 'romans.shx', height: 3.5, widthFactor: 0.8 }),
        textStyle(TITLE, 'Title', { font: 'arial.ttf', trueTypeFlags: 2 }),
        textStyle(SPARE, 'Spare', { font: 'simplex.shx', bigFont: 'bigfont.shx' }),
        textStyle(XREF, 'Site|Standard', { flags: 16 | 32 }),
        textStyle(SHAPES, '', { font: 'ltypeshp.shx', flags: 1 }),
        textStyle(LABELS, 'Labels', { font: 'isocp.shx' }),
        textStyle(ANNO, 'Anno', {
          xdata: [
            {
              appId: ANNO_APP,
              values: [
                { code: 1000, value: 'AnnotativeData' },
                { code: 1002, value: '{' },
                { code: 1070, value: 1 },
                { code: 1070, value: 1 },
                { code: 1002, value: '}' },
              ],
            },
          ],
        }),
      ],
      mleaderStyles: [
        {
          handle: '40',
          name: 'Callouts',
          textStyle: LABELS,
        } as never,
      ],
    },
    entities: [...(base.entities ?? []), entityInit('50', text(NOTES))],
  });
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const request = () => {
    const p = bus.prompt;
    if (p?.kind !== 'dialog' || p.dialog.type !== 'textstyle') throw new Error('no dialog');
    return p.dialog as TextStyleRequest;
  };
  const act = (textstyle: TextStyleAction) =>
    bus.answer({ kind: 'dialog', action: 'apply', textstyle });
  const styleNamed = (name: string) =>
    [...model.tables.textStyles.values()].find((s) => s.name === name);
  return { model, bus, request, act, styleNamed };
}

const settings = (extra: Partial<TextStyleSettings> = {}): TextStyleSettings => ({
  font: 'txt',
  bigFont: '',
  bold: false,
  italic: false,
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  backwards: false,
  upsideDown: false,
  vertical: false,
  ...extra,
});

describe('STYLE: the Text Style dialog', () => {
  it('lists the named styles with their settings, what is used, and the fonts named', async () => {
    const s = setup();
    await s.bus.submit('STYLE');
    const r = s.request();
    expect(r.current).toBe('Standard');
    expect(r.selected).toBe('Standard');
    // The shape file's nameless style is not listed; an xref's is, read only.
    expect(r.styles.map((x) => x.name)).toEqual([
      'Anno',
      'Labels',
      'Notes',
      'Site|Standard',
      'Spare',
      'Standard',
      'Title',
    ]);
    const row = (n: string) => r.styles.find((x) => x.name === n)!;
    expect(row('Notes').settings).toEqual(
      settings({ font: 'romans.shx', height: 3.5, widthFactor: 0.8 }),
    );
    expect(row('Title').settings).toMatchObject({ font: 'arial.ttf', bold: true, italic: false });
    expect(row('Spare').settings.bigFont).toBe('bigfont.shx');
    expect(row('Notes').used).toBe(true); // a TEXT
    expect(row('Labels').used).toBe(true); // a multileader style
    expect(row('Standard').used).toBe(true); // DIMTXSTY
    expect(row('Spare').used).toBe(false);
    expect(row('Site|Standard').xref).toBe(true);
    expect(row('Anno').annotative).toBe(true);
    expect(row('Notes').annotative).toBe(false);
    expect(r.fonts).toEqual(['arial.ttf', 'isocp.shx', 'romans.shx', 'simplex.shx', 'txt']);
    expect(r.bigFonts).toEqual(['bigfont.shx']);
  });

  it('opens on STYLE, ST and DDSTYLE, the current style being the one TEXTSTYLE names', async () => {
    const s = setup([['$TEXTSTYLE', 'notes']]);
    await s.bus.submit('ST');
    expect(s.request()).toMatchObject({ current: 'Notes', selected: 'Notes' });
    await s.bus.cancel();
    await s.bus.submit('DDSTYLE');
    expect(s.request().current).toBe('Notes');
  });

  it('sets the current style', async () => {
    const s = setup();
    await s.bus.submit('STYLE');
    await s.act({ op: 'current', name: 'notes' });
    expect(s.model.header.get('$TEXTSTYLE')).toBe('Notes');
    expect(s.request()).toMatchObject({ current: 'Notes', selected: 'Notes' });
    // An xref's style cannot be made current.
    await s.act({ op: 'current', name: 'Site|Standard' });
    expect(s.model.header.get('$TEXTSTYLE')).toBe('Notes');
    expect(s.request().note).toBe('An xref-dependent text style cannot be made current.');
  });

  it('makes a new style with the settings shown, selected and not current', async () => {
    const s = setup();
    await s.bus.submit('STYLE');
    await s.act({
      op: 'new',
      name: ' style1 ',
      settings: settings({
        font: 'arial.ttf',
        bold: true,
        italic: true,
        height: 5,
        obliqueAngle: 15,
      }),
    });
    const n = s.styleNamed('style1')!;
    expect(n).toMatchObject({
      font: 'arial.ttf',
      height: 5,
      widthFactor: 1,
      trueTypeFlags: 3,
      generation: 0,
      flags: 0,
    });
    expect(n.obliqueAngle).toBeCloseTo((15 * Math.PI) / 180, 12);
    expect(n.lastHeight).toBe(5);
    expect(n.bigFont).toBeUndefined();
    expect(s.request()).toMatchObject({ selected: 'style1', current: 'Standard' });
    expect(s.model.header.get('$TEXTSTYLE')).toBe('Standard');
  });

  it('refuses a new name in use, invalid, or settings the style cannot hold', async () => {
    const s = setup();
    await s.bus.submit('STYLE');
    await s.act({ op: 'new', name: 'NOTES', settings: settings() });
    expect(s.request().note).toBe('A text style with this name already exists.');
    await s.act({ op: 'new', name: 'a<b', settings: settings() });
    expect(s.request().note).toBe('Invalid text style name.');
    await s.act({ op: 'new', name: 'B', settings: settings({ widthFactor: 0 }) });
    expect(s.request().note).toBe('Width factor must be between 0.01 and 100.');
    await s.act({ op: 'new', name: 'B', settings: settings({ obliqueAngle: 86 }) });
    expect(s.request().note).toBe('Oblique angle must be between -85 and 85.');
    await s.act({ op: 'new', name: 'B', settings: settings({ height: -1 }) });
    expect(s.request().note).toBe('Height must be 0 or more.');
    await s.act({ op: 'new', name: 'B', settings: settings({ font: '  ' }) });
    expect(s.request().note).toBe('Choose a font.');
    expect(s.styleNamed('B')).toBeUndefined();
    // Bold and italic are a TrueType font's; a big font and vertical text an SHX font's: what the
    // font cannot have is dropped, as the dialog greys it.
    await s.act({
      op: 'new',
      name: 'C',
      settings: settings({ font: 'romans.shx', bold: true, bigFont: 'big.shx', vertical: true }),
    });
    expect(s.styleNamed('C')).toMatchObject({ trueTypeFlags: 0, bigFont: 'big.shx', flags: 4 });
    await s.act({
      op: 'new',
      name: 'D',
      settings: settings({ font: 'arial.ttf', italic: true, bigFont: 'big.shx', vertical: true }),
    });
    const d = s.styleNamed('D')!;
    expect(d).toMatchObject({ trueTypeFlags: 1, flags: 0 });
    expect(d.bigFont).toBeUndefined();
  });

  it('applies changed settings to the style, keeping what it does not show', async () => {
    const s = setup();
    await s.bus.submit('STYLE');
    const was = s.styleNamed('Notes')!;
    await s.act({
      op: 'apply',
      name: 'Notes',
      settings: {
        ...textStyleSettings(was),
        font: 'simplex.shx',
        widthFactor: 1.2,
        backwards: true,
        upsideDown: true,
      },
    });
    const now = s.styleNamed('Notes')!;
    expect(now).toMatchObject({
      handle: NOTES,
      font: 'simplex.shx',
      widthFactor: 1.2,
      height: 3.5,
      generation: 6,
      lastHeight: 0.2,
    });
    expect(s.request().selected).toBe('Notes');
    // A TrueType style made regular, given a big font it cannot have.
    await s.act({
      op: 'apply',
      name: 'Title',
      settings: settings({ font: 'arial.ttf', bigFont: 'x.shx' }),
    });
    expect(s.styleNamed('Title')).toMatchObject({ trueTypeFlags: 0 });
    expect(s.styleNamed('Title')!.bigFont).toBeUndefined();
    // A big font taken off.
    await s.act({
      op: 'apply',
      name: 'Spare',
      settings: { ...textStyleSettings(s.styleNamed('Spare')!), bigFont: '' },
    });
    expect(s.styleNamed('Spare')!.bigFont).toBeUndefined();
    // Nothing changed: no edit.
    const version = s.model.version;
    await s.act({
      op: 'apply',
      name: 'Spare',
      settings: textStyleSettings(s.styleNamed('Spare')!),
    });
    expect(s.model.version).toBe(version);
    // An xref's style is read only; a refused value changes nothing.
    await s.act({ op: 'apply', name: 'Site|Standard', settings: settings({ height: 9 }) });
    expect(s.styleNamed('Site|Standard')!.height).toBe(0);
    expect(s.request().note).toBe('An xref-dependent text style cannot be modified.');
    await s.act({ op: 'apply', name: 'Spare', settings: settings({ widthFactor: 101 }) });
    expect(s.styleNamed('Spare')!.widthFactor).toBe(1);
  });

  it('keeps the vertical flag beside the others it does not show', async () => {
    const s = setup();
    await s.bus.submit('STYLE');
    await s.act({
      op: 'apply',
      name: 'Labels',
      settings: settings({ font: 'isocp.shx', vertical: true }),
    });
    expect(s.styleNamed('Labels')!.flags).toBe(4);
    expect(textStyleSettings(s.styleNamed('Labels')!).vertical).toBe(true);
    await s.act({
      op: 'apply',
      name: 'Labels',
      settings: settings({ font: 'arial.ttf', vertical: true }),
    });
    expect(s.styleNamed('Labels')!.flags).toBe(0);
  });

  it('renames, but not Standard, an xref style or to a name in use', async () => {
    const s = setup([['$TEXTSTYLE', 'Notes']]);
    await s.bus.submit('STYLE');
    await s.act({ op: 'rename', name: 'Notes', to: 'Remarks' });
    expect(s.styleNamed('Remarks')?.handle).toBe(NOTES);
    expect(s.model.header.get('$TEXTSTYLE')).toBe('Remarks');
    expect(s.request()).toMatchObject({ selected: 'Remarks', current: 'Remarks' });
    await s.act({ op: 'rename', name: 'Standard', to: 'X' });
    expect(s.request().note).toBe('Standard cannot be renamed.');
    await s.act({ op: 'rename', name: 'Spare', to: 'title' });
    expect(s.request().note).toBe('A text style with this name already exists.');
    await s.act({ op: 'rename', name: 'Site|Standard', to: 'Y' });
    expect(s.request().note).toBe('An xref-dependent text style cannot be renamed.');
    await s.act({ op: 'rename', name: 'Spare', to: 'Spare' });
    expect(s.request().note).toBeUndefined();
    // A case change is a rename.
    await s.act({ op: 'rename', name: 'Spare', to: 'SPARE' });
    expect(s.styleNamed('SPARE')?.handle).toBe(SPARE);
  });

  it('deletes a style nothing uses, refusing Standard, the current one and those in use', async () => {
    const s = setup([['$TEXTSTYLE', 'Title']]);
    await s.bus.submit('STYLE');
    await s.act({ op: 'delete', name: 'Standard' });
    expect(s.request().note).toBe('Standard cannot be deleted.');
    await s.act({ op: 'delete', name: 'Title' });
    expect(s.request().note).toBe('The current text style cannot be deleted.');
    await s.act({ op: 'delete', name: 'Notes' });
    expect(s.request().note).toBe('Style in use, can’t be deleted.');
    await s.act({ op: 'delete', name: 'Labels' });
    expect(s.request().note).toBe('Style in use, can’t be deleted.');
    await s.act({ op: 'delete', name: 'Site|Standard' });
    expect(s.request().note).toBe('An xref-dependent text style cannot be deleted.');
    await s.act({ op: 'delete', name: 'Spare' });
    expect(s.styleNamed('Spare')).toBeUndefined();
    expect(s.request()).toMatchObject({ selected: 'Title' });
    await s.act({ op: 'delete', name: 'Gone' });
    expect(s.request().note).toBeUndefined();
  });

  it('is one undo step for everything it did, and Close (or Esc) ends it', async () => {
    const s = setup();
    await s.bus.submit('STYLE');
    await s.act({ op: 'new', name: 'A', settings: settings() });
    await s.act({ op: 'current', name: 'A' });
    await s.act({ op: 'delete', name: 'Spare' });
    await s.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(s.bus.command).toBeUndefined();
    expect(s.bus.undo.state.undoable).toBe(1);
    await s.bus.submit('U');
    expect(s.styleNamed('A')).toBeUndefined();
    expect(s.styleNamed('Spare')).toBeDefined();
    expect(s.model.header.get('$TEXTSTYLE')).toBe('Standard');
    await s.bus.submit('STYLE');
    await s.bus.cancel();
    expect(s.bus.command).toBeUndefined();
    await s.bus.submit('STYLE');
    await s.bus.answer({ kind: 'dialog', action: 'apply' });
    expect(s.bus.command).toBeUndefined();
  });

  it('refuses an action the dialog cannot send', async () => {
    const s = setup();
    await s.bus.submit('STYLE');
    const version = s.model.version;
    await s.act({ op: 'apply', name: 'Gone', settings: settings() });
    await s.act({ op: 'apply', name: 'Spare', settings: { font: 3 } as never });
    await s.act({ op: 'new', name: 'Z', settings: null as never });
    await s.act({ op: 'current', name: 'Gone' });
    await s.act({ op: 'rename', name: 'Gone', to: 'Q' });
    expect(s.model.version).toBe(version);
    expect(s.bus.command).toBeDefined();
  });
});

describe('-STYLE', () => {
  it('makes a new style from the answers and makes it current', async () => {
    const s = setup();
    await s.bus.submit('-STYLE');
    expect(s.bus.promptText).toBe('Enter name of text style or [?] <Standard>:');
    await s.bus.script(['Callout']);
    expect(s.bus.history.at(-1)).toBe('New style.');
    expect(s.bus.promptText).toBe('Specify full font name or font filename (TTF or SHX) <txt>:');
    await s.bus.script(['romans.shx,bigfont.shx']);
    expect(s.bus.promptText).toBe('Specify height of text or [Annotative] <0.0000>:');
    await s.bus.script(['A']);
    expect(s.bus.history.at(-1)).toBe('Triya does not make annotative text styles.');
    await s.bus.script(['2.5', '0.9', '10', 'Y']);
    expect(s.bus.promptText).toBe('Display text upside-down? [Yes/No] <No>:');
    await s.bus.script(['N']);
    expect(s.bus.promptText).toBe('Vertical? [Yes/No] <No>:');
    await s.bus.script(['Y']);
    expect(s.bus.history.at(-1)).toBe('"Callout" is now the current text style.');
    expect(s.bus.command).toBeUndefined();
    const c = s.styleNamed('Callout')!;
    expect(c).toMatchObject({
      font: 'romans.shx',
      bigFont: 'bigfont.shx',
      height: 2.5,
      widthFactor: 0.9,
      generation: 2,
      flags: 4,
    });
    expect(c.obliqueAngle).toBeCloseTo((10 * Math.PI) / 180, 12);
    expect(s.model.header.get('$TEXTSTYLE')).toBe('Callout');
    expect(s.bus.undo.state.undoable).toBe(1);
  });

  it('changes an existing style, its answers defaulting to what it has; no vertical for TrueType', async () => {
    const s = setup();
    await s.bus.submit('-STYLE');
    await s.bus.script(['notes']);
    expect(s.bus.history.at(-1)).toBe('Existing style.');
    expect(s.bus.promptText).toBe(
      'Specify full font name or font filename (TTF or SHX) <romans.shx>:',
    );
    await s.bus.script(['arial.ttf']);
    expect(s.bus.promptText).toBe('Specify height of text or [Annotative] <3.5000>:');
    await s.bus.script(['', '']);
    expect(s.bus.promptText).toBe('Specify obliquing angle <0>:');
    await s.bus.script(['', '', 'Y']);
    expect(s.bus.command).toBeUndefined();
    expect(s.styleNamed('Notes')).toMatchObject({
      handle: NOTES,
      font: 'arial.ttf',
      height: 3.5,
      widthFactor: 0.8,
      generation: 4,
    });
    expect(s.model.header.get('$TEXTSTYLE')).toBe('Notes');
  });

  it('refuses values out of range and asks again; ? lists the styles', async () => {
    const s = setup();
    await s.bus.submit('-STYLE');
    await s.bus.script(['?']);
    expect(s.bus.promptText).toBe('Enter text style(s) to list <*>:');
    await s.bus.script(['']);
    expect(s.bus.history).toContain('Style name: "Notes"  Font files: romans.shx');
    expect(s.bus.history).toContain('   Height: 3.5000  Width factor: 0.8000  Obliquing angle: 0');
    expect(s.bus.history).toContain('   Generation: Normal');
    expect(s.bus.history).toContain('Style name: "Spare"  Font files: simplex.shx, bigfont.shx');
    expect(s.bus.history.some((l) => l.includes('Site|Standard'))).toBe(true);
    expect(s.bus.history.some((l) => l.includes('ltypeshp'))).toBe(false);
    await s.bus.script(['?', 'N*']);
    expect(s.bus.history.filter((l) => l.startsWith('Style name: "Notes"'))).toHaveLength(2);
    expect(s.bus.history.filter((l) => l.startsWith('Style name: "Spare"'))).toHaveLength(1);
    await s.bus.script(['a<b']);
    expect(s.bus.history.at(-1)).toBe('Invalid text style name.');
    await s.bus.script(['Site|Standard']);
    expect(s.bus.history.at(-1)).toBe('An xref-dependent text style cannot be modified.');
    await s.bus.script(['Fresh', '', '-1']);
    expect(s.bus.history.at(-1)).toBe('Height must be 0 or more.');
    await s.bus.script(['1', '0']);
    expect(s.bus.history.at(-1)).toBe('Width factor must be between 0.01 and 100.');
    await s.bus.script(['1', '86']);
    expect(s.bus.history.at(-1)).toBe('Oblique angle must be between -85 and 85.');
    await s.bus.script(['-85', '', '', '']);
    expect(s.bus.command).toBeUndefined();
    expect(s.styleNamed('Fresh')!.obliqueAngle).toBeCloseTo((-85 * Math.PI) / 180, 12);
  });

  it('ends without a change when cancelled', async () => {
    const s = setup();
    await s.bus.submit('-STYLE');
    await s.bus.script(['Late', 'txt', '1']);
    await s.bus.cancel();
    expect(s.styleNamed('Late')).toBeUndefined();
    expect(s.bus.undo.state.undoable).toBe(0);
  });
});

describe('isTrueTypeFont', () => {
  it('tells a TrueType or OpenType file from an SHX font', () => {
    expect(isTrueTypeFont('arial.ttf')).toBe(true);
    expect(isTrueTypeFont('C:\\Fonts\\SimSun.TTC')).toBe(true);
    expect(isTrueTypeFont('Font.otf ')).toBe(true);
    expect(isTrueTypeFont('romans.shx')).toBe(false);
    expect(isTrueTypeFont('txt')).toBe(false);
  });
});
