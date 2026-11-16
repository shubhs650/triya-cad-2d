// M3-12 part 6: COMMANDPREVIEW (AutoCAD 2024 Help, "COMMANDPREVIEW (System Variable)": "a preview
// of the possible outcome of certain commands"). TRIM, EXTEND, FILLET, CHAMFER, LENGTHEN, BREAK
// and OFFSET put a preview source on the prompt that waits for the pick (point); asked at a
// cursor position, it gives the objects the pick would change (faded) and the shapes they and
// any new object would take, which are the shapes the pick then makes. Asking edits nothing.
// TRIM's freehand fence (Quick mode, press and drag) is here too.
import { describe, expect, it } from 'vitest';
import {
  type CommandPreview,
  type EntityGeometry,
  type PreviewQuery,
  type Vec2,
} from '../../src/index';
import { r6, setup } from './edit-harness';

type Bus = ReturnType<typeof setup>['bus'];

/** The current prompt's preview at `q`; fails when the prompt has none. */
async function previewAt(bus: Bus, q: PreviewQuery): Promise<CommandPreview | undefined> {
  if (!bus.prompt?.commandPreview) throw new Error(`no preview at "${bus.promptText}"`);
  return bus.commandPreview(q);
}

/** A geometry's numbers rounded, for comparing shapes. */
function shape(g: EntityGeometry): unknown {
  return JSON.parse(JSON.stringify(g), (_k, v: unknown) => (typeof v === 'number' ? r6(v) : v));
}

const shapes = (p: CommandPreview | undefined) =>
  (p?.shapes ?? []).map((s) => JSON.stringify(shape(s.geom))).sort();

describe('COMMANDPREVIEW', () => {
  it('TRIM previews the part a pick would trim, faded, and what is left, without editing', async () => {
    const t = setup([
      { kind: 'LINE', start: { x: 3, y: -5 }, end: { x: 3, y: 5 } },
      { kind: 'LINE', start: { x: 7, y: -5 }, end: { x: 7, y: 5 } },
    ]);
    const line = t.byHandle('30')!;
    await t.bus.script(['TRIM']);
    expect(t.bus.prompt?.commandPreview?.hover).toBe(true);
    const p = await previewAt(t.bus, { cursor: { x: 5, y: 0 }, hits: [line.id] });
    expect(p?.faded).toEqual([line.id]);
    expect(p?.shapes.map((s) => s.props.layer)).toEqual([line.layer, line.layer]);
    // Nothing changed yet.
    expect(t.byHandle('30')!.geom).toBe(line.geom);
    const want = shapes(p);
    await t.bus.pick({ x: 5, y: 0 });
    const made = t
      .space()
      .filter((e) => e.geom.kind === 'LINE' && e.layer === line.layer)
      .map((e) => JSON.stringify(shape(e.geom)))
      .sort();
    expect(want).toEqual(made);
    expect(want).toHaveLength(2);
  });

  it('TRIM previews an extension with Shift held, a deletion in Quick mode, and nothing off objects', async () => {
    const t = setup([{ kind: 'LINE', start: { x: 12, y: -5 }, end: { x: 12, y: 5 } }]);
    const line = t.byHandle('30')!;
    await t.bus.script(['TRIM']);
    // Shift: EXTEND's work, the line's end carried to the vertical at x = 12.
    const ext = await previewAt(t.bus, { cursor: { x: 9, y: 0 }, hits: [line.id], shift: true });
    expect(ext?.faded).toEqual([line.id]);
    expect(ext?.shapes.map((s) => shape(s.geom))).toEqual([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 12, y: 0 } },
    ]);
    // The circle crosses nothing: Quick mode would delete it, so it shows faded with no shape.
    const circle = t.byHandle('31')!;
    const del = await previewAt(t.bus, { cursor: { x: 55, y: 0 }, hits: [circle.id] });
    expect(del).toEqual({ faded: [circle.id], shapes: [] });
    expect(await previewAt(t.bus, { cursor: { x: 30, y: 30 }, hits: [] })).toBeUndefined();
  });

  it('EXTEND previews the extension, and nothing for an object no edge is ahead of', async () => {
    const t = setup([{ kind: 'LINE', start: { x: 12, y: -5 }, end: { x: 12, y: 5 } }]);
    const line = t.byHandle('30')!;
    await t.bus.script(['EXTEND']);
    const p = await previewAt(t.bus, { cursor: { x: 9, y: 0 }, hits: [line.id] });
    expect(p?.shapes.map((s) => shape(s.geom))).toEqual([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 12, y: 0 } },
    ]);
    // Picked near its start, nothing is that way.
    expect(await previewAt(t.bus, { cursor: { x: 1, y: 0 }, hits: [line.id] })).toBeUndefined();
  });

  it('FILLET previews the fillet as the cursor hovers over the second object; Shift a sharp corner', async () => {
    const t = setup([{ kind: 'LINE', start: { x: 12, y: 2 }, end: { x: 12, y: 10 } }]);
    const a = t.byHandle('30')!;
    const b = t.byHandle('40')!;
    await t.bus.script(['FILLET', 'R', '1']);
    await t.bus.pick({ x: 5, y: 0 });
    expect(t.bus.prompt?.commandPreview?.hover).toBe(true);
    const sharp = await previewAt(t.bus, { cursor: { x: 12, y: 6 }, hits: [b.id], shift: true });
    expect(shapes(sharp)).toEqual(
      [
        { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 12, y: 0 } },
        { kind: 'LINE', start: { x: 12, y: 0 }, end: { x: 12, y: 10 } },
      ]
        .map((g) => JSON.stringify(g))
        .sort(),
    );
    // Hovering the first object again previews nothing (it cannot be filleted to itself).
    expect(await previewAt(t.bus, { cursor: { x: 6, y: 0 }, hits: [a.id] })).toBeUndefined();
    const p = await previewAt(t.bus, { cursor: { x: 12, y: 6 }, hits: [b.id] });
    expect([...(p?.faded ?? [])].sort()).toEqual([a.id, b.id].sort());
    expect(p?.shapes.map((s) => s.geom.kind).sort()).toEqual(['ARC', 'LINE', 'LINE']);
    const want = shapes(p);
    await t.bus.pick({ x: 12, y: 6 });
    const made = t
      .space()
      .filter((e) => e.id === a.id || e.id === b.id || e.geom.kind === 'ARC')
      .map((e) => JSON.stringify(shape(e.geom)))
      .sort();
    expect(made).toEqual(want);
  });

  it('CHAMFER previews the chamfer line and the trimmed lines', async () => {
    const t = setup([{ kind: 'LINE', start: { x: 12, y: 2 }, end: { x: 12, y: 10 } }]);
    await t.bus.script(['CHAMFER', 'D', '1', '1']);
    await t.bus.pick({ x: 5, y: 0 });
    const b = t.byHandle('40')!;
    const p = await previewAt(t.bus, { cursor: { x: 12, y: 6 }, hits: [b.id] });
    expect(shapes(p)).toEqual(
      [
        { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 11, y: 0 } },
        { kind: 'LINE', start: { x: 12, y: 1 }, end: { x: 12, y: 10 } },
        { kind: 'LINE', start: { x: 11, y: 0 }, end: { x: 12, y: 1 } },
      ]
        .map((g) => JSON.stringify(g))
        .sort(),
    );
  });

  it('OFFSET previews the offset on the cursor side, through the cursor, and the source erased', async () => {
    const t = setup();
    const line = t.byHandle('30')!;
    await t.bus.script(['OFFSET', '2']);
    // The object prompt shows nothing yet: the side prompt does.
    await t.bus.pick({ x: 5, y: 0 });
    expect(t.bus.prompt?.commandPreview?.hover).toBeUndefined();
    const up = await previewAt(t.bus, { cursor: { x: 5, y: 7 }, hits: [] });
    expect(up?.faded).toEqual([]);
    expect(up?.shapes.map((s) => shape(s.geom))).toEqual([
      { kind: 'LINE', start: { x: 0, y: 2 }, end: { x: 10, y: 2 } },
    ]);
    expect(up?.shapes[0]!.props.layer).toBe(line.layer);
    const down = await previewAt(t.bus, { cursor: { x: 5, y: -1 }, hits: [] });
    expect(down?.shapes.map((s) => shape(s.geom))).toEqual([
      { kind: 'LINE', start: { x: 0, y: -2 }, end: { x: 10, y: -2 } },
    ]);
    // On the line itself no side is given.
    expect(await previewAt(t.bus, { cursor: { x: 5, y: 0 }, hits: [] })).toBeUndefined();
    await t.bus.submit('');
    await t.bus.submit('');

    await t.bus.script(['OFFSET', 'E', 'Y', 'T']);
    await t.bus.pick({ x: 5, y: 0 });
    const through = await previewAt(t.bus, { cursor: { x: 4, y: 3.5 }, hits: [] });
    expect(through?.faded).toEqual([line.id]);
    expect(through?.shapes.map((s) => shape(s.geom))).toEqual([
      { kind: 'LINE', start: { x: 0, y: 3.5 }, end: { x: 10, y: 3.5 } },
    ]);
  });

  it('BREAK previews the gap from the first point to the cursor', async () => {
    const t = setup();
    const line = t.byHandle('30')!;
    await t.bus.script(['BREAK']);
    await t.bus.pick({ x: 2, y: 0 });
    const p = await previewAt(t.bus, { cursor: { x: 6, y: 1 }, hits: [] });
    expect(p?.faded).toEqual([line.id]);
    expect(shapes(p)).toEqual(
      [
        { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
        { kind: 'LINE', start: { x: 6, y: 0 }, end: { x: 10, y: 0 } },
      ]
        .map((g) => JSON.stringify(g))
        .sort(),
    );
    // The First point option's second prompt previews from the point given.
    await t.bus.script(['F', '8,0']);
    const q = await previewAt(t.bus, { cursor: { x: 12, y: 0 }, hits: [] });
    expect(q?.shapes.map((s) => shape(s.geom))).toEqual([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 8, y: 0 } },
    ]);
  });

  it('LENGTHEN previews the change at the end nearer the cursor, and DYnamic the new end', async () => {
    const t = setup();
    const line = t.byHandle('30')!;
    await t.bus.script(['LENGTHEN', 'DE', '2']);
    expect(t.bus.prompt?.commandPreview?.hover).toBe(true);
    const p = await previewAt(t.bus, { cursor: { x: 9, y: 0 }, hits: [line.id] });
    expect(p?.faded).toEqual([line.id]);
    expect(p?.shapes.map((s) => shape(s.geom))).toEqual([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 12, y: 0 } },
    ]);
    const q = await previewAt(t.bus, { cursor: { x: 1, y: 0 }, hits: [line.id] });
    expect(q?.shapes.map((s) => shape(s.geom))).toEqual([
      { kind: 'LINE', start: { x: -2, y: 0 }, end: { x: 10, y: 0 } },
    ]);
    await t.bus.submit('');
    await t.bus.script(['LENGTHEN', 'DY']);
    await t.bus.pick({ x: 9, y: 0 });
    const d = await previewAt(t.bus, { cursor: { x: 15, y: 3 }, hits: [] });
    expect(d?.shapes.map((s) => shape(s.geom))).toEqual([
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 15, y: 0 } },
    ]);
  });
});

describe("TRIM's freehand fence", () => {
  const verticals = (): EntityGeometry[] => [
    { kind: 'LINE', start: { x: 3, y: -5 }, end: { x: 3, y: 5 } },
    { kind: 'LINE', start: { x: 7, y: -5 }, end: { x: 7, y: 5 } },
  ];

  it('a press on nothing dragged and let go trims what the path crosses (Quick mode)', async () => {
    const t = setup(verticals());
    await t.bus.script(['TRIM']);
    await t.bus.pick({ x: 5, y: -1 });
    expect(t.bus.prompt).toMatchObject({ kind: 'point', rubberBand: { freehand: true } });
    const path: Vec2[] = [
      { x: 5, y: -1 },
      { x: 5, y: 1 },
      { x: 9, y: 1 },
      { x: 9, y: -1 },
    ];
    await t.bus.pick({ x: 9, y: -1 }, { release: true, freehand: path });
    // The line is cut at x = 5 (between the verticals) and at x = 9 (past x = 7): what is left
    // of it is (0,0)-(3,0), and the vertical at x = 7 crossed at y = 1 loses its top half.
    const lines = t
      .space()
      .filter((e) => e.geom.kind === 'LINE')
      .map((e) => t.ends(e));
    expect(lines).toContainEqual([0, 0, 3, 0]);
    expect(lines).not.toContainEqual([7, 0, 10, 0]);
    expect(lines).toContainEqual([7, -5, 7, 0]);
    expect(t.bus.promptText).toMatch(/^Select object to trim/);
  });

  it("a let go without a path is the fence's second point, as before", async () => {
    const t = setup(verticals());
    await t.bus.script(['TRIM']);
    await t.bus.pick({ x: 5, y: -1 });
    // A release with no path does nothing; a click gives the second point.
    await t.bus.pick({ x: 5, y: 1 }, { release: true });
    expect(t.bus.promptText).toMatch(/^Specify next fence point/);
    await t.bus.pick({ x: 5, y: 1 });
    expect(t.byHandle('30')!.geom).toMatchObject({ end: { x: 3, y: 0 } });
  });

  it('Standard mode keeps its crossing window: no freehand fence', async () => {
    const t = setup(verticals());
    await t.bus.script(['TRIM', 'O', 'S', '']);
    await t.bus.pick({ x: 5, y: -1 });
    expect(t.bus.prompt).toMatchObject({ kind: 'point', rubberBand: { box: true } });
    expect((t.bus.prompt as { rubberBand?: { freehand?: true } }).rubberBand?.freehand).toBe(
      undefined,
    );
  });
});

// M3-12 part 7: the preview along a fence or crossing window, the cursor as its last point
// (opposite corner): what each object it crosses would become, as the fence (window) then makes
// it, with nothing edited before.
describe('COMMANDPREVIEW along a fence or crossing window', () => {
  const verticals = (): EntityGeometry[] => [
    { kind: 'LINE', start: { x: 3, y: -5 }, end: { x: 3, y: 5 } },
    { kind: 'LINE', start: { x: 7, y: -5 }, end: { x: 7, y: 5 } },
  ];
  const lineShapes = (t: ReturnType<typeof setup>) =>
    t
      .space()
      .filter((e) => e.geom.kind === 'LINE')
      .map((e) => JSON.stringify(shape(e.geom)))
      .sort();

  it("previews Quick mode's fence to the cursor, as the fence then trims", async () => {
    const t = setup(verticals());
    await t.bus.script(['TRIM']);
    await t.bus.pick({ x: 5, y: -1 });
    expect(t.bus.prompt?.commandPreview?.hover).toBeUndefined();
    const before = lineShapes(t);
    const p = await previewAt(t.bus, { cursor: { x: 5, y: 1 }, hits: [] });
    // Only the horizontal line is crossed: its middle third between the verticals goes.
    expect(p?.faded).toEqual([t.byHandle('30')!.id]);
    expect(lineShapes(t)).toEqual(before);
    const unchanged = before.filter((s) => !s.includes('"y":0}') || s.includes('"y":-5'));
    await t.bus.pick({ x: 5, y: 1 });
    const after = lineShapes(t);
    expect([...unchanged, ...shapes(p)].sort()).toEqual(after);
  });

  it('previews each crossing of a fence in turn, one object cut twice', async () => {
    const t = setup(verticals());
    await t.bus.script(['TRIM', 'O', 'S', '', 'F']);
    await t.bus.pick({ x: 5, y: -1 });
    await t.bus.pick({ x: 5, y: 1 });
    await t.bus.pick({ x: 9, y: 1 });
    // On to (9,-1): the line is cut at x = 5, then its piece past x = 7 found again at x = 9
    // (Standard mode keeps it: no edge crosses it there), and the vertical at x = 7 at y = 1.
    const p = await previewAt(t.bus, { cursor: { x: 9, y: -1 }, hits: [] });
    expect(p?.faded).toHaveLength(2);
    expect(shapes(p)).toEqual(
      [
        { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 3, y: 0 } },
        { kind: 'LINE', start: { x: 7, y: 0 }, end: { x: 10, y: 0 } },
        { kind: 'LINE', start: { x: 7, y: -5 }, end: { x: 7, y: 0 } },
      ]
        .map((g) => JSON.stringify(g))
        .sort(),
    );
    const want = shapes(p);
    await t.bus.pick({ x: 9, y: -1 });
    await t.bus.submit('');
    for (const s of want) expect(lineShapes(t)).toContain(s);
  });

  it("previews Standard mode's crossing window, and EXTEND's, and nothing for an empty one", async () => {
    const t = setup(verticals());
    await t.bus.script(['TRIM', 'O', 'S', '']);
    await t.bus.pick({ x: 4, y: -1 });
    const p = await previewAt(t.bus, { cursor: { x: 6, y: 1 }, hits: [] });
    expect(shapes(p)).toEqual(
      [
        { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 3, y: 0 } },
        { kind: 'LINE', start: { x: 7, y: 0 }, end: { x: 10, y: 0 } },
      ]
        .map((g) => JSON.stringify(g))
        .sort(),
    );
    expect(await previewAt(t.bus, { cursor: { x: 4, y: -1 }, hits: [] })).toBeUndefined();
    expect(await previewAt(t.bus, { cursor: { x: 4.5, y: -0.5 }, hits: [] })).toBeUndefined();
    const want = shapes(p);
    await t.bus.pick({ x: 6, y: 1 });
    for (const s of want) expect(lineShapes(t)).toContain(s);

    const x = setup([{ kind: 'LINE', start: { x: 12, y: -5 }, end: { x: 12, y: 5 } }]);
    await x.bus.script(['EXTEND', 'O', 'S', '']);
    await x.bus.pick({ x: 9, y: -1 });
    const ext = await previewAt(x.bus, { cursor: { x: 10.5, y: 1 }, hits: [] });
    expect(shapes(ext)).toEqual([
      JSON.stringify({ kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 12, y: 0 } }),
    ]);
  });
});
