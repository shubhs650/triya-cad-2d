// M8-05: the compare engine on hand-made drawing pairs. Each pair is an original and a revision
// built the way the case says (the same file edited, or the drawing redrawn with new handles).
import { describe, expect, it } from 'vitest';
import type { EntityGeometry, EntityInit } from '@triya/engine';
import { compareDrawings, type CompareItem } from '../src/index';
import {
  PAPER,
  WALLS,
  arc,
  circle,
  drawing,
  ent,
  insert,
  line,
  text,
  type Drawing,
} from './drawings';

/** The original every revision below starts from. */
const ORIGINAL: readonly EntityInit[] = [
  ent('A1', line(0, 0, 100, 0)),
  ent('A2', line(100, 0, 100, 50)),
  ent('A3', circle(50, 25, 10)),
  ent('A4', arc(0, Math.PI / 2)),
  ent('A5', text('REV A')),
];

const brief = (items: readonly CompareItem[]) =>
  items.map((i) => ({ status: i.status, a: i.a, b: i.b, changes: i.changes }));

describe('compareDrawings (M8-05)', () => {
  it('finds nothing between a drawing and itself', () => {
    const r = compareDrawings(drawing({ entities: ORIGINAL }), drawing({ entities: ORIGINAL }));
    expect(r.items).toEqual([]);
    expect(r.counts).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 5 });
    expect(r.unchanged.every((p) => p.matchedBy === 'handle' && p.a === p.b)).toBe(true);
  });

  it('classifies a revision of the same file as added, removed and modified by handle', () => {
    const revised = drawing({
      entities: [
        ent('A1', line(0, 0, 100, 0)),
        // A2 erased; A3 moved; A4 to another layer; A5 reworded; A6 drawn.
        ent('A3', circle(60, 25, 10)),
        ent('A4', arc(0, Math.PI / 2), { layer: WALLS }),
        ent('A5', text('REV B')),
        ent('A6', line(0, 50, 100, 50)),
      ],
    });
    const r = compareDrawings(drawing({ entities: ORIGINAL }), revised);
    expect(brief(r.items)).toEqual([
      { status: 'removed', a: 'A2', b: undefined, changes: [] },
      { status: 'modified', a: 'A3', b: 'A3', changes: ['geometry'] },
      { status: 'modified', a: 'A4', b: 'A4', changes: ['layer'] },
      { status: 'modified', a: 'A5', b: 'A5', changes: ['text'] },
      { status: 'added', a: undefined, b: 'A6', changes: [] },
    ]);
    expect(r.items[1]).toMatchObject({ fields: ['center'], matchedBy: 'handle', space: 'Model' });
    expect(r.items[3]).toMatchObject({ fields: ['value'] });
    expect(r.counts).toEqual({ added: 1, removed: 1, modified: 3, unchanged: 1 });
  });

  it('lists every property that changed, after the geometry', () => {
    const revised = drawing({
      entities: [
        ent('A1', line(0, 0, 100, 1), {
          color: { kind: 'aci', index: 1 },
          lineweight: 50,
          transparency: { alpha: 127 },
          ltScale: 2,
          visible: false,
        }),
      ],
    });
    const r = compareDrawings(drawing({ entities: [ORIGINAL[0]!] }), revised);
    expect(r.items[0]?.changes).toEqual([
      'geometry',
      'color',
      'lineweight',
      'transparency',
      'ltScale',
      'visible',
    ]);
    expect(r.items[0]?.fields).toEqual(['end']);
    expect(
      compareDrawings(drawing({ entities: [ORIGINAL[0]!] }), revised, { properties: false })
        .items[0]?.changes,
    ).toEqual(['geometry']);
  });

  it('pairs a redrawn drawing by geometry when its handles are new', () => {
    const redrawn = drawing({
      entities: [
        ent('B5', text('REV A')),
        ent('B4', arc(0, Math.PI / 2)),
        ent('B3', circle(50, 25, 10), { color: { kind: 'aci', index: 3 } }),
        ent('B2', line(100, 50, 100, 0)), // drawn from the other end
        ent('B1', line(0, 0, 100, 0)),
      ],
      // Its layers are numbered differently too: they are compared by name.
      layers: { zero: '50', walls: '51' },
    });
    const r = compareDrawings(drawing({ entities: ORIGINAL }), redrawn);
    expect(brief(r.items)).toEqual([{ status: 'modified', a: 'A3', b: 'B3', changes: ['color'] }]);
    expect(r.items[0]?.matchedBy).toBe('geometry');
    expect(r.unchanged.map((p) => [p.a, p.b, p.matchedBy])).toEqual([
      ['A1', 'B1', 'geometry'],
      ['A2', 'B2', 'geometry'],
      ['A4', 'B4', 'geometry'],
      ['A5', 'B5', 'geometry'],
    ]);
  });

  it('prefers the geometric twin with the same properties', () => {
    const a = drawing({ entities: [ent('A1', line(0, 0, 1, 0), { layer: WALLS })] });
    const b = drawing({
      entities: [ent('B1', line(0, 0, 1, 0)), ent('B2', line(0, 0, 1, 0), { layer: WALLS })],
    });
    const r = compareDrawings(a, b);
    expect(r.unchanged.map((p) => [p.a, p.b])).toEqual([['A1', 'B2']]);
    expect(brief(r.items)).toEqual([{ status: 'added', a: undefined, b: 'B1', changes: [] }]);
  });

  it('normalises angles a full turn apart and a reversed line', () => {
    const a = drawing({ entities: [ent('A4', arc(0, Math.PI / 2)), ent('A1', line(0, 0, 3, 4))] });
    const b = drawing({
      entities: [
        ent('A4', arc(2 * Math.PI, Math.PI / 2 - 2 * Math.PI)),
        ent('A1', line(3, 4, 0, 0)),
      ],
    });
    expect(compareDrawings(a, b).items).toEqual([]);
  });

  it('takes a tolerance: moves within it are not differences', () => {
    const a = drawing({ entities: [ent('A1', line(0, 0, 100, 0))] });
    const b = drawing({ entities: [ent('A1', line(0, 0, 100.001, 0))] });
    expect(compareDrawings(a, b).counts.modified).toBe(1);
    expect(compareDrawings(a, b, { tolerance: { linear: 0.01 } }).items).toEqual([]);
    expect(compareDrawings(a, b, { tolerance: { linear: 0.01 } }).tolerance.linear).toBe(0.01);
    // A redrawn copy within the tolerance is found by geometry as well.
    const c = drawing({ entities: [ent('C1', line(0.004, 0, 100, -0.004))] });
    const r = compareDrawings(a, c, { tolerance: { linear: 0.01 } });
    expect(r.unchanged).toEqual([{ space: 'Model', a: 'A1', b: 'C1', matchedBy: 'geometry' }]);
    // Angles have their own.
    const turned = drawing({ entities: [ent('A4', arc(0.001, Math.PI / 2))] });
    const arcs = drawing({ entities: [ent('A4', arc(0, Math.PI / 2))] });
    expect(compareDrawings(arcs, turned).counts.modified).toBe(1);
    expect(compareDrawings(arcs, turned, { tolerance: { angular: 0.01 } }).items).toEqual([]);
  });

  it('defaults the tolerance to the drawings’ extents epsilon', () => {
    const a = drawing({ entities: [ent('A1', line(0, 0, 5e6, 0))] });
    const r = compareDrawings(a, a);
    expect(r.tolerance.linear).toBeCloseTo(1e-3, 12);
    expect(r.tolerance.angular).toBe(1e-10);
  });

  it('can ignore handles, comparing unrelated drawings by geometry alone', () => {
    // Two unrelated drawings that happen to number an entity alike.
    const a = drawing({ entities: [ent('A1', line(0, 0, 1, 0))] });
    const b = drawing({ entities: [ent('A1', circle(0, 0, 1))] });
    expect(brief(compareDrawings(a, b).items)).toEqual([
      // Different types are never one object, handles or not.
      { status: 'removed', a: 'A1', b: undefined, changes: [] },
      { status: 'added', a: undefined, b: 'A1', changes: [] },
    ]);
    const moved = drawing({ entities: [ent('A1', line(0, 0, 2, 0))] });
    expect(brief(compareDrawings(a, moved, { matchHandles: false }).items)).toEqual([
      { status: 'removed', a: 'A1', b: undefined, changes: [] },
      { status: 'added', a: undefined, b: 'A1', changes: [] },
    ]);
  });

  it('reports a reference to a changed named block as a block change', () => {
    const flange = (radius: number, extra: EntityInit[] = []): Drawing => ({
      blocks: [{ handle: '40', name: 'FLANGE', basePoint: { x: 0, y: 0 } }],
      entities: [
        ent('41', circle(0, 0, radius), { owner: '40' }),
        ...extra,
        ent('A1', insert('40')),
        ent('A2', line(0, 0, 9, 9)),
      ],
    });
    const r = compareDrawings(drawing(flange(5)), drawing(flange(6)));
    expect(brief(r.items)).toEqual([{ status: 'modified', a: 'A1', b: 'A1', changes: ['block'] }]);
    expect(r.items[0]?.fields).toEqual([]);
    // Entities inside a definition are never listed themselves, and their order does not count.
    const two = (first: EntityGeometry, second: EntityGeometry): Drawing => ({
      blocks: [{ handle: '40', name: 'FLANGE', basePoint: { x: 0, y: 0 } }],
      entities: [
        ent('41', first, { owner: '40' }),
        ent('42', second, { owner: '40' }),
        ent('A1', insert('40')),
      ],
    });
    expect(
      compareDrawings(
        drawing(two(circle(0, 0, 5), line(0, 0, 1, 1))),
        drawing(two(line(0, 0, 1, 1), circle(0, 0, 5))),
      ).items,
    ).toEqual([]);
  });

  it('compares anonymous blocks by contents, whatever their names', () => {
    const anon = (name: string, handle: string, radius: number): Drawing => ({
      blocks: [{ handle, name, basePoint: { x: 0, y: 0 } }],
      entities: [ent('41', circle(0, 0, radius), { owner: handle }), ent('A1', insert(handle))],
    });
    expect(
      compareDrawings(drawing(anon('*U1', '40', 5)), drawing(anon('*U7', '60', 5))).items,
    ).toEqual([]);
    const r = compareDrawings(drawing(anon('*U1', '40', 5)), drawing(anon('*U7', '60', 6)));
    expect(brief(r.items)).toEqual([
      { status: 'modified', a: 'A1', b: 'A1', changes: ['geometry'] },
    ]);
    expect(r.items[0]?.fields).toEqual(['block']);
    // Named and renamed blocks are different blocks.
    const named = (name: string): Drawing => ({
      blocks: [{ handle: '40', name, basePoint: { x: 0, y: 0 } }],
      entities: [ent('41', circle(0, 0, 5), { owner: '40' }), ent('A1', insert('40'))],
    });
    expect(
      compareDrawings(drawing(named('FLANGE')), drawing(named('VALVE'))).items[0]?.fields,
    ).toEqual(['block']);
  });

  it('compares each layout with the layout of the same name', () => {
    const paper = (handle: string, geom: EntityGeometry) => ent(handle, geom, { owner: PAPER });
    const a = drawing({ entities: [paper('C1', line(0, 0, 1, 1))], layouts: ['Sheet 1'] });
    const b = drawing({ entities: [paper('C1', line(0, 0, 1, 1))], layouts: ['SHEET 1'] });
    expect(compareDrawings(a, b).items).toEqual([]);
    const renamed = drawing({ entities: [paper('C1', line(0, 0, 1, 1))], layouts: ['Sheet 2'] });
    expect(compareDrawings(a, renamed).items.map((i) => [i.status, i.space])).toEqual([
      ['removed', 'Sheet 1'],
      ['added', 'Sheet 2'],
    ]);
    // An entity moved from model space to a layout keeps its handle but is another object there.
    const toPaper = drawing({ entities: [paper('A1', line(0, 0, 100, 0))] });
    const inModel = drawing({ entities: [ORIGINAL[0]!] });
    expect(compareDrawings(inModel, toPaper).items.map((i) => [i.status, i.space])).toEqual([
      ['removed', 'Model'],
      ['added', 'Layout1'],
    ]);
  });
});
