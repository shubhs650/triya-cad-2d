// M2-35 part 29: a dynamic block reference's custom properties (the Properties palette's Custom
// section, read-only) on AutoCAD's saves. The expected values are read off the samples' DXF by
// hand: each reference's AcDbBlockRepresentation → AppDataCache → ACAD_ENHANCEDBLOCKDATA XRECORD
// for the parameter's node (its points, a flip's state, a visibility state or lookup value), or
// the definition's parameter for a reference without one. DWG saves of the same drawings give
// the same rows.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DocumentModel, propertySheet, type PropertyRow } from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const readable = readableFiles(loadManifest(`${corpusDir}corpus.json`));
const DIR = 'public/third-party/acadsharp/dynamic-blocks/';

function open(path: string): DocumentModel | undefined {
  try {
    return DocumentModel.create(
      documentInit(readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${path}`)))),
    );
  } catch {
    return undefined; // read failures are the round-trip suite's concern
  }
}

/** Each block reference's Custom rows as `label = value` (numbers to 6 places), by handle. */
function customRows(model: DocumentModel): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of model.entities()) {
    if (e.type !== 'INSERT') continue;
    const sheet = propertySheet(model, [e.id]);
    const custom = sheet.sections.find((s) => s.title === 'Custom');
    if (custom) out.set(e.handle, custom.rows.map(shown));
  }
  return out;
}

const shown = (r: PropertyRow): string => {
  expect(r.readOnly).toBe(true);
  const v = typeof r.value === 'number' ? Number(r.value.toFixed(6)) : r.value;
  return `${r.label} = ${r.kind === 'angle' ? `${Number(((Number(v) * 180) / Math.PI).toFixed(4))}°` : v}`;
};

const deg = (d: number) => `${d}°`;

describe('dynamic block custom properties on the public corpus (M2-35 part 29)', () => {
  it.each([
    [
      'BLOCKLINEARPARAMETER.dxf',
      // 254 names the definition itself: its own distance, (0,0) to (5,0).
      { '254': ['my_distance_param = 5'], '284': ['my_distance_param = 7.5'] },
    ],
    [
      'BLOCKFLIPPARAMETER.dxf',
      { '255': ['Flip state1 = Not flipped'], '28B': ['Flip state1 = Flipped'] },
    ],
    [
      'BLOCKVISIBILITYPARAMETER.dxf',
      {
        '252': ['Test visibility = VisibilityState0'],
        '268': ['Test visibility = HideAll'],
        '284': ['Test visibility = VisibilityState1'],
        '28C': ['Test visibility = ShowAll'],
      },
    ],
    [
      'BLOCKPOINTPARAMETER.dxf',
      {
        // 26E names the definition: its parameter's own point.
        '26E': ['dynamic_pos X = 0', 'dynamic_pos Y = 0'],
        '281': ['dynamic_pos X = 0', 'dynamic_pos Y = 5'],
        '294': ['dynamic_pos X = 5', 'dynamic_pos Y = 0'],
      },
    ],
    [
      'BLOCKROTATIONPARAMETER.dxf',
      {
        // The definition's own: (0,0) to (0,5), from its base angle's line along +X.
        '254': [`Angle parameter = ${deg(90)}`],
        '27C': [`Angle parameter = ${deg(50)}`],
        '290': [`Angle parameter = ${deg(0)}`],
        '2A6': [`Angle parameter = ${deg(225)}`],
      },
    ],
    [
      'BLOCKXYPARAMETER.dxf',
      {
        '254': ['X Distance1 = 5', 'Y Distance1 = -5'],
        '2AE': ['X Distance1 = 100.592698', 'Y Distance1 = -104.303888'],
      },
    ],
    [
      'BLOCKPOLARPARAMETER.dxf',
      {
        // The definition's own: (2.007301, 2.345539) to (8.429121, 8.767359).
        '254': ['Distance1 = 9.081824', `Angle1 = ${deg(45)}`],
        // Base (-7.153545, 2.345539) to end (8.429121, 8.767359); the base angle's line along +X.
        '299': ['Distance1 = 16.854057', `Angle1 = ${deg(22.3972)}`],
      },
    ],
    [
      'BLOCKLOOKUPPARAMETER.dxf',
      Object.fromEntries(
        [
          ['254', '8'],
          ['38C', '6'],
          ['395', '5'],
          ['39E', '3.453765'],
        ].map(([h, d]) => [
          h,
          [
            `my_distance_label = ${d}`,
            'Lookup Label Name = my_custom',
            'Position1 X = 0.535364',
            'Position1 Y = -0.661679',
            'Lookup1 = Custom',
          ],
        ]),
      ),
    ],
    // An alignment or base point parameter lists nothing.
    ['BLOCKALIGNMENTPARAMETER.dxf', {}],
    ['BLOCKBASEPOINTPARAMETER.dxf', {}],
  ])('%s', (file, want) => {
    const model = open(`${DIR}${file}`);
    expect(model).toBeDefined();
    expect(Object.fromEntries(customRows(model!))).toEqual(want);
  });

  const twins = readable
    .filter((f) => f.format === 'dwg' && f.path.startsWith(DIR))
    // Another save of the drawing than its DXF (see dynamic-blocks.corpus.test.ts).
    .filter((f) => !f.path.endsWith('BLOCKPOLARPARAMETER.dwg'))
    .map((f) => [f.path, f.path.replace(/\.dwg$/i, '.dxf')] as const);

  it('has the DWG saves', () => {
    expect(twins.length).toBe(9);
  });

  it.each(twins)('reads %s as its DXF save %s', (dwg, dxf) => {
    const a = open(dwg);
    const b = open(dxf);
    expect(a && b).toBeDefined();
    expect(customRows(a!)).toEqual(customRows(b!));
  });

  it('lists the sample drawings’ dynamic block (a linear and a visibility parameter)', () => {
    const counted: Record<string, number> = {};
    for (const f of readable) {
      if (f.format !== 'dxf-ascii' || !/sample_AC10\d\d/.test(f.path)) continue;
      const model = open(f.path);
      if (!model) continue;
      for (const rows of customRows(model).values()) {
        for (const r of rows) {
          const label = r.split(' = ')[0]!;
          counted[label] = (counted[label] ?? 0) + 1;
        }
      }
    }
    // Only the AC1015 and AC1018 ASCII samples hold the evaluation graph (the later saves keep
    // no parameter objects): twelve references to it between them.
    expect(counted).toEqual({ 'dynamic-diameter': 12, custom_visibility: 12 });
  });
});
