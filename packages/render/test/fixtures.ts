// Test helpers: a small drawing, and a recording stand-in for a Canvas 2D context so the
// renderer's calls can be checked in Node. Pixel-level checks run in the browser (part 2).
import {
  ChangeSetBuilder,
  DocumentModel,
  SpatialIndex,
  toleranceForSize,
  type ChangeSet,
  type EntityGeometry,
  type EntityInit,
  type HeaderValue,
  type LayerRecord,
} from '@triya/engine';
import type { Canvas2D, Surface } from '../src/index';

export const MODEL = '1F';
export const LAYER_0 = '10';
export const LAYER_RED = '11';

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

export function drawing(entities: EntityInit[]): { model: DocumentModel; index: SpatialIndex } {
  const model = DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 4, measurement: 'metric' },
    handSeed: '1000',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [layer(LAYER_0, '0'), layer(LAYER_RED, 'RED', { color: { kind: 'aci', index: 1 } })],
      linetypes: [
        {
          handle: '14',
          name: 'Continuous',
          description: '',
          alignment: 'A',
          patternLength: 0,
          elements: [],
        },
      ],
      blockRecords: [
        { handle: MODEL, name: '*Model_Space', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [{ handle: MODEL, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: 'AA', name: 'Model', tabOrder: 0, blockRecord: MODEL }],
    entities,
  });
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

/** Records every call and property write, in order. */
export class FakeContext implements Canvas2D {
  readonly calls: Call[] = [];
  #stroke = '';
  #fill = '';
  #width = 1;
  lineCap: CanvasLineCap = 'butt';
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
    this.calls.push(['fillStyle', v]);
  }
  get lineWidth(): number {
    return this.#width;
  }
  set lineWidth(v: number) {
    this.#width = v;
    this.calls.push(['lineWidth', v]);
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
  closePath(): void {
    this.calls.push(['closePath']);
  }
  stroke(): void {
    this.calls.push(['stroke', this.#stroke, this.#width]);
  }
  fill(rule?: CanvasFillRule): void {
    this.calls.push(['fill', this.#fill, rule]);
  }
  drawImage(image: CanvasImageSource, x: number, y: number): void {
    this.calls.push(['drawImage', (image as unknown as { name: string }).name, x, y]);
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
