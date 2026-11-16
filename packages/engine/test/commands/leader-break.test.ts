// M4-15: DIMBREAK on multileaders and leaders. AutoCAD 2024 breaks "multileaders (straight
// leaders only) and leaders (straight only)" (AutoCAD 2024 Help, "About Dimension Breaks") with
// the prompts it asks for a dimension; the breaks are DEC-064's TRIYA_DIMBREAK record in the
// leader's extension dictionary, and the gaps are cut out of its leader lines and landing as it is
// drawn (`withLeaderBreaks`).
import { describe, expect, it } from 'vitest';
import {
  annotationParts,
  ChangeSetBuilder,
  dimBreakOf,
  isDimBreak,
  leaderBreakSize,
  withLeaderBreaks,
  type BusEvent,
  type ChangeSet,
  type Entity,
  type LeaderGeometry,
  type LwPolylineGeometry,
  type MultiLeaderGeometry,
  type Vec2,
} from '../../src/index';
import { entityInit, lineGeom } from '../model/fixtures';
import { said, setup, standard, STYLE } from './dimension-harness';

const MLEADER = '30';
const LEADER = '31';
const ACROSS = '32';
const LANDING = '33';
const ACROSS_LEADER = '34';

/** A multileader from (0,40) up to (10,50), landing 2.5 to the right, text at (13,51). */
const mleader: MultiLeaderGeometry = {
  kind: 'MULTILEADER',
  overrideFlags: 0,
  pathType: 1,
  lineColor: { kind: 'byBlock' },
  lineweight: 'ByBlock',
  landing: true,
  dogleg: true,
  doglegLength: 2.5,
  arrowheadSize: 1,
  drawnArrowheadSize: 1,
  contentType: 2,
  scale: 1,
  annotative: false,
  textLeftAttachment: 1,
  textRightAttachment: 1,
  textTopAttachment: 9,
  textBottomAttachment: 9,
  textAttachmentDirection: 0,
  textAngleType: 1,
  textAlignment: 0,
  textFrame: false,
  contentBase: { x: 12.5, y: 50 },
  landingGap: 0.5,
  text: {
    content: 'NOTE',
    style: '0',
    position: { x: 13, y: 51 },
    rotation: 0,
    height: 1,
    width: 0,
    boundaryHeight: 0,
    lineSpacing: 1,
    lineSpacingStyle: 1,
    attachment: 1,
    flow: 1,
    color: { kind: 'byBlock' },
  },
  branches: [
    {
      index: 0,
      connection: { x: 10, y: 50 },
      direction: { x: 1, y: 0 },
      doglegLength: 2.5,
      lines: [{ index: 0, vertices: [{ x: 0, y: 40 }] }],
    },
  ],
};

/** A leader (20,40) → (30,50) → (35,50), with no annotation. */
const leader: LeaderGeometry = {
  kind: 'LEADER',
  style: STYLE,
  vertices: [
    { x: 20, y: 40 },
    { x: 30, y: 50 },
    { x: 35, y: 50 },
  ],
  arrowhead: true,
  spline: false,
  creationType: 3,
  textHeight: 0,
  textWidth: 0,
  horizontalDirection: { x: 1, y: 0 },
  blockOffset: { x: 0, y: 0 },
  annotationOffset: { x: 0, y: 0 },
};

/**
 * The two leaders; a line across the multileader's leader line at x = 5, one across its landing
 * at x = 11, one across the leader at x = 25.
 */
function drawing(vars: Record<string, number> = {}) {
  const s = setup({
    styles: [standard(vars)],
    entities: [
      entityInit(MLEADER, mleader),
      entityInit(LEADER, leader),
      entityInit(ACROSS, lineGeom(5, 38, 5, 56)),
      entityInit(LANDING, lineGeom(11, 49, 11, 52)),
      entityInit(ACROSS_LEADER, lineGeom(25, 38, 25, 56)),
    ],
  });
  const commits: ChangeSet[][] = [];
  s.bus.on((e: BusEvent) => {
    if (e.type === 'commit') commits.push([...e.record.changes]);
  });
  const get = (h: string): Entity => s.model.entityByHandle(h)!;
  const breaks = (h: string) => dimBreakOf(s.model, get(h));
  /** The leader's straight lines as drawn, each as its vertices. */
  const lines = (h: string): Vec2[][] => {
    const e = get(h);
    const parts = withLeaderBreaks(s.model, e, annotationParts(e.geom, s.model, e.xdata)!);
    return parts
      .filter((p) => p.geom.kind === 'LWPOLYLINE')
      .map((p) => (p.geom as LwPolylineGeometry).vertices.map((v) => ({ x: v.x, y: v.y })));
  };
  /** Whether the last command's changes have the entity drawn again. */
  const redrawn = (h: string) =>
    commits.at(-1)!.some((cs) => cs.entities?.updated?.some((u) => u.after.handle === h) ?? false);
  return { ...s, get, breaks, lines, redrawn };
}

const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
const half = 0.125 / 2 / Math.SQRT2;

describe('DIMBREAK on a multileader', () => {
  it('takes it at the first prompt; Auto breaks its leader line and landing where crossed', async () => {
    const s = drawing();
    await s.bus.submit('DIMBREAK');
    expect(s.bus.promptText).toBe('Select dimension to add/remove break or [Multiple]:');
    await s.bus.pick({ x: 8, y: 48 });
    expect(s.bus.promptText).toBe(
      'Select object to break dimension or [Auto/Manual/Remove] <Auto>:',
    );
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
    expect(said(s.bus)).toContain('1 object modified');
    const r = s.breaks(MLEADER)!;
    expect(r).toMatchObject({ type: 'TRIYA_DIMBREAK', dimension: MLEADER, manual: [] });
    expect([...r.objects].sort()).toEqual([ACROSS, LANDING]);
    expect(s.get(MLEADER).extDict).toBe(r.owner);
    expect(s.redrawn(MLEADER)).toBe(true);
    // The leader line, cut 0.125 wide about (5,45); the landing about (11,50).
    const [a, b, c, d] = s.lines(MLEADER);
    expect(near(a!.at(-1)!, { x: 5 - half, y: 45 - half })).toBe(true);
    expect(near(b![0]!, { x: 5 + half, y: 45 + half })).toBe(true);
    expect(near(b!.at(-1)!, { x: 10, y: 50 })).toBe(true);
    expect(near(c!.at(-1)!, { x: 10.9375, y: 50 })).toBe(true);
    expect(near(d![0]!, { x: 11.0625, y: 50 })).toBe(true);
    // One undo takes it all back.
    await s.bus.script(['U']);
    expect(s.breaks(MLEADER)).toBeUndefined();
    expect(s.lines(MLEADER)).toHaveLength(2);
  });

  it('breaks it with objects picked one by one, its own text and arrowhead whole', async () => {
    const s = drawing();
    await s.bus.submit('DIMBREAK');
    await s.bus.pick({ x: 8, y: 48 });
    await s.bus.pick({ x: 5, y: 54 });
    expect(s.bus.promptText).toBe('Select object to break dimension:');
    await s.bus.submit('');
    expect(s.breaks(MLEADER)!.objects).toEqual([ACROSS]);
    const e = s.get(MLEADER);
    const parts = withLeaderBreaks(s.model, e, annotationParts(e.geom, s.model)!);
    expect(parts.map((p) => p.geom.kind)).toEqual([
      'SOLID',
      'LWPOLYLINE',
      'LWPOLYLINE',
      'LWPOLYLINE',
      'MTEXT',
    ]);
  });

  it("Manual's points go on the segment nearest the first; Remove takes the breaks off", async () => {
    const s = drawing();
    await s.bus.script(['DIMBREAK', '8,48', 'M', '9,49.2', '11,50.3']);
    expect(s.bus.command).toBeUndefined();
    const [[p, q]] = s.breaks(MLEADER)!.manual as [[Vec2, Vec2]];
    expect(p.x).toBeCloseTo(9.1, 12);
    expect(p.y).toBeCloseTo(49.1, 12);
    // The second, past the leader line's end, is put at its end: the landing stays whole.
    expect(near(q, { x: 10, y: 50 })).toBe(true);
    const [line, landing] = s.lines(MLEADER);
    expect(line!.at(-1)!.x).toBeCloseTo(9.1, 12);
    expect(landing).toEqual([
      { x: 10, y: 50 },
      { x: 12.5, y: 50 },
    ]);
    await s.bus.script(['DIMBREAK', '8,48', 'R']);
    expect(s.breaks(MLEADER)).toBeUndefined();
    expect([...s.model.objects.values()].some(isDimBreak)).toBe(false);
    expect(s.redrawn(MLEADER)).toBe(true);
  });

  it('follows the breaking object when it moves, which draws the multileader again', async () => {
    const s = drawing();
    await s.bus.script(['DIMBREAK', '8,48', '5,54', '']);
    await s.bus.script(['MOVE', '5,54', '', '0,0', '2,0']);
    expect(s.redrawn(MLEADER)).toBe(true);
    expect(near(s.lines(MLEADER)[0]!.at(-1)!, { x: 7 - half, y: 47 - half })).toBe(true);
    // Moving the multileader carries its manual breaks; its record stays with it.
    await s.bus.script(['ERASE', '7,54', '']);
    expect(s.redrawn(MLEADER)).toBe(true);
    expect(s.lines(MLEADER)).toHaveLength(2);
    await s.bus.script(['DIMBREAK', '8,48', 'M', '2,42', '3,43']);
    await s.bus.script(['MOVE', '8,48', '', '0,0', '0,-10']);
    const [a, b] = s.breaks(MLEADER)!.manual[0]!;
    expect(a.y).toBeCloseTo(32, 12);
    expect(b.y).toBeCloseTo(33, 12);
    expect(s.lines(MLEADER)).toHaveLength(3);
    // Erased, it takes its record with it.
    await s.bus.script(['ERASE', '8,38', '']);
    expect([...s.model.objects.values()].some(isDimBreak)).toBe(false);
  });

  it('uses its style Break size times its overall scale', () => {
    const s = drawing();
    const e = s.get(MLEADER);
    expect(leaderBreakSize(s.model, e as never)).toBe(0.125);
    const scaled = { ...e, geom: { ...mleader, scale: 4 } };
    expect(leaderBreakSize(s.model, scaled as never)).toBe(0.5);
  });
});

describe('DIMBREAK on a leader', () => {
  it('Auto breaks its straight path, a gap of its style Break size times DIMSCALE', async () => {
    const s = drawing({ DIMSCALE: 2 });
    await s.bus.script(['DIMBREAK', '28,48', '']);
    expect(s.bus.command).toBeUndefined();
    expect(s.breaks(LEADER)!.objects).toEqual([ACROSS_LEADER]);
    const [a, b] = s.lines(LEADER);
    expect(near(a!.at(-1)!, { x: 25 - 2 * half, y: 45 - 2 * half })).toBe(true);
    expect(near(b![0]!, { x: 25 + 2 * half, y: 45 + 2 * half })).toBe(true);
    expect(b).toHaveLength(3);
  });

  it('leaves a spline leader whole, as AutoCAD breaks straight leaders only', async () => {
    const s = drawing();
    const b = new ChangeSetBuilder(s.model);
    b.updateEntity(s.get(LEADER).id, { geom: { ...leader, spline: true } });
    s.model.apply(b.build());
    await s.bus.script(['DIMBREAK', '28,48', '']);
    expect(s.breaks(LEADER)?.objects ?? []).toEqual([]);
  });

  it('Multiple breaks dimensions, leaders and multileaders alike', async () => {
    const s = drawing();
    await s.bus.script(['DIMLINEAR', '0,60', '30,60', '15,65']);
    await s.bus.submit('DIMBREAK');
    await s.bus.submit('M');
    expect(s.bus.promptText).toBe('Select dimensions:');
    await s.bus.pick({ x: 8, y: 48 });
    await s.bus.pick({ x: 28, y: 48 });
    await s.bus.pick({ x: 0, y: 60 });
    await s.bus.submit('');
    expect(s.bus.promptText).toBe('Enter an option [Break/Remove] <Break>:');
    await s.bus.submit('');
    expect(said(s.bus)).toContain('3 objects modified');
    expect(s.breaks(MLEADER)!.objects).toHaveLength(2);
    expect(s.breaks(LEADER)!.objects).toEqual([ACROSS_LEADER]);
    await s.bus.script(['DIMBREAK', 'M', '8,48', '28,48', '', 'R']);
    expect(s.breaks(MLEADER)).toBeUndefined();
    expect(s.breaks(LEADER)).toBeUndefined();
  });

  it('still refuses other objects', async () => {
    const s = drawing();
    await s.bus.submit('DIMBREAK');
    await s.bus.pick({ x: 5, y: 54 });
    expect(said(s.bus)).toContain('Object selected is not a dimension.');
    expect(s.bus.promptText).toBe('Select dimension to add/remove break or [Multiple]:');
  });
});
