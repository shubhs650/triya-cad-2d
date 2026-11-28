// ASME B16.5 flanges (M8-01): a class, size and type's dimensions, from the inch tables in
// b16-5-tables.ts, as the drawing generator (draw.ts) uses them.
import { B16_5_TABLES, type B165Row } from './b16-5-tables';
import { pipeBore, type PipeSchedule } from './pipe-bores';

/** B16.5's pressure classes. */
export const B16_5_CLASSES = [150, 300, 400, 600, 900, 1500, 2500] as const;
export type B165Class = (typeof B16_5_CLASSES)[number];

/** B16.5's flange types: weld neck, slip-on, blind, lap joint, socket welding, threaded. */
export const FLANGE_TYPES = ['WN', 'SO', 'BL', 'LJ', 'SW', 'TH'] as const;
export type FlangeType = (typeof FLANGE_TYPES)[number];

export const FLANGE_TYPE_NAMES: Readonly<Record<FlangeType, string>> = {
  WN: 'weld neck',
  SO: 'slip-on',
  BL: 'blind',
  LJ: 'lap joint',
  SW: 'socket welding',
  TH: 'threaded',
};

/** The sizes B16.5 covers, NPS ½ to 24. */
export const B16_5_SIZES = [
  0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24,
] as const;

/** A B16.5 flange to look up. */
export interface B165Spec {
  readonly flangeClass: B165Class;
  readonly nps: number;
  readonly type: FlangeType;
  /** The pipe a weld neck or socket welding flange is bored to; standard wall by default. */
  readonly schedule?: PipeSchedule;
}

/**
 * One flange's dimensions, inches. Along the axis the flange runs from its gasket face (0) to
 * the end of its hub: `raisedFace.height`, then the `thickness` of the ring, then the hub.
 */
export interface FlangeDimensions {
  readonly spec: Required<B165Spec>;
  readonly outsideDiameter: number;
  /** The ring's thickness behind the raised face (B16.5 tf; a lap joint's own thickness). */
  readonly thickness: number;
  /** Absent on a lap joint flange, whose face is its stub end's. */
  readonly raisedFace?: { readonly diameter: number; readonly height: number };
  readonly hub?: {
    /** X, at the back of the ring. */
    readonly baseDiameter: number;
    /** At the hub's end: A (the pipe's outside diameter) on a weld neck, else X. */
    readonly endDiameter: number;
    /** Y, from the back of the raised face (the ring's front) to the hub's end. */
    readonly length: number;
  };
  /** The through bore; absent on a blind flange. */
  readonly bore?: number;
  readonly bolting: {
    readonly count: number;
    readonly holeDiameter: number;
    readonly circleDiameter: number;
    /** The bolt's nominal diameter, 1/8 in. under the hole. */
    readonly boltDiameter: number;
  };
  /** A socket welding flange's socket, from the hub's end. */
  readonly socket?: { readonly diameter: number; readonly depth: number };
  /** A threaded flange's thread (major diameter A, from the hub's end) and face counterbore Q. */
  readonly thread?: {
    readonly diameter: number;
    readonly length: number;
    readonly counterbore: number;
  };
  /** A lap joint flange's bore corner radius, at the face. */
  readonly lapRadius?: number;
}

/** The row for a class and size, following B16.5's "use the higher class" notes. */
function row(flangeClass: B165Class, nps: number): B165Row | undefined {
  const own = B16_5_TABLES[flangeClass].find((r) => r[0] === nps);
  if (own) return own;
  // B16.5: Class 400 in NPS 3½ and under is made to Class 600; Class 900 in NPS 2½ and under to
  // Class 1500.
  if (flangeClass === 400 && nps <= 3.5) return row(600, nps);
  if (flangeClass === 900 && nps <= 2.5) return row(1500, nps);
  return undefined;
}

/** B16.5's raised face height: 1/16 in. for Classes 150 and 300, 1/4 in. above. */
export function raisedFaceHeight(flangeClass: B165Class): number {
  return flangeClass <= 300 ? 0.06 : 0.25;
}

/**
 * The dimensions of B16.5 flange `spec`, inches; undefined when B16.5 has no such flange (a
 * slip-on in Class 2500, a socket welding flange over NPS 3, a size the class lacks) or the
 * schedule asked for has no pipe in that size.
 */
export function b165Flange(spec: B165Spec): FlangeDimensions | undefined {
  const r = row(spec.flangeClass, spec.nps);
  if (!r) return undefined;
  const [, O, tf, tfLap, R, X, holes, hole, W, bSO, bLap, A, ySO, yWN, yLap, rad, q, d, t] = r;
  const schedule = spec.schedule ?? 'STD';
  const full = { ...spec, schedule };
  const bolting = {
    count: holes,
    holeDiameter: hole,
    circleDiameter: W,
    boltDiameter: Math.round((hole - 0.125) * 8) / 8,
  };
  const raisedFace = { diameter: R, height: raisedFaceHeight(spec.flangeClass) };
  const base = { spec: full, outsideDiameter: O, thickness: tf, raisedFace, bolting };
  const hub = (length: number, endDiameter = X) => ({ baseDiameter: X, endDiameter, length });
  switch (spec.type) {
    case 'WN': {
      const bore = pipeBore(spec.nps, schedule);
      return bore === undefined ? undefined : { ...base, hub: hub(yWN, A), bore };
    }
    case 'SO':
      return bSO === null || ySO === null ? undefined : { ...base, hub: hub(ySO), bore: bSO };
    case 'BL':
      return base;
    case 'LJ': {
      const { raisedFace: _none, ...ring } = base;
      return { ...ring, thickness: tfLap ?? tf, hub: hub(yLap), bore: bLap, lapRadius: rad };
    }
    case 'SW': {
      const bore = pipeBore(spec.nps, schedule);
      if (bSO === null || ySO === null || d === null || bore === undefined) return undefined;
      return { ...base, hub: hub(ySO), bore, socket: { diameter: bSO, depth: d } };
    }
    case 'TH':
      if (ySO === null || t === null || q === null) return undefined;
      return {
        ...base,
        hub: hub(ySO),
        bore: A,
        thread: { diameter: A, length: t, counterbore: q },
      };
  }
}

/** The sizes in which B16.5 has a `type` flange of `flangeClass`. */
export function b165Sizes(flangeClass: B165Class, type: FlangeType): number[] {
  return B16_5_SIZES.filter((nps) => b165Flange({ flangeClass, nps, type }) !== undefined);
}

/** "½", "1¼", "24": a nominal pipe size as drafters write it. */
export function npsLabel(nps: number): string {
  const whole = Math.floor(nps);
  const part = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' }[nps - whole] ?? String(nps - whole);
  return `${whole === 0 ? '' : whole}${part}`;
}
