// M3-01 part 3: RECTANG and POLYGON scripted on the PromptBus (AutoCAD 2024 Help, "RECTANG
// (Command)", "POLYGON (Command)"): closed LWPOLYLINEs, RECTANG's Chamfer, Elevation, Fillet,
// Thickness and Width modes kept for the next rectangle, Area, Dimensions and Rotation;
// POLYGON's sides, Inscribed or Circumscribed about a centre, and Edge; both dragged.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  dragMotion,
  type Entity,
  type LwPolylineGeometry,
  type Prompt,
} from '../../src/index';
import { LAYER_WALLS, sampleInit } from '../model/fixtures';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const T8 = r6(Math.tan(Math.PI / 8));
const S3 = r6(5 * Math.sqrt(3));

function setup() {
  const model = DocumentModel.create(sampleInit());
  const before = new Set([...model.entities()].map((e) => e.id));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const pline = (i = 0): LwPolylineGeometry => {
    const e = added()[i];
    expect(e?.type).toBe('LWPOLYLINE');
    return e!.geom as LwPolylineGeometry;
  };
  const corners = (i = 0) => pline(i).vertices.map((v) => [r6(v.x), r6(v.y), r6(v.bulge)]);
  return { model, bus, added, pline, corners };
}

const dragged = (p: Prompt | undefined, x: number, y: number) =>
  p?.drag && (dragMotion(p.drag, { x, y })?.adding?.geom as LwPolylineGeometry | undefined);
const points = (g: LwPolylineGeometry | undefined) => g?.vertices.map((v) => [r6(v.x), r6(v.y)]);

describe('RECTANG', () => {
  it('draws a closed polyline from two corners with AutoCAD 2024 prompts', async () => {
    const { bus, added, pline, corners } = setup();
    await bus.submit('REC');
    expect(bus.promptText).toBe(
      'Specify first corner point or [Chamfer/Elevation/Fillet/Thickness/Width]:',
    );
    await bus.submit('0,0');
    expect(bus.promptText).toBe('Specify other corner point or [Area/Dimensions/Rotation]:');
    // The rectangle follows the cursor.
    expect(points(dragged(bus.prompt, 4, 3))).toEqual([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]);
    expect(dragged(bus.prompt, 4, 0)).toBeUndefined();
    await bus.submit('10,5');
    expect(bus.promptText).toBe('Command:');
    expect(added()).toHaveLength(1);
    expect(added()[0]).toMatchObject({ layer: LAYER_WALLS });
    expect(pline().closed).toBe(true);
    expect(corners()).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 5, 0],
      [0, 5, 0],
    ]);
    // Corners given the other way round go round the other way, from the first corner.
    await bus.script(['RECTANG', '0,0', '-4,3']);
    expect(corners(1)).toEqual([
      [0, 0, 0],
      [-4, 0, 0],
      [-4, 3, 0],
      [0, 3, 0],
    ]);
  });

  it('fillets the corners, and keeps the mode for the next rectangle', async () => {
    const { bus, corners } = setup();
    await bus.script(['REC', 'F']);
    expect(bus.promptText).toBe('Specify fillet radius for rectangles <0.0000>:');
    await bus.script(['1', '0,0', '10,5']);
    expect(corners()).toEqual([
      [0, 1, T8],
      [1, 0, 0],
      [9, 0, T8],
      [10, 1, 0],
      [10, 4, T8],
      [9, 5, 0],
      [1, 5, T8],
      [0, 4, 0],
    ]);
    await bus.submit('REC');
    expect(bus.history.at(-1)).toBe('Current rectangle modes:  Fillet=1.0000');
    // Too small for its fillets: drawn square.
    await bus.script(['0,0', '1.5,1.5']);
    expect(corners(1)).toEqual([
      [0, 0, 0],
      [1.5, 0, 0],
      [1.5, 1.5, 0],
      [0, 1.5, 0],
    ]);
    // Fillets that use up a side leave no straight piece there.
    await bus.script(['REC', '0,0', '2,5']);
    expect(corners(2)).toHaveLength(6);
  });

  it('chamfers the corners; Chamfer and Fillet replace each other', async () => {
    const { bus, corners } = setup();
    await bus.script(['REC', 'F', '2', 'C']);
    expect(bus.promptText).toBe('Specify first chamfer distance for rectangles <0.0000>:');
    await bus.submit('1');
    expect(bus.promptText).toBe('Specify second chamfer distance for rectangles <1.0000>:');
    await bus.script(['2', '0,0', '10,5']);
    expect(corners()).toEqual([
      [0, 1, 0],
      [2, 0, 0],
      [9, 0, 0],
      [10, 2, 0],
      [10, 4, 0],
      [8, 5, 0],
      [1, 5, 0],
      [0, 3, 0],
    ]);
    await bus.submit('REC');
    expect(bus.history.at(-1)).toBe('Current rectangle modes:  Chamfer=1.0000 x 2.0000');
    await bus.script(['F', '', 'F', '0']);
    expect(bus.history.at(-1)).toMatch(/^Specify fillet radius for rectangles <2\.0000>: 0$/);
    await bus.script(['0,0', '10,5']);
    expect(corners(1)).toHaveLength(4);
  });

  it('takes Width, Elevation and Thickness and lists them as the current modes', async () => {
    const { bus, pline } = setup();
    await bus.script(['REC', 'W']);
    expect(bus.promptText).toBe('Specify line width for rectangles <0.0000>:');
    await bus.script(['0.5', 'E']);
    expect(bus.promptText).toBe('Specify the elevation for rectangles <0.0000>:');
    await bus.script(['2', 'T']);
    expect(bus.promptText).toBe('Specify thickness for rectangles <0.0000>:');
    await bus.script(['3', '0,0']);
    expect(dragged(bus.prompt, 4, 3)).toMatchObject({ constantWidth: 0.5 });
    await bus.submit('4,3');
    expect(pline()).toMatchObject({ constantWidth: 0.5, elevation: 2, thickness: 3 });
    await bus.submit('REC');
    expect(bus.history.at(-1)).toBe(
      'Current rectangle modes:  Elevation=2.0000  Thickness=3.0000  Width=0.5000',
    );
  });

  it('draws by Area with a length or a width, counting the fillets', async () => {
    const { bus, corners } = setup();
    await bus.script(['REC', '0,0', 'A']);
    expect(bus.promptText).toBe('Enter area of rectangle in current units <100.0000>:');
    await bus.submit('50');
    expect(bus.promptText).toBe('Calculate rectangle dimensions based on [Length/Width] <Length>:');
    await bus.submit('');
    expect(bus.promptText).toBe('Enter rectangle length <10.0000>:');
    await bus.submit('');
    expect(corners()).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 5, 0],
      [0, 5, 0],
    ]);
    await bus.script(['REC', '0,0', 'A', '', 'W']);
    expect(bus.promptText).toBe('Enter rectangle width <5.0000>:');
    await bus.submit('2');
    expect(corners(1)[2]).toEqual([25, 2, 0]);
    // With fillets the area is what the rounded rectangle covers.
    await bus.script(['REC', 'F', '1', '0,0', 'A', '50', 'L', '10']);
    const w = (50 + (4 - Math.PI)) / 10;
    expect(corners(2)[4]).toEqual([10, r6(w - 1), T8]);
  });

  it('draws by Dimensions, the cursor choosing the side', async () => {
    const { bus, corners } = setup();
    await bus.script(['REC', '0,0', 'D']);
    expect(bus.promptText).toBe('Specify length for rectangles <10.0000>:');
    await bus.submit('8');
    expect(bus.promptText).toBe('Specify width for rectangles <10.0000>:');
    await bus.submit('3');
    expect(bus.promptText).toBe('Specify other corner point or [Area/Dimensions/Rotation]:');
    expect(points(dragged(bus.prompt, -1, 1))).toEqual([
      [0, 0],
      [-8, 0],
      [-8, 3],
      [0, 3],
    ]);
    await bus.submit('-1,-1');
    expect(corners()).toEqual([
      [0, 0, 0],
      [-8, 0, 0],
      [-8, -3, 0],
      [0, -3, 0],
    ]);
    await bus.script(['REC', '0,0', 'D']);
    expect(bus.promptText).toBe('Specify length for rectangles <8.0000>:');
  });

  it('turns the rectangle by Rotation, typed or by Pick points, for later ones too', async () => {
    const { bus, corners } = setup();
    await bus.script(['REC', '0,0', 'R']);
    expect(bus.promptText).toBe('Specify rotation angle or [Pick points] <0>:');
    await bus.submit('90');
    expect(bus.promptText).toBe('Specify other corner point or [Area/Dimensions/Rotation]:');
    await bus.submit('5,10');
    expect(corners()).toEqual([
      [0, 0, 0],
      [0, 10, 0],
      [5, 10, 0],
      [5, 0, 0],
    ]);
    await bus.submit('REC');
    expect(bus.history.at(-1)).toBe('Current rectangle modes:  Rotation=90');
    await bus.script(['0,0', 'R']);
    expect(bus.promptText).toBe('Specify rotation angle or [Pick points] <90>:');
    await bus.submit('P');
    expect(bus.promptText).toBe('Specify first point:');
    await bus.submit('0,0');
    expect(bus.promptText).toBe('Specify second point:');
    await bus.script(['1,1', 'R']);
    expect(bus.promptText).toBe('Specify rotation angle or [Pick points] <45>:');
  });

  it('draws nothing when cancelled', async () => {
    const { bus, added } = setup();
    await bus.script(['REC', '0,0']);
    await bus.cancel();
    await bus.script(['REC', '0,0', '0,5']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.cancel();
    expect(added()).toHaveLength(0);
  });
});

describe('POLYGON', () => {
  it('draws an inscribed polygon with its bottom edge level when the radius is typed', async () => {
    const { bus, corners, pline } = setup();
    await bus.submit('POL');
    expect(bus.promptText).toBe('Enter number of sides <4>:');
    await bus.submit('6');
    expect(bus.promptText).toBe('Specify center of polygon or [Edge]:');
    await bus.submit('0,0');
    expect(bus.promptText).toBe(
      'Enter an option [Inscribed in circle/Circumscribed about circle] <I>:',
    );
    await bus.submit('');
    expect(bus.promptText).toBe('Specify radius of circle:');
    await bus.submit('10');
    expect(pline().closed).toBe(true);
    expect(corners()).toEqual([
      [-5, -S3 * 1, 0],
      [5, -S3, 0],
      [10, 0, 0],
      [5, S3, 0],
      [-5, S3, 0],
      [-10, 0, 0],
    ]);
    // The sides and the option are the next defaults.
    await bus.submit('POLYGON');
    expect(bus.promptText).toBe('Enter number of sides <6>:');
  });

  it('turns the polygon to a picked radius: a vertex there, or an edge midpoint', async () => {
    const { bus, corners } = setup();
    await bus.script(['POL', '3', '0,0', 'I']);
    expect(points(dragged(bus.prompt, 10, 0))?.[0]).toEqual([10, 0]);
    await bus.submit('10,0');
    expect(corners()).toEqual([
      [10, 0, 0],
      [-5, S3, 0],
      [-5, -S3, 0],
    ]);
    await bus.script(['POL', '4', '0,0', 'C', '0,10']);
    expect(corners(1)).toEqual([
      [10, 10, 0],
      [-10, 10, 0],
      [-10, -10, 0],
      [10, -10, 0],
    ]);
    await bus.script(['POL', '', '0,0']);
    expect(bus.promptText).toBe(
      'Enter an option [Inscribed in circle/Circumscribed about circle] <C>:',
    );
  });

  it('draws on an Edge, counter-clockwise from its first endpoint', async () => {
    const { bus, corners } = setup();
    await bus.script(['POL', '4', 'E']);
    expect(bus.promptText).toBe('Specify first endpoint of edge:');
    await bus.submit('0,0');
    expect(bus.promptText).toBe('Specify second endpoint of edge:');
    expect(points(dragged(bus.prompt, 0, 5))).toEqual([
      [0, 0],
      [0, 5],
      [-5, 5],
      [-5, 0],
    ]);
    await bus.submit('10,0');
    expect(corners()).toEqual([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
    ]);
  });

  it('takes 3 to 1024 sides only, and a radius above zero', async () => {
    const { bus, added } = setup();
    await bus.script(['POL', '2']);
    expect(bus.history.at(-1)).toBe('Requires an integer between 3 and 1024.');
    expect(bus.promptText).toBe('Enter number of sides <4>:');
    await bus.script(['1025']);
    expect(bus.history.at(-1)).toBe('Requires an integer between 3 and 1024.');
    await bus.script(['5', '0,0', 'I', '0']);
    expect(bus.history.at(-1)).toBe('Value must be positive and nonzero.');
    expect(bus.promptText).toBe('Specify radius of circle:');
    await bus.cancel();
    await bus.script(['POL', '5', 'E', '1,1', '1,1']);
    expect(bus.history.at(-1)).toBe('*Invalid*');
    await bus.cancel();
    expect(added()).toHaveLength(0);
  });
});
