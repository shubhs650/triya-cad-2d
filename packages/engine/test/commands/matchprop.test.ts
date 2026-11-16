// M3-02 part 5: MATCHPROP on the PromptBus and its properties (`properties/match.ts`), with
// AutoCAD 2024's prompts and Property Settings (AutoCAD Help, "MATCHPROP (Command)", "Property
// Settings Dialog Box").
import { describe, expect, it } from 'vitest';
import {
  ALL_MATCH_SETTINGS,
  DocumentModel,
  activeSettingsLine,
  matchedPatch,
  type DialogPrompt,
  type EntityGeometry,
  type HatchGeometry,
  type ViewportGeometry,
} from '../../src/index';
import { LAYER_0, LAYER_WALLS, entityInit, sampleInit } from '../model/fixtures';
import { setup } from './edit-harness';

const lw = (pts: [number, number][], extra = {}): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  vertices: pts.map(([x, y]) => ({ x, y, bulge: 0 })),
  closed: false,
  ...extra,
});
const text = (style: string, y: number): EntityGeometry => ({
  kind: 'TEXT',
  value: 'T',
  style,
  position: { x: 20, y },
  height: 2.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});

describe('MATCHPROP', () => {
  it('copies the source’s layer, colour, linetype, scale, lineweight and thickness', async () => {
    const { bus, byHandle, log } = setup([
      [
        { kind: 'LINE', start: { x: 0, y: 5 }, end: { x: 10, y: 5 }, thickness: 2 },
        {
          color: { kind: 'aci', index: 1 },
          linetype: '15',
          ltScale: 3,
          lineweight: 50,
          transparency: { alpha: 128 },
        },
      ],
    ]);
    await bus.script(['MA']);
    expect(bus.promptText).toBe('Select source object:');
    expect((bus.prompt as { cursor?: string }).cursor).toBeUndefined();
    await bus.pick({ x: 5, y: 5 });
    expect(log).toContain(
      'Current active settings:  Color Layer Ltype Ltscale Lineweight Transparency Thickness PlotStyle Dim Text Hatch Polyline Viewport Material Multileader',
    );
    expect(bus.promptText).toBe('Select destination object(s) or [Settings]:');
    // The paintbrush beside the pickbox (M3-16), only while destinations are picked.
    expect((bus.prompt as { cursor?: string }).cursor).toBe('paintbrush');
    await bus.pick({ x: 5, y: 0 });
    // Each pick takes the properties at once; the prompt comes back for more.
    const line = byHandle('30')!;
    expect(line.layer).toBe(LAYER_WALLS);
    expect(line.color).toEqual({ kind: 'aci', index: 1 });
    expect(line.linetype).toBe('15');
    expect(line.ltScale).toBe(3);
    expect(line.lineweight).toBe(50);
    expect(line.transparency).toEqual({ alpha: 128 });
    expect((line.geom as { thickness?: number }).thickness).toBe(2);
    expect(bus.promptText).toBe('Select destination object(s) or [Settings]:');
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
  });

  it('copies only what Property Settings leaves on, for the rest of the session', async () => {
    const { bus, byHandle, log } = setup([
      [
        lw([
          [0, 5],
          [10, 5],
        ]),
        { color: { kind: 'aci', index: 2 } },
      ],
    ]);
    await bus.script(['MATCHPROP']);
    await bus.pick({ x: 5, y: 5 });
    await bus.script(['S']);
    const d = (bus.prompt as DialogPrompt).dialog;
    expect(d).toMatchObject({ type: 'matchprop', settings: ALL_MATCH_SETTINGS, plotStyles: false });
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      matchprop: { ...ALL_MATCH_SETTINGS, layer: false },
    });
    expect(bus.promptText).toBe('Select destination object(s) or [Settings]:');
    await bus.pick({ x: 5, y: 0 });
    await bus.script(['']);
    expect(byHandle('30')!.color).toEqual({ kind: 'aci', index: 2 });
    expect(byHandle('30')!.layer).toBe(LAYER_0);
    // Cancel keeps the settings; the next MATCHPROP lists them.
    await bus.script(['MATCHPROP']);
    await bus.pick({ x: 5, y: 5 });
    expect(log.at(-1)).not.toContain('Layer');
    await bus.script(['S']);
    await bus.answer({ kind: 'dialog', action: 'ok' });
    expect(log.at(-1)).not.toContain(' Layer ');
    // Esc in the dialog goes back to the prompt, not out of the command.
    await bus.script(['S']);
    await bus.cancel();
    expect(bus.promptText).toBe('Select destination object(s) or [Settings]:');
    await bus.cancel();
    expect(bus.command).toBeUndefined();
  });

  it('gives polylines the source’s width and linetype generation, and texts its style', async () => {
    const { bus, byHandle } = setup([
      lw(
        [
          [0, 5],
          [10, 5],
        ],
        { constantWidth: 0.5, plinegen: true },
      ),
      lw([
        [0, 8],
        [10, 8],
      ]),
      text('17', 20),
      text('16', 30),
    ]);
    await bus.script(['MATCHPROP']);
    await bus.pick({ x: 5, y: 5 });
    await bus.pick({ x: 5, y: 8 });
    await bus.script(['']);
    expect(byHandle('41')!.geom).toMatchObject({ constantWidth: 0.5, plinegen: true });
    // Text: the NOTES style is 3.5 high, which the text takes with it.
    await bus.script(['MATCHPROP', 'C', '19,19', '21,21', 'C', '19,29', '21,31', '']);
    expect(byHandle('43')!.geom).toMatchObject({ style: '17', height: 3.5 });
  });

  it('leaves objects on locked layers and the source itself alone', async () => {
    const s = setup([
      [
        lw([
          [0, 5],
          [10, 5],
        ]),
        { color: { kind: 'aci', index: 5 }, layer: LAYER_0 },
      ],
    ]);
    const walls = s.model.tables.layers.get(LAYER_WALLS)!;
    s.model.apply({
      tables: { layers: { updated: [{ before: walls, after: { ...walls, locked: true } }] } },
    } as never);
    s.model.apply({
      entities: {
        updated: [
          {
            before: s.byHandle('30')!,
            after: { ...s.byHandle('30')!, layer: LAYER_WALLS },
          },
        ],
      },
    } as never);
    await s.bus.script(['MATCHPROP']);
    await s.bus.pick({ x: 5, y: 5 });
    // ALL leaves out what is on a locked layer; a pick is refused.
    await s.bus.script(['ALL']);
    await s.bus.pick({ x: 5, y: 0 });
    expect(s.log).toContain('1 object was not changed: on a locked layer.');
    await s.bus.script(['']);
    expect(s.byHandle('30')!.color).toEqual({ kind: 'byLayer' });
    expect(s.byHandle('31')!.color).toEqual({ kind: 'aci', index: 5 });
  });
});

describe('matched properties', () => {
  const model = DocumentModel.create(sampleInit());
  const hatch = (
    pattern: string,
    base: number,
    extra: Partial<HatchGeometry> = {},
  ): HatchGeometry => ({
    kind: 'HATCH',
    pattern,
    solid: false,
    associative: false,
    style: 0,
    patternType: 1,
    patternAngle: 0,
    patternScale: 1,
    double: false,
    loops: [],
    patternLines: [{ angle: 0, base: { x: base, y: base }, offset: { x: 0, y: 1 }, dashes: [] }],
    seedPoints: [],
    ...extra,
  });

  it('gives a hatch the source’s pattern laid from its own origin', () => {
    const src = { ...entityInit('60', hatch('ANSI31', 5, { patternScale: 2 })), id: 1 as never };
    const dst = { ...entityInit('61', hatch('ANSI37', 1)), id: 2 as never };
    const p = matchedPatch(model, src, dst, ALL_MATCH_SETTINGS)!;
    const g = p.geom as HatchGeometry;
    expect(g.pattern).toBe('ANSI31');
    expect(g.patternScale).toBe(2);
    expect(g.patternLines[0]!.base).toEqual({ x: 1, y: 1 });
    // Nothing to change: no patch.
    expect(matchedPatch(model, src, src, ALL_MATCH_SETTINGS)).toBeUndefined();
  });

  // M3-16: Viewport (AutoCAD Help, "Property Settings Dialog Box": "on/off, display locking,
  // standard or custom scale, shade plot, snap, grid, and UCS icon visibility and location.
  // Settings for clipping and for UCS per viewport and freeze/thaw state of the layers are not
  // transferred"). Triya keeps no shade plot or snap and grid spacing of a viewport's own, so
  // the on/off bits are what snap and grid copy.
  it('gives a viewport the source’s on/off, lock, scale, snap, grid and UCS icon', () => {
    const vp = (over: Partial<ViewportGeometry>): ViewportGeometry => ({
      kind: 'VIEWPORT',
      center: { x: 100, y: 50 },
      width: 40,
      height: 20,
      id: 2,
      status: 1,
      flags: 0,
      viewCenter: { x: 10, y: 10 },
      viewHeight: 10,
      viewDirection: { x: 0, y: 0, z: 1 },
      viewTarget: { x: 0, y: 0, z: 0 },
      twist: 0,
      lensLength: 50,
      frontClip: 0,
      backClip: 0,
      frozenLayers: [],
      plotStyleSheet: '',
      renderMode: 0,
      ...over,
    });
    // Off, locked, snap and grid on, UCS icon on at the origin; scale 1:4 (10 tall shows 40).
    const OFF = 0x20000;
    const LOCK = 0x4000;
    const src = {
      ...entityInit(
        '60',
        vp({ flags: OFF | LOCK | 256 | 512 | 32 | 64 | 0x10000, height: 10, viewHeight: 40 }),
      ),
      id: 1 as never,
    };
    // Its own clip (65536), UCS per viewport and frozen layers stay.
    const dst = {
      ...entityInit(
        '61',
        vp({ flags: 8, ucsPerViewport: true, frozenLayers: ['10'], viewCenter: { x: 5, y: 6 } }),
      ),
      id: 2 as never,
    };
    const g = matchedPatch(model, src, dst, ALL_MATCH_SETTINGS)!.geom as ViewportGeometry;
    expect(g.flags).toBe(OFF | LOCK | 256 | 512 | 32 | 64 | 8);
    // The same scale: 20 tall shows 80, about its own view centre.
    expect(g.viewHeight).toBe(80);
    expect(g.viewCenter).toEqual({ x: 5, y: 6 });
    expect(g.ucsPerViewport).toBe(true);
    expect(g.frozenLayers).toEqual(['10']);
    // Viewport off: only the basic properties.
    expect(
      (
        matchedPatch(model, src, dst, { ...ALL_MATCH_SETTINGS, viewport: false })?.geom as
          ViewportGeometry | undefined
      )?.flags,
    ).toBeUndefined();
    // A source showing nothing (no view) gives no scale; the paper-space viewport takes nothing.
    const flat = { ...src, geom: vp({ viewHeight: 0 }) };
    expect(matchedPatch(model, flat, dst, ALL_MATCH_SETTINGS)).toBeUndefined();
    const paper = { ...dst, geom: vp({ id: 1 }) };
    expect(matchedPatch(model, src, paper, ALL_MATCH_SETTINGS)?.geom).toBeUndefined();
  });

  it('lists the settings left on', () => {
    expect(activeSettingsLine({ ...ALL_MATCH_SETTINGS, hatch: false, dimension: false })).toBe(
      'Current active settings:  Color Layer Ltype Ltscale Lineweight Transparency Thickness PlotStyle Text Polyline Viewport Material Multileader',
    );
  });
});

describe('MATCHPROP leaves things as they were', () => {
  it('keeps the settings when Property Settings is cancelled, and skips the source itself', async () => {
    const { bus, byHandle, log } = setup([
      [
        lw([
          [0, 5],
          [10, 5],
        ]),
        { color: { kind: 'aci', index: 3 } },
      ],
    ]);
    await bus.script(['MATCHPROP']);
    await bus.pick({ x: 5, y: 5 });
    await bus.script(['S']);
    await bus.cancel();
    expect(bus.promptText).toBe('Select destination object(s) or [Settings]:');
    await bus.pick({ x: 5, y: 5 });
    expect(byHandle('40')!.color).toEqual({ kind: 'aci', index: 3 });
    await bus.pick({ x: 5, y: 0 });
    await bus.script(['']);
    expect(byHandle('30')!.color).toEqual({ kind: 'aci', index: 3 });
    expect(log.filter((l) => l.startsWith('Current active settings:'))).toHaveLength(1);
  });
});
