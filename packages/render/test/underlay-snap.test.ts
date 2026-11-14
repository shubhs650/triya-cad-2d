// M2-56 part 3: the operator-list reader keeps each path's optional content. A synthetic
// pdf.js 6.4 operator list (codes as `OPS`) checks the marked-content stack: `OC` levels nest,
// other marked content (BMC, /Span BDC) adds none, and OCMD properties and visibility
// expressions come through as pdf.js parses them.
import { describe, expect, it } from 'vitest';
import { underlaySnapShown } from '@triya/engine';
import { underlaySnapFromOperatorList, type PdfOperatorCodes } from '../src/underlay-snap';

const OPS: PdfOperatorCodes = {
  save: 10,
  restore: 11,
  transform: 12,
  constructPath: 91,
  endPath: 28,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginAnnotation: 80,
  endAnnotation: 81,
  beginMarkedContent: 69,
  beginMarkedContentProps: 70,
  endMarkedContent: 71,
};

/** A stroked one-segment path along y = `y` points, as pdf.js's constructPath gives it. */
const path = (y: number): [number, unknown] => [
  OPS.constructPath,
  [20, [new Float32Array([0, 0, y, 1, 72, y])], null],
];

function page(ops: [number, unknown][]) {
  return underlaySnapFromOperatorList(
    { fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) },
    OPS,
    { transform: [1, 0, 0, -1, 0, 720], height: 720 },
    new Map([
      ['5R', { name: 'Walls', visible: true }],
      ['6R', { name: 'Notes', visible: true }],
      ['7R', { name: undefined, visible: false }],
    ]),
  );
}

describe('underlaySnapFromOperatorList and optional content (M2-56)', () => {
  it('nests OC levels and ignores other marked content', () => {
    const p = page([
      path(0),
      [OPS.beginMarkedContentProps, ['OC', { type: 'OCG', id: '5R' }]],
      [OPS.beginMarkedContent, ['Artifact']],
      [OPS.beginMarkedContentProps, ['Span', 3]],
      path(72),
      [OPS.endMarkedContent, []],
      [OPS.beginMarkedContentProps, ['OC', { type: 'OCG', id: '6R' }]],
      path(144),
      [OPS.endMarkedContent, []],
      [OPS.endMarkedContent, []],
      [OPS.endMarkedContent, []],
      path(216),
      // Malformed properties pdf.js could not read show, as pdf.js draws them.
      [OPS.beginMarkedContentProps, ['OC', null]],
      path(288),
      [OPS.endMarkedContent, []],
    ]);
    expect(page([path(0)]).layers).toBeUndefined();
    expect(p.layers?.groups).toEqual([
      { id: '5R', name: 'Walls', on: true },
      { id: '6R', name: 'Notes', on: true },
      { id: '7R', name: null, on: false },
    ]);
    expect(p.layers?.conditions).toEqual([
      [],
      [{ type: 'OCG', id: '5R' }],
      [
        { type: 'OCG', id: '5R' },
        { type: 'OCG', id: '6R' },
      ],
    ]);
    expect(Array.from(p.layers!.lines)).toEqual([0, 1, 2, 0, 0]);
    expect(Array.from(underlaySnapShown(p, ['Notes'])!)).toEqual([1, 1, 0]);
  });

  it('reads OCMD properties and visibility expressions', () => {
    const p = page([
      [
        OPS.beginMarkedContentProps,
        ['OC', { type: 'OCMD', ids: ['5R', '7R'], policy: 'AllOn', expression: null }],
      ],
      path(0),
      [OPS.endMarkedContent, []],
      [OPS.beginMarkedContentProps, ['OC', { type: 'OCMD', id: '6R' }]],
      path(72),
      [OPS.endMarkedContent, []],
      [
        OPS.beginMarkedContentProps,
        ['OC', { type: 'OCMD', expression: ['Or', '7R', ['Not', '5R'], 4] }],
      ],
      path(144),
      [OPS.endMarkedContent, []],
      [OPS.beginMarkedContentProps, ['OC', { type: 'Other' }]],
      path(216),
      [OPS.endMarkedContent, []],
      [OPS.beginMarkedContentProps, ['OC', { type: 'OCG' }]],
      path(288),
      [OPS.endMarkedContent, []],
    ]);
    expect(p.layers?.conditions).toEqual([
      [],
      [{ type: 'OCMD', ids: ['5R', '7R'], policy: 'AllOn' }],
      [{ type: 'OCMD', id: '6R' }],
      [{ type: 'OCMD', expression: ['Or', '7R', ['Not', '5R']] }],
    ]);
    expect(Array.from(p.layers!.lines)).toEqual([1, 2, 3, 0, 0]);
    expect(Array.from(underlaySnapShown(p, [])!)).toEqual([1, 0, 1, 0]);
    expect(Array.from(underlaySnapShown(p, ['Walls'])!)).toEqual([1, 0, 1, 1]);
  });
});
