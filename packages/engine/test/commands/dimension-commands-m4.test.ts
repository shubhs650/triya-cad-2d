// M4-02: DIMORDINATE, DIMJOGGED, DIMARC and DIMJOGLINE on the PromptBus with AutoCAD 2024's
// prompts, on the stand-in dimension engine of dimension-harness.ts.
import { describe, expect, it } from 'vitest';
import { dragMotion, linearJog, type EntityInit } from '../../src/index';
import { entityInit, snapshot } from '../model/fixtures';
import { said, setup } from './dimension-harness';

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

describe('DIMORDINATE', () => {
  it('asks AutoCAD 2024 prompts; a leader running up measures X from the UCS origin', async () => {
    const s = setup();
    await s.bus.submit('DIMORDINATE');
    expect(s.bus.promptText).toBe('Specify feature location:');
    await s.bus.submit('10,5');
    expect(s.bus.promptText).toBe('Specify leader endpoint or [Xdatum/Ydatum/Mtext/Text/Angle]:');
    await s.bus.submit('12,15');
    expect(s.bus.command).toBeUndefined();
    expect(s.dim<'ordinate'>()).toMatchObject({
      kind: 'DIMENSION',
      dimType: 'ordinate',
      axis: 'x',
      definitionPoint: { x: 0, y: 0 },
      feature: { x: 10, y: 5 },
      leaderEnd: { x: 12, y: 15 },
      horizontalDirection: 0,
    });
    expect(said(s.bus)).toContain('Dimension text = 10');
  });

  it('a leader running across measures Y; Xdatum and Ydatum fix the axis', async () => {
    const s = setup();
    await s.bus.script(['DIMORDINATE', '10,5', '20,6']);
    expect(s.dim<'ordinate'>().axis).toBe('y');
    expect(said(s.bus)).toContain('Dimension text = 5');
    await s.bus.script(['DIMORDINATE', '10,5', 'X', '20,6']);
    expect(s.dim<'ordinate'>()).toMatchObject({ axis: 'x', leaderEnd: { x: 20, y: 6 } });
    await s.bus.script(['DIMORDINATE', '10,5', 'Y', '10,20']);
    expect(s.dim<'ordinate'>().axis).toBe('y');
  });

  it('measures from the current UCS, its X axis in DXF 51 negated', async () => {
    const s = setup({
      header: [
        ['$UCSORG', { x: 5, y: 5, z: 0 }],
        ['$UCSXDIR', { x: 0, y: 1, z: 0 }],
        ['$UCSYDIR', { x: -1, y: 0, z: 0 }],
      ],
    });
    // In world coordinates: the feature 3 along the UCS X axis (world +Y) from its origin, the
    // leader running along the UCS Y axis (world −X): the X datum.
    await s.bus.script(['DIMORDINATE', '*5,8', '*-5,8']);
    const g = s.dim<'ordinate'>();
    expect(g).toMatchObject({ axis: 'x', definitionPoint: { x: 5, y: 5 } });
    expect(g.horizontalDirection).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('drags the leader end; Text defaults to the measurement; one undo step', async () => {
    const s = setup();
    const before = snapshot(s.model);
    await s.bus.script(['DIMORDINATE', '10,5']);
    const m = dragMotion(s.bus.prompt!.drag!, { x: 10, y: 9 })!;
    expect(m.adding?.geom).toMatchObject({ dimType: 'ordinate', leaderEnd: { x: 10, y: 9 } });
    await s.bus.submit('T');
    expect(s.bus.promptText).toBe('Enter dimension text <10>:');
    await s.bus.script(['X=<>', '10,9']);
    expect(s.dim<'ordinate'>().text).toBe('X=<>');
    await s.bus.script(['U']);
    expect(snapshot(s.model)).toEqual(before);
  });

  it('refuses a leader end on the feature; DIMCONTINUE goes on from it; DOR', async () => {
    const s = setup();
    await s.bus.script(['DOR', '10,5', '10,5']);
    expect(said(s.bus)).toContain('Invalid point.');
    await s.bus.script(['12,15']);
    await s.bus.script(['DIMCONTINUE']);
    expect(s.bus.promptText).toBe('Specify feature location or [Undo/Select] <Select>:');
    await s.bus.script(['20,0', '']);
    expect(s.dims()).toHaveLength(2);
    expect(s.dim<'ordinate'>()).toMatchObject({ axis: 'x', feature: { x: 20, y: 0 } });
  });
});

describe('DIMJOGGED', () => {
  it('asks AutoCAD 2024 prompts, says the radius before the location, then the jog', async () => {
    const s = setup();
    await s.bus.submit('DIMJOGGED');
    expect(s.bus.promptText).toBe('Select arc or circle:');
    await s.bus.pick({ x: 60, y: 0 });
    expect(s.bus.promptText).toBe('Specify center location override:');
    await s.bus.submit('50,-20');
    expect(s.bus.history.at(-1)).toBe('Dimension text = R10');
    expect(s.bus.promptText).toBe('Specify dimension line location or [Mtext/Text/Angle]:');
    await s.bus.submit('65,0');
    expect(s.bus.promptText).toBe('Specify jog location:');
    expect(s.dims()).toHaveLength(0);
    const drag = s.bus.prompt!.drag!;
    const m = dragMotion(drag, { x: 55, y: -2 })!;
    expect(m.adding?.geom).toMatchObject({ dimType: 'jogged', jogPoint: { x: 55, y: -2 } });
    await s.bus.submit('55,-2');
    expect(s.bus.command).toBeUndefined();
    const e = s.dims()[0]!;
    expect(e.type).toBe('LARGE_RADIAL_DIMENSION');
    expect(s.dim<'jogged'>()).toMatchObject({
      kind: 'LARGE_RADIAL_DIMENSION',
      definitionPoint: { x: 50, y: 0 },
      chordPoint: { x: 60, y: 0 },
      overrideCenter: { x: 50, y: -20 },
      jogPoint: { x: 55, y: -2 },
      textPosition: { x: 65, y: 0 },
      textUserPositioned: true,
      leaderLength: 0,
    });
    expect(s.model.blocks.get(s.dim<'jogged'>().block!)?.name).toMatch(/^\*D\d+$/);
    // Said once, before the location.
    expect(s.bus.history.filter((l) => l === 'Dimension text = R10')).toHaveLength(1);
  });

  it('keeps the Text option’s override through the jog; refuses a line; Esc makes nothing', async () => {
    const s = setup();
    await s.bus.script(['DIMJOGGED']);
    await s.bus.pick({ x: 5, y: 20 });
    expect(said(s.bus)).toContain('Object selected is not a circle or arc.');
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.script(['50,-20', 'T', 'R<> TYP', '65,0', '55,-2']);
    expect(s.dim<'jogged'>().text).toBe('R<> TYP');
    await s.bus.script(['JOG']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.script(['50,-20', '65,0']);
    await s.bus.cancel();
    expect(s.dims()).toHaveLength(1);
  });
});

/** A polyline with a half-circle arc segment from (200,0) to (220,0), bulging below. */
const POLY_ARC: EntityInit = entityInit('40', {
  kind: 'LWPOLYLINE',
  closed: false,
  vertices: [
    { x: 190, y: 0, bulge: 0 },
    { x: 200, y: 0, bulge: 1 },
    { x: 220, y: 0, bulge: 0 },
  ],
});

describe('DIMARC', () => {
  it('asks AutoCAD 2024 prompts and measures an arc; no Leader under 90°', async () => {
    const s = setup();
    await s.bus.submit('DIMARC');
    expect(s.bus.promptText).toBe('Select arc or polyline arc segment:');
    await s.bus.pick({ x: 60, y: 0 });
    expect(s.bus.promptText).toBe(
      'Specify arc length dimension location or [Mtext/Text/Angle/Partial]:',
    );
    const m = dragMotion(s.bus.prompt!.drag!, { x: 65, y: 0 })!;
    expect(m.adding?.geom).toMatchObject({ kind: 'ARC_DIMENSION', dimType: 'arc' });
    await s.bus.submit('65,0');
    const e = s.dims()[0]!;
    expect(e.type).toBe('ARC_DIMENSION');
    const g = s.dim<'arc'>();
    expect(g).toMatchObject({
      kind: 'ARC_DIMENSION',
      center: { x: 50, y: 0 },
      definitionPoint: { x: 65, y: 0 },
      startAngle: 0,
      partial: false,
    });
    expect(g.endAngle).toBeCloseTo(Math.PI / 3, 12);
    close(g.first, 60, 0);
    close(g.second, 55, 10 * Math.sin(Math.PI / 3));
    expect(g.leader).toBeUndefined();
    expect(said(s.bus)).toContain('Dimension text = 10.472');
  });

  it('a polyline arc segment over 90° offers Leader, then No leader', async () => {
    const s = setup({ entities: [POLY_ARC] });
    await s.bus.script(['DAR']);
    // The line segment is not an arc; the arc segment is taken.
    await s.bus.pick({ x: 195, y: 0 });
    expect(said(s.bus)).toContain('Object selected is not an arc or polyline arc segment.');
    await s.bus.pick({ x: 210, y: -10 });
    expect(s.bus.promptText).toBe(
      'Specify arc length dimension location or [Mtext/Text/Angle/Partial/Leader]:',
    );
    await s.bus.submit('L');
    expect(s.bus.promptText).toBe(
      'Specify arc length dimension location or [Mtext/Text/Angle/Partial/No leader]:',
    );
    await s.bus.submit('210,-15');
    const g = s.dim<'arc'>();
    close(g.center, 210, 0);
    // Counter-clockwise from the left end round the bottom to the right one.
    close(g.first, 200, 0);
    close(g.second, 220, 0);
    expect(g.startAngle).toBeCloseTo(Math.PI, 12);
    expect(g.endAngle).toBeCloseTo(0, 12);
    // Radial from the dimension arc's middle to the arc.
    close(g.leader![0], 210, -10);
    close(g.leader![1], 210, -15);
    expect(said(s.bus)).toContain(`Dimension text = ${Math.round(Math.PI * 10 * 1000) / 1000}`);
  });

  it('No leader takes it back', async () => {
    const s = setup({ entities: [POLY_ARC] });
    await s.bus.script(['DIMARC']);
    await s.bus.pick({ x: 210, y: -10 });
    await s.bus.script(['L', 'N', '210,-15']);
    expect(s.dim<'arc'>().leader).toBeUndefined();
  });

  it('Partial measures the part between two points on the arc, in the arc’s direction', async () => {
    const s = setup({ entities: [POLY_ARC] });
    await s.bus.script(['DIMARC']);
    await s.bus.pick({ x: 210, y: -10 });
    await s.bus.submit('P');
    expect(s.bus.promptText).toBe('Specify first point for arc length dimension:');
    // Above the centre is off the arc.
    await s.bus.submit('210,10');
    expect(said(s.bus)).toContain('Point is not on the arc.');
    await s.bus.submit('210,-10');
    expect(s.bus.promptText).toBe('Specify second point for arc length dimension:');
    await s.bus.submit('200,0');
    // A quarter: no leader offered.
    expect(s.bus.promptText).toBe(
      'Specify arc length dimension location or [Mtext/Text/Angle/Partial]:',
    );
    await s.bus.submit('200,-15');
    const g = s.dim<'arc'>();
    expect(g.partial).toBe(true);
    close(g.first, 200, 0);
    close(g.second, 210, -10);
    expect(g.startAngle).toBeCloseTo(Math.PI, 12);
    expect(g.endAngle).toBeCloseTo((3 * Math.PI) / 2, 12);
  });

  it('refuses a circle; Esc at the location makes nothing', async () => {
    const s = setup({
      entities: [entityInit('41', { kind: 'CIRCLE', center: { x: 0, y: -50 }, radius: 5 })],
    });
    await s.bus.script(['DIMARC']);
    await s.bus.pick({ x: 5, y: -50 });
    expect(said(s.bus)).toContain('Object selected is not an arc or polyline arc segment.');
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.cancel();
    expect(s.dims()).toHaveLength(0);
  });
});

describe('DIMJOGLINE', () => {
  const jogOf = (s: ReturnType<typeof setup>) => linearJog(s.dims()[0]!.xdata, s.model);

  it('asks AutoCAD 2024 prompts and files the jog on the dimension line', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    await s.bus.submit('DIMJOGLINE');
    expect(s.bus.promptText).toBe('Select dimension to add jog or [Remove]:');
    await s.bus.pick({ x: 10, y: 5 });
    expect(s.bus.promptText).toBe('Specify jog location (or press ENTER):');
    await s.bus.submit('3,4');
    expect(s.bus.command).toBeUndefined();
    expect(jogOf(s)).toEqual({ x: 3, y: 5 });
    const names = [...s.model.tables.appIds.values()].map((r) => r.name);
    expect(names).toContain('ACAD_DSTYLE_DIMJAG_POSITION');
  });

  it('Enter puts it halfway from the first extension line to the text', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    // The stand-in engine put the text at (10, 6): halfway from (0, 5) is (5, 5).
    await s.bus.script(['DJL']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('');
    expect(jogOf(s)).toEqual({ x: 5, y: 5 });
  });

  it('moves a jog already there, Remove takes it off, each one undo step', async () => {
    const s = setup();
    await s.bus.script(['DIMLINEAR', '0,0', '10,0', '5,5']);
    const plain = snapshot(s.model);
    await s.bus.script(['DIMJOGLINE']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('3,5');
    await s.bus.script(['DIMJOGLINE']);
    await s.bus.pick({ x: 10, y: 5 });
    await s.bus.submit('7,5');
    expect(jogOf(s)).toEqual({ x: 7, y: 5 });
    const appIds = s
      .dims()[0]!
      .xdata!.filter(
        (a) => s.model.tables.appIds.get(a.appId)?.name === 'ACAD_DSTYLE_DIMJAG_POSITION',
      );
    expect(appIds).toHaveLength(1);
    await s.bus.script(['DIMJOGLINE', 'R']);
    expect(s.bus.promptText).toBe('Select jog to remove:');
    await s.bus.pick({ x: 10, y: 5 });
    expect(jogOf(s)).toBeUndefined();
    await s.bus.script(['U', 'U']);
    expect(jogOf(s)).toEqual({ x: 3, y: 5 });
    await s.bus.script(['U']);
    expect(snapshot(s.model)).toEqual(plain);
  });

  it('takes linear and aligned dimensions only; Remove a dimension without a jog', async () => {
    const s = setup();
    await s.bus.script(['DIMRADIUS']);
    await s.bus.pick({ x: 60, y: 0 });
    await s.bus.script(['70,0']);
    await s.bus.script(['DIMJOGLINE']);
    await s.bus.pick({ x: 60, y: 0 });
    expect(said(s.bus)).toContain('Object selected is not a linear or aligned dimension.');
    expect(s.bus.promptText).toBe('Select dimension to add jog or [Remove]:');
    await s.bus.script(['R']);
    await s.bus.pick({ x: 60, y: 0 });
    expect(said(s.bus)).toContain('Object selected is not a jogged dimension.');
    await s.bus.cancel();
    expect(linearJog(s.dims()[0]!.xdata, s.model)).toBeUndefined();
  });
});
