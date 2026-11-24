// The plot job (M2-17): model space and layouts as plot parts, each painted through the plot
// style table by what its object has with ByLayer and ByBlock resolved, blocks included.
import {
  constraintDisplays,
  type DimensionalConstraintObject,
  type EntityInit,
  type ImageGeometry,
  type LayoutPlot,
  type NonGraphicalObject,
  type PdfDefinition,
  type UnderlayGeometry,
  type ViewportGeometry,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  CTB_STYLE_COUNT,
  DEFAULT_PLOT_LINEWEIGHTS,
  PATH_A,
  PATH_L,
  PATH_M,
  PATH_Z,
  PlotResolver,
  annotationalSizes,
  constraintPrimitives,
  newPlotStyle,
  pathPolygons,
  plotObject,
  plotParts,
  type PlotPart,
  type PlotStyleTable,
} from '../../src/index';
import { FontBook, parseShx } from '@triya/text';
import { buildShapes } from '../../../text/test/shx/builder';
import { drawing, entity, layer, LAYER_0, LAYER_RED, line, MODEL, PAPER } from '../fixtures';

const BLOCK = '40';
const NO_PLOT = '16';

/** A CTB plotting ACI 1 green and ACI 7 blue; everything else keeps its colour. */
function table(): PlotStyleTable {
  const styles = Array.from({ length: CTB_STYLE_COUNT }, (_, i) => newPlotStyle(`Color_${i + 1}`));
  styles[0] = { ...styles[0]!, color: [0, 255, 0] };
  styles[6] = { ...styles[6]!, color: [0, 0, 255] };
  return {
    kind: 'ctb',
    description: 'test',
    scaleFactor: 1,
    applyFactor: false,
    lineweightUnits: 'mm',
    lineweights: DEFAULT_PLOT_LINEWEIGHTS,
    styles,
  };
}

const resolver = new PlotResolver(table());
const colours = (parts: readonly PlotPart[]) => parts.map((p) => p.paint.color);
const paths = (parts: readonly PlotPart[]) =>
  parts.map((p) => (p.kind === 'stroke' || p.kind === 'fill' ? p.path : []));

const insert = (handle: string, extra: Partial<EntityInit> = {}): EntityInit =>
  entity(
    handle,
    {
      kind: 'INSERT',
      block: BLOCK,
      position: { x: 100, y: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [],
    },
    extra,
  );

function blockDrawing(entities: EntityInit[], extraLayers = true) {
  const d = drawing(entities, { blocks: [{ handle: BLOCK, name: 'B' }] });
  if (extraLayers) {
    // A layer that does not plot (DEFPOINTS-like).
    const layers = d.model.tables.layers as Map<string, ReturnType<typeof layer>>;
    layers.set(NO_PLOT, layer(NO_PLOT, 'NOPLOT', { plot: false }));
  }
  return d.model;
}

describe('plotParts in model space', () => {
  it('plots a ByBlock part by the reference colour and a layer-0 part by the reference layer', () => {
    const model = blockDrawing([
      entity('50', line(0, 0, 1, 0), { owner: BLOCK, color: { kind: 'byBlock' } }),
      entity('51', line(0, 1, 1, 1), { owner: BLOCK }),
      // The reference: on RED (ACI 1), colour 7 of its own.
      insert('60', { layer: LAYER_RED, color: { kind: 'aci', index: 7 } }),
    ]);
    const parts = plotParts(model, MODEL, { resolver });
    // ByBlock → ACI 7 → blue; layer 0 → the reference's RED → ACI 1 → green.
    expect(colours(parts)).toEqual([
      [0, 0, 255],
      [0, 255, 0],
    ]);
    // Placed by the reference.
    expect(paths(parts)[0]).toEqual([PATH_M, 100, 0, PATH_L, 101, 0]);
  });

  it('names the layer each part plots from, a reference’s layer-0 parts on its layer (M2-18)', () => {
    const model = blockDrawing([
      entity('50', line(0, 0, 1, 0), { owner: BLOCK }),
      entity('51', line(0, 1, 1, 1), { owner: BLOCK, layer: LAYER_0 }),
      entity('52', line(5, 5, 6, 6)),
      insert('60', { layer: LAYER_RED }),
    ]);
    const parts = plotParts(model, MODEL, { resolver });
    expect(parts.map((p) => p.layer)).toEqual(['0', 'RED', 'RED']);
  });

  // M2-74: a saved PDF links each hyperlinked object; the parts of one object share its link.
  it('carries the hyperlink of the object each part plots from, one link per object', () => {
    const PE_URL = '90';
    const url = (value: string, location?: string) => ({
      xdata: [
        {
          appId: PE_URL,
          values: [
            { code: 1000, value },
            ...(location !== undefined
              ? [
                  { code: 1002, value: '{' },
                  { code: 1000, value: 'description' },
                  { code: 1000, value: location },
                  { code: 1002, value: '}' },
                ]
              : []),
          ],
        },
      ],
    });
    const model = blockDrawing([
      // A part of the block with a link of its own: the reference's link is what plots.
      entity('50', line(0, 0, 1, 0), { owner: BLOCK, ...url('https://example.com/nested') }),
      entity('51', line(0, 1, 1, 1), { owner: BLOCK }),
      entity('52', line(5, 5, 6, 6), url('', 'Layout1')),
      entity('53', line(7, 7, 8, 8)),
      insert('60', url('https://example.com/block')),
      insert('61'),
    ]);
    const appIds = model.tables.appIds as Map<string, { handle: string; name: string }>;
    appIds.set(PE_URL, { handle: PE_URL, name: 'PE_URL' });
    const parts = plotParts(model, MODEL, { resolver });
    expect(parts.map((p) => p.link)).toEqual([
      { url: '', location: 'Layout1' },
      undefined,
      { url: 'https://example.com/block', location: '' },
      { url: 'https://example.com/block', location: '' },
      undefined,
      undefined,
    ]);
    expect(parts[2]!.link).toBe(parts[3]!.link);
  });

  it('carries ByBlock through nested references', () => {
    const model = blockDrawing([
      entity('50', line(0, 0, 1, 0), { owner: BLOCK, color: { kind: 'byBlock' } }),
      // Plain objects plot by their own colour: ACI 3 has no override in the table.
      entity('52', line(0, 0, 0, 1), { color: { kind: 'aci', index: 3 } }),
      insert('60', { color: { kind: 'aci', index: 1 } }),
    ]);
    const parts = plotParts(model, MODEL, { resolver });
    expect(colours(parts)).toEqual([
      [0, 255, 0],
      [0, 255, 0],
    ]);
  });

  it('leaves out objects on layers that do not plot, and a reference’s layer-0 parts with them', () => {
    const model = blockDrawing([
      entity('50', line(0, 0, 1, 0), { owner: BLOCK }),
      entity('51', line(0, 1, 1, 1), { owner: BLOCK, layer: LAYER_RED }),
      entity('52', line(5, 5, 6, 6), { layer: NO_PLOT }),
      insert('60', { layer: NO_PLOT }),
    ]);
    const parts = plotParts(model, MODEL, { resolver });
    expect(paths(parts)).toEqual([[PATH_M, 100, 1, PATH_L, 101, 1]]);
  });

  it('plots only the objects named, as the picture of copied objects does (M2-32 part 5)', () => {
    const model = blockDrawing([
      entity('50', line(0, 0, 1, 0), { owner: BLOCK }),
      entity('52', line(5, 5, 6, 6)),
      entity('53', line(7, 7, 8, 8)),
      insert('60'),
    ]);
    const parts = plotParts(model, MODEL, { resolver, only: new Set(['53', '60']) });
    // The block's own objects plot with the reference.
    expect(paths(parts)).toEqual([
      [PATH_M, 7, 7, PATH_L, 8, 8],
      [PATH_M, 100, 0, PATH_L, 101, 0],
    ]);
  });

  it('resolves the plot style name an object plots by, its own or its layer’s', () => {
    const model = blockDrawing([
      entity('50', line(0, 0, 1, 0)),
      entity('51', line(0, 0, 1, 0), { plotStyle: 'P2' }),
    ]);
    const tables = model.tables as unknown as {
      plotStyles: Map<string, { handle: string; name: string }>;
      layers: Map<string, ReturnType<typeof layer>>;
    };
    tables.plotStyles.set('P1', { handle: 'P1', name: 'Thin' });
    tables.plotStyles.set('P2', { handle: 'P2', name: 'Bold' });
    tables.layers.set(LAYER_0, layer(LAYER_0, '0', { plotStyle: 'P1' }));
    const [a, b] = [...model.blockEntities(MODEL)].map((id) => model.entity(id)!);
    expect(plotObject(a!, model).plotStyle).toBe('Thin');
    expect(plotObject(b!, model).plotStyle).toBe('Bold');
    expect(plotObject(a!, model)).toMatchObject({
      color: { kind: 'aci', index: 7 },
      lineweight: 25,
    });
  });
});

/** A 200 × 100 mm sheet, 1:1 millimetres. */
const PLOT: LayoutPlot = {
  paperSize: 'custom',
  paperWidth: 200,
  paperHeight: 100,
  margins: { left: 0, bottom: 0, right: 0, top: 0 },
  paperUnits: 'millimeters',
  rotation: 0,
  origin: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 },
  plotType: 5,
  flags: 0,
};

// Frame 40…80 × 20…60 on the sheet, showing model 0…20 × 0…20 (scale 2).
const viewport = (extra: Partial<ViewportGeometry> = {}): ViewportGeometry => ({
  kind: 'VIEWPORT',
  center: { x: 60, y: 40 },
  width: 40,
  height: 40,
  id: 2,
  status: 1,
  flags: 0,
  viewCenter: { x: 10, y: 10 },
  viewHeight: 20,
  viewDirection: { x: 0, y: 0, z: 1 },
  viewTarget: { x: 0, y: 0, z: 0 },
  twist: 0,
  lensLength: 50,
  frontClip: 0,
  backClip: 0,
  frozenLayers: [],
  plotStyleSheet: '',
  renderMode: 0,
  ...extra,
});

describe('plotParts in a layout', () => {
  const sheet = (vp: ViewportGeometry = viewport()) =>
    drawing(
      [
        entity('50', line(0, 0, 10, 0), { color: { kind: 'aci', index: 1 } }),
        entity('51', line(0, 5, 10, 5), { layer: LAYER_RED }),
        entity('70', line(0, 0, 200, 0), { owner: PAPER }),
        entity('71', vp, { owner: PAPER }),
      ],
      { layoutPlot: PLOT },
    ).model;

  it('plots paper space, then each viewport’s model space on the sheet, clipped to its frame', () => {
    const parts = plotParts(sheet(), PAPER, { resolver });
    const frame = [40, 20, 80, 20, 80, 60, 40, 60];
    expect(parts.map((p) => ('clip' in p ? p.clip : undefined))).toEqual([
      undefined,
      undefined,
      [frame],
      [frame],
    ]);
    // The paper line, the viewport's frame, then model (0,0)-(10,0) at scale 2 from (40, 20).
    expect(paths(parts)).toEqual([
      [PATH_M, 0, 0, PATH_L, 200, 0],
      [PATH_M, 40, 20, PATH_L, 80, 20, PATH_L, 80, 60, PATH_L, 40, 60, PATH_Z],
      [PATH_M, 40, 20, PATH_L, 60, 20],
      [PATH_M, 40, 30, PATH_L, 60, 30],
    ]);
    expect(colours(parts).slice(2)).toEqual([
      [0, 255, 0],
      [0, 255, 0],
    ]);
  });

  it('plots paper space on top with "Plot paperspace last"', () => {
    const parts = plotParts(sheet(), PAPER, { resolver, paperspaceLast: true });
    expect(paths(parts)[0]).toEqual([PATH_M, 40, 20, PATH_L, 60, 20]);
    expect(paths(parts)[2]).toEqual([PATH_M, 0, 0, PATH_L, 200, 0]);
  });

  it('leaves out layers frozen in the viewport', () => {
    const parts = plotParts(sheet(viewport({ frozenLayers: [LAYER_RED] })), PAPER, { resolver });
    expect(paths(parts).slice(2)).toEqual([[PATH_M, 40, 20, PATH_L, 60, 20]]);
  });

  it('plots no model space through a viewport that is off', () => {
    const parts = plotParts(sheet(viewport({ flags: 0x20000 })), PAPER, { resolver });
    expect(parts).toHaveLength(2);
  });

  it('plots model space alone on the Model tab', () => {
    expect(plotParts(sheet(), MODEL, { resolver })).toHaveLength(2);
  });
});

/**
 * The labels' bundled stroke font, built in memory: every character a label can hold is the
 * same square (a pen-down 1×1 cell), advancing 2.
 */
function labelFont(): FontBook {
  const cell = [0x14, 0x10, 0x1c, 0x18, 2, 0x20, 0];
  const codes = [...'0123456789.=-()dA'].map((c) => c.charCodeAt(0));
  const book = new FontBook();
  book.addShx(
    'oet-simplex.shx',
    parseShx(
      buildShapes(
        codes.map((code) => ({ code, name: `c${code}`, bytes: cell })),
        { name: 'Label', above: 1, below: 0 },
      ),
    ),
  );
  return book;
}

describe('plotParts with dimensional constraints (M9-03 part 8)', () => {
  const dim = (
    handle: string,
    o: Partial<DimensionalConstraintObject> = {},
  ): DimensionalConstraintObject => ({
    handle,
    type: 'TRIYA_DIMCONSTRAINT',
    owner: '0',
    dimension: 'horizontal',
    refs: [{ entity: '50' }],
    parameter: `d${handle}`,
    expression: '10',
    location: { x: 5, y: -2 },
    form: 'annotational',
    ...o,
  });
  const model = (dims: readonly DimensionalConstraintObject[]) =>
    drawing(
      [
        entity('50', line(0, 0, 10, 0), { color: { kind: 'aci', index: 1 } }),
        entity('71', viewport(), { owner: PAPER }),
      ],
      { objects: dims, layoutPlot: PLOT, header: [['$DIMSCALE', 2]] },
    ).model;
  /** What the screen draws of the drawing's one annotational constraint, as paths. */
  const drawn = (m: ReturnType<typeof model>) =>
    constraintPrimitives(
      constraintDisplays(m, 2).find((d) => d.form === 'annotational')!,
      annotationalSizes(m.header),
      'foreground',
      undefined,
    ).map((p) => (p.kind === 'stroke' || p.kind === 'fill' ? p.path : []));

  it('plots annotational constraints on the Model tab, after the objects, as the screen draws them', () => {
    const m = model([dim('A1'), dim('A2', { form: 'dynamic', location: { x: 5, y: 3 } })]);
    const parts = plotParts(m, MODEL, { resolver });
    expect(paths(parts)[0]).toEqual([PATH_M, 0, 0, PATH_L, 10, 0]);
    // Two extension lines and the dimension line, then the two arrowheads; the dynamic one not.
    expect(paths(parts).slice(1)).toEqual(drawn(m));
    expect(parts.slice(1).map((p) => p.kind)).toEqual(['stroke', 'stroke', 'stroke', 'fill', 'fill']);
    // Sized by the DIMVARs times DIMSCALE: the arrows DIMASZ 0.18 × 2 long.
    const arrow = paths(parts)[4]!;
    expect(Math.hypot(arrow[1]! - arrow[4]!, arrow[2]! - arrow[5]!)).toBeCloseTo(0.36, 2);
  });

  it('plots them in colour 7 through the plot style table, solid and continuous', () => {
    const parts = plotParts(model([dim('A1')]), MODEL, { resolver }).slice(1);
    // The test table plots ACI 7 blue.
    expect(new Set(colours(parts).map((c) => c.join()))).toEqual(new Set(['0,0,255']));
    expect(parts.map((p) => p.paint.linetype)).toEqual(parts.map(() => ({ kind: 'object' })));
    expect(parts.every((p) => !('layer' in p))).toBe(true);
  });

  it('plots no dynamic constraint, none with only the named objects, and none on a layout', () => {
    const m = model([dim('A1')]);
    expect(plotParts(model([dim('A1', { form: 'dynamic' })]), MODEL, { resolver })).toHaveLength(1);
    expect(plotParts(m, MODEL, { resolver, only: new Set(['50']) })).toHaveLength(1);
    // The layout: its viewport's frame and the line through it; the screen shows constraints on
    // the Model tab only.
    expect(plotParts(m, PAPER, { resolver })).toHaveLength(2);
  });

  it("labels them by the plot's CONSTRAINTNAMEFORMAT, Name and expression when absent", () => {
    const m = model([dim('A1')]);
    const text = { fonts: labelFont(), style: (h: string) => m.tables.textStyles.get(h) };
    const at = (nameFormat?: 0 | 1 | 2) =>
      plotParts(m, MODEL, {
        resolver,
        tessellate: { text },
        ...(nameFormat !== undefined && { constraintNameFormat: nameFormat }),
      })
        .slice(6)
        .reduce((n, p) => n + paths([p])[0]!.length, 0);
    // "dA1=10" against "10": a longer glyph path with the name, the label after the 5 lines.
    expect(at()).toBeGreaterThan(at(1));
    expect(at(2)).toBe(at());
  });
});

describe('pathPolygons', () => {
  it('closes each subpath and flattens arcs into chords on the circle', () => {
    const [square, circle] = pathPolygons([
      PATH_M,
      0,
      0,
      PATH_L,
      1,
      0,
      PATH_L,
      1,
      1,
      PATH_Z,
      PATH_M,
      12,
      10,
      PATH_A,
      10,
      10,
      2,
      0,
      2 * Math.PI,
      1,
    ]);
    expect(square).toEqual([0, 0, 1, 0, 1, 1]);
    expect(circle!.length).toBeGreaterThan(200);
    for (let i = 0; i < circle!.length; i += 2) {
      expect(Math.hypot(circle![i]! - 10, circle![i + 1]! - 10)).toBeCloseTo(2, 9);
    }
  });
});

describe('plotParts with a PDF underlay (M2-16 part 5)', () => {
  const pdfDef: PdfDefinition = {
    type: 'PDFDEFINITION',
    handle: '9A',
    owner: '0',
    name: 'plan-2',
    fileName: '..\\plans\\plan.pdf',
    page: '2',
  } as PdfDefinition;
  const geom = (extra: Partial<UnderlayGeometry> = {}): UnderlayGeometry => ({
    kind: 'PDFUNDERLAY',
    definition: '9A',
    position: { x: 10, y: 20 },
    scale: { x: 25.4, y: 25.4, z: 1 },
    rotation: 0,
    flags: 2 | 4,
    contrast: 60,
    fade: 30,
    clip: [],
    ...extra,
  });

  it("names the definition's file and page, with the frame and settings the screen draws with", () => {
    const { model } = drawing([entity('70', geom())], { objects: [pdfDef] });
    const parts = plotParts(model, MODEL, { resolver });
    expect(parts).toHaveLength(1);
    const p = parts[0]!;
    expect(p.kind).toBe('fill');
    if (p.kind !== 'fill') return;
    expect(p.path).toEqual([]);
    expect(p.underlay).toEqual({
      definition: '9A',
      fileName: '..\\plans\\plan.pdf',
      page: '2',
      frame: { a: 25.4, b: 0, c: -0, d: 25.4, e: 10, f: 20 },
      clipped: false,
      contrast: 60,
      fade: 30,
      monochrome: true,
    });
  });

  it('plots the frame with PDFFRAME 1 only: 0 hides it and 2 shows it on screen alone (M5-04 part 17)', () => {
    const frameOff = (value?: string) => {
      const header: [string, string][] = value === undefined ? [] : [['PDFFRAME', value]];
      const { model } = drawing([entity('70', geom())], { objects: [pdfDef], header });
      const p = plotParts(model, MODEL, { resolver })[0]!;
      if (p.kind !== 'fill') throw new Error('fill expected');
      return p.underlay?.frameOff;
    };
    expect(frameOff()).toBeUndefined();
    expect(frameOff('1')).toBeUndefined();
    expect(frameOff('0')).toBe(true);
    expect(frameOff('2')).toBe(true);
  });

  it('names the PDF layers the underlay turns off, sorted, once each (M2-38 part 2)', () => {
    const { model } = drawing([entity('70', geom({ layersOff: ['Walls', 'Notes', 'Walls'] }))], {
      objects: [pdfDef],
    });
    const p = plotParts(model, MODEL, { resolver })[0]!;
    if (p.kind !== 'fill') throw new Error('fill expected');
    expect(p.underlay?.layersOff).toEqual(['Notes', 'Walls']);
  });

  it("keeps a clipped underlay's boundary as its path and leaves out one on a non-plotting layer", () => {
    const { model } = blockDrawingWith([
      entity(
        '70',
        geom({
          flags: 3,
          clip: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        }),
      ),
      entity('71', geom(), { layer: NO_PLOT }),
    ]);
    const parts = plotParts(model, MODEL, { resolver });
    expect(parts).toHaveLength(1);
    const p = parts[0]!;
    if (p.kind !== 'fill') throw new Error('fill expected');
    expect(p.underlay?.clipped).toBe(true);
    expect(p.path).toEqual([
      PATH_M,
      10,
      20,
      PATH_L,
      35.4,
      20,
      PATH_L,
      35.4,
      45.4,
      PATH_L,
      10,
      45.4,
      PATH_Z,
    ]);
  });

  function blockDrawingWith(entities: EntityInit[]) {
    const d = drawing(entities, { objects: [pdfDef] });
    const layers = d.model.tables.layers as Map<string, ReturnType<typeof layer>>;
    layers.set(NO_PLOT, layer(NO_PLOT, 'NOPLOT', { plot: false }));
    return d;
  }
});

describe('plotParts with IMAGEFRAME (M5-04 part 4)', () => {
  const image: ImageGeometry = {
    kind: 'IMAGE',
    position: { x: 0, y: 0 },
    u: { x: 1, y: 0 },
    v: { x: 0, y: 1 },
    size: { x: 8, y: 4 },
    displayFlags: 7,
    clipping: false,
    brightness: 50,
    contrast: 50,
    fade: 0,
    clip: {
      type: 'rectangle',
      vertices: [
        { x: -0.5, y: -0.5 },
        { x: 7.5, y: 3.5 },
      ],
      inverted: false,
    },
  } as ImageGeometry;
  const strokes = (frame?: number) => {
    const objects =
      frame === undefined
        ? []
        : [
            {
              handle: '83',
              type: 'RASTERVARIABLES',
              owner: '0C',
              frame,
              quality: 'high',
              units: 0,
            } as NonGraphicalObject,
          ];
    const { model } = drawing([entity('70', image)], { objects });
    // The screen draws image frames with IMAGEFRAME 1 and 2.
    const tessellate = { frames: { image: frame !== 0, wipeout: true } };
    return plotParts(model, MODEL, { resolver, tessellate }).filter((p) => p.kind === 'stroke')
      .length;
  };

  it('plots image frames with IMAGEFRAME 1, not with 0, and leaves out 2 (displayed but not plotted)', () => {
    expect(strokes()).toBe(1);
    expect(strokes(1)).toBe(1);
    expect(strokes(0)).toBe(0);
    expect(strokes(2)).toBe(0);
  });
});

describe('plotParts with wipeouts (M2-24 part 2)', () => {
  const wipeout: ImageGeometry = {
    kind: 'WIPEOUT',
    position: { x: 0, y: 0 },
    u: { x: 4, y: 0 },
    v: { x: 0, y: 4 },
    size: { x: 1, y: 1 },
    displayFlags: 7,
    clipping: true,
    brightness: 50,
    contrast: 50,
    fade: 0,
    clip: {
      type: 'polygon',
      vertices: [
        { x: -0.5, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: -0.5 },
        { x: -0.5, y: -0.5 },
        { x: -0.5, y: 0.5 },
      ],
      inverted: false,
    },
  } as ImageGeometry;
  const kinds = (frame?: number) => {
    const objects =
      frame === undefined
        ? []
        : [{ handle: '83', type: 'WIPEOUTVARIABLES', owner: '0C', frame } as NonGraphicalObject];
    const { model } = drawing([entity('70', wipeout)], { objects });
    // The screen's tessellation context draws frames (WIPEOUTFRAME 1 and 2 both show them).
    const tessellate = { frames: { image: true, wipeout: frame !== 0 } };
    return plotParts(model, MODEL, { resolver, tessellate }).map((p) => p.kind);
  };

  it('plots the frame with WIPEOUTFRAME 1, AutoCAD’s initial value, and not with 0', () => {
    expect(kinds()).toEqual(['fill', 'stroke']);
    expect(kinds(1)).toEqual(['fill', 'stroke']);
    expect(kinds(0)).toEqual(['fill']);
  });

  it('leaves out the frame the screen shows with WIPEOUTFRAME 2 (displayed but not plotted)', () => {
    expect(kinds(2)).toEqual(['fill']);
  });

  it('masks in the paper colour, whatever the plot style makes of the object’s colour', () => {
    // A wipeout hides what is under it on paper too ("WIPEOUT (Command)": it covers objects
    // "with the current background color"; on a plot, the paper). It plotted in the wipeout's
    // own colour through the table, a black box on a monochrome plot.
    const { model } = drawing([entity('70', wipeout, { color: { kind: 'aci', index: 1 } })]);
    const [mask, frame] = plotParts(model, MODEL, { resolver });
    expect(mask?.kind).toBe('fill');
    expect(mask?.paint.color).toEqual([255, 255, 255]);
    expect(frame?.paint.color).toEqual([0, 255, 0]);
  });
});
