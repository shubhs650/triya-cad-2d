// M2-09: the multileader geometry behind MLEADER and MLEADEREDIT (edit/mleader.ts): where block
// content goes, where a landing on the far side of the content meets it, which leader a point
// removes, and the extents a block content is placed by.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  addLeaderLine,
  blockAnchor,
  blockContentBox,
  blockExtentsOf,
  blockScaleOf,
  currentMLeaderStyle,
  landingAt,
  landingTo,
  nearestLeaderLine,
  newMultiLeader,
  removeLeaderLine,
  settingsOf,
  standardMLeaderStyle,
  textAnchor,
  type DocumentInit,
  type MLeaderStyleRecord,
  type MultiLeaderGeometry,
  type Vec2,
} from '../../src/index';
import { MODEL_SPACE, blockRecord, circleGeom, entityInit, sampleInit } from '../model/fixtures';

const style: MLeaderStyleRecord = { handle: '35', ...standardMLeaderStyle(false, undefined) };
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: Vec2) => [r6(p.x), r6(p.y)];
const box = { minX: 10, minY: 4, maxX: 14, maxY: 6 };

/** A text multileader with its one landing on the text's left, the text in `box`. */
function textLeader(): MultiLeaderGeometry {
  const landing = landingAt({ x: 0, y: 0 }, { x: 9.55, y: 5.91 }, style, true, 1);
  return newMultiLeader({
    style,
    settings: settingsOf(style),
    scale: 1,
    vertices: [{ x: 0, y: 0 }],
    landing,
    text: { content: 'T', style: '30', position: { x: 10, y: 6 }, attachment: 1, width: 0 },
  });
}

describe('multileader geometry', () => {
  it('meets the far side of text at the level each right attachment names', () => {
    const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => {
      const g = { ...textLeader(), textRightAttachment: k };
      const r = addLeaderLine(g, { x: 30, y: 0 }, box);
      if (!r.ok) throw new Error(r.message);
      const b = r.geom.branches[1]!;
      return [r6(b.connection.x), r6(b.connection.y)];
    });
    // Right of the text, a gap out and the landing beyond; the text is 0.18 high.
    const x = r6(14 + 0.09 + 0.36);
    expect(levels).toEqual([
      [x, 6],
      [x, 5.91],
      [x, 5],
      [x, 4.09],
      [x, 4],
      [x, 3.91],
      [x, r6(6 - 0.18 - 0.09)],
      [x, 5.82],
      [x, 3.91],
      [x, 4],
    ]);
  });

  it('meets text above or below with vertical attachment', () => {
    const t = textLeader();
    const g: MultiLeaderGeometry = {
      ...t,
      textAttachmentDirection: 1,
      branches: [{ ...t.branches[0]!, direction: { x: 0, y: 1 } }],
    };
    const below = addLeaderLine(g, { x: 12, y: 0 }, box);
    expect(below.ok && below.geom.branches.length).toBe(1);
    const above = addLeaderLine(g, { x: 12, y: 20 }, box);
    if (!above.ok) throw new Error(above.message);
    const b = above.geom.branches[1]!;
    expect([pt(b.connection), pt(b.direction)]).toEqual([
      [12, 6.09],
      [0, -1],
    ]);
  });

  it('meets block content at its middle, without a gap', () => {
    const { text: _text, ...rest } = textLeader();
    const g: MultiLeaderGeometry = { ...rest, contentType: 1 };
    const r = addLeaderLine(g, { x: 30, y: 0 }, box);
    if (!r.ok) throw new Error(r.message);
    expect(pt(r.geom.branches[1]!.connection)).toEqual([14.36, 5]);
    const v = addLeaderLine({ ...g, textAttachmentDirection: 1 }, { x: 12, y: -10 }, box);
    if (!v.ok) throw new Error(v.message);
    expect(pt(v.geom.branches[1]!.connection)).toEqual([12, 4]);
  });

  it('refuses a leader with nowhere to go', () => {
    const g = { ...textLeader(), contentType: 0, branches: [] };
    expect(addLeaderLine(g, { x: 0, y: 0 }, undefined)).toEqual({
      ok: false,
      message: 'The multileader has no leader to add to.',
    });
  });

  it('removes the line nearest a point, by its segments or its arrowhead', () => {
    const g = textLeader();
    const two: MultiLeaderGeometry = {
      ...g,
      branches: [
        {
          ...g.branches[0]!,
          lines: [
            { index: 0, vertices: [{ x: 0, y: 0 }] },
            {
              index: 1,
              vertices: [
                { x: 20, y: 20 },
                { x: 20, y: 20 },
              ],
            },
          ],
        },
      ],
    };
    // The second line's first segment has no length: the distance is to its point.
    expect(nearestLeaderLine(two, { x: 20.1, y: 20.2 })).toEqual({ branch: 0, line: 1 });
    expect(nearestLeaderLine({ ...g, branches: [] }, { x: 0, y: 0 })).toBeUndefined();
    expect(removeLeaderLine(two, { x: 1, y: 0 })!.branches[0]!.lines.map((l) => l.index)).toEqual([
      1,
    ]);
  });

  it('places block content by its turned extents, or its base point without them', () => {
    const turned = { ...style, blockRotationOn: true, blockRotation: Math.PI / 2 };
    const right = landingTo({ x: 10, y: 5 }, { x: 1, y: 0 }, style, 1);
    const ext = { minX: 0, minY: -1, maxX: 4, maxY: 1 };
    const s = blockScaleOf(turned, 1);
    // Turned a quarter, the block spans x −1…1 and y 0…4.
    expect(pt(blockAnchor(turned, right, ext, s.scale, s.rotation))).toEqual([11, 3]);
    const up = landingTo({ x: 10, y: 5 }, { x: 0, y: 1 }, style, 1);
    expect(pt(blockAnchor(style, up, ext, { x: 1, y: 1 }, 0))).toEqual([8, 6]);
    const down = landingTo({ x: 10, y: 5 }, { x: 0, y: -1 }, style, 1);
    expect(pt(blockAnchor(style, down, ext, { x: 1, y: 1 }, 0))).toEqual([8, 4]);
    expect(pt(blockAnchor(style, down, undefined, { x: 1, y: 1 }, 0))).toEqual([10, 5]);
    // Scale and rotation off: the block as drawn, times the overall scale.
    const off = { ...style, blockScaleOn: false, blockRotationOn: false, blockRotation: 1 };
    expect(blockScaleOf(off, 2)).toEqual({ scale: { x: 2, y: 2 }, rotation: 0 });
    const g = newMultiLeader({
      style: { ...off, linetype: '14', arrowhead: '40' },
      settings: settingsOf(off),
      scale: 2,
      vertices: [{ x: 0, y: 0 }],
      landing: right,
      block: { block: '40', position: { x: 0, y: 0 }, attributes: [] },
    });
    expect(g).toMatchObject({ linetype: '14', arrowhead: '40' });
    expect(g.block).toMatchObject({ scale: { x: 2, y: 2, z: 2 }, rotation: 0 });
    expect(g.block!.attributes).toBeUndefined();
  });

  it('opens text a gap out from a vertical landing', () => {
    const v = { ...style, textAttachmentDirection: 1 };
    expect(textAnchor(v, landingAt({ x: 0, y: 10 }, { x: 5, y: 5 }, v, true, 1), 1)).toEqual({
      position: { x: 5, y: 5 - 0.09 },
      attachment: 2,
    });
  });

  it('measures a block from what it draws, nested blocks included', () => {
    const base = sampleInit();
    const init: DocumentInit = {
      ...base,
      header: new Map([
        ...base.header!,
        ['$EXTMIN', { x: -100, y: -100, z: 0 }],
        ['$EXTMAX', { x: 100, y: 100, z: 0 }],
      ]),
      tables: {
        ...base.tables,
        blockRecords: [
          ...base.tables!.blockRecords!,
          blockRecord('50', 'INNER'),
          blockRecord('51', 'OUTER'),
          blockRecord('52', 'EMPTY'),
          blockRecord('53', 'SELF'),
        ],
      },
      blocks: [
        ...base.blocks!,
        { handle: '50', name: 'INNER', basePoint: { x: 0, y: 0 } },
        { handle: '51', name: 'OUTER', basePoint: { x: 1, y: 0 } },
        { handle: '52', name: 'EMPTY', basePoint: { x: 0, y: 0 } },
        { handle: '53', name: 'SELF', basePoint: { x: 0, y: 0 } },
      ],
      entities: [
        ...base.entities!,
        entityInit('54', circleGeom(0, 0, 1), { owner: '50' }),
        entityInit(
          '55',
          {
            kind: 'INSERT',
            block: '50',
            position: { x: 5, y: 0 },
            scale: { x: 2, y: 2, z: 1 },
            rotation: 0,
            attributes: [],
          },
          { owner: '51' },
        ),
        entityInit('56', circleGeom(0, 0, 1), { owner: '51' }),
        entityInit(
          '57',
          {
            kind: 'INSERT',
            block: '53',
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: 0,
            attributes: [],
          },
          { owner: '53' },
        ),
      ],
    };
    const model = DocumentModel.create(init);
    // OUTER: its circle at −1…1 and INNER's doubled at 3…7, relative to base point (1, 0).
    expect(blockExtentsOf(model, '51')).toEqual({ minX: -2, minY: -2, maxX: 6, maxY: 2 });
    expect(blockExtentsOf(model, '52')).toBeUndefined();
    // A block holding itself: the inner reference stands in as its insertion point.
    expect(blockExtentsOf(model, '53')).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(blockExtentsOf(model, 'FF')).toBeUndefined();
    expect(
      blockContentBox(model, {
        block: '50',
        position: { x: 10, y: 10 },
        scale: { x: 2, y: 2, z: 2 },
        rotation: 0,
        color: { kind: 'byBlock' },
      }),
    ).toEqual({ minX: 8, minY: 8, maxX: 12, maxY: 12 });
    const none = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1, z: 1 }, rotation: 0 };
    expect(blockContentBox(model, { ...none, color: { kind: 'byBlock' } })).toBeUndefined();
    expect(blockContentBox(model, { ...none, block: '52', color: { kind: 'byBlock' } })).toBe(
      undefined,
    );
    // A drawing without extents measures at unit tolerance.
    const bare = DocumentModel.create({ ...init, header: new Map() });
    expect(blockExtentsOf(bare, '50')).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
    expect(MODEL_SPACE).toBe('1F');
  });

  it('takes CMLEADERSTYLE, else Standard, else the first style', () => {
    const base = sampleInit();
    const make = (names: string[], current?: string) =>
      currentMLeaderStyle(
        DocumentModel.create({
          ...base,
          header: new Map([
            ...base.header!,
            ...(current ? [['CMLEADERSTYLE', current] as const] : []),
          ]),
          tables: {
            ...base.tables,
            mleaderStyles: names.map((name, i) => ({ ...style, handle: `6${i}`, name })),
          },
        }),
      )?.name;
    expect(make(['A', 'Standard', 'B'], 'b')).toBe('B');
    expect(make(['A', 'Standard'], 'missing')).toBe('Standard');
    expect(make(['A', 'C'])).toBe('A');
    expect(make([])).toBeUndefined();
  });
});
