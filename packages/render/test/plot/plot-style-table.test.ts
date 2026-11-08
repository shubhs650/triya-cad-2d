// CTB/STB plot style tables (M2-15): the container AutoCAD writes (a 48-byte
// `PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec` marker, three little-endian 32-bit
// words, then a zlib stream of the text) and the text itself, as the format is published by
// ezdxf's `acadctb` add-on (MIT) and in AutoCAD's Plot Style Table Editor help.
import { unzlibSync, zlibSync, strToU8, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  OBJECT_COLOR,
  OBJECT_LINETYPE,
  OBJECT_LINEWEIGHT,
  PlotStyleTableError,
  newPlotStyle,
  parsePlotStyleTable,
  parsePlotStyleText,
  plotStyleText,
  writePlotStyleTable,
  type PlotStyleTable,
} from '../../src/index';

/** A CTB as AutoCAD lays its text out: a quote opens a string and nothing closes it. */
const CTB_TEXT = [
  'description="Pens for the GA set',
  'aci_table_available=TRUE',
  'scale_factor=1.0',
  'apply_factor=FALSE',
  'custom_lineweight_display_units=0',
  'aci_table{',
  ' 0="Color_1',
  ' 1="Color_2',
  '}',
  'plot_style{',
  ' 0{',
  '  name="Color_1',
  '  localized_name="Color_1',
  '  description="',
  '  color=-1023410176',
  '  mode_color=-1023410176',
  '  color_policy=3',
  '  physical_pen_number=0',
  '  virtual_pen_number=0',
  '  screen=60',
  '  linepattern_size=0.5',
  '  linetype=31',
  '  adaptive_linetype=TRUE',
  '  lineweight=10',
  '  fill_style=73',
  '  end_style=4',
  '  join_style=5',
  ' }',
  ' 6{',
  '  name="Color_7',
  '  localized_name="Color_7',
  '  description="',
  '  color=-1006632961',
  '  mode_color=-1006632961',
  '  color_policy=1',
  '  physical_pen_number=0',
  '  virtual_pen_number=0',
  '  screen=100',
  '  linepattern_size=0.5',
  '  linetype=2',
  '  adaptive_linetype=FALSE',
  '  lineweight=255',
  '  fill_style=64',
  '  end_style=2',
  '  join_style=1',
  ' }',
  '}',
  'custom_lineweight_table{',
  ' 0=0.00',
  ' 1=0.05',
  ' 2=0.09',
  ' 3=0.10',
  ' 4=0.13',
  ' 5=0.15',
  ' 6=0.18',
  ' 7=0.20',
  ' 8=0.25',
  ' 9=0.30',
  ' 10=0.35',
  '}',
  '',
].join('\n');

/** The binary container around `text`, with sizes and checksum as AutoCAD writes them. */
function container(text: string, marker = 'CTBVER1'): Uint8Array {
  const body = strToU8(`${text}\0`);
  const packed = zlibSync(body);
  const head = strToU8(`PIAFILEVERSION_2.0,${marker},compress\r\npmzlibcodec`);
  const out = new Uint8Array(60 + packed.length);
  out.set(head, 0);
  const view = new DataView(out.buffer);
  view.setUint32(48, 0, true);
  view.setUint32(52, body.length, true);
  view.setUint32(56, packed.length, true);
  out.set(packed, 60);
  return out;
}

describe('parsePlotStyleText', () => {
  const t = parsePlotStyleText(CTB_TEXT);

  it('reads the header values', () => {
    expect(t.kind).toBe('ctb');
    expect(t.description).toBe('Pens for the GA set');
    expect(t.scaleFactor).toBe(1);
    expect(t.applyFactor).toBe(false);
    expect(t.lineweightUnits).toBe('mm');
    expect(t.lineweights).toEqual([0, 0.05, 0.09, 0.1, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35]);
  });

  it('holds one style per ACI colour, the ones the file leaves out using the object', () => {
    expect(t.styles).toHaveLength(255);
    expect(t.styles.map((s) => s.name).slice(0, 3)).toEqual(['Color_1', 'Color_2', 'Color_3']);
    expect(t.styles[254]!.name).toBe('Color_255');
    const absent = t.styles[1]!;
    expect(absent.color).toBe(OBJECT_COLOR);
    expect(absent.linetype).toBe(OBJECT_LINETYPE);
    expect(absent.lineweight).toBe(OBJECT_LINEWEIGHT);
    expect(absent.screening).toBe(100);
  });

  it('reads a style colour from its colour word (type byte, then R, G, B)', () => {
    const red = t.styles[0]!;
    // -1023410176 = 0xC3000000 + 0: an RGB word of black with type 0xC3. The type byte is
    // AutoCAD's own bookkeeping; the three low bytes are the colour.
    expect(red.color).toEqual([0, 0, 0]);
    expect(red.dither).toBe(true);
    expect(red.grayscale).toBe(true);
    expect(red.screening).toBe(60);
    expect(red.lineweight).toBe(10);
  });

  it('reads "use object" sentinels and the other fields of a style', () => {
    const seven = t.styles[6]!;
    expect(seven.color).toBe(OBJECT_COLOR);
    expect(seven.dither).toBe(true);
    expect(seven.grayscale).toBe(false);
    expect(seven.linetype).toBe(2);
    expect(seven.adaptiveLinetype).toBe(false);
    expect(seven.lineweight).toBe(OBJECT_LINEWEIGHT);
    expect(seven.fillStyle).toBe(64);
    expect(seven.endStyle).toBe(2);
    expect(seven.joinStyle).toBe(1);
  });

  it('takes the colour from mode_color, which holds the true colour AutoCAD shows', () => {
    const text = CTB_TEXT.replace(
      '  color=-1023410176\n  mode_color=-1023410176',
      // color as an ACI word, mode_color the RGB of a custom colour 0x12 0x34 0x56.
      `  color=${0xc3000001 - 2 ** 32}\n  mode_color=${0xc2123456 - 2 ** 32}`,
    );
    expect(parsePlotStyleText(text).styles[0]!.color).toEqual([0x12, 0x34, 0x56]);
  });

  it('reads -1 as the object colour too', () => {
    const text = CTB_TEXT.replace('  color=-1023410176\n  mode_color=-1023410176', '  color=-1');
    expect(parsePlotStyleText(text).styles[0]!.color).toBe(OBJECT_COLOR);
  });

  it('keeps a named table’s styles in file order, Normal first', () => {
    const stb = parsePlotStyleText(
      [
        'description="',
        'aci_table_available=FALSE',
        'scale_factor=2.5',
        'apply_factor=TRUE',
        'custom_lineweight_display_units=1',
        'plot_style{',
        ' 0{',
        '  name="Normal',
        '  localized_name="Normal',
        '  description="',
        '  color=-1',
        '  lineweight=255',
        ' }',
        ' 1{',
        '  name="Thick black"',
        '  localized_name="Thick black',
        '  description="Plots 0.70 mm black',
        `  color=${0xc2000000 - 2 ** 32}`,
        '  lineweight=1',
        ' }',
        '}',
        'custom_lineweight_table{',
        ' 0=0.00',
        ' 1=0.70 (+7.Z+"8V?S_LC )',
        '}',
      ].join('\r\n'),
    );
    expect(stb.kind).toBe('stb');
    expect(stb.scaleFactor).toBe(2.5);
    expect(stb.applyFactor).toBe(true);
    expect(stb.lineweightUnits).toBe('in');
    // A trailing quote, which AutoCAD does not write, is not part of the name.
    expect(stb.styles.map((s) => s.name)).toEqual(['Normal', 'Thick black']);
    expect(stb.styles[1]!.description).toBe('Plots 0.70 mm black');
    expect(stb.styles[1]!.color).toEqual([0, 0, 0]);
    // A number followed by bracketed bytes (seen in the wild; ezdxf issue 1069) is the number.
    expect(stb.lineweights).toEqual([0, 0.7]);
  });

  it('refuses text that is not a plot style table', () => {
    expect(() => parsePlotStyleText('hello')).toThrow(PlotStyleTableError);
    expect(() => parsePlotStyleText('plot_style{\n 0{\n')).toThrow(/unclosed/);
  });
});

describe('parsePlotStyleTable / writePlotStyleTable', () => {
  it('opens the binary container', () => {
    const t = parsePlotStyleTable(container(CTB_TEXT));
    expect(t).toEqual(parsePlotStyleText(CTB_TEXT));
  });

  it('opens the layout ezdxf writes on 64-bit Linux, whose three sizes take 8 bytes each', () => {
    const body = strToU8(`${CTB_TEXT}\0`);
    const packed = zlibSync(body);
    const out = new Uint8Array(72 + packed.length);
    out.set(container(CTB_TEXT).subarray(0, 48), 0);
    const view = new DataView(out.buffer);
    view.setUint32(56, body.length, true);
    view.setUint32(64, packed.length, true);
    out.set(packed, 72);
    expect(parsePlotStyleTable(out)).toEqual(parsePlotStyleText(CTB_TEXT));
  });

  it('refuses a file that is not a CTB or STB, or whose stream is damaged', () => {
    expect(() => parsePlotStyleTable(strToU8('AC1032 not a table'))).toThrow(PlotStyleTableError);
    const bad = container(CTB_TEXT);
    bad.fill(0, 60);
    expect(() => parsePlotStyleTable(bad)).toThrow(PlotStyleTableError);
  });

  it('writes the container AutoCAD reads: marker, checksum, sizes, zlib text ending in NUL', () => {
    const table = parsePlotStyleText(CTB_TEXT);
    const bytes = writePlotStyleTable(table);
    expect(strFromU8(bytes.subarray(0, 48), true)).toBe(
      'PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec',
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const packed = bytes.subarray(60);
    expect(view.getUint32(56, true)).toBe(packed.length);
    // The checksum is the Adler-32 of the compressed stream (ezdxf writes it so).
    expect(view.getUint32(48, true)).toBe(adler32(packed));
    const text = unzlibSync(packed);
    expect(view.getUint32(52, true)).toBe(text.length);
    expect(text[text.length - 1]).toBe(0);
    expect(parsePlotStyleTable(bytes)).toEqual(table);
  });

  it('marks a named table STBVER1', () => {
    const stb: PlotStyleTable = {
      kind: 'stb',
      description: '',
      scaleFactor: 1,
      applyFactor: false,
      lineweightUnits: 'mm',
      lineweights: [0, 0.25],
      styles: [newPlotStyle('Normal'), { ...newPlotStyle('Red'), color: [255, 0, 0] }],
    };
    const bytes = writePlotStyleTable(stb);
    expect(strFromU8(bytes.subarray(0, 48), true)).toContain('STBVER1');
    expect(parsePlotStyleTable(bytes)).toEqual(stb);
  });

  it('writes the text in AutoCAD’s layout, every style in full', () => {
    const text = plotStyleText(parsePlotStyleText(CTB_TEXT));
    expect(text.split('\n').slice(0, 7)).toEqual([
      'description="Pens for the GA set',
      'aci_table_available=TRUE',
      'scale_factor=1.0',
      'apply_factor=FALSE',
      'custom_lineweight_display_units=0',
      'aci_table{',
      ' 0="Color_1',
    ]);
    expect(text).toContain(
      [
        ' 6{',
        '  name="Color_7',
        '  localized_name="Color_7',
        '  description="',
        '  color=-1006632961',
        '  mode_color=-1006632961',
        '  color_policy=1',
        '  physical_pen_number=0',
        '  virtual_pen_number=0',
        '  screen=100',
        '  linepattern_size=0.5',
        '  linetype=2',
        '  adaptive_linetype=FALSE',
        '  lineweight=255',
        '  fill_style=64',
        '  end_style=2',
        '  join_style=1',
        ' }',
      ].join('\n'),
    );
    expect(text).toContain(`  color=${0xc2000000 - 2 ** 32}\n  mode_color=${0xc2000000 - 2 ** 32}`);
    expect(text).toContain('custom_lineweight_table{\n 0=0.00\n 1=0.05\n');
  });
});

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
