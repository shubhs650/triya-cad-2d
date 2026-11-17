// M5-04 part 4: the image commands on the PromptBus, with AutoCAD 2024's prompts (AutoCAD Help,
// "IMAGECLIP (Command)", "-IMAGEADJUST (Command)", "IMAGEQUALITY (Command)", "IMAGEFRAME (System
// Variable)"): IMAGECLIP's New boundary (Rectangular, Polygonal, Select polyline, Invert clip),
// ON, OFF and Delete; IMAGEADJUST's Brightness, Contrast and Fade; IMAGEQUALITY; IMAGEFRAME 0, 1
// and 2. Each is one undo step, written as the save writes it (io export/entities.ts IMAGE, DXF
// 14/71/280/290 and 281–283; export/image-objects.ts RASTERVARIABLES 70/71).
import { describe, expect, it } from 'vitest';
import {
  imageFrame,
  type EntityGeometry,
  type ImageDefinition,
  type ImageGeometry,
  type NonGraphicalObject,
  type RasterVariables,
  type Vec2,
} from '../../src/index';
import { r6, setup } from './edit-harness';

const ROOT = 'C';
const IMAGEDEF: ImageDefinition = {
  type: 'IMAGEDEF',
  handle: '90',
  owner: ROOT,
  name: 'photo',
  fileName: 'photo.png',
  size: { x: 200, y: 100 },
  pixelSize: { x: 0.1, y: 0.1 },
  loaded: true,
  units: 0,
};

/**
 * A 200 × 100 pixel image whose pixels are 0.1 square, its lower-left corner at `at`, turned
 * `angle`: unturned at 100,100 it covers 100–120 by 100–110.
 */
function image(at: Vec2, angle = 0, o: Partial<ImageGeometry> = {}): EntityGeometry {
  const c = Math.cos(angle) * 0.1;
  const s = Math.sin(angle) * 0.1;
  return {
    kind: 'IMAGE',
    definition: '90',
    position: at,
    u: { x: c, y: s },
    v: { x: -s, y: c },
    size: { x: 200, y: 100 },
    displayFlags: 7,
    clipping: false,
    brightness: 50,
    contrast: 50,
    fade: 0,
    clip: {
      type: 'rectangle',
      vertices: [
        { x: -0.5, y: -0.5 },
        { x: 199.5, y: 99.5 },
      ],
      inverted: false,
    },
    ...o,
  } as EntityGeometry;
}

/**
 * The harness drawing (line 30, circle 31) with image 40 at 100,100, image 41 at 200,100 turned
 * 45°, and whatever `extra` adds (handles 42 on); its root dictionary is C.
 */
function drawing(extra: EntityGeometry[] = [], objects: NonGraphicalObject[] = []) {
  const t = setup([image({ x: 100, y: 100 }), image({ x: 200, y: 100 }, Math.PI / 4), ...extra], {
    objects: [IMAGEDEF, ...objects],
    meta: { rootDictionary: ROOT },
  });
  const geom = (h: string) => t.byHandle(h)!.geom as ImageGeometry;
  const clip = (h: string) => {
    const c = geom(h).clip;
    return { ...c, vertices: c.vertices.map((p) => [r6(p.x), r6(p.y)]) };
  };
  /** Starts IMAGECLIP on the image whose frame passes through `at`. */
  const imageclip = async (at: Vec2) => {
    await t.bus.submit('IMAGECLIP');
    await t.bus.pick(at);
  };
  const raster = () =>
    [...t.model.objects.values()].find((o): o is RasterVariables => o.type === 'RASTERVARIABLES');
  return { ...t, geom, clip, imageclip, raster };
}

/** A point on image 40's bottom edge, and one on image 41's. */
const ON_40 = { x: 110, y: 100 };
const ON_41 = { x: 200 + 10 * Math.SQRT1_2, y: 100 + 10 * Math.SQRT1_2 };

describe('IMAGECLIP New boundary', () => {
  it('clips an image to a rectangle, in pixel coordinates centred on pixels, V down from the top', async () => {
    const t = drawing();
    await t.imageclip(ON_40);
    expect(t.bus.promptText).toBe(
      'Enter image clipping option [ON/OFF/Delete/New boundary] <New>:',
    );
    await t.bus.submit('');
    expect(t.log).toContain('Outside mode - Objects outside boundary will be hidden.');
    expect(t.bus.promptText).toBe(
      'Specify clipping boundary or select invert option [Select polyline/Polygonal/Rectangular/Invert clip] <Rectangular>:',
    );
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Specify first corner:');
    await t.bus.submit('105,108');
    expect(t.bus.promptText).toBe('Specify opposite corner:');
    await t.bus.submit('110,102');
    expect(t.bus.command).toBeUndefined();
    // World 105,108 is pixel column 50 and row 20 from the top: 49.5,19.5 centred on pixels.
    expect(t.clip('40')).toEqual({
      type: 'rectangle',
      vertices: [
        [49.5, 19.5],
        [99.5, 79.5],
      ],
      inverted: false,
    });
    expect(t.geom('40').clipping).toBe(true);
    expect(t.geom('40').displayFlags & 4).toBe(4);
    // The other image is left alone.
    expect(t.geom('41').clipping).toBe(false);
  });

  it('is one undo step', async () => {
    const t = drawing();
    await t.imageclip(ON_40);
    await t.bus.script(['N', 'R', '105,108', '110,102']);
    expect(t.geom('40').clipping).toBe(true);
    await t.bus.script(['U']);
    expect(t.geom('40').clipping).toBe(false);
    expect(t.clip('40').vertices).toEqual([
      [-0.5, -0.5],
      [199.5, 99.5],
    ]);
  });

  it('keeps a rectangle to the image: a boundary beyond it is cut at its edges', async () => {
    const t = drawing();
    await t.imageclip(ON_40);
    await t.bus.script(['N', 'R', '90,90', '110,105']);
    expect(t.clip('40').vertices).toEqual([
      [-0.5, 49.5],
      [99.5, 99.5],
    ]);
  });

  it('refuses a boundary that misses the image, and asks again', async () => {
    const t = drawing();
    await t.imageclip(ON_40);
    await t.bus.script(['N', 'R', '0,0', '10,10']);
    expect(t.log.at(-1)).toBe('The clipping boundary must overlap the image.');
    expect(t.bus.promptText).toBe('Specify first corner:');
    await t.bus.script(['101,101', '102,102']);
    expect(t.geom('40').clipping).toBe(true);
  });

  it('clips to a polygon, AutoCAD repeating its first vertex at the end', async () => {
    const t = drawing();
    await t.imageclip(ON_40);
    await t.bus.script(['N', 'P', '100,100', '120,100', '110,110', '']);
    expect(t.clip('40')).toEqual({
      type: 'polygon',
      vertices: [
        [-0.5, 99.5],
        [199.5, 99.5],
        [99.5, -0.5],
        [-0.5, 99.5],
      ],
      inverted: false,
    });
    expect(t.geom('40').clipping).toBe(true);
  });

  it('cuts a polygon at the image’s edges', async () => {
    const t = drawing();
    await t.imageclip(ON_40);
    await t.bus.script(['N', 'P', '110,95', '125,105', '110,115', '']);
    const v = t.clip('40').vertices;
    expect(v.at(0)).toEqual(v.at(-1));
    // Every vertex inside the image, the shape the triangle and the image share.
    for (const [x, y] of v) {
      expect(x).toBeGreaterThanOrEqual(-0.5);
      expect(x).toBeLessThanOrEqual(199.5);
      expect(y).toBeGreaterThanOrEqual(-0.5);
      expect(y).toBeLessThanOrEqual(99.5);
    }
    // 110,100, 117.5,100, 120,101.67, 120,108.33, 117.5,110 and 110,110.
    expect(v.length - 1).toBe(6);
  });

  it('clips to a polyline selected', async () => {
    const t = drawing([
      {
        kind: 'LWPOLYLINE',
        closed: false,
        vertices: [
          { x: 102, y: 102, bulge: 0 },
          { x: 108, y: 102, bulge: 0 },
          { x: 108, y: 108, bulge: 0 },
        ],
      } as EntityGeometry,
    ]);
    await t.imageclip(ON_40);
    await t.bus.script(['N', 'S']);
    expect(t.bus.promptText).toBe('Select polyline:');
    await t.bus.pick({ x: 105, y: 102 });
    expect(t.clip('40')).toEqual({
      type: 'polygon',
      vertices: [
        [19.5, 79.5],
        [79.5, 79.5],
        [79.5, 19.5],
        [19.5, 79.5],
      ],
      inverted: false,
    });
  });

  it('Invert clip hides what lies inside the boundary (DXF 290)', async () => {
    const t = drawing();
    await t.imageclip(ON_40);
    await t.bus.script(['N', 'I']);
    expect(t.log.at(-1)).toBe('Inside mode - Objects inside boundary will be hidden.');
    expect(t.bus.promptText).toBe(
      'Specify clipping boundary or select invert option [Select polyline/Polygonal/Rectangular/Invert clip] <Rectangular>:',
    );
    await t.bus.script(['I']);
    expect(t.log.at(-1)).toBe('Outside mode - Objects outside boundary will be hidden.');
    await t.bus.script(['I', 'R', '105,108', '110,102']);
    expect(t.clip('40').inverted).toBe(true);
  });

  it('stores a turned image’s rectangle as the polygon it is in the image’s pixels', async () => {
    const t = drawing();
    await t.imageclip(ON_41);
    // Image 41 runs at 45° from 200,100; a square on the world's axes about a point inside it.
    const c = { x: 200 + 5 * Math.SQRT1_2, y: 100 + 15 * Math.SQRT1_2 };
    await t.bus.script(['N', 'R', `${c.x - 1},${c.y - 1}`, `${c.x + 1},${c.y + 1}`]);
    const k = t.clip('41');
    expect(k.type).toBe('polygon');
    expect(k.vertices).toHaveLength(5);
    // Its centre is pixel column 100 and row 50 from the top: 99.5, 49.5 less a half.
    const mid = k.vertices
      .slice(0, 4)
      .reduce((a, [x, y]) => [a[0]! + x! / 4, a[1]! + y! / 4], [0, 0]);
    expect(mid.map(r6)).toEqual([99.5, 49.5]);
  });

  it('asks before replacing a boundary, and keeps it on No', async () => {
    const t = drawing();
    await t.imageclip(ON_40);
    await t.bus.script(['N', 'R', '105,108', '110,102']);
    await t.imageclip(ON_40);
    await t.bus.script(['N']);
    expect(t.bus.promptText).toBe('Delete old boundary? [Yes/No] <Yes>:');
    await t.bus.script(['N']);
    expect(t.bus.command).toBeUndefined();
    expect(t.clip('40').vertices).toEqual([
      [49.5, 19.5],
      [99.5, 79.5],
    ]);
    await t.imageclip(ON_40);
    await t.bus.script(['N', '', 'R', '101,101', '102,102']);
    expect(t.clip('40').vertices).toEqual([
      [9.5, 79.5],
      [19.5, 89.5],
    ]);
  });

  it('takes images only', async () => {
    const t = drawing();
    await t.bus.submit('IMAGECLIP');
    expect(t.bus.promptText).toBe('Select image to clip:');
    await t.bus.pick({ x: 5, y: 0 });
    expect(t.log.at(-1)).toBe('Object is not an image.');
    expect(t.bus.promptText).toBe('Select image to clip:');
    await t.bus.pick(ON_40);
    expect(t.bus.promptText).toBe(
      'Enter image clipping option [ON/OFF/Delete/New boundary] <New>:',
    );
  });
});

describe('IMAGECLIP ON, OFF and Delete', () => {
  it('turns clipping off and on, keeping the boundary', async () => {
    const t = drawing();
    await t.imageclip(ON_40);
    await t.bus.script(['N', 'R', '105,108', '110,102']);
    await t.imageclip(ON_40);
    await t.bus.script(['OFF']);
    expect(t.geom('40').clipping).toBe(false);
    expect(t.clip('40').vertices).toEqual([
      [49.5, 19.5],
      [99.5, 79.5],
    ]);
    await t.imageclip(ON_40);
    await t.bus.script(['ON']);
    expect(t.geom('40').clipping).toBe(true);
  });

  it('Delete brings the whole image back', async () => {
    const t = drawing();
    await t.imageclip(ON_40);
    await t.bus.script(['N', 'I', 'P', '100,100', '120,100', '110,110', '']);
    await t.imageclip(ON_40);
    await t.bus.script(['D']);
    expect(t.geom('40').clipping).toBe(false);
    expect(t.clip('40')).toEqual({
      type: 'rectangle',
      vertices: [
        [-0.5, -0.5],
        [199.5, 99.5],
      ],
      inverted: false,
    });
  });
});

describe('IMAGEADJUST', () => {
  it('sets the brightness of every image selected, as -IMAGEADJUST asks', async () => {
    const t = drawing();
    await t.bus.submit('IMAGEADJUST');
    expect(t.bus.promptText).toBe('Select image(s):');
    // A crossing window over both images' insertion points, line 30 and circle 31.
    await t.bus.pick({ x: 250, y: 120 });
    await t.bus.pick({ x: 5, y: -1 });
    await t.bus.submit('');
    expect(t.log).toContain('2 objects are not images.');
    expect(t.bus.promptText).toBe(
      'Enter image adjust option [Contrast/Fade/Brightness] <Brightness>:',
    );
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Enter brightness value (0-100) <50>:');
    await t.bus.submit('101');
    expect(t.log.at(-1)).toBe('Value must be between 0 and 100.');
    await t.bus.submit('70');
    expect(t.geom('40').brightness).toBe(70);
    expect(t.geom('41').brightness).toBe(70);
    await t.bus.script(['U']);
    expect(t.geom('40').brightness).toBe(50);
  });

  it('sets contrast and fade, the first image’s value offered', async () => {
    const t = drawing([image({ x: 300, y: 100 }, 0, { contrast: 20, fade: 35 })]);
    /** Starts `name` on image 42 alone, by a window around its insertion point. */
    const start = async (name: string) => {
      await t.bus.submit(name);
      await t.bus.pick({ x: 295, y: 95 });
      await t.bus.pick({ x: 305, y: 105 });
      await t.bus.submit('');
    };
    await start('-IMAGEADJUST');
    await t.bus.script(['C']);
    expect(t.bus.promptText).toBe('Enter contrast value (0-100) <20>:');
    await t.bus.script(['80']);
    expect(t.geom('42').contrast).toBe(80);
    await start('IAD');
    await t.bus.script(['F']);
    expect(t.bus.promptText).toBe('Enter fade value (0-100) <35>:');
    await t.bus.script(['']);
    expect(t.geom('42').fade).toBe(35);
    await start('IAD');
    await t.bus.script(['F', '10']);
    expect(t.geom('42').fade).toBe(10);
    expect(t.geom('40').fade).toBe(0);
  });
});

describe('IMAGEQUALITY and IMAGEFRAME', () => {
  it('IMAGEQUALITY keeps Draft in the drawing’s RASTERVARIABLES, made when it has none', async () => {
    const t = drawing();
    await t.bus.submit('IMAGEQUALITY');
    expect(t.bus.promptText).toBe('Enter image quality setting [High/Draft] <High>:');
    await t.bus.submit('');
    expect(t.raster()).toBeUndefined();
    await t.bus.script(['IMAGEQUALITY', 'D']);
    expect(t.raster()).toMatchObject({ owner: ROOT, quality: 'draft', frame: 1, units: 0 });
    await t.bus.script(['IMAGEQUALITY']);
    expect(t.bus.promptText).toBe('Enter image quality setting [High/Draft] <Draft>:');
    await t.bus.script(['H']);
    expect(t.raster()!.quality).toBe('high');
  });

  it('IMAGEFRAME is 0, 1 or 2, kept in RASTERVARIABLES', async () => {
    const vars: RasterVariables = {
      type: 'RASTERVARIABLES',
      handle: '91',
      owner: ROOT,
      frame: 1,
      quality: 'high',
      units: 1,
    };
    const t = drawing([], [vars]);
    expect(imageFrame(t.model)).toBe(1);
    await t.bus.script(['IMAGEFRAME']);
    expect(t.bus.promptText).toBe('Enter new value for IMAGEFRAME <1>:');
    await t.bus.script(['3']);
    expect(t.log.at(-1)).toBe('Value must be between 0 and 2.');
    await t.bus.script(['2']);
    expect(t.raster()).toMatchObject({ handle: '91', frame: 2, units: 1 });
    expect(imageFrame(t.model)).toBe(2);
    await t.bus.script(['U']);
    expect(imageFrame(t.model)).toBe(1);
  });

  it('IMAGEFRAME makes the RASTERVARIABLES a drawing without one needs', async () => {
    const t = drawing();
    await t.bus.script(['SETVAR', 'IMAGEFRAME', '1']);
    expect(t.raster()).toBeUndefined();
    await t.bus.script(['IMAGEFRAME', '0']);
    expect(t.raster()).toMatchObject({ owner: ROOT, frame: 0, quality: 'high' });
  });
});
