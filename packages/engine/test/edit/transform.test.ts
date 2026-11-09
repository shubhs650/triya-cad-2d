// M2-06: the geometry of MOVE, ROTATE, SCALE and MIRROR. Each kind is checked by where its
// drawing goes, not by its fields: points sampled on the original, carried by the similarity,
// must lie where the carried object draws them (AutoCAD 2024 Help, "MIRROR (Command)",
// "MIRRTEXT (System Variable)", "MIRRHATCH (System Variable)").
import { describe, expect, it } from 'vitest';
import { domain, pointAt, type Curve } from '../../src/geom/index';
import {
  FIXED_KINDS,
  mirrorIn,
  moveBy,
  scaleAbout,
  similarity,
  transformGeometry,
  transformProblem,
  turnAbout,
  type Similarity,
} from '../../src/edit/index';
import { angle, followedBy, point, upright } from '../../src/edit/similarity';
import type {
  EntityGeometry,
  HatchEdge,
  HatchGeometry,
  InsertGeometry,
  MTextGeometry,
  TextGeometry,
} from '../../src/model/index';
import { rotation, translation } from '../../src/geom/transform';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

/** Sample points along a curve, start to end. */
const samples = (c: Curve, n = 8) => {
  const d = domain(c);
  return Array.from({ length: n + 1 }, (_, i) => pointAt(c, d.start + ((d.end - d.start) * i) / n));
};

const CASES: [string, Similarity][] = [
  ['move', moveBy({ x: 7, y: -3 })],
  ['turn', turnAbout({ x: 1, y: 2 }, 0.7)],
  ['scale', scaleAbout({ x: -2, y: 1 }, 2.5)],
  ['mirror', mirrorIn({ x: 1, y: 1 }, { x: 4, y: 3 })],
  [
    'mirror and turn',
    followedBy(mirrorIn({ x: 0, y: 0 }, { x: 0, y: 1 }), turnAbout({ x: 0, y: 0 }, 1)),
  ],
];

describe('similarity', () => {
  it('takes apart a matrix into scale, angle and reflection', () => {
    const t = similarity(rotation(0.5));
    expect(t).toMatchObject({ scale: 1, reflect: false });
    expect(t.angle).toBeCloseTo(0.5, 12);
    expect(mirrorIn({ x: 0, y: 0 }, { x: 1, y: 0 }).reflect).toBe(true);
    expect(scaleAbout({ x: 0, y: 0 }, 3).scale).toBeCloseTo(3, 12);
  });

  it('applies the first transform, then the second (followedBy)', () => {
    const t = followedBy(moveBy({ x: 1, y: 0 }), turnAbout({ x: 0, y: 0 }, Math.PI / 2));
    close(point(t, { x: 0, y: 0 }), { x: 0, y: 1 });
    close(point(similarity(translation(2, 2)), { x: 1, y: 1 }), { x: 3, y: 3 });
  });

  it('reflects angles about the mirror line, and leaves them on a pure move', () => {
    const m = mirrorIn({ x: 0, y: 0 }, { x: 1, y: 1 });
    expect(angle(m, 0)).toBeCloseTo(Math.PI / 2, 12);
    expect(angle(moveBy({ x: 1, y: 1 }), 0.3)).toBe(0.3);
  });

  it('sets mirrored text upright the nearer way', () => {
    // A vertical mirror line: text along +X reads along +X again, flipped in x.
    expect(upright(mirrorIn({ x: 0, y: 0 }, { x: 0, y: 1 }), 0)).toMatchObject({ flip: 'x' });
    // A horizontal one: the same direction, flipped in y.
    expect(upright(mirrorIn({ x: 0, y: 0 }, { x: 1, y: 0 }), 0)).toMatchObject({ flip: 'y' });
  });
});

describe.each(CASES)('%s', (_name, t) => {
  const curves: EntityGeometry[] = [
    { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 5, y: 2 } },
    { kind: 'CIRCLE', center: { x: 3, y: 1 }, radius: 2 },
    { kind: 'ARC', center: { x: 3, y: 1 }, radius: 2, startAngle: 0.3, endAngle: 2.2 },
    { kind: 'ARC', center: { x: -1, y: 1 }, radius: 1, startAngle: 5.5, endAngle: 1 },
    {
      kind: 'ELLIPSE',
      center: { x: 1, y: 1 },
      majorAxis: { x: 3, y: 1 },
      ratio: 0.5,
      startParam: 0.4,
      endParam: 4,
    },
    {
      kind: 'LWPOLYLINE',
      closed: false,
      vertices: [
        { x: 0, y: 0, bulge: 1 },
        { x: 10, y: 0, bulge: -0.4, startWidth: 1, endWidth: 2 },
        { x: 10, y: 5, bulge: 0 },
      ],
    },
  ];

  it.each(curves.map((c) => [c.kind, c] as const))('carries a %s point for point', (_k, c) => {
    const out = transformGeometry(c, t) as Curve;
    const before = samples(c as Curve).map((p) => point(t, p));
    const after = samples(out);
    if (out.kind === 'CIRCLE') {
      // A circle has no start: every carried point is on the carried circle.
      for (const p of before) {
        expect(Math.hypot(p.x - out.center.x, p.y - out.center.y)).toBeCloseTo(out.radius, 9);
      }
      return;
    }
    // An arc swept clockwise by a reflection is stored counter-clockwise: the same points,
    // the other way round.
    const reversed = t.reflect && (c.kind === 'ARC' || c.kind === 'ELLIPSE');
    (reversed ? after.reverse() : after).forEach((p, i) => close(p, before[i]!));
  });

  it('scales polyline widths and keeps the bulge with the arc it draws', () => {
    const out = transformGeometry(curves[5]!, t);
    expect(out).toMatchObject({
      vertices: [{}, { startWidth: t.scale, endWidth: 2 * t.scale }, {}],
    });
  });
});

describe('INSERT', () => {
  const insert: InsertGeometry = {
    kind: 'INSERT',
    block: '50',
    position: { x: 2, y: 3 },
    scale: { x: 1.5, y: 1, z: 1 },
    rotation: 0.4,
    attributes: [],
  };
  /** Where the block's point `p` lands. */
  const place = (g: InsertGeometry, p: { x: number; y: number }) => {
    const c = Math.cos(g.rotation);
    const s = Math.sin(g.rotation);
    const x = p.x * g.scale.x;
    const y = p.y * g.scale.y;
    return { x: g.position.x + x * c - y * s, y: g.position.y + x * s + y * c };
  };

  it.each(CASES)('draws its block where %s takes it', (_name, t) => {
    const out = transformGeometry(insert, t) as InsertGeometry;
    for (const p of [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -2, y: 3 },
    ]) {
      close(place(out, p), point(t, place(insert, p)));
    }
  });

  it('is mirrored as a negative X scale', () => {
    const out = transformGeometry(
      { ...insert, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
      mirrorIn({ x: 0, y: 0 }, { x: 0, y: 1 }),
    ) as InsertGeometry;
    expect(out.scale).toEqual({ x: -1, y: 1, z: 1 });
    expect(out.rotation).toBeCloseTo(0, 12);
  });
});

describe('TEXT and MTEXT', () => {
  const text: TextGeometry = {
    kind: 'TEXT',
    value: 'AB',
    style: '0',
    position: { x: 2, y: 1 },
    height: 1,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
    backward: false,
    upsideDown: false,
  };
  const acrossX = mirrorIn({ x: 0, y: 0 }, { x: 1, y: 0 });

  it('stays readable across a horizontal line (MIRRTEXT 0): it hangs from its top instead', () => {
    // The text covers y 1..2; its mirror image covers −2..−1, so it hangs from −1.
    const out = transformGeometry(text, acrossX) as TextGeometry;
    expect(out).toMatchObject({ valign: 3, halign: 0, upsideDown: false, backward: false });
    close(out.alignmentPoint!, { x: 2, y: -1 });
    expect(out.rotation).toBeCloseTo(0, 12);
  });

  it('turns upside down across a horizontal line with MIRRTEXT 1', () => {
    const out = transformGeometry(text, acrossX, { mirrorText: true }) as TextGeometry;
    expect(out).toMatchObject({ upsideDown: true, halign: 0, valign: 0 });
    close(out.position, { x: 2, y: -1 });
  });

  it('drops the alignment point once mirrored text is left and baseline again', () => {
    const right = { ...text, halign: 2, alignmentPoint: { x: 5, y: 1 } };
    const out = transformGeometry(right, mirrorIn({ x: 0, y: 0 }, { x: 0, y: 1 })) as TextGeometry;
    expect(out.halign).toBe(0);
    expect(out.alignmentPoint).toBeUndefined();
    close(out.position, { x: -5, y: 1 });
  });

  it('scales the height and turns the rotation', () => {
    const out = transformGeometry(
      text,
      followedBy(scaleAbout({ x: 0, y: 0 }, 2), turnAbout({ x: 0, y: 0 }, 0.5)),
    ) as TextGeometry;
    expect(out.height).toBeCloseTo(2, 12);
    expect(out.rotation).toBeCloseTo(0.5, 12);
  });

  it("swaps an MTEXT's attachment column or row and keeps it readable", () => {
    const mtext: MTextGeometry = {
      kind: 'MTEXT',
      contents: 'AB',
      style: '0',
      position: { x: 2, y: 1 },
      height: 1,
      width: 4,
      rotation: 0,
      attachment: 1,
    } as MTextGeometry;
    const x = transformGeometry(mtext, mirrorIn({ x: 0, y: 0 }, { x: 0, y: 1 })) as MTextGeometry;
    expect(x.attachment).toBe(3);
    close(x.position, { x: -2, y: 1 });
    const y = transformGeometry({ ...mtext, attachment: 2 }, acrossX) as MTextGeometry;
    expect(y.attachment).toBe(8);
    expect(y.rotation).toBeCloseTo(0, 12);
  });
});

describe('HATCH', () => {
  const arcEdge = (ccw: boolean): HatchEdge => ({
    type: 'arc',
    center: { x: 1, y: 1 },
    radius: 2,
    startAngle: 0.2,
    endAngle: 1.4,
    ccw,
  });
  /** A point a fraction f of the way along a hatch arc edge (clockwise edges store −angles). */
  const along = (e: Extract<HatchEdge, { type: 'arc' }>, f: number) => {
    const s = e.ccw ? e.startAngle : -e.startAngle;
    const end = e.ccw ? e.endAngle : -e.endAngle;
    const tau = 2 * Math.PI;
    const sweep = e.ccw ? (((end - s) % tau) + tau) % tau : (((s - end) % tau) + tau) % tau;
    const a = e.ccw ? s + f * sweep : s - f * sweep;
    return { x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) };
  };
  const hatch = (edges: HatchEdge[]): HatchGeometry => ({
    kind: 'HATCH',
    pattern: 'ANSI31',
    solid: false,
    associative: false,
    style: 0,
    patternType: 1,
    patternAngle: 0,
    patternScale: 1,
    double: false,
    loops: [{ flags: 1, edges }],
    patternLines: [
      { angle: Math.PI / 4, base: { x: 0, y: 0 }, offset: { x: -1, y: 1 }, dashes: [] },
    ],
    seedPoints: [],
  });

  it.each(
    CASES.flatMap(([n, t]) => [[`${n}, ccw`, t, true] as const, [`${n}, cw`, t, false] as const]),
  )('carries an arc edge (%s) point for point', (_n, t, ccw) => {
    const e = arcEdge(ccw) as Extract<HatchEdge, { type: 'arc' }>;
    const out = (transformGeometry(hatch([e]), t) as HatchGeometry).loops[0]!.edges![0] as typeof e;
    for (const f of [0, 0.25, 0.5, 1]) close(along(out, f), point(t, along(e, f)));
  });

  it('keeps the pattern direction across a mirror (MIRRHATCH 0), or mirrors it (MIRRHATCH 1)', () => {
    const m = mirrorIn({ x: 0, y: 0 }, { x: 0, y: 1 });
    const kept = transformGeometry(hatch([]), m) as HatchGeometry;
    expect(kept.patternLines[0]!.angle).toBeCloseTo(Math.PI / 4, 12);
    const mirrored = transformGeometry(hatch([]), m, { mirrorHatch: true }) as HatchGeometry;
    expect(mirrored.patternLines[0]!.angle).toBeCloseTo((3 * Math.PI) / 4, 12);
  });

  it('turns the pattern with the hatch, but not a solid fill', () => {
    const t = turnAbout({ x: 0, y: 0 }, 0.5);
    expect((transformGeometry(hatch([]), t) as HatchGeometry).patternAngle).toBeCloseTo(0.5, 12);
    expect(
      (transformGeometry({ ...hatch([]), solid: true }, t) as HatchGeometry).patternAngle,
    ).toBe(0);
  });
});

describe('what cannot be carried', () => {
  const turn = turnAbout({ x: 0, y: 0 }, 1);
  const flip = mirrorIn({ x: 0, y: 0 }, { x: 0, y: 1 });

  it('refuses OLE and proxy objects whatever the edit', () => {
    for (const kind of FIXED_KINDS) {
      expect(transformProblem({ kind } as EntityGeometry, moveBy({ x: 1, y: 0 }))).toBe(
        'OLE and proxy objects cannot be edited',
      );
      expect(() => transformGeometry({ kind } as EntityGeometry, moveBy({ x: 1, y: 0 }))).toThrow();
    }
  });

  it('moves and scales an object outside the XY plane, but does not turn or mirror it', () => {
    const tilted = {
      kind: 'CIRCLE',
      center: { x: 0, y: 0 },
      radius: 1,
      normal: { x: 0, y: 0.6, z: 0.8 },
    } as EntityGeometry;
    expect(transformProblem(tilted, moveBy({ x: 1, y: 1 }))).toBeUndefined();
    expect(transformProblem(tilted, scaleAbout({ x: 0, y: 0 }, 2))).toBeUndefined();
    expect(transformProblem(tilted, turn)).toBe(
      'an object outside the XY plane can only be moved or scaled',
    );
    expect(transformProblem(tilted, flip)).toBeDefined();
    // −Z is the XY plane seen from below: it turns like any other.
    expect(
      transformProblem({ ...tilted, normal: { x: 0, y: 0, z: -1 } } as EntityGeometry, turn),
    ).toBeUndefined();
  });

  it('does not mirror a region, and turns a viewport by right angles only', () => {
    expect(transformProblem({ kind: 'REGION', loops: [] } as unknown as EntityGeometry, flip)).toBe(
      'a region cannot be mirrored',
    );
    const vp = { kind: 'VIEWPORT', id: 2 } as EntityGeometry;
    expect(transformProblem(vp, turnAbout({ x: 0, y: 0 }, Math.PI / 2))).toBeUndefined();
    expect(transformProblem(vp, turn)).toBe('a viewport turns by right angles only');
    expect(transformProblem(vp, flip)).toBe('a viewport cannot be mirrored');
    expect(transformProblem({ ...vp, id: 1 } as EntityGeometry, moveBy({ x: 1, y: 0 }))).toBe(
      'the paper space viewport cannot be edited',
    );
  });
});
