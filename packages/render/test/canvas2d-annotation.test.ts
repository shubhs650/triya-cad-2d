// M6-03: ANNOALLVISIBLE 0 (`RenderStyle.annotationAllVisible` false) hides on the Model tab the
// annotative objects that do not support the current annotation scale (CANNOSCALE), as AutoCAD
// 2024 Help's "ANNOALLVISIBLE (System Variable)" says: "Only annotative objects that support the
// current annotation scale are displayed". A hidden object is neither drawn nor picked, and the
// canvas says so for snaps (`hides`). Paper space objects are not hidden: the variable is about
// model space as the Model tab shows it (a layout viewport's own annotation scale is M1-63's,
// post-launch).
import {
  DocumentModel,
  OSNAP,
  SpatialIndex,
  toleranceForSize,
  type EntityInit,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { Canvas2DRenderer, RenderSession, type RenderStyle } from '../src/index';
import { change, drawingInit, entity, line, MODEL, PAPER, surface } from './fixtures';

const STYLE: RenderStyle = { background: '#000000', foreground: '#ffffff', showLineweights: false };
const SCALES = [
  { name: '1:1', value: 1, handle: 'B7' },
  { name: '1:50', value: 0.02, handle: '12D' },
];
const EVERYWHERE = { minX: -100, minY: -100, maxX: 100, maxY: 100 };

/** An annotative line at height `y` supporting the scales `scales` name. */
const annotative = (handle: string, y: number, scales: string[], owner?: string): EntityInit =>
  entity(handle, line(0, y, 10, y), {
    ...(owner && { owner }),
    annotative: {
      representations: scales.map((scale, i) => ({
        handle: `${handle}${i}`,
        scale,
        isDefault: i === 0,
      })),
    },
  });

function setup(
  entities: EntityInit[],
  o: { allVisible?: boolean; block?: string; cannoscale?: string } = {},
) {
  const init = drawingInit(entities, { header: [['CANNOSCALE', o.cannoscale ?? '1:50']] });
  const model = DocumentModel.create({ ...init, meta: { ...init.meta, annotationScales: SCALES } });
  const d = { model, index: SpatialIndex.build(model, { tol: toleranceForSize(1000) }) };
  const r = new Canvas2DRenderer({
    now: () => 0,
    model: d.model,
    index: d.index,
    block: o.block ?? MODEL,
    surface: surface('visible'),
    createLayer: () => surface('scene'),
    style: { ...STYLE, ...(o.allVisible !== undefined && { annotationAllVisible: o.allVisible }) },
    requestIdle: () => {},
  });
  r.resize(100, 50, 1);
  r.setView({ center: { x: 5, y: 0 }, scale: 4 });
  const picked = () =>
    r
      .select({ kind: 'crossing', box: EVERYWHERE })
      .map((id) => d.model.entity(id)!.handle)
      .sort();
  return { d, r, picked };
}

const BOTH = annotative('A1', 0, ['B7', '12D']);
const ONE_TO_ONE = annotative('A2', 2, ['B7']);
const PLAIN = entity('A3', line(0, 4, 10, 4));

describe('ANNOALLVISIBLE on the Model tab (M6-03)', () => {
  it('shows every annotative object while 1, as absent', () => {
    expect(setup([BOTH, ONE_TO_ONE, PLAIN]).picked()).toEqual(['A1', 'A2', 'A3']);
    expect(setup([BOTH, ONE_TO_ONE, PLAIN], { allVisible: true }).picked()).toEqual([
      'A1',
      'A2',
      'A3',
    ]);
  });

  it('hides at 0 the annotative objects that do not support the current scale', () => {
    const s = setup([BOTH, ONE_TO_ONE, PLAIN], { allVisible: false });
    expect(s.picked()).toEqual(['A1', 'A3']);
    const hides = (h: string) => s.r.hides(s.d.model.entityByHandle(h)!);
    expect(['A1', 'A2', 'A3'].map(hides)).toEqual([false, true, false]);
  });

  it('follows ANNOALLVISIBLE turned on and off', () => {
    const s = setup([BOTH, ONE_TO_ONE, PLAIN]);
    s.r.setStyle({ ...STYLE, annotationAllVisible: false });
    expect(s.picked()).toEqual(['A1', 'A3']);
    s.r.setStyle({ ...STYLE, annotationAllVisible: true });
    expect(s.picked()).toEqual(['A1', 'A2', 'A3']);
  });

  it('follows CANNOSCALE changed, and changed back by undo', () => {
    const s = setup([BOTH, ONE_TO_ONE, PLAIN], { allVisible: false });
    s.r.apply(change(s.d, (b) => b.setHeader('CANNOSCALE', '1:1')));
    expect(s.picked()).toEqual(['A1', 'A2', 'A3']);
    s.r.apply(change(s.d, (b) => b.setHeader('CANNOSCALE', '1:50')));
    expect(s.picked()).toEqual(['A1', 'A3']);
  });

  it('draws a hidden object again once an edit gives it no annotative data', () => {
    const s = setup([BOTH, ONE_TO_ONE, PLAIN], { allVisible: false });
    const a2 = s.d.model.ids.idOf('A2')!;
    s.r.apply(change(s.d, (b) => b.updateEntity(a2, { annotative: undefined })));
    expect(s.picked()).toEqual(['A1', 'A2', 'A3']);
  });

  it('hides nothing in paper space', () => {
    const s = setup([annotative('B1', 0, ['B7'], PAPER)], { allVisible: false, block: PAPER });
    expect(s.picked()).toEqual(['B1']);
    expect(s.r.hides(s.d.model.entityByHandle('B1')!)).toBe(false);
  });
});

describe('snaps and plots under ANNOALLVISIBLE 0 (M6-03)', () => {
  const init = drawingInit([BOTH, ONE_TO_ONE], { header: [['CANNOSCALE', '1:50']] });
  const session = (allVisible: boolean) =>
    new RenderSession({
      now: () => 0,
      document: {
        init: { ...init, meta: { ...init.meta, annotationScales: SCALES } },
        block: MODEL,
        tol: toleranceForSize(1000),
      },
      surface: surface('visible'),
      createLayer: () => surface('layer'),
      style: { ...STYLE, annotationAllVisible: allVisible },
      requestIdle: () => {},
    });

  it('snaps skip the annotative objects the Model tab hides', () => {
    // The end of A2 (y = 2) and of A1 (y = 0).
    const at = (s: RenderSession, y: number) =>
      s.snap({ point: { x: 10, y }, aperture: 0.5, modes: OSNAP.END }).length;
    expect([at(session(true), 2), at(session(true), 0)]).toEqual([1, 1]);
    expect([at(session(false), 2), at(session(false), 0)]).toEqual([0, 1]);
  });

  it('a plot of the Model tab leaves them out, as the screen does', () => {
    const ys = (s: RenderSession) =>
      s
        .plot()
        .flatMap((p) => (p.kind === 'stroke' ? [p.path[2]] : []))
        .sort();
    expect(ys(session(true))).toEqual([0, 2]);
    expect(ys(session(false))).toEqual([0]);
  });
});
