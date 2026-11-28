// Nozzle details (M8-02): a nozzle neck welded into (set-in) or onto (set-on) a vessel's shell,
// with or without a reinforcing pad, drawn as a section on the nozzle's axis.
//
// Placement: the base point is on the nozzle's axis at the shell's outside surface; the neck
// points up (+Y) and the shell lies along X, drawn flat (a detail shows the wall, not the
// vessel's curve), its inside surface at y = -shell thickness. The projection is measured
// from the shell's outside surface to the neck's end, where a weld neck flange's hub (M8-01)
// meets it.
//
// Set-in: the neck passes through a hole of its outside diameter and may stand into the
// vessel (internal projection). Set-on: the neck stands on the shell, over a hole of its bore.
// A pad is a ring on the shell's outside around the neck (its bore the neck's outside
// diameter); the neck passes through it in both kinds. Welds are fillets of the given leg at
// the neck's outside (on the pad when there is one) and the pad's rim; the groove of a set-on
// or full-penetration weld is the weld symbol's business (later in M8-02), not the outline's.
// Section lining per ASME Y14.3: adjacent parts at different angles (shell 45°, neck 135°,
// pad 90°), the welds solid.
import { closed, corner, hatch, line, rect, solid, type Corner, type LibraryPart } from '../parts';
import type { DetailField, DetailGenerator, DetailSpec } from './detail';

type NozzleKey =
  | 'neckOD'
  | 'neckThickness'
  | 'shellThickness'
  | 'projection'
  | 'internalProjection'
  | 'padDiameter'
  | 'padThickness'
  | 'weldLeg'
  | 'shellLength';

const FIELDS: readonly DetailField<NozzleKey>[] = [
  { key: 'neckOD', code: 'OD', label: 'neck OD', kind: 'length' },
  { key: 'neckThickness', code: 'T', label: 'neck thickness', kind: 'length' },
  { key: 'shellThickness', code: 'TS', label: 'shell thickness', kind: 'length' },
  { key: 'projection', code: 'P', label: 'projection', kind: 'length' },
  {
    key: 'internalProjection',
    code: 'IP',
    label: 'internal projection',
    kind: 'length',
    optional: true,
  },
  { key: 'padDiameter', code: 'PD', label: 'pad diameter', kind: 'length', optional: true },
  { key: 'padThickness', code: 'TP', label: 'pad thickness', kind: 'length', optional: true },
  { key: 'weldLeg', code: 'W', label: 'weld leg', kind: 'length', optional: true },
  { key: 'shellLength', code: 'L', label: 'shell length shown', kind: 'length' },
];

/** NPS 6 Schedule 80 on a ½ in. shell, with a pad twice the neck's diameter. */
const DEFAULTS: DetailSpec<NozzleKey> = {
  neckOD: 6.625,
  neckThickness: 0.432,
  shellThickness: 0.5,
  projection: 8,
  internalProjection: 0,
  padDiameter: 13.25,
  padThickness: 0.5,
  weldLeg: 0.375,
  shellLength: 20,
};

function check(s: DetailSpec<NozzleKey>): string | undefined {
  if (s.neckThickness >= s.neckOD / 2) return 'neck thickness must be less than half the neck OD';
  if ((s.padDiameter === 0) !== (s.padThickness === 0))
    return 'a pad needs both its diameter and its thickness';
  if (s.padDiameter !== 0 && s.padDiameter <= s.neckOD)
    return 'pad diameter must be more than the neck OD';
  if (s.shellLength <= Math.max(s.neckOD, s.padDiameter))
    return 'shell length shown must be more than the neck OD and the pad diameter';
  if (s.weldLeg >= s.projection) return 'weld leg must be less than the projection';
  return undefined;
}

/** Each loop and its mirror image across the axis. */
const pair = (loop: Corner[]): Corner[][] => [loop, loop.map((c) => ({ ...c, x: -c.x })).reverse()];

function nozzleParts(s: DetailSpec<NozzleKey>, setIn: boolean): LibraryPart[] {
  const ro = s.neckOD / 2;
  const ri = ro - s.neckThickness;
  const ts = s.shellThickness;
  const half = s.shellLength / 2;
  const bottom = setIn ? -ts - s.internalProjection : 0;
  const hole = setIn ? ro : ri;
  const pad = s.padDiameter > 0;
  const shell = pair(rect(hole, -ts, half, 0));
  const neck = pair(rect(ri, bottom, ro, s.projection));
  const pads = pad ? pair(rect(ro, 0, s.padDiameter / 2, s.padThickness)) : [];
  const welds: Corner[][] = [];
  if (s.weldLeg > 0) {
    const top = pad ? s.padThickness : 0;
    const w = s.weldLeg;
    welds.push(...pair([corner(ro, top), corner(ro + w, top), corner(ro, top + w)]));
    if (pad) {
      // A pad's rim weld is no bigger than the pad is thick.
      const rim = s.padDiameter / 2;
      const wp = Math.min(w, s.padThickness);
      welds.push(...pair([corner(rim, 0), corner(rim + wp, 0), corner(rim, wp)]));
    }
  }
  const outlines = [...shell, ...neck, ...pads, ...welds];
  const parts: LibraryPart[] = outlines.map((l) => ({ role: 'visible', geom: closed(l) }));
  // Beyond the cut, the bore's far half is seen edge on where it ends or changes part.
  const across = setIn ? [bottom, s.projection] : [-ts, 0, s.projection];
  for (const y of across) parts.push({ role: 'visible', geom: line({ x: -ri, y }, { x: ri, y }) });
  const spacing = Math.max(ts, s.neckThickness) / 3;
  parts.push({ role: 'hatch', geom: hatch(shell, spacing, Math.PI / 4) });
  parts.push({ role: 'hatch', geom: hatch(neck, spacing, (3 * Math.PI) / 4) });
  if (pad) parts.push({ role: 'hatch', geom: hatch(pads, spacing, Math.PI / 2) });
  if (welds.length > 0) parts.push({ role: 'hatch', geom: solid(welds) });
  const m = s.neckOD / 8;
  parts.push({
    role: 'center',
    geom: line({ x: 0, y: Math.min(bottom, -ts) - m }, { x: 0, y: s.projection + m }),
  });
  return parts;
}

type SetOnKey = Exclude<NozzleKey, 'internalProjection'>;

const SET_ON_FIELDS = FIELDS.filter(
  (f): f is DetailField<SetOnKey> => f.key !== 'internalProjection',
);

const { internalProjection: _, ...SET_ON_DEFAULTS } = DEFAULTS;

export const NOZZLE_SET_IN: DetailGenerator<NozzleKey> = {
  id: 'NOZZLE_SET_IN',
  label: 'Set-in nozzle',
  view: 'section',
  fields: FIELDS,
  defaults: DEFAULTS,
  check,
  parts: (s) => nozzleParts(s, true),
};

export const NOZZLE_SET_ON: DetailGenerator<SetOnKey> = {
  id: 'NOZZLE_SET_ON',
  label: 'Set-on nozzle',
  view: 'section',
  fields: SET_ON_FIELDS,
  defaults: SET_ON_DEFAULTS,
  check: (s) => check({ ...s, internalProjection: 0 }),
  parts: (s) => nozzleParts({ ...s, internalProjection: 0 }, false),
};
