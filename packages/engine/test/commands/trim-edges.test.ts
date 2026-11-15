// M3-12 part 4: TRIM and EXTEND with block references, text and hatches as edges, on the
// PromptBus as the canvas drives them: the canvas measures the texts among the edges once
// (`textOutlines`), a text no font draws cuts with nothing, and a hatch is an edge only when
// chosen as one (`edit/trim-edges.ts`).
import { describe, expect, it } from 'vitest';
import {
  PromptBus,
  builtinCommands,
  type BusEvent,
  type EntityGeometry,
  type ViewHost,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { host, setup } from './edit-harness';

/** Block B (line (0,0)-(1,0), circle (1,0) r 0.5) scaled 2 at (20,0): circle (22,0) r 1. */
const INSERT = {
  kind: 'INSERT',
  block: '50',
  position: { x: 20, y: 0 },
  scale: { x: 2, y: 2, z: 2 },
  rotation: 0,
  attributes: [],
} as never as EntityGeometry;

const TEXT = {
  kind: 'TEXT',
  value: 'AB',
  style: '16',
  position: { x: 30, y: 0 },
  height: 1,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
} as never as EntityGeometry;

/** A square hatch from (40,18) to (44,22). */
const HATCH = {
  kind: 'HATCH',
  pattern: 'SOLID',
  solid: true,
  associative: false,
  style: 0,
  patternType: 1,
  patternAngle: 0,
  patternScale: 1,
  double: false,
  patternLines: [],
  seedPoints: [],
  loops: [
    {
      flags: 2,
      polyline: {
        closed: true,
        vertices: [
          { x: 40, y: 18, bulge: 0 },
          { x: 44, y: 18, bulge: 0 },
          { x: 44, y: 22, bulge: 0 },
          { x: 40, y: 22, bulge: 0 },
        ],
      },
    },
  ],
} as never as EntityGeometry;

const line = (x1: number, y1: number, x2: number, y2: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});

/**
 * The harness drawing with a reference, a text and a hatch (handles 40–42) and the lines
 * `lines` (from 43), on a canvas that draws a text 2 per character wide and 1 high from its
 * position (none with `fonts` false).
 */
function drawing(lines: EntityGeometry[], fonts = true) {
  const h = setup([INSERT, TEXT, HATCH, ...lines]);
  const measured: unknown[] = [];
  const canvas = host(() => h.model);
  const view: ViewHost = {
    request: (r: ViewRequest): Promise<ViewReply> => {
      if (r.op !== 'textOutlines') return canvas.request(r);
      measured.push(...r.texts);
      return Promise.resolve({
        ok: true,
        pickbox: 0.25,
        outlines: r.texts.map((t) => {
          if (!fonts || t.kind !== 'TEXT') return null;
          const { x, y } = t.position;
          const w = 2 * t.value.length;
          const corners = [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + 1 },
            { x, y: y + 1 },
          ];
          return { corners, width: w, below: 0 };
        }),
      });
    },
  };
  const bus = new PromptBus({ model: h.model, registry: builtinCommands(), view });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  return { ...h, bus, log, measured };
}

describe('TRIM and EXTEND with objects that are not curves as edges', () => {
  it('trims at a block reference and a text, measuring each text once', async () => {
    const { bus, byHandle, ends, measured } = drawing([
      line(22, -5, 22, 5),
      line(25, 0.5, 40, 0.5),
    ]);
    await bus.script(['TRIM']);
    // The vertical is cut by the reference's circle (y = ±1) and its line's end (y = 0).
    await bus.pick({ x: 22, y: 4 });
    expect(ends(byHandle('43')!)).toEqual([22, -5, 22, 1]);
    // The horizontal is cut by the text's box (30 to 34), and the hatch does not cut it.
    await bus.pick({ x: 36, y: 0.5 });
    expect(ends(byHandle('44')!)).toEqual([25, 0.5, 34, 0.5]);
    expect(measured).toMatchObject([{ kind: 'TEXT', value: 'AB' }]);
    await bus.submit('');
    expect(bus.command).toBeUndefined();
  });

  it('extends to a block reference', async () => {
    const { bus, byHandle, ends } = drawing([line(22, 5, 22, 3)]);
    await bus.script(['EXTEND']);
    await bus.pick({ x: 22, y: 3.2 });
    expect(ends(byHandle('43')!)).toEqual([22, 5, 22, 1]);
  });

  it('takes a text no loaded font draws as no edge', async () => {
    // Measured, the text stops the line at its box; unmeasured, the line goes on to the circle
    // at (50,0) r 5.
    for (const [fonts, x] of [
      [true, 30],
      [false, 45.025063],
    ] as const) {
      const { bus, byHandle, ends } = drawing([line(25, 0.5, 29, 0.5)], fonts);
      await bus.script(['EXTEND']);
      await bus.pick({ x: 28.8, y: 0.5 });
      expect(ends(byHandle('43')!)).toEqual([25, 0.5, x, 0.5]);
    }
  });

  it('cuts at a hatch only when it is chosen as an edge', async () => {
    const { bus, byHandle, ends, model } = drawing([line(38, 20, 50, 20)]);
    await bus.script(['TRIM']);
    // Quick mode: no edge crosses the line, so it goes.
    await bus.pick({ x: 46, y: 20 });
    expect(byHandle('43')).toBeUndefined();
    await bus.script(['U']);
    expect(byHandle('43')).toBeDefined();
    // Standard mode, the hatch chosen: the line is cut at its boundary.
    await bus.script(['O', 'S']);
    await bus.answer({ kind: 'selection', ids: [model.ids.idOf('42')!] });
    await bus.pick({ x: 46, y: 20 });
    expect(ends(byHandle('43')!)).toEqual([38, 20, 44, 20]);
  });
});
