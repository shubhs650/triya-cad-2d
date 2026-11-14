// acad-ts patch tests that need a real drawing (third_party/acad-ts/PATCHES.md). The rest live
// in packages/io/test/acad-ts-patches.test.ts; @triya/io has no Node file APIs to read corpus files.
// Part 3 of 3, where new tests go (split for CI's shards by DEC-053 and M2-64; helpers in
// acad-ts-patches.corpus-shared.ts).
import type { CellStyle, TableStyle } from '@node-projects/acad-ts';
import {
  ACadVersion,
  Entity as AcadEntity,
  CadDictionary,
  CellStyleMap,
  Color,
  DwgWriter,
  DxfWriterConfiguration,
  type CadDocument,
} from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import {
  corpusBytes,
  readDxfRaw,
  readDwgRaw,
  writeDxf,
  dxfRawRoundTrip,
  dwgRawRoundTrip,
  cellStyleMapGroups,
  styleMapFiles,
  mapCell,
  styleMaps,
  objectGroups,
} from './acad-ts-patches.corpus-shared';

describe('acad-ts local patches (corpus-backed, part 3)', () => {
  it('0142 TABLESTYLE row styles keep their text colour (DWG) and data and unit types (DXF)', () => {
    // Before the patch the DWG row style read its text colour into textColor, which DXF and
    // the mapping do not use, and DXF 90/91 (data and unit type) went into the R2010 cell style
    // type and class, which the DWG row style does not hold.
    const standard = (d: CadDocument): TableStyle =>
      d
        .rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadTableStyle)!
        .getEntry<TableStyle>('Standard')!;
    const rows = (s: TableStyle) =>
      [s.dataCellStyle, s.titleCellStyle, s.headerCellStyle].map((c: CellStyle) => [
        c.color.index,
        c.valueDataType,
        c.valueUnitType,
      ]);
    const dxf = readDxfRaw(corpusBytes('third-party/acadsharp/sample_AC1021_ascii.dxf'));
    const dwg = readDwgRaw('third-party/acadsharp/sample_AC1021.dwg');
    // The same drawing: ByBlock text, data type 512 (general), unit type 0.
    expect(rows(standard(dxf))).toEqual(Array(3).fill([0, 512, 0]));
    expect(rows(standard(dwg))).toEqual(rows(standard(dxf)));
    for (const doc of [dxf, dwg]) {
      const s = standard(doc);
      s.dataCellStyle.color = new Color(3);
      s.headerCellStyle.valueDataType = 4;
      s.headerCellStyle.valueUnitType = 2;
    }
    const edited = [
      [3, 512, 0],
      [0, 512, 0],
      [0, 4, 2],
    ];
    expect(rows(standard(dxfRawRoundTrip(dxf, false)))).toEqual(edited);
    expect(rows(standard(readDwgRaw(DwgWriter.writeToBuffer(dwg).slice().buffer)))).toEqual(edited);
  });

  it('0152 an entity keeps its material (DXF 347, DWG R2007+) through read and save', () => {
    // The ACadSharp R2007+ samples give a POINT the ByBlock material and four CIRCLEs materials
    // of their own (DXF 347; a DWG states ByBlock as the material flags 01 and the others as 11
    // and a handle). The entity template dropped the handle both readers kept, the DWG reader
    // skipped ByBlock, and neither writer wrote a material.
    const materials = (d: CadDocument) =>
      [...d.getCadObjects()]
        .filter((o): o is AcadEntity => o instanceof AcadEntity && o.material !== null)
        .map((e) => [e.handle.toString(16).toUpperCase(), e.material!.name])
        .sort((a, b) => a[0]!.localeCompare(b[0]!));
    for (const version of ['AC1021', 'AC1024', 'AC1027', 'AC1032']) {
      const base = `third-party/acadsharp/sample_${version}`;
      const dxf = readDxfRaw(corpusBytes(`${base}_ascii.dxf`));
      const want = [
        ['298', 'ByBlock'],
        ['E00', 'Aluminum Cast'],
        ['E01', 'Beech'],
        ['E02', 'Bamboo'],
        ['E03', 'Asphalt - Wet'],
      ];
      expect(materials(dxf), version).toEqual(want);
      expect(materials(dxfRawRoundTrip(dxf, false)), `${version} DXF`).toEqual(want);
      expect(materials(dxfRawRoundTrip(dxf, true)), `${version} binary DXF`).toEqual(want);
      const dwg = readDwgRaw(`${base}.dwg`);
      expect(materials(dwg), `${version} DWG`).toEqual(want);
      expect(materials(dwgRawRoundTrip(dwg)), `${version} DWG saved`).toEqual(want);
    }
  });

  it('0153 a DWG layer keeps its plot style name (R2000+) through read and save', () => {
    // Every layer points at a plot style name (DXF 390), Normal in these colour-dependent
    // samples. The DWG reader read the handle and dropped it, and the writer wrote 0.
    const styles = (d: CadDocument) => [...d.layers!].map((l) => [l.name, l.plotStyleName]);
    for (const version of ['AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032']) {
      const base = `third-party/acadsharp/sample_${version}`;
      const want = styles(readDxfRaw(corpusBytes(`${base}_ascii.dxf`)));
      expect(
        want.every(([, h]) => h !== 0),
        version,
      ).toBe(true);
      const dwg = readDwgRaw(`${base}.dwg`);
      expect(styles(dwg), `${version} DWG`).toEqual(want);
      expect(styles(dwgRawRoundTrip(dwg)), `${version} DWG saved`).toEqual(want);
    }
  });

  it('0155 finds the corpus DXFs with a CELLSTYLEMAP', () => {
    expect(styleMapFiles.length).toBeGreaterThan(40);
  });

  it.each(styleMapFiles)(
    '0155 a DXF save of the CELLSTYLEMAPs in %s states their groups',
    (path) => {
      // M1-98: AutoCAD saves a CELLSTYLEMAP in every DXF from AutoCAD 2008 on. Unpatched, a save
      // wrote the cell alignment at 170 and the class at 91, no 93, GRIDFORMAT 90 and 91 swapped,
      // the borders in another order and no 340 for a border without a linetype.
      const bytes = corpusBytes(path);
      const read = cellStyleMapGroups(Buffer.from(bytes).toString('latin1'));
      const saved = cellStyleMapGroups(
        Buffer.from(writeDxf(readDxfRaw(bytes), false)).toString('latin1'),
      );
      expect(read.size).toBeGreaterThan(0);
      for (const [handle, groups] of read) expect(saved.get(handle), handle).toEqual(groups);
    },
  );

  it.each(['AC1014', 'AC1015', 'AC1018', 'AC1021'])(
    '0156 the CELLSTYLEMAP of sample_%s.dwg reads like its DXF save and survives a DWG save',
    (version) => {
      // M1-98: AutoCAD 2008 and later keep the CELLSTYLEMAP in a DWG before R2010, which acad-ts
      // read as an unknown object. The R2000–R2007 DXF saves of the same drawing state the
      // same cell styles (0155), and AC1014 has no DXF twin.
      const doc = readDwgRaw(`third-party/acadsharp/sample_${version}.dwg`);
      const maps = styleMaps(doc);
      expect(maps).toHaveLength(1);
      expect(maps[0]!.cellStyles.map((c) => c.name)).toEqual(['_TITLE', '_HEADER', '_DATA']);
      if (version !== 'AC1014') {
        const dxf = readDxfRaw(corpusBytes(`third-party/acadsharp/sample_${version}_ascii.dxf`));
        expect(maps[0]!.cellStyles.map(mapCell)).toEqual(
          styleMaps(dxf)[0]!.cellStyles.map(mapCell),
        );
      }
      const back = dwgRawRoundTrip(doc).getCadObject(maps[0]!.handle);
      expect(back).toBeInstanceOf(CellStyleMap);
      expect((back as CellStyleMap).cellStyles.map(mapCell)).toEqual(
        maps[0]!.cellStyles.map(mapCell),
      );
    },
  );

  it('0178 a TABLECONTENT kept from an R2000/R2004 DXF is written with R2007 values', () => {
    const config = new DxfWriterConfiguration();
    config.writeDynamicBlockData = true;
    // A TABLECONTENT is written from the codes it was read with (the writer has no fields for
    // it), so one read from an R2004 DXF kept that version's values (90 type and data, no 304
    // ACVALUE_END) in an AC1032 save, and reading the save ran on from TABLECONTENT 747 to the
    // next ACVALUE_END: TABLEGEOMETRY 748, DICTIONARY 75A and the dynamic blocks' ACAD_ENHANCEDBLOCK
    // data (ABD to ACF) were gone after a second save (M2-40).
    for (const path of ['sample_AC1015_ascii.dxf', 'sample_AC1018_ascii.dxf']) {
      const doc = readDxfRaw(corpusBytes(`third-party/acadsharp/${path}`));
      doc.header!.version = ACadVersion.AC1032;
      const saved = writeDxf(doc, false, config);
      const groups = objectGroups(saved, 0x747);
      // As AutoCAD's own AC1032 save of the drawing (sample_AC1032_ascii.dxf) states them.
      const at = (marker: string): string[] => {
        const i = groups.indexOf(marker);
        return groups.slice(i + 1, groups.indexOf('304 ACVALUE_END', i) + 1);
      };
      expect(at('301 DATAMAP_VALUE'), path).toEqual([
        '93 2',
        '90 2',
        '140 7783',
        '94 0',
        '300',
        '302',
        '304 ACVALUE_END',
      ]);
      expect(at('300 VALUE'), path).toEqual([
        '93 2',
        '90 4',
        '1 Table sample',
        '94 0',
        '300',
        '302',
        '304 ACVALUE_END',
      ]);
      // An unknown (empty) cell value is flagged empty and has no data.
      expect(groups.join('\n'), path).toContain(
        '300 VALUE\n93 3\n90 0\n94 0\n300\n302\n304 ACVALUE_END',
      );
      const values = groups.filter((g) => g === '300 VALUE' || g === '301 DATAMAP_VALUE').length;
      expect(
        groups.filter((g) => g === '304 ACVALUE_END'),
        path,
      ).toHaveLength(values);
      const back = readDxfRaw(saved);
      for (const h of [0x747, 0x748, 0x75a, 0x760, 0xabd, 0xabe, 0xabf, 0xac0, 0xace, 0xacf]) {
        expect(back.getCadObject(h), `${path} ${h.toString(16)}`).toBeTruthy();
      }
    }
    // A pre-R2007 date is the seconds since 1970 (UTC) in 8 bytes; from R2007 a SYSTEMTIME.
    // 0x673680F0 = 2024-11-14 23:00:00 UTC, a Thursday (AutoCAD's save, in UTC+1: the 15th).
    const doc = readDxfRaw(corpusBytes('third-party/acadsharp/sample_AC1018_ascii.dxf'));
    doc.header!.version = ACadVersion.AC1032;
    const text = objectGroups(writeDxf(doc, false, config), 0x13ef).join('\n');
    expect(text).toContain('90 8\n92 16\n310 E8070B0004000E001700000000000000\n94 0');
  });

  it('0179 an R2007+ DXF value without its 93 flags ends on its data', () => {
    // Triya's AC1032 saves of an R2000/R2004 drawing before 0178 hold TABLECONTENT values
    // without the R2007 frame. Read as R2007 values they ran on to the next ACVALUE_END and lost
    // the objects in between; a value whose type (90) comes without 93 flags first is one of
    // those and ends on its data, as before R2007.
    const config = new DxfWriterConfiguration();
    config.writeDynamicBlockData = true;
    const doc = readDxfRaw(corpusBytes('third-party/acadsharp/sample_AC1018_ascii.dxf'));
    doc.header!.version = ACadVersion.AC1032;
    const framed = new TextDecoder().decode(writeDxf(doc, false, config));
    // Back to the codes the save wrote before 0178: drop the 93 before each value's 90 and the
    // 94/300/302/304 after its data, in the TABLECONTENT objects only.
    const unframed = framed
      .split('\n  0\n')
      .map((record) =>
        record.startsWith('TABLECONTENT\n')
          ? record
              .replace(/\n 93\n\d+\n( 90\n)/g, '\n$1')
              .replace(/\n 94\n0\n300\n\n302\n\n304\nACVALUE_END(?=\n)/g, '')
          : record,
      )
      .join('\n  0\n');
    expect(unframed).not.toBe(framed);
    const back = readDxfRaw(new TextEncoder().encode(unframed));
    for (const h of [0x747, 0x748, 0x75a, 0x760, 0xabd, 0xabe, 0xabf, 0xac0, 0xace, 0xacf]) {
      expect(back.getCadObject(h), h.toString(16)).toBeTruthy();
    }
  });
});
