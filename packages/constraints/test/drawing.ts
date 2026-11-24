// A tiny drawing for constraint scenarios: entities by handle, edited by the replacements the
// model hands back.
import { expect } from 'vitest';
import {
  createEntity,
  type Entity,
  type EntityGeometry,
  type Handle,
  type Replacement,
  type Vec2,
} from '@triya/engine';
import type { CurveRef, PointName, PointRef } from '../src/index';

export class Drawing {
  readonly entities = new Map<Handle, Entity>();
  #id = 1;
  #handle = 0x200;
  readonly lookup = (h: Handle) => this.entities.get(h);

  add(geom: EntityGeometry): Handle {
    const handle = (this.#handle++).toString(16).toUpperCase();
    const entity = createEntity(this.#id++, {
      handle,
      owner: '1F',
      type: geom.kind,
      layer: '10',
      color: { kind: 'byLayer' },
      linetype: 'ByLayer',
      lineweight: 'ByLayer',
      transparency: 'ByLayer',
      ltScale: 1,
      visible: true,
      geom,
    });
    this.entities.set(handle, entity);
    return handle;
  }

  line(x1: number, y1: number, x2: number, y2: number): Handle {
    return this.add({ kind: 'LINE', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
  }
  circle(x: number, y: number, radius: number): Handle {
    return this.add({ kind: 'CIRCLE', center: { x, y }, radius });
  }
  arc(x: number, y: number, radius: number, startDeg: number, endDeg: number): Handle {
    const rad = Math.PI / 180;
    return this.add({
      kind: 'ARC',
      center: { x, y },
      radius,
      startAngle: startDeg * rad,
      endAngle: endDeg * rad,
    });
  }
  /** An ellipse, or an elliptical arc between parameters given in degrees. */
  ellipse(
    x: number,
    y: number,
    majorAxis: [number, number],
    ratio: number,
    params: [number, number] = [0, 360],
  ): Handle {
    const rad = Math.PI / 180;
    return this.add({
      kind: 'ELLIPSE',
      center: { x, y },
      majorAxis: { x: majorAxis[0], y: majorAxis[1] },
      ratio,
      startParam: params[0] * rad,
      endParam: params[1] * rad,
    });
  }
  point(x: number, y: number): Handle {
    return this.add({ kind: 'POINT', position: { x, y } });
  }
  /** An open spline; clamped uniform knots unless given. */
  spline(
    controlPoints: [number, number][],
    options: { degree?: number; knots?: number[]; weights?: number[]; fitPoints?: Vec2[] } = {},
  ): Handle {
    const degree = options.degree ?? 3;
    const n = controlPoints.length;
    const knots = options.knots ?? [
      ...Array<number>(degree + 1).fill(0),
      ...Array.from({ length: n - degree - 1 }, (_, i) => i + 1),
      ...Array<number>(degree + 1).fill(n - degree),
    ];
    return this.add({
      kind: 'SPLINE',
      degree,
      knots,
      controlPoints: controlPoints.map(([x, y]) => ({ x, y })),
      ...(options.weights && { weights: options.weights }),
      ...(options.fitPoints && { fitPoints: options.fitPoints }),
      closed: false,
      periodic: false,
    });
  }
  polyline(vertices: [number, number, number?][], closed = false): Handle {
    return this.add({
      kind: 'LWPOLYLINE',
      closed,
      vertices: vertices.map(([x, y, bulge]) => ({ x, y, bulge: bulge ?? 0 })),
    });
  }

  /** Applies the replacements, checking each `before` is what the drawing holds. */
  apply(updated: readonly Replacement<Entity>[]): void {
    for (const { before, after } of updated) {
      expect(this.entities.get(before.handle)).toBe(before);
      this.entities.set(after.handle, after);
    }
  }

  /** The replacement an edit makes: `geom` patched onto the entity. */
  edit(handle: Handle, patch: Record<string, unknown>): Replacement<Entity> {
    const before = this.entities.get(handle)!;
    const after = { ...before, geom: { ...before.geom, ...patch } } as Entity;
    return { before, after };
  }

  geom<K extends EntityGeometry['kind']>(h: Handle, kind: K): Extract<EntityGeometry, { kind: K }> {
    const g = this.entities.get(h)!.geom;
    expect(g.kind).toBe(kind);
    return g as Extract<EntityGeometry, { kind: K }>;
  }
}

export const curve = (entity: Handle, segment?: number): CurveRef =>
  segment === undefined ? { entity } : { entity, segment };
export const pt = (entity: Handle, point: PointName, index?: number): PointRef =>
  index === undefined ? { entity, point } : { entity, point, index };

export const EPS = 1e-7;
export const near = (a: number, b: number, eps = EPS) => expect(Math.abs(a - b)).toBeLessThan(eps);
export const nearPt = (a: Vec2, b: Vec2, eps = EPS) => {
  near(a.x, b.x, eps);
  near(a.y, b.y, eps);
};
export const len = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);
