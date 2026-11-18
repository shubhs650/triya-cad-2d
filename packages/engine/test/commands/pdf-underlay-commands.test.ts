// M5-04 part 9: PDFCLIP and PDFADJUST on the PromptBus, with AutoCAD 2024's prompts (AutoCAD
// Help, "PDFCLIP (Command)", "PDFADJUST (Command)"): PDFCLIP's New boundary (Rectangular,
// Polygonal, Select polyline), ON, OFF and Delete; PDFADJUST's Fade, Contrast, Monochrome and
// AdjustColorForBackground. Each is one undo step, written as the save writes it (io
// export/entities.ts PDFUNDERLAY, DXF 11 and 280–282). The harness's pages are 10 × 10 inches.
import { describe, expect, it } from 'vitest';
import type { EntityGeometry, PdfDefinition, UnderlayGeometry, Vec2 } from '../../src/index';
import { r6, setup } from './edit-harness';

const ROOT = 'C';
const PDFDEF: PdfDefinition = {
  type: 'PDFDEFINITION',
  handle: '90',
  owner: ROOT,
  name: 'plan - 1',
  fileName: 'plan.pdf',
  page: '1',
};

/** A PDF underlay of plan.pdf's page 1, as PDFATTACH makes one: on, adjusted, unclipped. */
function underlay(at: Vec2, o: Partial<UnderlayGeometry> = {}): EntityGeometry {
  return {
    kind: 'PDFUNDERLAY',
    definition: '90',
    position: at,
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    flags: 10,
    contrast: 100,
    fade: 0,
    clip: [],
    ...o,
  } as EntityGeometry;
}

/**
 * The harness drawing (line 30, circle 31) with underlay 40 at 100,100 (its page 100–110 by
 * 100–110), underlay 41 at 200,100 at scale 2 turned 90° (180–200 by 100–120), underlay 42 at
 * 300,100 turned 30°, and whatever `extra` adds (handles 43 on).
 */
function drawing(extra: EntityGeometry[] = []) {
  const t = setup(
    [
      underlay({ x: 100, y: 100 }),
      underlay({ x: 200, y: 100 }, { scale: { x: 2, y: 2, z: 2 }, rotation: Math.PI / 2 }),
      underlay({ x: 300, y: 100 }, { rotation: Math.PI / 6 }),
      ...extra,
    ],
    { objects: [PDFDEF], meta: { rootDictionary: ROOT } },
  );
  const geom = (h: string) => t.byHandle(h)!.geom as UnderlayGeometry;
  const clip = (h: string) => geom(h).clip.map((p) => [r6(p.x), r6(p.y)]);
  /** Starts PDFCLIP on the underlay whose page edge passes through `at`. */
  const pdfclip = async (at: Vec2) => {
    await t.bus.submit('PDFCLIP');
    await t.bus.pick(at);
  };
  return { ...t, geom, clip, pdfclip };
}

/** A point on underlay 40's bottom edge, one on 41's (its X axis, turned up), one on 42's. */
const ON_40 = { x: 105, y: 100 };
const ON_41 = { x: 200, y: 110 };
const ON_42 = { x: 300 + 5 * Math.cos(Math.PI / 6), y: 100 + 5 * Math.sin(Math.PI / 6) };

describe('PDFCLIP New boundary', () => {
  it('clips an underlay to a rectangle, two corners in page inches', async () => {
    const t = drawing();
    await t.bus.submit('PDFCLIP');
    expect(t.bus.promptText).toBe('Select PDF to clip:');
    await t.bus.pick(ON_40);
    expect(t.bus.promptText).toBe(
      'Enter PDF clipping option [ON/OFF/Delete/New boundary] <New boundary>:',
    );
    await t.bus.submit('');
    expect(t.log).toContain('Outside mode - Objects outside boundary will be hidden.');
    expect(t.bus.promptText).toBe(
      'Specify clipping boundary [Select polyline/Polygonal/Rectangular] <Rectangular>:',
    );
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Specify first corner:');
    await t.bus.submit('108,107');
    expect(t.bus.promptText).toBe('Specify opposite corner:');
    await t.bus.submit('102,103');
    expect(t.bus.command).toBeUndefined();
    expect(t.clip('40')).toEqual([
      [2, 3],
      [8, 7],
    ]);
    // Clipping on (DXF 280 bit 1), the rest of its flags kept.
    expect(t.geom('40').flags).toBe(11);
    expect(t.geom('41').clip).toEqual([]);
  });

  it('is one undo step', async () => {
    const t = drawing();
    await t.pdfclip(ON_40);
    await t.bus.script(['N', 'R', '102,103', '108,107']);
    expect(t.geom('40').flags).toBe(11);
    await t.bus.script(['U']);
    expect(t.geom('40').flags).toBe(10);
    expect(t.geom('40').clip).toEqual([]);
  });

  it('takes the boundary into the underlay’s space: its scale and rotation undone', async () => {
    const t = drawing();
    await t.pdfclip(ON_41);
    await t.bus.script(['N', 'R', '190,105', '195,115']);
    // World = 200,100 + 2 · (−y, x): 190,105 is 2.5,5 and 195,115 is 7.5,2.5.
    expect(t.clip('41')).toEqual([
      [2.5, 2.5],
      [7.5, 5],
    ]);
  });

  it('keeps a rectangle across a turned page as the polygon it is there', async () => {
    const t = drawing();
    await t.pdfclip(ON_42);
    await t.bus.script(['N', 'R', '300,101', '303,104']);
    const v = t.clip('42');
    expect(v).toHaveLength(4);
    // Its first corner, 0,1 from the insertion point, turned back 30°.
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    expect(v[0]).toEqual([r6(s), r6(c)]);
    expect(t.geom('42').flags).toBe(11);
  });

  it('clips to a polygon, its first vertex not repeated', async () => {
    const t = drawing();
    await t.pdfclip(ON_40);
    await t.bus.script(['N', 'P', '101,101', '109,101', '105,109', '']);
    expect(t.clip('40')).toEqual([
      [1, 1],
      [9, 1],
      [5, 9],
    ]);
  });

  it('does not cut a boundary at the page: the engine does not know the page’s size', async () => {
    const t = drawing();
    await t.pdfclip(ON_40);
    await t.bus.script(['N', 'R', '95,95', '105,105']);
    expect(t.clip('40')).toEqual([
      [-5, -5],
      [5, 5],
    ]);
  });

  it('refuses a boundary without area, and asks for more points', async () => {
    const t = drawing();
    await t.pdfclip(ON_40);
    await t.bus.script(['N', 'P', '101,101', '105,101', '109,101', '']);
    expect(t.log.at(-1)).toBe('The clipping boundary must enclose an area.');
    expect(t.bus.promptText).toBe('Specify next point or [Undo]:');
    expect(t.geom('40').flags).toBe(10);
    await t.bus.script(['105,109', '']);
    expect(t.geom('40').flags).toBe(11);
    expect(t.clip('40')).toHaveLength(4);
  });

  it('clips to a polyline selected', async () => {
    const t = drawing([
      {
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: [
          { x: 102, y: 102, bulge: 0 },
          { x: 108, y: 102, bulge: 0 },
          { x: 108, y: 108, bulge: 0 },
        ],
      } as EntityGeometry,
    ]);
    await t.pdfclip(ON_40);
    await t.bus.script(['N', 'S']);
    expect(t.bus.promptText).toBe('Select polyline:');
    await t.bus.pick({ x: 105, y: 102 });
    expect(t.clip('40')).toEqual([
      [2, 2],
      [8, 2],
      [8, 8],
    ]);
  });

  it('asks before replacing a boundary, and keeps it on No', async () => {
    const t = drawing();
    await t.pdfclip(ON_40);
    await t.bus.script(['N', 'R', '102,103', '108,107']);
    await t.pdfclip(ON_40);
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Delete old boundary? [Yes/No] <Yes>:');
    await t.bus.submit('N');
    expect(t.bus.command).toBeUndefined();
    expect(t.clip('40')).toEqual([
      [2, 3],
      [8, 7],
    ]);
    await t.pdfclip(ON_40);
    await t.bus.script(['', 'Y', 'R', '101,101', '104,104']);
    expect(t.clip('40')).toEqual([
      [1, 1],
      [4, 4],
    ]);
  });

  it('takes PDF underlays only', async () => {
    const t = drawing();
    await t.bus.submit('PDFCLIP');
    await t.bus.pick({ x: 5, y: 0 });
    expect(t.log.at(-1)).toBe('Object is not a PDF underlay.');
    expect(t.bus.promptText).toBe('Select PDF to clip:');
    await t.bus.pick(ON_40);
    expect(t.bus.promptText).toBe(
      'Enter PDF clipping option [ON/OFF/Delete/New boundary] <New boundary>:',
    );
  });
});

describe('PDFCLIP ends without a change', () => {
  it('on Enter at the selection, Escape at an option, and Escape during a boundary', async () => {
    const t = drawing();
    await t.bus.script(['PDFCLIP', '']);
    expect(t.bus.command).toBeUndefined();
    await t.pdfclip(ON_40);
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
    await t.pdfclip(ON_40);
    await t.bus.script(['N', 'R', '102,103']);
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
    await t.pdfclip(ON_40);
    await t.bus.script(['N']);
    await t.bus.cancel();
    expect(t.geom('40')).toMatchObject({ flags: 10, clip: [] });
    // Delete and OFF on an underlay without a clip change nothing either.
    await t.pdfclip(ON_40);
    await t.bus.script(['D']);
    await t.pdfclip(ON_40);
    await t.bus.script(['OFF']);
    expect(t.log.at(-1)).toBe('The PDF underlay has no clipping boundary.');
    await t.bus.script(['U']);
    expect(t.log.at(-1)).toBe('Nothing to undo');
  });

  it('refuses a boundary on a flat underlay (a zero scale), and asks again', async () => {
    const t = drawing([underlay({ x: 400, y: 100 }, { scale: { x: 0, y: 1, z: 1 } })]);
    await t.pdfclip({ x: 400, y: 105 });
    await t.bus.script(['N', 'R', '401,101', '402,102']);
    expect(t.log.at(-1)).toBe('The clipping boundary must enclose an area.');
    expect(t.bus.promptText).toBe('Specify first corner:');
    await t.bus.cancel();
    expect(t.geom('43').clip).toEqual([]);
  });

  it('turning clipping on when it is on changes nothing', async () => {
    const t = drawing();
    await t.pdfclip(ON_40);
    await t.bus.script(['N', 'R', '102,103', '108,107']);
    await t.pdfclip(ON_40);
    await t.bus.script(['ON']);
    await t.bus.script(['U']);
    expect(t.geom('40').flags).toBe(10);
  });
});

describe('PDFCLIP ON, OFF and Delete', () => {
  it('turns clipping off and on, keeping the boundary', async () => {
    const t = drawing();
    await t.pdfclip(ON_40);
    await t.bus.script(['N', 'R', '102,103', '108,107']);
    await t.pdfclip(ON_40);
    await t.bus.script(['OFF']);
    expect(t.geom('40').flags).toBe(10);
    expect(t.clip('40')).toEqual([
      [2, 3],
      [8, 7],
    ]);
    await t.pdfclip(ON_40);
    await t.bus.script(['ON']);
    expect(t.geom('40').flags).toBe(11);
  });

  it('says so when there is no boundary to turn on', async () => {
    const t = drawing();
    await t.pdfclip(ON_40);
    await t.bus.script(['ON']);
    expect(t.log.at(-1)).toBe('The PDF underlay has no clipping boundary.');
    expect(t.geom('40').flags).toBe(10);
  });

  it('Delete brings the whole page back', async () => {
    const t = drawing();
    await t.pdfclip(ON_40);
    await t.bus.script(['N', 'P', '101,101', '109,101', '105,109', '']);
    await t.pdfclip(ON_40);
    await t.bus.script(['D']);
    expect(t.geom('40').flags).toBe(10);
    expect(t.geom('40').clip).toEqual([]);
    await t.bus.script(['U']);
    expect(t.clip('40')).toHaveLength(3);
  });
});

describe('PDFADJUST', () => {
  /** Starts PDFADJUST on the underlays whose insertion points a window from `a` to `b` holds. */
  const start = async (t: ReturnType<typeof drawing>, a: Vec2, b: Vec2) => {
    await t.bus.submit('PDFADJUST');
    await t.bus.pick(a);
    await t.bus.pick(b);
    await t.bus.submit('');
  };

  it('sets the fade of every underlay selected, 0 to 80', async () => {
    const t = drawing();
    await t.bus.submit('PDFADJUST');
    expect(t.bus.promptText).toBe('Select PDF underlay:');
    // A crossing window over 40's and 41's insertion points, line 30 and circle 31.
    await t.bus.pick({ x: 250, y: 120 });
    await t.bus.pick({ x: 5, y: -1 });
    await t.bus.submit('');
    expect(t.log).toContain('2 objects are not PDF underlays.');
    expect(t.bus.promptText).toBe(
      'Enter PDF underlay option [Fade/Contrast/Monochrome/AdjustColorForBackground] <Fade>:',
    );
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Enter fade value (0-80) <0>:');
    await t.bus.submit('81');
    expect(t.log.at(-1)).toBe('Value must be between 0 and 80.');
    await t.bus.submit('25');
    expect(t.geom('40').fade).toBe(25);
    expect(t.geom('41').fade).toBe(25);
    expect(t.geom('42').fade).toBe(0);
    await t.bus.script(['U']);
    expect(t.geom('40').fade).toBe(0);
    expect(t.geom('41').fade).toBe(0);
  });

  it('sets the contrast, the first underlay’s value offered', async () => {
    const t = drawing([underlay({ x: 400, y: 100 }, { contrast: 40 })]);
    await start(t, { x: 395, y: 95 }, { x: 405, y: 105 });
    await t.bus.script(['C']);
    expect(t.bus.promptText).toBe('Enter contrast value (0-100) <40>:');
    await t.bus.script(['101']);
    expect(t.log.at(-1)).toBe('Value must be between 0 and 100.');
    await t.bus.script(['75']);
    expect(t.geom('43').contrast).toBe(75);
    expect(t.geom('40').contrast).toBe(100);
  });

  it('turns Monochrome and AdjustColorForBackground on and off (DXF 280 bits 4 and 8)', async () => {
    const t = drawing();
    await start(t, { x: 95, y: 95 }, { x: 105, y: 105 });
    await t.bus.script(['M']);
    expect(t.bus.promptText).toBe('Enter monochrome setting [Yes/No] <No>:');
    await t.bus.script(['Y']);
    expect(t.geom('40').flags).toBe(14);
    await start(t, { x: 95, y: 95 }, { x: 105, y: 105 });
    await t.bus.script(['ACFB']);
    expect(t.bus.promptText).toBe('Enter adjust colors for background setting [Yes/No] <Yes>:');
    await t.bus.script(['N']);
    expect(t.geom('40').flags).toBe(6);
    await t.bus.script(['U']);
    expect(t.geom('40').flags).toBe(14);
    // The same setting again changes nothing and makes no undo step.
    await start(t, { x: 95, y: 95 }, { x: 105, y: 105 });
    await t.bus.script(['M', '']);
    await t.bus.script(['U']);
    expect(t.geom('40').flags).toBe(10);
  });

  it('ends without a change on Escape, or on Enter at an unchanged value', async () => {
    const t = drawing();
    await start(t, { x: 95, y: 95 }, { x: 105, y: 105 });
    await t.bus.cancel();
    await start(t, { x: 95, y: 95 }, { x: 105, y: 105 });
    await t.bus.script(['C']);
    await t.bus.cancel();
    await start(t, { x: 95, y: 95 }, { x: 105, y: 105 });
    await t.bus.script(['M']);
    await t.bus.cancel();
    await start(t, { x: 95, y: 95 }, { x: 105, y: 105 });
    await t.bus.script(['F', '']);
    expect(t.bus.command).toBeUndefined();
    expect(t.geom('40')).toMatchObject({ flags: 10, contrast: 100, fade: 0 });
    await t.bus.script(['PDFADJUST', '']);
    expect(t.bus.command).toBeUndefined();
  });

  it('ends when nothing selected is a PDF underlay', async () => {
    const t = drawing();
    await start(t, { x: -1, y: -1 }, { x: 11, y: 1 });
    expect(t.log).toContain('1 object is not a PDF underlay.');
    expect(t.bus.command).toBeUndefined();
  });
});
