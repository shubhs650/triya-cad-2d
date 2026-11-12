// A Properties palette edit (M2-21): one property set on every selected object of the type the
// palette shows. Each edit is one undo step, as in AutoCAD, and goes through the same edits the
// commands use where the property moves the object (Position, Center, Rotation of a reference or
// a text: MOVE and ROTATE's `transformObjects`, which keep attributes, associativity and a
// dimension's block in step).
//
// Objects on locked layers are not changed ("on a locked layer"); a value the property cannot
// take changes nothing and says why, as AutoCAD's palette refuses it ("Invalid input").
import { parseAngleValue, parseNumber } from '../commands/parse';
import { moveBy, turnAbout } from '../edit/similarity';
import { transformObjects } from '../edit/edit';
import { rescaledReference } from '../edit/transform';
import { JUSTIFICATIONS, rejustified } from '../commands/modify/attributes';
import type { PatternPlacement, PlacedPattern, TextOutline } from '../commands/view/host';
import type { EntityId } from '../model/entity-ids';
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityPatch } from '../model/update';
import type {
  Entity,
  EntityGeometry,
  HatchGeometry,
  HatchPatternLine,
  InsertAttribute,
} from '../model/types';
import { withDimvarOverride } from '../annotation/dstyle';
import { currentHeader } from './current';
import type { GeneralProps } from './sheet';
import { DIMVAR_DEFAULTS, DIMVAR_ROWS, rowVars } from './dimension';
import {
  MAX_TRANSPARENCY,
  isPatterned,
  parseColorValue,
  parseLineweightValue,
  textPositionOf,
  transparencyOf,
  type PropertyValue,
} from './sheet';

/** A Justify row's TEXT objects as the canvas draws them now, by id (null: no font draws it). */
export type TextOutlines = ReadonlyMap<EntityId, TextOutline | null>;

/**
 * A Pattern name edit's hatches as the app's pattern library placed the new pattern for each,
 * by id (`hatchPattern`, M2-35 part 3).
 */
export type HatchPatterns = ReadonlyMap<
  EntityId,
  { readonly name: string; readonly custom: boolean; readonly lines: readonly HatchPatternLine[] }
>;

/** What the palette sends: the row's key and the value chosen or typed. */
export interface PropertyEdit {
  readonly key: string;
  /** A choice's option value, a number, or typed text (parsed as the row's kind). */
  readonly value: PropertyValue;
}

export interface PropertyEditReport {
  /** How many objects changed. */
  readonly changed: number;
  /** Reason → how many objects it kept out. */
  readonly refused: ReadonlyMap<string, number>;
  /** Why the value itself was refused (nothing changed), or undefined. */
  readonly invalid?: string;
}

const LOCKED = 'on a locked layer';
const INVALID = 'Invalid input';

type Kind = 'distance' | 'positive' | 'angle' | 'number' | 'text' | 'yesNo';

/** A typed or chosen value as a number of `kind`, or undefined when it does not read. */
function numeric(v: PropertyValue, kind: Kind): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  if (kind === 'angle') return parseAngleValue(v);
  return parseNumber(v.trim());
}

function yesNo(v: PropertyValue): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return undefined;
}

/**
 * The patch a geometric property makes to one object, or a reason it cannot take it. Moves and
 * turns are returned as such, for `transformObjects`.
 */
type Change =
  | { readonly patch: EntityPatch }
  | { readonly move: Vec2 }
  | { readonly turn: { readonly about: Vec2; readonly by: number } }
  | { readonly refuse: string }
  | { readonly skip: true };

const UNMEASURED = 'its text cannot be measured';
const ANNOTATIVE = 'annotative (each scale keeps its own placement)';

/** MTEXT attachments 1–9 by AutoCAD's names, as the sheet's Justify choices give them. */
const ATTACHMENTS = [
  'Top left',
  'Top center',
  'Top right',
  'Middle left',
  'Middle center',
  'Middle right',
  'Bottom left',
  'Bottom center',
  'Bottom right',
];

/** MIRRTEXT, 0 unless the drawing says 1 (AutoCAD's default). */
const mirrorText = (model: DocumentModel): boolean => {
  const v = model.header.get('$MIRRTEXT');
  return v === 1 || v === true;
};

/**
 * The rows M2-35 part 2 made editable that need the drawing or the canvas: a text's Style (a
 * fixed-height style gives the text its height, as TEXT does when placing one; AutoCAD's help
 * does not say whether the palette does, and a drafter picking a 3.5 style expects 3.5 text)
 * and Justify (the insertion point kept and the text moving about it, as AutoCAD's palette does;
 * `rejustified` with the canvas's `outlines`), a reference's Scale X/Y/Z (`rescaledReference`)
 * and a polyline's Global width (every segment that width: DXF 43, the vertices' own widths
 * gone). Undefined for another key.
 */
function typeRowChange(
  model: DocumentModel,
  e: Entity,
  key: string,
  v: PropertyValue,
  outlines: TextOutlines | undefined,
  patterns: HatchPatterns | undefined,
): Change | undefined | 'invalid' {
  const g = e.geom;
  if (g.kind === 'HATCH') return hatchChange(e.id, g, key, v, patterns);
  if (key === 'style' && (g.kind === 'TEXT' || g.kind === 'MTEXT')) {
    const style = typeof v === 'string' ? model.tables.textStyles.get(v) : undefined;
    if (!style) return 'invalid';
    return geomPatch({
      ...g,
      style: style.handle,
      ...(style.height > 0 && { height: style.height }),
    });
  }
  if (key === 'justify' && g.kind === 'MTEXT') {
    const attachment = ATTACHMENTS.indexOf(String(v)) + 1;
    return attachment > 0 ? geomPatch({ ...g, attachment }) : 'invalid';
  }
  if (key === 'justify' && g.kind === 'TEXT') {
    const j = JUSTIFICATIONS.find((x) => x.name === v);
    if (!j) return 'invalid';
    if (j.halign === g.halign && j.valign === g.valign) return { skip: true };
    if (e.annotative) return { refuse: ANNOTATIVE };
    const placed = rejustified(g, j.halign, j.valign, outlines?.get(e.id) ?? undefined);
    if (!placed) return { refuse: UNMEASURED };
    const { alignmentPoint: _old, ...rest } = g;
    return geomPatch({ ...rest, ...placed });
  }
  if (g.kind === 'INSERT' && /^scale[XYZ]$/.test(key)) {
    const n = numeric(v, 'number');
    // AutoCAD refuses a zero scale ("Value must be nonzero").
    if (n === undefined || n === 0) return 'invalid';
    const axis = key === 'scaleX' ? 'x' : key === 'scaleY' ? 'y' : 'z';
    const scale = { ...g.scale, [axis]: n };
    return geomPatch(rescaledReference(g, scale, { mirrorText: mirrorText(model) }));
  }
  if (key === 'globalWidth' && g.kind === 'LWPOLYLINE') {
    const n = numeric(v, 'number');
    if (n === undefined || n < 0) return 'invalid';
    const vertices = g.vertices.map(({ startWidth: _s, endWidth: _e, ...rest }) => rest);
    return geomPatch({ ...g, vertices, constantWidth: n });
  }
  return undefined;
}

const geomPatch = (geom: EntityGeometry): Change => ({ patch: { geom } });

const GRADIENT = 'a gradient fill';
const USER_DEFINED = 'user defined (its Spacing sets it)';
const NOT_USER_DEFINED = 'not user defined (its Scale sets it)';

/**
 * The point a hatch's pattern lines start from: the first line's base point (AutoCAD keeps the
 * hatch origin, HPORIGIN, only in the lines it stores: DXF 43/44 are the origin turned and
 * scaled from the pattern file's first line, which in the ANSI, ISO and Triya patterns, and in
 * every user-defined hatch, starts at 0,0), else the drawing's origin.
 */
function patternOrigin(g: HatchGeometry): Vec2 {
  return (isPatterned(g) && g.patternLines[0]?.base) || { x: 0, y: 0 };
}

/**
 * Where a hatch given another pattern places it: at its angle and scale, about its origin. A
 * user-defined hatch's DXF 41 is a spacing, not a scale, and a solid fill has none: both 1.
 */
export function patternPlacement(g: HatchGeometry): PatternPlacement {
  const scaled = isPatterned(g) && g.patternType !== 0 && g.patternScale > 0;
  return { angle: g.patternAngle, scale: scaled ? g.patternScale : 1, origin: patternOrigin(g) };
}

/**
 * Pattern lines turned by `by` and scaled by `k` about `o`, as AutoCAD lays a pattern out again
 * at a new angle or scale about the same origin (each line's base point, its offset and dashes).
 */
function relaidLines(
  lines: readonly HatchPatternLine[],
  o: Vec2,
  by: number,
  k: number,
): HatchPatternLine[] {
  const c = Math.cos(by);
  const s = Math.sin(by);
  const t = (v: Vec2): Vec2 => ({ x: k * (v.x * c - v.y * s), y: k * (v.x * s + v.y * c) });
  return lines.map((l) => {
    const d = t({ x: l.base.x - o.x, y: l.base.y - o.y });
    return {
      angle: l.angle + by,
      base: { x: o.x + d.x, y: o.y + d.y },
      offset: t(l.offset),
      dashes: l.dashes.map((x) => x * k),
    };
  });
}

/**
 * A hatch's Pattern rows (M2-35 part 3, AutoCAD 2024's Properties): Pattern name (SOLID, or a
 * pattern `patterns` holds from the app's library), Angle and Scale (the stored lines laid out
 * again about the hatch's origin), Spacing and Double for a user-defined hatch (a second family
 * at 90° to the first, as HATCH's Double makes it), Island detection style (DXF 75). A gradient
 * keeps its pattern; a solid fill has no lines to turn or scale.
 */
function hatchChange(
  id: EntityId,
  g: HatchGeometry,
  key: string,
  v: PropertyValue,
  patterns: HatchPatterns | undefined,
): Change | undefined | 'invalid' {
  const patterned = isPatterned(g);
  switch (key) {
    case 'patternName': {
      const name = typeof v === 'string' ? v.trim() : '';
      if (name === '') return 'invalid';
      if (g.gradient) return { refuse: GRADIENT };
      if (name.toUpperCase() === g.pattern.toUpperCase()) return { skip: true };
      if (name.toUpperCase() === 'SOLID') {
        // DXF states a hatch's angle and scale (52, 41) for pattern fills only, so a solid fill
        // has the reader's 0 and 0 (the OCS angle 0 is π in the WCS on a −Z plane).
        return geomPatch({
          ...g,
          pattern: 'SOLID',
          solid: true,
          patternType: 1,
          patternAngle: (g.normal?.z ?? 1) < 0 ? Math.PI : 0,
          patternScale: 0,
          double: false,
          patternLines: [],
        });
      }
      const p = patterns?.get(id);
      if (!p) return 'invalid';
      return geomPatch({
        ...g,
        pattern: p.name,
        solid: false,
        patternType: p.custom ? 2 : 1,
        double: false,
        patternScale: patternPlacement(g).scale,
        patternLines: [...p.lines],
      });
    }
    case 'patternAngle': {
      const n = numeric(v, 'angle');
      if (n === undefined) return 'invalid';
      if (!patterned) return { skip: true };
      const by = n - g.patternAngle;
      return geomPatch({
        ...g,
        patternAngle: normalizeAngle(n),
        patternLines: relaidLines(g.patternLines, patternOrigin(g), by, 1),
      });
    }
    case 'patternScale':
    case 'patternSpacing': {
      const n = numeric(v, 'number');
      if (n === undefined || !(n > 0)) return 'invalid';
      if (!patterned) return { skip: true };
      const user = g.patternType === 0;
      if (user !== (key === 'patternSpacing')) {
        return { refuse: user ? USER_DEFINED : NOT_USER_DEFINED };
      }
      // A stored scale of 0 (a file's) lays the lines out as they are, at scale 1.
      const k = n / (g.patternScale > 0 ? g.patternScale : 1);
      return geomPatch({
        ...g,
        patternScale: n,
        patternLines: relaidLines(g.patternLines, patternOrigin(g), 0, k),
      });
    }
    case 'double': {
      const b = yesNo(v);
      if (b === undefined) return 'invalid';
      if (!patterned) return { skip: true };
      if (g.patternType !== 0) return { refuse: NOT_USER_DEFINED };
      const first = g.patternLines[0];
      const patternLines =
        b && first
          ? [first, ...relaidLines([first], first.base, Math.PI / 2, 1)]
          : g.patternLines.slice(0, 1);
      return geomPatch({ ...g, double: b, patternLines });
    }
    case 'islandStyle': {
      const style = ['0', '1', '2'].indexOf(String(v));
      return style < 0 ? 'invalid' : geomPatch({ ...g, style });
    }
    default:
      return undefined;
  }
}

/**
 * The hatches a Pattern name edit gives a pattern the app's library must place first (not SOLID,
 * not a gradient, not one already of that name), each with where it places it.
 */
export function hatchesToPattern(
  entities: readonly Entity[],
  edit: PropertyEdit,
): { readonly entity: Entity; readonly placement: PatternPlacement }[] {
  if (edit.key !== 'patternName' || typeof edit.value !== 'string') return [];
  const name = edit.value.trim().toUpperCase();
  if (name === '' || name === 'SOLID') return [];
  const out: { entity: Entity; placement: PatternPlacement }[] = [];
  for (const e of entities) {
    const g = e.geom;
    if (g.kind !== 'HATCH' || g.gradient || g.pattern.toUpperCase() === name) continue;
    out.push({ entity: e, placement: patternPlacement(g) });
  }
  return out;
}

/** `hatchPattern`'s reply as each hatch's new pattern. */
export function placedPatterns(
  hatches: readonly { readonly entity: Entity }[],
  placed: PlacedPattern,
): HatchPatterns {
  return new Map(
    hatches.map((h, i) => [
      h.entity.id,
      { name: placed.name, custom: placed.custom, lines: placed.lines[i] ?? [] },
    ]),
  );
}

const delta = (from: number, to: number, axis: 'x' | 'y'): Vec2 =>
  axis === 'x' ? { x: to - from, y: 0 } : { x: 0, y: to - from };

/** How a geometry key changes `e` to `n`; undefined for a key the type does not have. */
function geometryChange(
  e: Entity,
  key: string,
  n: number | undefined,
  b: boolean | undefined,
  text: string | undefined,
): Change | undefined | 'invalid' {
  const g = e.geom;
  const pos = n !== undefined && n > 0;
  switch (g.kind) {
    case 'LINE':
      if (n === undefined) return key.match(/^(start|end)[XY]$/) ? 'invalid' : undefined;
      if (key === 'startX') return geomPatch({ ...g, start: { ...g.start, x: n } });
      if (key === 'startY') return geomPatch({ ...g, start: { ...g.start, y: n } });
      if (key === 'endX') return geomPatch({ ...g, end: { ...g.end, x: n } });
      if (key === 'endY') return geomPatch({ ...g, end: { ...g.end, y: n } });
      return undefined;
    case 'CIRCLE':
    case 'ARC': {
      if (key === 'centerX' || key === 'centerY') {
        if (n === undefined) return 'invalid';
        const axis = key === 'centerX' ? 'x' : 'y';
        return { move: delta(g.center[axis], n, axis) };
      }
      const radius =
        key === 'radius'
          ? n
          : g.kind === 'CIRCLE' && key === 'diameter' && n !== undefined
            ? n / 2
            : g.kind === 'CIRCLE' && key === 'circumference' && n !== undefined
              ? n / (2 * Math.PI)
              : g.kind === 'CIRCLE' && key === 'area' && n !== undefined && n > 0
                ? Math.sqrt(n / Math.PI)
                : undefined;
      if (['radius', 'diameter', 'circumference', 'area'].includes(key)) {
        if (g.kind === 'ARC' && key !== 'radius') return undefined;
        if (radius === undefined || !pos) return 'invalid';
        return geomPatch({ ...g, radius });
      }
      if (g.kind === 'ARC' && (key === 'startAngle' || key === 'endAngle')) {
        if (n === undefined) return 'invalid';
        return geomPatch({ ...g, [key]: normalizeAngle(n) });
      }
      return undefined;
    }
    case 'ELLIPSE':
      if (key === 'centerX' || key === 'centerY') {
        if (n === undefined) return 'invalid';
        const axis = key === 'centerX' ? 'x' : 'y';
        return { move: delta(g.center[axis], n, axis) };
      }
      return undefined;
    case 'POINT':
    case 'MTEXT':
    case 'INSERT':
    case 'TEXT': {
      if (key === 'positionX' || key === 'positionY') {
        if (n === undefined) return 'invalid';
        const axis = key === 'positionX' ? 'x' : 'y';
        const at = g.kind === 'TEXT' ? textPositionOf(g) : g.position;
        return { move: delta(at[axis], n, axis) };
      }
      if (g.kind === 'POINT') return undefined;
      if (key === 'rotation') {
        if (n === undefined) return 'invalid';
        const at = g.kind === 'TEXT' ? textPositionOf(g) : g.position;
        return { turn: { about: at, by: n - g.rotation } };
      }
      if (g.kind === 'INSERT') return undefined;
      if (key === 'height') {
        if (n === undefined || n <= 0) return 'invalid';
        return geomPatch({ ...g, height: n });
      }
      if (g.kind === 'MTEXT') {
        if (key === 'width') {
          if (n === undefined || n < 0) return 'invalid';
          return geomPatch({ ...g, width: n });
        }
        if (key === 'lineSpacing') {
          // MTEXT's line spacing factor: 0.25 to 4.00 (AutoCAD's range).
          if (n === undefined || n < 0.25 || n > 4) return 'invalid';
          return geomPatch({ ...g, lineSpacing: n });
        }
        return undefined;
      }
      if (key === 'contents') {
        if (text === undefined) return 'invalid';
        return geomPatch({ ...g, value: text });
      }
      if (key === 'widthFactor') {
        // TEXT width factor: 0.01 to 100 (STYLE's range).
        if (n === undefined || n < 0.01 || n > 100) return 'invalid';
        return geomPatch({ ...g, widthFactor: n });
      }
      if (key === 'oblique') {
        // Obliquing angle: −85° to 85°.
        if (n === undefined || Math.abs(n) > (85 * Math.PI) / 180 + 1e-12) return 'invalid';
        return geomPatch({ ...g, oblique: n });
      }
      if (key === 'upsideDown' || key === 'backward') {
        if (b === undefined) return 'invalid';
        return geomPatch({ ...g, [key]: b });
      }
      return undefined;
    }
    case 'LWPOLYLINE':
      if (key === 'closed') {
        if (b === undefined) return 'invalid';
        return geomPatch({ ...g, closed: b });
      }
      if (key === 'elevation') {
        if (n === undefined) return 'invalid';
        return geomPatch(n === 0 ? withoutElevation(g) : { ...g, elevation: n });
      }
      return undefined;
    default:
      return undefined;
  }
}

function withoutElevation<T extends { readonly elevation?: number }>(g: T): T {
  const { elevation: _elevation, ...rest } = g;
  return rest as T;
}

function normalizeAngle(a: number): number {
  const tau = 2 * Math.PI;
  return ((a % tau) + tau) % tau;
}

const ANGLE_KEYS = new Set(['rotation', 'startAngle', 'endAngle', 'oblique']);

/** The General properties' patch, or 'invalid'; undefined for a key that is not General. */
function generalPatch(model: DocumentModel, key: string, v: PropertyValue) {
  switch (key) {
    case 'color': {
      const color = typeof v === 'string' ? parseColorValue(v) : undefined;
      return color ? { color } : 'invalid';
    }
    case 'layer':
      return typeof v === 'string' && model.tables.layers.has(v) ? { layer: v } : 'invalid';
    case 'linetype':
      return typeof v === 'string' &&
        (v === 'ByLayer' || v === 'ByBlock' || model.tables.linetypes.has(v))
        ? { linetype: v }
        : 'invalid';
    case 'ltScale': {
      const n = numeric(v, 'number');
      return n !== undefined && n > 0 ? { ltScale: n } : 'invalid';
    }
    case 'lineweight': {
      const w = typeof v === 'string' ? parseLineweightValue(v) : parseLineweightValue(String(v));
      return w !== undefined ? { lineweight: w } : 'invalid';
    }
    case 'transparency': {
      if (v === 'ByLayer' || v === 'ByBlock') return { transparency: v };
      const n = numeric(v, 'number');
      return n !== undefined && Number.isInteger(n) && n >= 0 && n <= MAX_TRANSPARENCY
        ? { transparency: transparencyOf(n) }
        : 'invalid';
    }
    default:
      return undefined;
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Sets `edit`, a General row, as the drawing's current setting (nothing selected, M2-35): the
 * header variable new objects take it from. `changed` counts the variables set.
 */
export function applyCurrentEdit(
  b: ChangeSetBuilder,
  model: DocumentModel,
  edit: PropertyEdit,
): PropertyEditReport {
  const refused = new Map<string, number>();
  const general = generalPatch(model, edit.key, edit.value);
  if (!general || general === 'invalid') return { changed: 0, refused, invalid: INVALID };
  const header = currentHeader(model, general as Partial<GeneralProps>);
  if (typeof header === 'string') return { changed: 0, refused, invalid: header };
  let changed = 0;
  for (const [name, value] of header) {
    if (same(model.header.get(name), value)) continue;
    b.setHeader(name, value);
    changed++;
  }
  return { changed, refused };
}

/**
 * Sets `edit` on `entities` (the selected objects of the type the palette shows) through `b`.
 * A value that does not read changes nothing and reports `invalid`.
 */
export function applyPropertyEdit(
  b: ChangeSetBuilder,
  model: DocumentModel,
  entities: readonly Entity[],
  edit: PropertyEdit,
  outlines?: TextOutlines,
  patterns?: HatchPatterns,
): PropertyEditReport {
  const refused = new Map<string, number>();
  const editable = entities.filter((e) => {
    const locked = model.tables.layers.get(e.layer)?.locked === true;
    if (locked) refused.set(LOCKED, (refused.get(LOCKED) ?? 0) + 1);
    return !locked;
  });
  const general = generalPatch(model, edit.key, edit.value);
  if (general === 'invalid') return { changed: 0, refused, invalid: INVALID };
  if (general) {
    let changed = 0;
    for (const e of editable) {
      const patch = general as EntityPatch;
      const differs = Object.entries(patch).some(([k, v]) => !same(e[k as keyof Entity], v));
      if (!differs) continue;
      b.updateEntity(e.id, patch);
      changed++;
    }
    return { changed, refused };
  }

  const attribute = /^attribute:(.+)$/.exec(edit.key);
  if (attribute) return { ...attributeEdit(b, editable, attribute[1]!, edit.value), refused };
  if (DIMENSION_KEYS.test(edit.key)) {
    return { ...dimensionEdit(b, model, editable, edit), refused };
  }

  const n = numeric(edit.value, ANGLE_KEYS.has(edit.key) ? 'angle' : 'number');
  const flag = yesNo(edit.value);
  const text = typeof edit.value === 'string' ? edit.value : undefined;
  // Work out every object's change first: a value one of them cannot take changes none.
  const changes: [Entity, Change][] = [];
  for (const e of editable) {
    const c =
      typeRowChange(model, e, edit.key, edit.value, outlines, patterns) ??
      geometryChange(e, edit.key, n, flag, text);
    if (c === 'invalid') return { changed: 0, refused, invalid: INVALID };
    if (c && 'refuse' in c) refused.set(c.refuse, (refused.get(c.refuse) ?? 0) + 1);
    else if (c) changes.push([e, c]);
  }
  let changed = 0;
  for (const [e, c] of changes) {
    if ('patch' in c) {
      if (same(c.patch.geom, e.geom)) continue;
      b.updateEntity(e.id, c.patch);
      changed++;
    } else if ('move' in c) {
      if (c.move.x === 0 && c.move.y === 0) continue;
      changed += transformObjects(b, model, [e.id], moveBy(c.move)).ids.length;
    } else if ('turn' in c) {
      if (Math.abs(c.turn.by) < 1e-15) continue;
      changed += transformObjects(b, model, [e.id], turnAbout(c.turn.about, c.turn.by)).ids.length;
    }
  }
  return { changed, refused };
}

/**
 * The objects a Justify edit gives a new justification that the canvas must measure first (a
 * single-line TEXT's DXF 10 is the baseline start its font draws from).
 */
export function textsToMeasure(entities: readonly Entity[], edit: PropertyEdit): Entity[] {
  if (edit.key !== 'justify') return [];
  const j = JUSTIFICATIONS.find((x) => x.name === edit.value);
  if (!j) return [];
  return entities.filter(
    (e) =>
      e.geom.kind === 'TEXT' &&
      !e.annotative &&
      (e.geom.halign !== j.halign || e.geom.valign !== j.valign),
  );
}

/** One reference's attribute value (the Attributes section, a single reference shown). */
function attributeEdit(
  b: ChangeSetBuilder,
  entities: readonly Entity[],
  handle: string,
  v: PropertyValue,
): Omit<PropertyEditReport, 'refused'> {
  if (typeof v !== 'string') return { changed: 0, invalid: INVALID };
  for (const e of entities) {
    if (e.geom.kind !== 'INSERT') continue;
    const g = e.geom;
    const i = g.attributes.findIndex((a) => a.handle === handle);
    if (i < 0) continue;
    const a = g.attributes[i]!;
    if (a.mtext) return { changed: 0, invalid: INVALID };
    if (a.value === v) return { changed: 0 };
    const attributes: InsertAttribute[] = [...g.attributes];
    attributes[i] = { ...a, value: v };
    b.updateEntity(e.id, { geom: { ...g, attributes } });
    return { changed: 1 };
  }
  return { changed: 0, invalid: INVALID };
}

const DIMENSION_KEYS = /^(dimStyle|textOverride|dimvar:.+)$/;

const isDimension = (e: Entity): boolean =>
  e.geom.kind === 'DIMENSION' ||
  e.geom.kind === 'ARC_DIMENSION' ||
  e.geom.kind === 'LARGE_RADIAL_DIMENSION';

/**
 * A dimension's Dim style, Text override or DIMVAR row (M2-30 part 2). The bus regenerates the
 * dimensions it changes once the edit ends (`regenerateRestyled`), as AutoCAD redraws them.
 */
function dimensionEdit(
  b: ChangeSetBuilder,
  model: DocumentModel,
  entities: readonly Entity[],
  edit: PropertyEdit,
): Omit<PropertyEditReport, 'refused'> {
  const dims = entities.filter(isDimension);
  const v = edit.value;
  type Dim = Extract<EntityGeometry, { kind: 'DIMENSION' }>;
  const geom = (e: Entity) => e.geom as Dim;
  let patchOf: (e: Entity) => EntityPatch | 'invalid';
  if (edit.key === 'dimStyle') {
    if (typeof v !== 'string' || !model.tables.dimStyles.has(v)) {
      return { changed: 0, invalid: INVALID };
    }
    patchOf = (e) => ({ geom: { ...geom(e), style: v } as EntityGeometry });
  } else if (edit.key === 'textOverride') {
    if (typeof v !== 'string') return { changed: 0, invalid: INVALID };
    patchOf = (e) => ({ geom: { ...geom(e), text: v } as EntityGeometry });
  } else {
    const d = DIMVAR_ROWS.find((r) => `dimvar:${r.name}` === edit.key);
    if (!d) return { changed: 0, invalid: INVALID };
    patchOf = (e) => {
      const set = d.set(v, rowVars(geom(e).style, e.xdata, model), model);
      if (set === undefined) return 'invalid';
      let xdata: Entity['xdata'] = e.xdata;
      for (const [name, value] of Object.entries(set)) {
        const next = withDimvarOverride(
          xdata ? { xdata } : {},
          geom(e).style,
          model,
          name,
          value,
          DIMVAR_DEFAULTS[name],
        );
        if (next === 'no-acad') return 'invalid';
        xdata = next;
      }
      return { xdata } as EntityPatch;
    };
  }
  const patches: [Entity, EntityPatch][] = [];
  for (const e of dims) {
    const patch = patchOf(e);
    if (patch === 'invalid') return { changed: 0, invalid: INVALID };
    patches.push([e, patch]);
  }
  let changed = 0;
  for (const [e, patch] of patches) {
    const differs = Object.entries(patch).some(([k, x]) => !same(e[k as keyof Entity], x));
    if (!differs) continue;
    b.updateEntity(e.id, patch);
    changed++;
  }
  return { changed };
}
