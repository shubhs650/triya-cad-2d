// M6-02 part 10: -VPORTS arranges model space's tiled viewports and saves, restores, lists and
// deletes named viewport configurations (AutoCAD 2024 Help, "-VPORTS - Model Space Viewports");
// in a layout it is MVIEW ("-VPORTS - Layout Viewports"), and MVIEW Restore lays a configuration
// out as layout viewports ("MVIEW (Command)").
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  INVALID_CONFIGURATION_NAME,
  JOIN_ITSELF,
  JOIN_NOT_RECTANGLE,
  JOIN_ONE_VIEWPORT,
  JOIN_PICK_VIEWPORT,
  NO_MATCHING_CONFIGURATIONS,
  NO_MODEL_VIEWPORT,
  PromptBus,
  builtinCommands,
  modelTiles,
  viewportConfigurations,
  type BusEvent,
  type Entity,
  type ViewHost,
  type ViewReply,
  type ViewRequest,
  type ViewState,
  type ViewportGeometry,
  type VportRecord,
} from '../../src/index';
import { MODEL_SPACE, PAPER_SPACE, sampleInit } from '../model/fixtures';

function vport(handle: string, name: string, o: Partial<VportRecord> = {}): VportRecord {
  return {
    handle,
    name,
    center: { x: 0, y: 0 },
    height: 10,
    direction: { x: 0, y: 0, z: 1 },
    target: { x: 0, y: 0, z: 0 },
    lensLength: 50,
    frontClip: 0,
    backClip: 0,
    twist: 0,
    viewMode: 0,
    renderMode: 0,
    lowerLeft: { x: 0, y: 0 },
    upperRight: { x: 1, y: 1 },
    aspectRatio: 2,
    snapBase: { x: 0, y: 0 },
    snapSpacing: { x: 5, y: 5 },
    snapRotation: 0,
    snapOn: false,
    isometricSnap: false,
    isometricPlane: 0,
    gridSpacing: { x: 5, y: 5 },
    gridOn: false,
    gridFlags: 0,
    gridMajor: 5,
    circleZoom: 1000,
    ucsIcon: 3,
    ucs: {
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      elevation: 0,
      orthographic: 0,
    },
    ...o,
  } as VportRecord;
}

/** Two tiles side by side (the left one current) and a saved configuration TWO of two tiles. */
const TILED: VportRecord[] = [
  vport('29', '*Active', { upperRight: { x: 0.5, y: 1 }, center: { x: 5, y: 5 }, aspectRatio: 1 }),
  vport('2A', '*Active', {
    lowerLeft: { x: 0.5, y: 0 },
    center: { x: 50, y: 50 },
    height: 20,
    aspectRatio: 1,
    snapSpacing: { x: 2, y: 2 },
  }),
  vport('2B', 'Two', { upperRight: { x: 1, y: 0.5 }, center: { x: 1, y: 2 }, height: 4 }),
  vport('2C', 'TWO', { lowerLeft: { x: 0, y: 0.5 }, center: { x: 3, y: 4 }, height: 8 }),
];

interface Options {
  vports?: VportRecord[];
  space?: string;
  /** What the canvas answers `tiles` with; nothing (a refusal) by default. */
  tiles?: { views: (ViewState | null)[]; current: number };
  answer?: (r: ViewRequest) => ViewReply | undefined;
}

function drawing(o: Options = {}) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    tables: { ...init.tables, vports: o.vports ?? [vport('29', '*Active')] },
  });
  const requests: ViewRequest[] = [];
  const view: ViewHost = {
    request: (r) => {
      requests.push(r);
      if (r.op === 'tiles' && o.tiles) return Promise.resolve({ ok: true, tiles: o.tiles });
      return Promise.resolve(o.answer?.(r) ?? { ok: false, message: 'no view' });
    },
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    space: () => o.space ?? MODEL_SPACE,
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const records = () => [...model.tables.vports.values()];
  const active = () => records().filter((v) => v.name === '*Active');
  const corners = (v: VportRecord) => [
    v.lowerLeft.x,
    v.lowerLeft.y,
    v.upperRight.x,
    v.upperRight.y,
  ];
  return { model, bus, log, requests, records, active, corners };
}

const live = (x: number, y: number, height: number, width: number): ViewState => ({
  center: { x, y },
  height,
  width,
  paper: false,
});

describe('-VPORTS on the Model tab', () => {
  it('offers AutoCAD’s options with 3 as the default', async () => {
    const t = drawing();
    await t.bus.script(['-VPORTS']);
    expect(t.bus.prompt?.message).toBe('Enter an option');
    expect(t.bus.prompt?.options).toEqual([
      'Save',
      'Restore',
      'Delete',
      'Join',
      'SIngle',
      '?',
      '2',
      '3',
      '4',
      'Toggle',
      'MOde',
    ]);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: '3' });
  });

  it('divides the single viewport in two side by side, each showing the current view', async () => {
    const t = drawing({ tiles: { views: [live(7, 8, 10, 20)], current: 0 } });
    await t.bus.script(['-VPORTS', '2']);
    expect(t.bus.prompt?.message).toBe('Enter a configuration option');
    expect(t.bus.prompt?.options).toEqual(['Horizontal', 'Vertical']);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: 'Vertical' });
    await t.bus.script(['']);
    expect(t.bus.command).toBeUndefined();
    const [a, b] = t.active();
    // The first record keeps its handle: it stays the first, the current viewport.
    expect(a!.handle).toBe('29');
    expect(t.corners(a!)).toEqual([0, 0, 0.5, 1]);
    expect(t.corners(b!)).toEqual([0.5, 0, 1, 1]);
    // The view shown, VIEWSIZE kept: half as wide a tile is half as wide a view.
    for (const v of [a!, b!]) {
      expect(v.center).toEqual({ x: 7, y: 8 });
      expect(v.height).toBe(10);
      expect(v.aspectRatio).toBe(1);
    }
    // Snap, grid and UCS come with the current viewport's record.
    expect(b!.snapSpacing).toEqual({ x: 5, y: 5 });
    expect(t.bus.undo.state.nextUndo).toBe('-VPORTS');
    await t.bus.script(['U']);
    expect(t.active().map(t.corners)).toEqual([[0, 0, 1, 1]]);
  });

  it('divides only the current tile under Current viewport, the others kept', async () => {
    // The right tile is current; its live view replaces its record's.
    const t = drawing({
      vports: TILED,
      tiles: { views: [live(5, 5, 10, 10), live(60, 40, 20, 20)], current: 1 },
    });
    await t.bus.script(['-VPORTS', '3', 'Above']);
    const tiles = t.active();
    expect(tiles.map(t.corners)).toEqual([
      [0.5, 0.5, 1, 1],
      [0.5, 0, 0.75, 0.5],
      [0.75, 0, 1, 0.5],
      [0, 0, 0.5, 1],
    ]);
    // The large one is current, and every new tile starts on the current view.
    expect(tiles.slice(0, 3).map((v) => v.center)).toEqual([
      { x: 60, y: 40 },
      { x: 60, y: 40 },
      { x: 60, y: 40 },
    ]);
    expect(tiles.slice(0, 3).map((v) => v.snapSpacing.x)).toEqual([2, 2, 2]);
    // The left tile is as it was, its own view (the canvas's, as it shows it).
    expect(tiles[3]!.center).toEqual({ x: 5, y: 5 });
    expect(tiles[3]!.snapSpacing.x).toBe(5);
  });

  it('divides the whole display under MOde Display', async () => {
    const t = drawing({ vports: TILED });
    await t.bus.script(['-VPORTS', 'MOde']);
    expect(t.bus.prompt?.message).toBe('Enter a viewport configuration mode');
    expect(t.bus.prompt?.options).toEqual(['Display', 'Current viewport']);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: 'Current viewport' });
    await t.bus.script(['Display', '-VPORTS', '4']);
    expect(t.active().map(t.corners)).toEqual([
      [0, 0.5, 0.5, 1],
      [0.5, 0.5, 1, 1],
      [0, 0, 0.5, 0.5],
      [0.5, 0, 1, 0.5],
    ]);
    // The mode lasts: it is the default next time.
    await t.bus.script(['-VPORTS', 'MOde']);
    expect(t.bus.prompt?.default).toEqual({ kind: 'keyword', keyword: 'Display' });
  });

  it('goes back to one viewport showing the current view with SIngle, and Toggle undoes it', async () => {
    const t = drawing({
      vports: TILED,
      tiles: { views: [live(5, 5, 10, 10), live(60, 40, 20, 20)], current: 1 },
    });
    await t.bus.script(['-VPORTS', 'SI']);
    const [one] = t.active();
    expect(t.active()).toHaveLength(1);
    expect(one!.handle).toBe('29');
    expect(t.corners(one!)).toEqual([0, 0, 1, 1]);
    // The current (right) tile's view, twice as wide on the whole screen.
    expect(one!.center).toEqual({ x: 60, y: 40 });
    expect(one!.height).toBe(20);
    expect(one!.aspectRatio).toBe(2);
    // Toggle brings the two back, as they showed then, the current one first.
    await t.bus.script(['-VPORTS', 'T']);
    expect(t.active().map(t.corners)).toEqual([
      [0.5, 0, 1, 1],
      [0, 0, 0.5, 1],
    ]);
    expect(t.active().map((v) => v.center)).toEqual([
      { x: 60, y: 40 },
      { x: 5, y: 5 },
    ]);
    // And again to one.
    await t.bus.script(['-VPORTS', 'T']);
    expect(t.active()).toHaveLength(1);
  });

  it('toggles a single viewport to four when there was no other configuration', async () => {
    const t = drawing();
    await t.bus.script(['-VPORTS', 'T']);
    expect(t.active()).toHaveLength(4);
    await t.bus.script(['-VPORTS', 'SI', '-VPORTS', 'SI']);
    expect(t.active()).toHaveLength(1);
  });

  it('saves the tiles as they are shown under a name, the current one first', async () => {
    const t = drawing({
      vports: TILED,
      tiles: { views: [live(5, 5, 10, 10), live(70, 30, 25, 25)], current: 1 },
    });
    await t.bus.script(['-VPORTS', 'S']);
    expect(t.bus.prompt?.message).toBe('Enter name for new viewport configuration or');
    expect(t.bus.prompt?.options).toEqual(['?']);
    await t.bus.script(['?']);
    expect(t.log).toContain('Configuration Two:');
    await t.bus.script(['*Active']);
    expect(t.log).toContain(INVALID_CONFIGURATION_NAME);
    await t.bus.script(['Plan and detail']);
    expect(t.bus.command).toBeUndefined();
    const saved = t.records().filter((v) => v.name === 'Plan and detail');
    expect(saved.map(t.corners)).toEqual([
      [0.5, 0, 1, 1],
      [0, 0, 0.5, 1],
    ]);
    expect(saved.map((v) => [v.center, v.height])).toEqual([
      [{ x: 70, y: 30 }, 25],
      [{ x: 5, y: 5 }, 10],
    ]);
    // The current configuration is unchanged.
    expect(t.active().map((v) => v.handle)).toEqual(['29', '2A']);
    expect(viewportConfigurations(t.records()).map((c) => c.name)).toEqual([
      'Plan and detail',
      'Two',
    ]);
  });

  it('replaces a configuration saved under the same name, keeping its records', async () => {
    const t = drawing({ vports: TILED });
    await t.bus.script(['-VPORTS', 'S', 'two']);
    const two = t.records().filter((v) => v.name.toUpperCase() === 'TWO');
    expect(two.map((v) => v.handle)).toEqual(['2B', '2C']);
    expect(two.map((v) => v.name)).toEqual(['two', 'two']);
    expect(two.map(t.corners)).toEqual([
      [0, 0, 0.5, 1],
      [0.5, 0, 1, 1],
    ]);
  });

  it('restores a named configuration in place of the current one', async () => {
    const t = drawing({ vports: TILED });
    await t.bus.script(['-VPORTS', 'R']);
    expect(t.bus.prompt?.message).toBe('Enter name of viewport configuration to restore or');
    await t.bus.script(['Missing']);
    expect(t.log).toContain('Cannot find viewport configuration "Missing".');
    await t.bus.script(['two']);
    expect(t.bus.command).toBeUndefined();
    const tiles = t.active();
    expect(tiles.map((v) => v.handle)).toEqual(['29', '2A']);
    expect(tiles.map(t.corners)).toEqual([
      [0, 0, 1, 0.5],
      [0, 0.5, 1, 1],
    ]);
    expect(tiles.map((v) => [v.center, v.height])).toEqual([
      [{ x: 1, y: 2 }, 4],
      [{ x: 3, y: 4 }, 8],
    ]);
    expect(modelTiles(t.records()).map((m) => m.rect)).toEqual([
      { left: 0, top: 0.5, width: 1, height: 0.5 },
      { left: 0, top: 0, width: 1, height: 0.5 },
    ]);
    // The named one is still there.
    expect(t.records().filter((v) => v.name === 'Two')).toHaveLength(1);
    await t.bus.script(['U']);
    expect(t.active().map(t.corners)).toEqual([
      [0, 0, 0.5, 1],
      [0.5, 0, 1, 1],
    ]);
  });

  it('deletes the configurations named, wildcards allowed, never the current one', async () => {
    const t = drawing({ vports: [...TILED, vport('2D', 'Other')] });
    await t.bus.script(['-VPORTS', 'D']);
    expect(t.bus.prompt?.message).toBe('Enter name(s) of viewport configurations to delete');
    await t.bus.script(['nothing*']);
    expect(t.log).toContain(NO_MATCHING_CONFIGURATIONS);
    await t.bus.script(['-VPORTS', 'D', 't?o,*active']);
    expect(t.records().map((v) => v.name)).toEqual(['*Active', '*Active', 'Other']);
  });

  it('lists the current configuration, the current tile first, and the named ones', async () => {
    const t = drawing({
      vports: TILED,
      tiles: { views: [null, null], current: 1 },
    });
    await t.bus.script(['-VPORTS', '?']);
    expect(t.bus.prompt?.message).toBe('Enter name(s) of viewport configuration(s) to list');
    await t.bus.script(['']);
    expect(t.log.slice(-8)).toEqual([
      'Current configuration:',
      '  id# 3',
      '  corners: 0.5000,0.0000 1.0000,1.0000',
      '  id# 2',
      '  corners: 0.0000,0.0000 0.5000,1.0000',
      'Configuration Two:',
      '  0.0000,0.0000 1.0000,0.5000',
      '  0.0000,0.5000 1.0000,1.0000',
    ]);
  });

  describe('Join (M6-02 part 13)', () => {
    // Three tiles: a large one on the left (current), two stacked on the right.
    const THREE: VportRecord[] = [
      vport('29', '*Active', { upperRight: { x: 0.5, y: 1 }, center: { x: 5, y: 5 } }),
      vport('2A', '*Active', {
        lowerLeft: { x: 0.5, y: 0.5 },
        center: { x: 50, y: 50 },
        snapSpacing: { x: 2, y: 2 },
      }),
      vport('2B', '*Active', { lowerLeft: { x: 0.5, y: 0 }, upperRight: { x: 1, y: 0.5 } }),
    ];

    it('asks for the dominant viewport with the current one as the default, then the other', async () => {
      const t = drawing({ vports: TILED, tiles: { views: [null, null], current: 1 } });
      await t.bus.script(['-VPORTS', 'J']);
      expect(t.bus.prompt?.message).toBe('Select dominant viewport');
      expect(t.bus.prompt?.defaultLabel).toBe('current viewport');
      expect(t.bus.prompt?.kind === 'point' && t.bus.prompt.viewport).toBe(true);
      await t.bus.script(['']);
      expect(t.bus.prompt?.message).toBe('Select viewport to join');
      expect(t.bus.prompt?.kind === 'point' && t.bus.prompt.viewport).toBe(true);
    });

    it('joins two tiles into one showing the dominant (current) one’s view', async () => {
      // The right tile is current and dominant; the left one is clicked to join it.
      const t = drawing({
        vports: TILED,
        tiles: { views: [live(5, 5, 10, 10), live(60, 40, 20, 20)], current: 1 },
      });
      await t.bus.script(['-VPORTS', 'J', '']);
      await t.bus.pick({ x: 3, y: 3 }, { tile: 0 });
      expect(t.bus.command).toBeUndefined();
      const tiles = t.active();
      expect(tiles).toHaveLength(1);
      // The first record keeps its handle, the current viewport; the dominant's settings.
      expect(tiles[0]!.handle).toBe('29');
      expect(t.corners(tiles[0]!)).toEqual([0, 0, 1, 1]);
      expect(tiles[0]!.center).toEqual({ x: 60, y: 40 });
      expect(tiles[0]!.height).toBe(20);
      // VIEWSIZE kept: twice as wide a viewport shows twice as wide a view.
      expect(tiles[0]!.aspectRatio).toBe(2);
      expect(tiles[0]!.snapSpacing).toEqual({ x: 2, y: 2 });
      // The named configurations are left alone.
      expect(t.records().filter((v) => v.name !== '*Active')).toHaveLength(2);
      expect(t.bus.undo.state.nextUndo).toBe('-VPORTS');
      await t.bus.script(['U']);
      expect(t.active().map(t.corners)).toEqual([
        [0, 0, 0.5, 1],
        [0.5, 0, 1, 1],
      ]);
    });

    it('takes the dominant viewport clicked, and the joined one becomes current', async () => {
      const t = drawing({
        vports: THREE,
        tiles: {
          views: [live(5, 5, 10, 10), live(50, 50, 10, 10), live(0, 0, 10, 10)],
          current: 0,
        },
      });
      await t.bus.script(['-VPORTS', 'J']);
      // A click in the lower right tile, which is not current, picks it as the dominant one.
      await t.bus.pick({ x: 1, y: 1 }, { tile: 2 });
      await t.bus.pick({ x: 50, y: 50 }, { tile: 1 });
      expect(t.bus.command).toBeUndefined();
      const tiles = t.active();
      expect(tiles.map(t.corners)).toEqual([
        [0.5, 0, 1, 1],
        [0, 0, 0.5, 1],
      ]);
      expect(tiles[0]!.center).toEqual({ x: 0, y: 0 });
      expect(tiles[0]!.snapSpacing).toEqual({ x: 5, y: 5 });
      expect(tiles[1]!.center).toEqual({ x: 5, y: 5 });
    });

    it('refuses two tiles that do not make a rectangle, changing nothing', async () => {
      const t = drawing({ vports: THREE });
      await t.bus.script(['-VPORTS', 'J', '']);
      await t.bus.pick({ x: 50, y: 50 }, { tile: 1 });
      expect(t.log).toContain(JOIN_NOT_RECTANGLE);
      expect(t.bus.command).toBeUndefined();
      expect(t.active()).toHaveLength(3);
      expect(t.bus.undo.state.nextUndo).toBeUndefined();
    });

    it('asks again for a click outside every viewport or on the dominant one', async () => {
      const t = drawing({ vports: TILED });
      await t.bus.script(['-VPORTS', 'J']);
      // A typed point says nothing of which viewport.
      await t.bus.script(['3,3']);
      expect(t.log).toContain(JOIN_PICK_VIEWPORT);
      expect(t.bus.prompt?.message).toBe('Select dominant viewport');
      await t.bus.pick({ x: 3, y: 3 }, { tile: 0 });
      await t.bus.pick({ x: 4, y: 4 }, { tile: 0 });
      expect(t.log).toContain(JOIN_ITSELF);
      expect(t.bus.prompt?.message).toBe('Select viewport to join');
      await t.bus.pick({ x: 4, y: 4 }, { tile: 1 });
      expect(t.active()).toHaveLength(1);
    });

    it('says so with a single viewport', async () => {
      const t = drawing();
      await t.bus.script(['-VPORTS', 'J']);
      expect(t.log).toContain(JOIN_ONE_VIEWPORT);
      expect(t.bus.command).toBeUndefined();
    });

    it('takes no tile from a click at a prompt that does not ask for a viewport', async () => {
      const t = drawing({ vports: TILED });
      await t.bus.script(['-VPORTS', 'J', '']);
      // Esc ends it; a LINE's point picked with a tile is a plain point.
      await t.bus.cancel();
      await t.bus.script(['LINE']);
      await t.bus.pick({ x: 1, y: 1 }, { tile: 1 });
      expect(t.bus.prompt?.message).toBe('Specify next point or');
    });
  });

  it('says so when the drawing has no model viewport', async () => {
    const t = drawing({ vports: [] });
    await t.bus.script(['-VPORTS']);
    expect(t.log).toContain(NO_MODEL_VIEWPORT);
    expect(t.bus.command).toBeUndefined();
  });
});

describe('-VPORTS in a layout and MVIEW Restore', () => {
  const viewports = (model: DocumentModel) =>
    model
      .blockEntities(PAPER_SPACE)
      .map((id) => model.entity(id)!)
      .filter((e): e is Entity & { geom: ViewportGeometry } => e.geom.kind === 'VIEWPORT');

  it('shows MVIEW’s prompts in a layout', async () => {
    const t = drawing({ space: PAPER_SPACE });
    await t.bus.script(['-VPORTS']);
    expect(t.bus.prompt?.message).toBe('Specify corner of viewport or');
    expect(t.bus.prompt?.options).toContain('Restore');
  });

  it('lays a configuration out in a window, each viewport showing its tile’s view', async () => {
    const t = drawing({ vports: TILED, space: PAPER_SPACE });
    await t.bus.script(['MVIEW', 'Restore']);
    expect(t.bus.prompt?.message).toBe('Enter viewport configuration name or');
    expect(t.bus.prompt?.options).toEqual(['?']);
    expect(t.bus.prompt?.default).toEqual({ kind: 'string', value: '*Active' });
    await t.bus.script(['?']);
    expect(t.log).toContain('Configuration Two:');
    await t.bus.script(['nope']);
    expect(t.log).toContain('Cannot find viewport configuration "nope".');
    await t.bus.script(['TWO']);
    expect(t.bus.prompt?.message).toBe('Specify first corner or');
    await t.bus.script(['0,0', '200,100']);
    expect(t.bus.command).toBeUndefined();
    const [, bottom, top] = viewports(t.model);
    expect(bottom!.geom).toMatchObject({
      center: { x: 100, y: 25 },
      width: 200,
      height: 50,
      viewCenter: { x: 1, y: 2 },
      viewHeight: 4,
    });
    expect(top!.geom).toMatchObject({
      center: { x: 100, y: 75 },
      width: 200,
      height: 50,
      viewCenter: { x: 3, y: 4 },
      viewHeight: 8,
    });
    expect(t.bus.undo.state.nextUndo).toBe('MVIEW');
  });

  it('lays out the current configuration at Enter', async () => {
    const t = drawing({ vports: TILED, space: PAPER_SPACE });
    await t.bus.script(['MV', 'R', '', '0,0', '100,100']);
    const [, left, right] = viewports(t.model);
    expect(left!.geom).toMatchObject({ center: { x: 25, y: 50 }, viewCenter: { x: 5, y: 5 } });
    expect(right!.geom).toMatchObject({ center: { x: 75, y: 50 }, viewHeight: 20 });
  });
});
