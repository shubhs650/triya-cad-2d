// M8-02 part 2: weld symbols (AWS A2.4 and ISO 2553 system A). Each symbol's drawing is pinned
// by a snapshot under weld-snapshots/ (one line per part, to four decimals); rewrite with
// `pnpm vitest run packages/library/test/weld -u` and review the diff, which is the symbol's
// change as a drafter sees it. The rules the standards set (which side of the reference line
// is the arrow side, the fillet's upright leg on the left, the flag pointing at the tail, the
// identification line) are asserted on their own below.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  type DocumentInit,
  type EntityGeometry,
  type PolylineVertex,
  type TextGeometry,
} from '@triya/engine';
import {
  WELD_SYMBOL_DEFAULTS,
  WELD_TYPES,
  addWeldSymbolBlock,
  checkWeldSymbol,
  weldSymbolDefaults,
  weldSymbolDescription,
  weldSymbolName,
  weldSymbolParts,
  type LibraryPart,
  type WeldSide,
  type WeldSymbolSpec,
} from '../src/index';

const STYLE = '11';

const f = (v: number) => {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};
const pt = (p: { x: number; y: number }) => `(${f(p.x)}, ${f(p.y)})`;
const vertex = (v: PolylineVertex) => (v.bulge === 0 ? pt(v) : `${pt(v)} b${f(v.bulge)}`);

function geomText(g: EntityGeometry): string {
  switch (g.kind) {
    case 'LINE':
      return `LINE ${pt(g.start)} ${pt(g.end)}`;
    case 'CIRCLE':
      return `CIRCLE ${pt(g.center)} r${f(g.radius)}`;
    case 'LWPOLYLINE':
      return `LWPOLYLINE ${g.closed ? 'closed' : 'open'} ${g.vertices.map(vertex).join(' ')}`;
    case 'HATCH':
      return `HATCH ${g.solid ? 'SOLID' : g.pattern} ${g.loops
        .map((l) => `[${l.polyline!.vertices.map(vertex).join(' ')}]`)
        .join(' ')}`;
    case 'TEXT':
      return `TEXT "${g.value}" ${pt(g.alignmentPoint ?? g.position)} h${f(g.height)} j${g.halign}${g.valign}`;
    default:
      return g.kind;
  }
}

const partsText = (parts: readonly LibraryPart[]) =>
  parts.map((p) => `${p.role.padEnd(7)} ${geomText(p.geom)}`).join('\n');

const spec = (change: Partial<WeldSymbolSpec> = {}): WeldSymbolSpec => ({
  ...WELD_SYMBOL_DEFAULTS,
  ...change,
});

const texts = (parts: readonly LibraryPart[]) =>
  parts.filter((p) => p.geom.kind === 'TEXT').map((p) => p.geom as TextGeometry);
const textNamed = (parts: readonly LibraryPart[], value: string) =>
  texts(parts).find((t) => t.value === value)!;
const lines = (parts: readonly LibraryPart[]) =>
  parts
    .filter((p) => p.geom.kind === 'LINE')
    .map((p) => ({ role: p.role, ...(p.geom as Extract<EntityGeometry, { kind: 'LINE' }>) }));

/** The reference line: the longest continuous horizontal line. */
function referenceLine(parts: readonly LibraryPart[]) {
  return lines(parts)
    .filter((l) => l.role === 'visible' && Math.abs(l.start.y - l.end.y) < 1e-12)
    .sort((a, b) => Math.abs(b.end.x - b.start.x) - Math.abs(a.end.x - a.start.x))[0]!;
}

/**
 * How far each point of the weld's own symbol lies above (+) or below (-) the reference line:
 * the parts drawn after the line, without any text.
 */
function symbolOffsets(parts: readonly LibraryPart[]): number[] {
  const ref = referenceLine(parts);
  const at = parts.findIndex(
    (p) =>
      p.geom.kind === 'LINE' &&
      p.geom.start.x === ref.start.x &&
      p.geom.start.y === ref.start.y &&
      p.geom.end.x === ref.end.x,
  );
  const after = parts.slice(at + 1);
  return after.flatMap((p) => {
    const g = p.geom;
    if (g.kind === 'LINE') return [g.start.y - ref.start.y, g.end.y - ref.start.y];
    if (g.kind === 'CIRCLE')
      return [g.center.y - g.radius - ref.start.y, g.center.y + g.radius - ref.start.y];
    if (g.kind === 'LWPOLYLINE')
      return g.vertices.flatMap((v, i) => {
        const q = g.vertices[(i + 1) % g.vertices.length]!;
        if (v.bulge === 0 || (!g.closed && i === g.vertices.length - 1)) return [v.y - ref.start.y];
        // An arc's midpoint lies to the right of its chord for a positive (CCW) bulge.
        const apex = (v.y + q.y) / 2 - (v.bulge * (q.x - v.x)) / 2;
        return [v.y - ref.start.y, apex - ref.start.y];
      });
    return [];
  });
}

describe('weld symbol snapshots (M8-02)', () => {
  const fillet: WeldSide = { type: 'fillet', size: '1/4', length: '2-6' };
  const cases: [string, Partial<WeldSymbolSpec>][] = [
    ['AWS-fillet-arrow', {}],
    [
      'AWS-fillet-both-staggered-all-around-field',
      {
        arrowSide: fillet,
        otherSide: fillet,
        staggered: true,
        allAround: true,
        field: true,
        tail: 'SMAW',
      },
    ],
    [
      'AWS-v-groove-backing-contour',
      {
        arrowSide: {
          type: 'v',
          size: '1/2',
          angle: '60%%d',
          rootOpening: '1/8',
          contour: 'flush',
          finish: 'G',
        },
        otherSide: { type: 'back' },
      },
    ],
    [
      'AWS-left-bevel-j-convex-concave',
      {
        leaderAngle: 135,
        arrowSide: { type: 'bevel', size: '3/8', angle: '45%%d', contour: 'convex', finish: 'M' },
        otherSide: { type: 'j', size: '1/4', contour: 'concave' },
        tail: 'WPS-12',
      },
    ],
    [
      'AWS-u-square-flare',
      {
        arrowSide: { type: 'u', size: '5/8', angle: '20%%d' },
        otherSide: { type: 'square', rootOpening: '1/16' },
      },
    ],
    [
      'AWS-flare-v-flare-bevel',
      { arrowSide: { type: 'flare-v', size: '1/4' }, otherSide: { type: 'flare-bevel' } },
    ],
    [
      'AWS-plug-spot-seam-surfacing',
      {
        arrowSide: { type: 'plug', size: '1', length: '4-6' },
        otherSide: { type: 'surfacing', size: '1/8' },
      },
    ],
    [
      'AWS-spot-seam',
      { arrowSide: { type: 'spot', size: '0.30' }, otherSide: { type: 'seam', size: '0.25' } },
    ],
    ['ISO-fillet-arrow', { standard: 'ISO', arrowSide: { type: 'fillet', size: 'a5' } }],
    [
      'ISO-v-other-side',
      {
        standard: 'ISO',
        arrowSide: undefined,
        otherSide: { type: 'v', size: 's8', angle: '60%%d' },
        tail: '111 ISO 5817-B',
      },
    ],
    [
      'ISO-fillet-symmetric-field',
      {
        standard: 'ISO',
        arrowSide: { type: 'fillet', size: 'a4', length: '3×50 (100)' },
        otherSide: { type: 'fillet', size: 'a4', length: '3×50 (100)' },
        field: true,
      },
    ],
  ];
  for (const [file, change] of cases)
    it(`pins ${file}`, async () => {
      const s = spec(change);
      expect(checkWeldSymbol(s)).toBeUndefined();
      const text = `# ${weldSymbolName(s)}\n# ${weldSymbolDescription(s)}\n${partsText(weldSymbolParts(s, STYLE))}\n`;
      await expect(text).toMatchFileSnapshot(`weld-snapshots/${file}.txt`);
    });
});

describe('weld symbols (M8-02)', () => {
  it('draws every weld type on either side of the line', () => {
    for (const type of WELD_TYPES) {
      for (const side of ['arrowSide', 'otherSide'] as const) {
        const s = spec({ arrowSide: undefined, [side]: { type } });
        expect(checkWeldSymbol(s), type).toBeUndefined();
        const parts = weldSymbolParts(s, STYLE);
        const ys = symbolOffsets(parts);
        expect(ys.length, type).toBeGreaterThan(0);
        // AWS A2.4: the arrow side's weld below the line, the other side's above.
        const sign = side === 'arrowSide' ? -1 : 1;
        for (const y of ys) expect(sign * y, type).toBeGreaterThanOrEqual(-1e-12);
        expect(Math.max(...ys.map((y) => sign * y)), type).toBeGreaterThan(0);
      }
    }
  });

  it('puts the arrow side below the line in AWS A2.4 and above it in ISO 2553', () => {
    const h = WELD_SYMBOL_DEFAULTS.height;
    for (const [standard, below] of [
      ['AWS', true],
      ['ISO', false],
    ] as const) {
      const parts = weldSymbolParts(
        spec({ standard, arrowSide: { type: 'fillet', size: 'S' } }),
        STYLE,
      );
      const y = referenceLine(parts).start.y;
      const size = textNamed(parts, 'S');
      expect(size.alignmentPoint!.y - y, standard).toBeCloseTo(below ? -h / 2 : h / 2, 12);
      // The fillet's upright leg is on the left, and the symbol stays on its side.
      const fillet = parts.find(
        (p) =>
          p.geom.kind === 'LWPOLYLINE' &&
          !p.geom.closed &&
          p.geom.vertices.length === 3 &&
          p.geom.vertices[0]!.y === y,
      )!.geom as Extract<EntityGeometry, { kind: 'LWPOLYLINE' }>;
      const [a, b, c] = fillet.vertices;
      expect(a!.x).toBeCloseTo(b!.x, 12);
      expect(c!.x).toBeGreaterThan(a!.x);
      expect(Math.sign(b!.y - y)).toBe(below ? -1 : 1);
    }
  });

  it('draws ISO 2553 identification line below, with the other side on it, unless symmetric', () => {
    const h = WELD_SYMBOL_DEFAULTS.height;
    const dashed = (parts: readonly LibraryPart[]) =>
      lines(parts).filter((l) => l.role === 'hidden');
    const one = weldSymbolParts(
      spec({ standard: 'ISO', arrowSide: undefined, otherSide: { type: 'fillet', size: 'O' } }),
      STYLE,
    );
    const y = referenceLine(one).start.y;
    const [id] = dashed(one);
    expect(id!.start.y).toBeLessThan(y);
    expect(id!.start.y).toBeCloseTo(id!.end.y, 12);
    // The other side hangs below the identification line.
    expect(textNamed(one, 'O').alignmentPoint!.y).toBeCloseTo(id!.start.y - h / 2, 12);
    const symmetric = weldSymbolParts(
      spec({
        standard: 'ISO',
        arrowSide: { type: 'fillet', size: 'A' },
        otherSide: { type: 'fillet', size: 'O' },
      }),
      STYLE,
    );
    expect(dashed(symmetric)).toHaveLength(0);
    expect(textNamed(symmetric, 'O').alignmentPoint!.y).toBeCloseTo(y - h / 2, 12);
    expect(dashed(weldSymbolParts(spec({ standard: 'AWS' }), STYLE))).toHaveLength(0);
  });

  it('starts the leader at the arrow tip and runs the reference line away from it', () => {
    for (const angle of [45, 135, 90, -45]) {
      const s = spec({ leaderAngle: angle });
      const parts = weldSymbolParts(s, STYLE);
      const a = (angle * Math.PI) / 180;
      const j = { x: s.leaderLength * Math.cos(a), y: s.leaderLength * Math.sin(a) };
      const leader = lines(parts).find((l) => l.start.x === 0 && l.start.y === 0)!;
      expect(leader.end.x).toBeCloseTo(j.x, 12);
      expect(leader.end.y).toBeCloseTo(j.y, 12);
      const ref = referenceLine(parts);
      expect(ref.start.x).toBeCloseTo(j.x, 12);
      expect(ref.end.x - ref.start.x).toBeCloseTo(
        (Math.cos(a) < -1e-9 ? -1 : 1) * s.referenceLength,
        12,
      );
    }
  });

  it('points the field flag and the tail away from the leader', () => {
    for (const angle of [45, 135]) {
      const s = spec({ leaderAngle: angle, field: true, tail: 'T' });
      const parts = weldSymbolParts(s, STYLE);
      const ref = referenceLine(parts);
      const dir = Math.sign(ref.end.x - ref.start.x);
      const flag = parts.find(
        (p) =>
          p.geom.kind === 'LWPOLYLINE' && p.geom.closed && p.geom.vertices[0]!.x === ref.start.x,
      )!.geom as Extract<EntityGeometry, { kind: 'LWPOLYLINE' }>;
      expect(Math.sign(flag.vertices[1]!.x - ref.start.x)).toBe(dir);
      expect(Math.min(...flag.vertices.map((v) => v.y))).toBeGreaterThan(ref.start.y);
      const tail = textNamed(parts, 'T');
      expect(Math.sign(tail.alignmentPoint!.x - ref.end.x)).toBe(dir);
      expect(tail.halign).toBe(dir > 0 ? 0 : 2);
    }
    // No tail without a reference.
    const plain = weldSymbolParts(spec(), STYLE);
    expect(lines(plain).filter((l) => l.start.y !== l.end.y && l.start.x !== 0)).toHaveLength(0);
  });

  it('staggers intermittent welds, the other side shifted along the line', () => {
    const fillet: WeldSide = { type: 'fillet', size: 'S', length: '2-6' };
    const centre = (parts: readonly LibraryPart[], below: boolean) => {
      const y = referenceLine(parts).start.y;
      return texts(parts).find((t) => t.value === 'S' && t.alignmentPoint!.y < y === below)!
        .alignmentPoint!.x;
    };
    const chain = weldSymbolParts(spec({ arrowSide: fillet, otherSide: fillet }), STYLE);
    expect(centre(chain, true)).toBeCloseTo(centre(chain, false), 12);
    const staggered = weldSymbolParts(
      spec({ arrowSide: fillet, otherSide: fillet, staggered: true }),
      STYLE,
    );
    expect(centre(staggered, false)).toBeGreaterThan(centre(staggered, true));
  });

  it('refuses symbols the standards do not draw, saying why', () => {
    const refused: [Partial<WeldSymbolSpec>, string][] = [
      [{ height: 0 }, 'height must be more than 0'],
      [{ referenceLength: Number.NaN }, 'reference line length must be a number'],
      [{ leaderLength: -1 }, 'leader length must be more than 0'],
      [{ leaderAngle: Number.POSITIVE_INFINITY }, 'leader angle must be a number'],
      [{ arrowSide: undefined }, 'a weld symbol needs a weld on the arrow side or the other side'],
      [
        { referenceLength: 0.4 },
        'reference line length must be at least 4 times the height (and the staggered offset)',
      ],
      [{ arrowSide: { type: 'fillet', angle: '45' } }, 'a fillet weld has no groove angle'],
      [
        { arrowSide: { type: 'plug', rootOpening: '1/8' } },
        'a plug or slot weld has no root opening',
      ],
      [{ arrowSide: { type: 'v', finish: 'G' } }, 'a finish needs a contour'],
      [{ arrowSide: { type: 'v', size: 'a\nb' } }, 'size must be one line'],
      [
        { arrowSide: { type: 'fillet', length: '2-6' }, staggered: true },
        'staggered welds need a length and pitch on both sides',
      ],
      [{ tail: 'SMAW\r\nGTAW' }, 'tail must be one line'],
    ];
    for (const [change, why] of refused) expect(checkWeldSymbol(spec(change))).toBe(why);
  });

  it("scales the defaults' lengths to the drawing's units", () => {
    const mm = weldSymbolDefaults(25.4);
    expect(mm).toMatchObject({
      height: WELD_SYMBOL_DEFAULTS.height * 25.4,
      referenceLength: WELD_SYMBOL_DEFAULTS.referenceLength * 25.4,
      leaderLength: WELD_SYMBOL_DEFAULTS.leaderLength * 25.4,
      leaderAngle: WELD_SYMBOL_DEFAULTS.leaderAngle,
    });
    expect(checkWeldSymbol(mm)).toBeUndefined();
    const a = weldSymbolParts(WELD_SYMBOL_DEFAULTS, STYLE);
    const b = weldSymbolParts(mm, STYLE);
    expect(b).toHaveLength(a.length);
    b.forEach((p, i) => {
      if (p.geom.kind === 'TEXT') {
        const q = a[i]!.geom as TextGeometry;
        expect(p.geom.height).toBeCloseTo(q.height * 25.4, 9);
        expect(p.geom.alignmentPoint!.x).toBeCloseTo(q.alignmentPoint!.x * 25.4, 9);
      }
    });
  });

  it('names a symbol by its standard, its weld types and a digest of the rest', () => {
    const s = spec({ otherSide: { type: 'v', size: '1/2' } });
    expect(weldSymbolName(s)).toMatch(/^TRIYA_WELD_AWS_FILLET_V_[0-9A-F]{8}$/);
    expect(
      weldSymbolName(
        spec({ standard: 'ISO', arrowSide: undefined, otherSide: { type: 'flare-v' } }),
      ),
    ).toMatch(/^TRIYA_WELD_ISO_0_FLARE-V_[0-9A-F]{8}$/);
    // Any change to what is drawn is another block.
    expect(weldSymbolName(spec({ tail: 'A' }))).not.toBe(weldSymbolName(spec({ tail: 'B' })));
    expect(weldSymbolName(spec({ leaderAngle: 135 }))).not.toBe(weldSymbolName(spec()));
    expect(weldSymbolName(spec())).toBe(weldSymbolName(spec()));
    expect(weldSymbolDescription(spec({ allAround: true, field: true, tail: 'SMAW' }))).toBe(
      'Weld symbol, AWS A2.4: arrow side fillet, size 1/4; all around; field weld; tail SMAW; ' +
        'height 0.125, reference line 1, leader 0.375 at 45°',
    );
  });
});

/** A drawing with layer 0, model space, and a Standard text style. */
function drawing(): DocumentModel {
  const init: DocumentInit = {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '40',
    header: new Map(),
    tables: {
      layers: [
        {
          handle: '10',
          name: '0',
          color: { kind: 'aci', index: 7 },
          linetype: '14',
          lineweight: 'Default',
          transparency: { alpha: 255 },
          plot: true,
          on: true,
          frozen: false,
          locked: false,
        },
      ],
      linetypes: [
        {
          handle: '14',
          name: 'Continuous',
          description: '',
          alignment: 'A',
          patternLength: 0,
          elements: [],
        },
        {
          handle: '15',
          name: 'HIDDEN2',
          description: '',
          alignment: 'A',
          patternLength: 0,
          elements: [],
        },
      ],
      textStyles: [
        {
          handle: STYLE,
          name: 'Standard',
          font: 'txt',
          height: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          lastHeight: 2.5,
          generation: 0,
          trueTypeFlags: 0,
        },
      ],
      blockRecords: [
        { handle: '1F', name: '*Model_Space', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [{ handle: '1F', name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: '1F' }],
    objects: [],
    passthrough: [],
    entities: [],
  };
  return DocumentModel.create(init);
}

describe('weld symbol blocks (M8-02)', () => {
  it("adds a block on layer 0 ByBlock in the drawing's text style, and finds one it has", () => {
    const model = drawing();
    const s = { ...weldSymbolDefaults(25.4), standard: 'ISO' as const, tail: '111' };
    const b = new ChangeSetBuilder(model);
    const made = addWeldSymbolBlock(b, model, s)!;
    expect(addWeldSymbolBlock(b, model, { ...s, height: 0 })).toBeUndefined();
    model.apply(b.build());
    expect(model.blocks.get(made)).toMatchObject({
      name: weldSymbolName(s),
      basePoint: { x: 0, y: 0 },
      description: weldSymbolDescription(s),
    });
    const parts = model.blockEntities(made).map((id) => model.entity(id)!);
    expect(parts).toHaveLength(weldSymbolParts(s, STYLE).length);
    for (const e of parts) {
      expect(model.tables.layers.get(e.layer)?.name).toBe('0');
      expect(e).toMatchObject({ color: { kind: 'byBlock' }, lineweight: 'ByBlock' });
    }
    expect(
      parts.filter((e) => e.geom.kind === 'TEXT').map((e) => (e.geom as TextGeometry).style),
    ).toEqual([STYLE, STYLE]);
    expect(parts.some((e) => e.linetype === '15')).toBe(true);
    const again = new ChangeSetBuilder(model);
    expect(addWeldSymbolBlock(again, model, s)).toBe(made);
  });
});
