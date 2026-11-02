// Test helpers: a small drawing, and a recording stand-in for a Canvas 2D context so the
// renderer's calls can be checked in Node. Pixel-level checks run in the browser (tests/e2e/fidelity/renderer-host.spec.ts).
import {
  ChangeSetBuilder,
  DocumentModel,
  SpatialIndex,
  toleranceForSize,
  type ChangeSet,
  type DimStyleRecord,
  type DocumentInit,
  type EntityGeometry,
  type EntityInit,
  type HeaderValue,
  type LayerRecord,
  type LayoutPlot,
  type NonGraphicalObject,
  type TextStyleRecord,
  type Vec2,
} from '@triya/engine';
import type { Canvas2D, Surface } from '../src/index';

export const MODEL = '1F';
export const LAYER_0 = '10';
export const LAYER_RED = '11';
/** M1-13: a layer drawn with the DASHED linetype below (0.5 dash, 0.25 gap). */
export const LAYER_DASHED = '12';
export const DASHED = '15';
/** M1-13: a layout's paper-space block, for lineweights that follow the zoom. */
export const PAPER = '1E';

export const layer = (
  handle: string,
  name: string,
  extra: Partial<LayerRecord> = {},
): LayerRecord => ({
  handle,
  name,
  color: { kind: 'aci', index: 7 },
  linetype: '14',
  lineweight: 'Default',
  transparency: { alpha: 255 },
  plot: true,
  on: true,
  frozen: false,
  locked: false,
  ...extra,
});

export function entity(
  handle: string,
  geom: EntityGeometry,
  extra: Partial<EntityInit> = {},
): EntityInit {
  return {
    handle,
    owner: MODEL,
    type: geom.kind,
    layer: LAYER_0,
    color: { kind: 'byLayer' },
    linetype: 'ByLayer',
    lineweight: 'ByLayer',
    transparency: 'ByLayer',
    ltScale: 1,
    visible: true,
    geom,
    ...extra,
  };
}

export const line = (x1: number, y1: number, x2: number, y2: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});

/** A plain dash, gap or dot of an LTYPE record. */
export const dash = (length: number) => ({
  length,
  shapeFlags: 0,
  shapeNumber: 0,
  offset: { x: 0, y: 0 },
  rotation: 0,
  scale: 1,
});

export interface DrawingExtra {
  readonly header?: Iterable<readonly [string, HeaderValue]>;
  readonly objects?: readonly NonGraphicalObject[];
  /** M1-14: block definitions besides model and paper space; their entities name them as owner. */
  readonly blocks?: readonly {
    readonly handle: string;
    readonly name: string;
    readonly basePoint?: Vec2;
  }[];
  /** M1-41: text styles. */
  readonly textStyles?: readonly TextStyleRecord[];
  /** M1-52: dimension styles (LEADER). */
  readonly dimStyles?: readonly DimStyleRecord[];
  /** M1-18: Layout1's page setup and layout flags (1 = PSLTSCALE). */
  readonly layoutPlot?: LayoutPlot;
  readonly layoutFlags?: number;
}

/**
 * The init of a small drawing: layers 0, RED and DASHED, the Continuous and DASHED linetypes,
 * model space and one layout, the given entities.
 */
export function drawingInit(entities: EntityInit[], extra: DrawingExtra = {}): DocumentInit {
  return {
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '1000',
    header: new Map<string, HeaderValue>(extra.header ?? []),
    tables: {
      layers: [
        layer(LAYER_0, '0'),
        layer(LAYER_RED, 'RED', { color: { kind: 'aci', index: 1 } }),
        layer(LAYER_DASHED, 'DASHED', { linetype: DASHED }),
      ],
      linetypes: [
        {
          handle: '14',
          name: 'Continuous',
          description: '',
          alignment: 'A',
          patternLength: 0,
          elements: [],
        },
        {
          handle: DASHED,
          name: 'DASHED',
          description: '__ __ __',
          alignment: 'A',
          patternLength: 0.75,
          elements: [dash(0.5), dash(-0.25)],
        },
      ],
      ...(extra.textStyles ? { textStyles: [...extra.textStyles] } : {}),
      ...(extra.dimStyles ? { dimStyles: [...extra.dimStyles] } : {}),
      blockRecords: [
        { handle: MODEL, name: '*Model_Space', units: 0, explodable: true, scalable: true },
        { handle: PAPER, name: '*Paper_Space', units: 0, explodable: true, scalable: true },
        ...(extra.blocks ?? []).map((b) => ({
          handle: b.handle,
          name: b.name,
          units: 0,
          explodable: true,
          scalable: true,
        })),
      ],
    },
    blocks: [
      { handle: MODEL, name: '*Model_Space', basePoint: { x: 0, y: 0 } },
      { handle: PAPER, name: '*Paper_Space', basePoint: { x: 0, y: 0 } },
      ...(extra.blocks ?? []).map((b) => ({
        handle: b.handle,
        name: b.name,
        basePoint: b.basePoint ?? { x: 0, y: 0 },
      })),
    ],
    layouts: [
      { handle: 'AA', name: 'Model', tabOrder: 0, blockRecord: MODEL },
      {
        handle: 'AB',
        name: 'Layout1',
        tabOrder: 1,
        blockRecord: PAPER,
        ...(extra.layoutPlot ? { plot: extra.layoutPlot } : {}),
        ...(extra.layoutFlags !== undefined ? { flags: extra.layoutFlags } : {}),
      },
    ],
    ...(extra.objects ? { objects: extra.objects } : {}),
    entities,
  };
}

export function drawing(
  entities: EntityInit[],
  extra: DrawingExtra = {},
): { model: DocumentModel; index: SpatialIndex } {
  const model = DocumentModel.create(drawingInit(entities, extra));
  return { model, index: SpatialIndex.build(model, { tol: toleranceForSize(1000) }) };
}

/** Applies a change to the model and its index (what the app does before the renderer). */
export function change(
  d: { model: DocumentModel; index: SpatialIndex },
  edit: (b: ChangeSetBuilder) => void,
): ChangeSet {
  const b = new ChangeSetBuilder(d.model);
  edit(b);
  const cs = b.build();
  d.model.apply(cs);
  d.index.apply(cs);
  return cs;
}

export type Call = [string, ...unknown[]];

/** A recorded gradient: how it was made and its colour stops. */
export class FakeGradient {
  readonly stops: [number, string][] = [];
  constructor(readonly args: [string, ...number[]]) {}
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
  toString(): string {
    return `gradient(${this.args.join(',')})`;
  }
}

/** Records every call and property write, in order. */
export class FakeContext implements Canvas2D {
  readonly calls: Call[] = [];
  #stroke = '';
  #fill = '';
  #width = 1;
  #alpha = 1;
  lineCap: CanvasLineCap = 'butt';
  #smoothing = true;
  get imageSmoothingEnabled(): boolean {
    return this.#smoothing;
  }
  set imageSmoothingEnabled(v: boolean) {
    this.#smoothing = v;
    this.calls.push(['imageSmoothingEnabled', v]);
  }
  lineJoin: CanvasLineJoin = 'miter';
  get strokeStyle(): string {
    return this.#stroke;
  }
  set strokeStyle(v: string | CanvasGradient | CanvasPattern) {
    this.#stroke = String(v);
    this.calls.push(['strokeStyle', v]);
  }
  get fillStyle(): string {
    return this.#fill;
  }
  set fillStyle(v: string | CanvasGradient | CanvasPattern) {
    this.#fill = String(v);
    this.gradient = v instanceof FakeGradient ? v : undefined;
    this.calls.push(['fillStyle', v]);
  }
  get lineWidth(): number {
    return this.#width;
  }
  set lineWidth(v: number) {
    this.#width = v;
    this.calls.push(['lineWidth', v]);
  }
  get globalAlpha(): number {
    return this.#alpha;
  }
  set globalAlpha(v: number) {
    this.#alpha = v;
    this.calls.push(['globalAlpha', v]);
  }
  /** The fill style last set, when it was a gradient. */
  gradient: FakeGradient | undefined;
  createLinearGradient(...a: number[]): CanvasGradient {
    this.calls.push(['createLinearGradient', ...a]);
    return new FakeGradient(['linear', ...a]) as unknown as CanvasGradient;
  }
  createRadialGradient(...a: number[]): CanvasGradient {
    this.calls.push(['createRadialGradient', ...a]);
    return new FakeGradient(['radial', ...a]) as unknown as CanvasGradient;
  }
  setTransform(...a: number[]): void {
    this.calls.push(['setTransform', ...a]);
  }
  clearRect(...a: number[]): void {
    this.calls.push(['clearRect', ...a]);
  }
  fillRect(...a: number[]): void {
    this.calls.push(['fillRect', ...a]);
  }
  beginPath(): void {
    this.calls.push(['beginPath']);
  }
  moveTo(x: number, y: number): void {
    this.calls.push(['moveTo', x, y]);
  }
  lineTo(x: number, y: number): void {
    this.calls.push(['lineTo', x, y]);
  }
  arc(...a: unknown[]): void {
    this.calls.push(['arc', ...a]);
  }
  ellipse(...a: unknown[]): void {
    this.calls.push(['ellipse', ...a]);
  }
  quadraticCurveTo(...a: number[]): void {
    this.calls.push(['quadraticCurveTo', ...a]);
  }
  bezierCurveTo(...a: number[]): void {
    this.calls.push(['bezierCurveTo', ...a]);
  }
  closePath(): void {
    this.calls.push(['closePath']);
  }
  stroke(): void {
    this.calls.push(['stroke', this.#stroke, this.#width]);
  }
  fill(rule?: CanvasFillRule): void {
    this.calls.push(['fill', this.#fill, rule, this.#alpha]);
  }
  save(): void {
    this.calls.push(['save']);
  }
  restore(): void {
    this.calls.push(['restore']);
  }
  rect(...a: number[]): void {
    this.calls.push(['rect', ...a]);
  }
  clip(rule?: CanvasFillRule): void {
    this.calls.push(rule === undefined ? ['clip'] : ['clip', rule]);
  }
  setLineDash(segments: number[]): void {
    this.calls.push(['setLineDash', [...segments]]);
  }
  drawImage(image: CanvasImageSource, x: number, y: number): void {
    this.calls.push(['drawImage', (image as unknown as { name: string }).name, x, y]);
  }
  createImageData(width: number, height: number): ImageData {
    this.calls.push(['createImageData', width, height]);
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }
  putImageData(data: ImageData, x: number, y: number): void {
    this.calls.push(['putImageData', [...data.data], x, y]);
  }
  named(name: string): Call[] {
    return this.calls.filter((c) => c[0] === name);
  }
  clear(): void {
    this.calls.length = 0;
  }
}

export function surface(name: string): Surface & { ctx: FakeContext } {
  const ctx = new FakeContext();
  return { canvas: { width: 0, height: 0 }, ctx, image: { name } as unknown as CanvasImageSource };
}
