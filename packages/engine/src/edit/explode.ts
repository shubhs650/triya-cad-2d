// EXPLODE's edits (M3-02 part 4), as AutoCAD 2024 explodes (AutoCAD Help, "EXPLODE (Command)"):
//
// - A 2D polyline becomes its lines and arcs, along its centre line, losing its widths (AutoCAD
//   warns of that) and its fit; a 3D polyline becomes lines. Each piece keeps the polyline's
//   properties, elevation and thickness.
// - A block reference becomes copies of what its block holds, carried as the reference places
//   them, one level at a time (a nested reference stays a reference). The copies keep their own
//   properties, as AutoCAD's do ("the color, linetype and lineweight of any exploded object might
//   change": what was on layer 0 or ByBlock shows as it is). The reference's attributes go and
//   the block's attribute definitions show. External references, MINSERT arrays and blocks
//   whose definition is not explodable are not exploded.
// - A block reference scaled differently in X and Y (M3-12 part 7) explodes as AutoCAD's help
//   says ("Circle: If within a nonuniformly scaled block, explodes into ellipses", "Arc: …
//   into elliptical arcs"): lines, rays, xlines, ellipses, splines, points, solids, traces,
//   3D faces and polylines without arcs or widths are carried by the scale; text and attribute
//   definitions whose baseline and height stay square under it take the stretch in their
//   height and width factor, and nested references whose axes stay square stay references,
//   scaled; the rest ("objects that cannot be exploded") go into an anonymous `*E` block
//   referenced with the nonuniform scaling, and when nothing can be exploded the reference is
//   left alone. The ObjectARX Developer's Guide's "Exploding Entities" table lists the same
//   objects as exploding into themselves under a nonuniform scale.
// - A dimension becomes the lines, text, solids and points of the block it was last drawn as.
//   AutoCAD's help does not say which layer and colours the pieces take; they are given the
//   dimension's wherever they were layer 0 or ByBlock, so that the drawing looks the same, the
//   common drafter expectation.
//
// - A leader (M3-12 part 3) becomes the lines, spline, solid or block arrowhead it draws; its
//   annotation stays as it is. A multileader becomes its leader lines, landings and arrowheads,
//   and its MTEXT (with the frame and mask as the MTEXT's background) or block reference (with
//   the attribute values as ATTRIBs). AutoCAD Help: "Leaders: Explodes into lines, splines,
//   solids (arrow heads), block inserts (arrow heads, annotation blocks), multiline text, or
//   tolerance objects". Each part keeps the leader's properties where it draws ByBlock.
// - A table becomes what its `*T` block holds, placed in the table's frame, as a dimension does.
// - A region becomes the lines, arcs, circles and ellipses of its loops ("Region: Explodes into
//   lines, arcs, or splines"; Triya reads no spline edges, M1-39).
// - A multiline becomes the lines of its elements and its caps' lines and arcs ("Multiline:
//   Explodes into lines and arcs"), each in its element's colour and linetype, with the joints
//   when its style displays them; the fill goes. Element breaks (MLEDIT's cuts, the parameters
//   after the first) are not read: neither the DXF reference nor AutoCAD's help says how they
//   are measured, so the elements are whole, as ezdxf (MIT) draws them too.
// - A pattern hatch becomes its pattern's lines and dots as `@triya/hatch` clips them (given as
//   `ExplodeServices.hatchLines`); AutoCAD's help does not list hatches, and a solid or
//   gradient fill, which has no lines to become, is left alone (the common drafter
//   expectation: AutoCAD keeps a solid fill a hatch).
// - An MTEXT (M3-12 part 7) becomes a TEXT for each run of one format on each of its lines
//   ("Multiline Text: Explodes into text objects"), as the canvas lays it out in its fonts
//   (`ExplodeServices.textPieces`), and lines for its underlines, overlines, strike-throughs,
//   fraction bars and background frame; a run in another font than its style's takes a text
//   style with that font, made (named for the font) when the drawing has none, as ezdxf's
//   MTextExplode (MIT) does. Its background fill goes, as a TEXT has none. An MTEXT the canvas
//   cannot lay out (its font not loaded, or drawn top to bottom) is not exploded.
// - An associative array becomes copies of its source objects ("Array: Explodes an associative
//   array into copies of the original objects"): the array's items are exploded with it.
//
// Everything else is left alone ("N objects could not be exploded").
import {
  applyPoint,
  applyVector,
  compose,
  determinant,
  rotation,
  scaling,
  transformCurve,
  translation,
  type Matrix2D,
} from '../geom/transform';
import { explodePolyline } from '../geom/eval';
import { fitSpline } from '../geom/fit';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { TextPiece } from '../commands/view/host';
import type { Handle } from '../model/handle';
import type {
  Entity,
  EntityGeometry,
  HatchGeometry,
  MTextGeometry,
  RegionGeometry,
  TextStyleRecord,
} from '../model/types';
import { leaderParts } from '../annotation/leader';
import { fileArc, mlineParts, mlineProblem, planarOf } from '../annotation/mline';
import { multiLeaderParts, type AnnotationPart } from '../annotation/multileader';
import type { TextMeasure } from '../annotation/tolerance';
import { tableAxes } from '../spatial/entity-bounds';
import { assocArrayOf } from './assoc-array';
import {
  AnonymousNames,
  copiedProps,
  copyObjects,
  copyProblem,
  eraseObjects,
  reshapeObject,
} from './edit';
import { normalizeAngle } from '../geom/angle';
import { cleanPolyline } from './offset';
import { similarity, type Similarity } from './similarity';

export interface ExplodeReport {
  /** The objects the explodes made. */
  readonly made: EntityId[];
  /** How many objects were exploded. */
  readonly exploded: number;
  /** Why the others were not, with how many. */
  readonly refused: Map<string, number>;
  /** A polyline with widths was exploded (AutoCAD's warning). */
  readonly lostWidth: boolean;
}

const count = (m: Map<string, number>, why: string) => m.set(why, (m.get(why) ?? 0) + 1);

/**
 * The lines a pattern hatch draws inside its boundary, flat (x0, y0, x1, y1 per dash; x, y per
 * dot), or undefined when it draws none it can give (an unknown pattern, more lines than
 * HPMAXLINES).
 */
export type HatchLinesOf = (
  g: HatchGeometry,
) => { readonly segments: readonly number[]; readonly dots: readonly number[] } | undefined;

/** An MTEXT's runs and strokes as the canvas lays them out, or undefined when it cannot. */
export type TextPiecesOf = (g: MTextGeometry) => readonly TextPiece[] | undefined;

/** What EXPLODE reads from the packages above the engine. */
export interface ExplodeServices {
  /** An MTEXT's runs and strokes (`textPieces`); without it MTEXTs are not exploded. */
  readonly textPieces?: TextPiecesOf | undefined;
  /** A pattern hatch's lines (`@triya/hatch`); without it hatches are not exploded. */
  readonly hatchLines?: HatchLinesOf | undefined;
  /** Measures a multileader's text, for its underline or overline (M1-111). */
  readonly measure?: TextMeasure | undefined;
}

/** EXPLODE: each of `ids` broken into what it is made of. */
export function explodeObjects(
  b: ChangeSetBuilder,
  model: DocumentModel,
  ids: readonly EntityId[],
  services: ExplodeServices = {},
): ExplodeReport {
  const made: EntityId[] = [];
  const refused = new Map<string, number>();
  let exploded = 0;
  let lostWidth = false;
  // The `*D` blocks of dimensions copied out of blocks are named afresh across the whole edit.
  const names = new AnonymousNames(model);
  // The text styles MTEXT runs in other fonts take, made once across the edit.
  const styles = new FontStyles(b, model);
  /** `e` replaced by `parts`, each with `e`'s properties where it draws ByBlock. */
  const replace = (e: Entity, parts: readonly AnnotationPart[]) => {
    for (const p of parts) {
      const geom = p.geom.kind === 'INSERT' ? newAttributes(b, p.geom) : p.geom;
      made.push(
        b.addEntity({
          ...copiedProps(b, e),
          ...(p.color && p.color.kind !== 'byBlock' ? { color: p.color } : {}),
          ...(p.linetype !== undefined && p.linetype !== 'ByBlock' ? { linetype: p.linetype } : {}),
          ...(p.lineweight !== undefined && p.lineweight !== 'ByBlock'
            ? { lineweight: p.lineweight }
            : {}),
          owner: e.owner,
          geom,
        }).id,
      );
    }
    eraseObjects(b, model, [e.id]);
    exploded++;
  };
  for (const id of ids) {
    const e = b.entity(id);
    if (!e) continue;
    const g = e.geom;
    switch (g.kind) {
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const pieces = polylinePieces(g);
        if (pieces.length === 0) {
          count(refused, 'the polyline has no segments');
          continue;
        }
        if (hasWidth(g)) lostWidth = true;
        made.push(...reshapeObject(b, model, id, pieces));
        exploded++;
        continue;
      }
      case 'INSERT': {
        const problem = insertProblem(b, g);
        if (typeof problem === 'string') {
          count(refused, problem);
          continue;
        }
        if ('affine' in problem) {
          const r = explodeNonuniform(b, model, e, g, problem.affine, names);
          if (typeof r === 'string') {
            count(refused, r);
            continue;
          }
          made.push(...r);
          eraseObjects(b, model, [id]);
          exploded++;
          continue;
        }
        const contents = b.blockEntities(g.block);
        const stuck = contents.map((c) => b.entity(c)!).find((c) => copyProblem(c, problem));
        if (stuck) {
          count(refused, `the block holds ${article(stuck.type)} that cannot be exploded`);
          continue;
        }
        const r = copyObjects(
          b,
          model,
          contents,
          problem,
          { mirrorText: true, mirrorHatch: true },
          e.owner,
          names,
        );
        eraseObjects(b, model, [id]);
        exploded++;
        if (assocArrayOf(model.objects.values(), e)) {
          // The array's items, INSERTs of its source block, go too: copies of the source.
          const items = r.ids.filter((c) => b.entity(c)?.geom.kind === 'INSERT');
          const inner = explodeObjects(b, model, items, services);
          made.push(...r.ids.filter((c) => !items.includes(c)), ...inner.made);
          for (const [why, n] of inner.refused) refused.set(why, (refused.get(why) ?? 0) + n);
        } else {
          made.push(...r.ids);
        }
        continue;
      }
      case 'DIMENSION':
      case 'ARC_DIMENSION':
      case 'LARGE_RADIAL_DIMENSION': {
        if (g.block === undefined || !b.block(g.block)) {
          count(refused, 'the dimension has no block to explode');
          continue;
        }
        const contents = b.blockEntities(g.block);
        const identity = similarity(translation(0, 0));
        const r = copyObjects(b, model, contents, identity, {}, e.owner, names);
        for (const c of r.ids) asDrawnBy(b, model, c, e);
        made.push(...r.ids);
        eraseObjects(b, model, [id]);
        exploded++;
        continue;
      }
      case 'ACAD_TABLE': {
        if (g.block === undefined || !b.block(g.block)) {
          count(refused, 'the table has no block to explode');
          continue;
        }
        // The `*T` block draws in the table's frame (M1-17): its origin at the insertion point.
        const { x: ax, y: ay } = tableAxes(g);
        const { x: bx, y: by } = b.block(g.block)!.basePoint;
        const frame = similarity({
          a: ax.x,
          b: ax.y,
          c: ay.x,
          d: ay.y,
          e: g.position.x - bx * ax.x - by * ay.x,
          f: g.position.y - bx * ax.y - by * ay.y,
        });
        const contents = b.blockEntities(g.block);
        const r = copyObjects(
          b,
          model,
          contents,
          frame,
          { mirrorText: true, mirrorHatch: true },
          e.owner,
          names,
        );
        for (const c of r.ids) asDrawnBy(b, model, c, e);
        made.push(...r.ids);
        eraseObjects(b, model, [id]);
        exploded++;
        continue;
      }
      case 'LEADER': {
        const parts = leaderParts(g, e.xdata, model).flatMap(asExploded);
        if (parts.length === 0) {
          count(refused, 'the leader draws nothing');
          continue;
        }
        replace(e, parts);
        continue;
      }
      case 'MULTILEADER': {
        const parts = multiLeaderParts(g, model, services.measure).flatMap(asExploded);
        if (parts.length === 0) {
          count(refused, 'the multileader draws nothing');
          continue;
        }
        replace(e, parts);
        continue;
      }
      case 'REGION': {
        const parts = regionPieces(g);
        if (parts.length === 0) {
          count(refused, 'the region has no edges');
          continue;
        }
        replace(e, parts);
        continue;
      }
      case 'MLINE': {
        // What the canvas draws (M3-14) less the fill, which AutoCAD's EXPLODE drops.
        const problem = mlineProblem(g, model);
        if (problem !== undefined) {
          count(refused, problem);
          continue;
        }
        replace(e, mlineParts(g, model, { fill: false }));
        continue;
      }
      case 'MTEXT': {
        const pieces = services.textPieces?.(g);
        if (!pieces) {
          count(refused, 'the MTEXT cannot be laid out (its font is not loaded)');
          continue;
        }
        if (pieces.length === 0) {
          count(refused, 'the MTEXT is empty');
          continue;
        }
        replace(e, mtextParts(g, pieces, styles));
        continue;
      }
      case 'HATCH': {
        if (g.solid || g.gradient) {
          count(refused, 'a solid or gradient fill cannot be exploded');
          continue;
        }
        const lines = services.hatchLines?.(g);
        if (!lines || (lines.segments.length === 0 && lines.dots.length === 0)) {
          count(refused, 'the hatch has no pattern lines to explode');
          continue;
        }
        replace(e, hatchPieces(g, lines));
        continue;
      }
      default:
        count(refused, `${article(g.kind)} cannot be exploded`);
    }
  }
  return { made, exploded, refused, lostWidth };
}

/** An INSERT part's attribute values with handles of their own (they are the ATTDEFs' now). */
function newAttributes(
  b: ChangeSetBuilder,
  g: Extract<EntityGeometry, { kind: 'INSERT' }>,
): EntityGeometry {
  return {
    ...g,
    attributes: g.attributes.map((a) => {
      const {
        handle: _handle,
        raw: _raw,
        reactors: _reactors,
        extDict: _extDict,
        annotative: _annotative,
        xdata: _xdata,
        ...rest
      } = a;
      return { ...rest, handle: b.allocateHandle() };
    }),
  };
}

/**
 * A leader's or multileader's part as EXPLODE leaves it: its polyline path as lines, a spline
 * through fit points given its control points (what a SPLINE entity holds), the rest as drawn.
 */
function asExploded(p: AnnotationPart): AnnotationPart[] {
  const g = p.geom;
  if (g.kind === 'LWPOLYLINE') {
    const out: AnnotationPart[] = [];
    for (let i = 0; i + 1 < g.vertices.length; i++) {
      const a = g.vertices[i]!;
      const c = g.vertices[i + 1]!;
      if (a.x === c.x && a.y === c.y) continue;
      out.push({
        ...p,
        geom: { kind: 'LINE', start: { x: a.x, y: a.y }, end: { x: c.x, y: c.y } },
      });
    }
    return out;
  }
  if (g.kind === 'SPLINE' && g.controlPoints.length === 0 && g.fitPoints) {
    const s = fitSpline({
      fitPoints: g.fitPoints,
      startTangent: g.startTangent,
      endTangent: g.endTangent,
    });
    if (!s) return [];
    return [{ ...p, geom: { ...g, knots: s.knots, controlPoints: s.controlPoints } }];
  }
  return [p];
}

/** An MTEXT's pieces as TEXTs and lines, in its plane. */
function mtextParts(
  g: MTextGeometry,
  pieces: readonly TextPiece[],
  styles: FontStyles,
): AnnotationPart[] {
  const planar = {
    ...(g.elevation !== undefined && g.elevation !== 0 && { elevation: g.elevation }),
  };
  return pieces.map((p): AnnotationPart => {
    const color = p.color ? { color: p.color } : {};
    if (p.kind === 'line') {
      return { geom: { kind: 'LINE', start: p.start, end: p.end, ...planar }, ...color };
    }
    return {
      geom: {
        kind: 'TEXT',
        // "%%%" draws one percent sign, so a run's own "%%" is not read as a control code.
        value: p.value.replace(/%%/g, '%%%%%%'),
        style: p.font ? styles.styleFor(g.style, p.font) : g.style,
        position: p.position,
        height: p.height,
        rotation: g.rotation,
        widthFactor: p.widthFactor,
        oblique: p.oblique,
        halign: 0,
        valign: 0,
        backward: false,
        upsideDown: !!g.upsideDown,
        ...planar,
      },
      ...color,
    };
  });
}

/** A font as a run names it. */
type RunFont = NonNullable<Extract<TextPiece, { kind: 'text' }>['font']>;

/** `trueTypeFlags` bits: italic, bold. */
const ITALIC = 1;
const BOLD = 2;
const fontKey = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\.(shx|ttf|ttc|otf)$/, '');

/**
 * The text styles exploded MTEXT runs in other fonts take: the drawing's first style with that
 * font (and that bold and italic), else one made like the MTEXT's own style with that font,
 * named for it ("Arial Bold"), once for the whole edit.
 */
class FontStyles {
  readonly #b: ChangeSetBuilder;
  readonly #model: DocumentModel;
  readonly #made = new Map<string, Handle>();
  readonly #names = new Set<string>();
  constructor(b: ChangeSetBuilder, model: DocumentModel) {
    this.#b = b;
    this.#model = model;
  }

  styleFor(base: Handle, font: RunFont): Handle {
    const key = `${fontKey(font.name)}|${font.bold}|${font.italic}`;
    const known = this.#made.get(key);
    if (known !== undefined) return known;
    const flags = (font.bold ? BOLD : 0) | (font.italic ? ITALIC : 0);
    // The drawing's styles; those made in this edit are in `#made` already.
    const records = [...this.#model.tables.textStyles.values()];
    const same = records.find(
      (s) =>
        fontKey(s.font) === fontKey(font.name) &&
        (font.kind === 'shx' || (s.trueTypeFlags & (BOLD | ITALIC)) === flags) &&
        ((s.flags ?? 0) & 1) === 0,
    );
    const handle = same?.handle ?? this.#add(base, font, flags, records);
    this.#made.set(key, handle);
    return handle;
  }

  #add(base: Handle, font: RunFont, flags: number, records: readonly TextStyleRecord[]): Handle {
    const like = this.#b.tableRecord('textStyles', base);
    const stem = font.name.trim().replace(/\.(shx|ttf|ttc|otf)$/i, '');
    const wanted = `${stem}${font.bold ? ' Bold' : ''}${font.italic ? ' Italic' : ''}`.replace(
      /[<>/\\":;?*|,=`]/g,
      '_',
    );
    const taken = new Set([...records.map((s) => s.name.toLowerCase()), ...this.#names]);
    let name = wanted;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${wanted} ${n}`;
    this.#names.add(name.toLowerCase());
    const ttf = font.kind === 'ttf';
    return this.#b.addTableRecord('textStyles', {
      name,
      // A TrueType font is named by its file, the face's bold and italic in the style's flags.
      font: /\.[a-z]+$/i.test(font.name) ? font.name : `${font.name}${ttf ? '.ttf' : '.shx'}`,
      ...(!ttf && like?.bigFont !== undefined && { bigFont: like.bigFont }),
      height: 0,
      widthFactor: like?.widthFactor ?? 1,
      obliqueAngle: like?.obliqueAngle ?? 0,
      lastHeight: like?.lastHeight ?? 2.5,
      generation: 0,
      trueTypeFlags: ttf ? flags : 0,
    }).handle;
  }
}

/** A region's edges, loop by loop. */
function regionPieces(g: RegionGeometry): AnnotationPart[] {
  const planar = planarOf(g);
  return g.loops.flatMap((l) => l.edges.map((c) => ({ geom: fileArc({ ...c, ...planar }) })));
}

/** A pattern hatch's dashes as lines and its dots as points. */
function hatchPieces(
  g: HatchGeometry,
  lines: { readonly segments: readonly number[]; readonly dots: readonly number[] },
): AnnotationPart[] {
  const planar = planarOf(g);
  const out: AnnotationPart[] = [];
  const s = lines.segments;
  for (let i = 0; i + 3 < s.length; i += 4) {
    out.push({
      geom: {
        kind: 'LINE',
        start: { x: s[i]!, y: s[i + 1]! },
        end: { x: s[i + 2]!, y: s[i + 3]! },
        ...planar,
      },
    });
  }
  const d = lines.dots;
  for (let i = 0; i + 1 < d.length; i += 2) {
    out.push({ geom: { kind: 'POINT', position: { x: d[i]!, y: d[i + 1]! }, ...planar } });
  }
  return out;
}

const article = (kind: string): string => (/^[AEIOU]/.test(kind) ? `an ${kind}` : `a ${kind}`);

/** A polyline's lines and arcs (3D: lines), with its elevation and thickness. */
function polylinePieces(g: Extract<EntityGeometry, { kind: 'LWPOLYLINE' | 'POLYLINE' }>) {
  const flat = g.kind === 'POLYLINE' && g.is3d;
  const curve = cleanPolyline(
    flat ? { ...g, vertices: g.vertices.map((v) => ({ ...v, bulge: 0 })) } : g,
  ).curve;
  const planar = {
    ...(g.elevation !== undefined && g.elevation !== 0 && !flat && { elevation: g.elevation }),
    ...(g.thickness !== undefined && g.thickness !== 0 && { thickness: g.thickness }),
    ...(g.normal !== undefined && !flat && { normal: g.normal }),
  };
  // Arc angles in [0, 2π), as the file has them.
  return explodePolyline(curve).map((piece): EntityGeometry =>
    piece.kind === 'ARC'
      ? {
          ...piece,
          startAngle: normalizeAngle(piece.startAngle),
          endAngle: normalizeAngle(piece.endAngle),
          ...planar,
        }
      : { ...piece, ...planar },
  );
}

function hasWidth(g: Extract<EntityGeometry, { kind: 'LWPOLYLINE' | 'POLYLINE' }>): boolean {
  if (g.kind === 'LWPOLYLINE' && (g.constantWidth ?? 0) !== 0) return true;
  if (g.kind === 'POLYLINE' && ((g.startWidth ?? 0) !== 0 || (g.endWidth ?? 0) !== 0)) return true;
  return g.vertices.some((v) => (v.startWidth ?? 0) !== 0 || (v.endWidth ?? 0) !== 0);
}

/**
 * How a block reference carries its block's contents to the drawing (base point to the
 * insertion point, scaled, then turned), or why it is not exploded.
 */
function insertProblem(
  b: ChangeSetBuilder,
  g: Extract<EntityGeometry, { kind: 'INSERT' }>,
): Similarity | { readonly affine: Matrix2D } | string {
  const def = b.block(g.block);
  if (!def) return 'the block is missing';
  // DXF 70 bits 4 and 8: an external reference or an overlay.
  if (((def.flags ?? 0) & 12) !== 0) return 'external references cannot be exploded';
  if (b.tableRecord('blockRecords', g.block)?.explodable === false) {
    return 'the block is not explodable';
  }
  if (g.array && (g.array.columns > 1 || g.array.rows > 1)) {
    return 'MINSERT arrays cannot be exploded';
  }
  if (g.normal && (g.normal.x !== 0 || g.normal.y !== 0 || g.normal.z <= 0)) {
    return 'the block reference is not in plan';
  }
  const sx = g.scale.x;
  const sy = g.scale.y;
  if (sx === 0 || sy === 0) return 'the block reference has a zero scale';
  const m = compose(
    translation(-def.basePoint.x, -def.basePoint.y),
    scaling(sx, sy),
    rotation(g.rotation),
    translation(g.position.x, g.position.y),
  );
  if (Math.abs(Math.abs(sx) - Math.abs(sy)) > UNIFORM * Math.max(Math.abs(sx), Math.abs(sy))) {
    return { affine: m };
  }
  return similarity(m);
}

/** How near two scales are taken as one (relative): the same test as before M3-12 part 7. */
const UNIFORM = 1e-12;
/** What `transformCurve` and the squareness tests take as equal directions. */
const SQUARE = { linear: 0, angular: 1e-12 };

/**
 * A block reference `e` scaled differently in X and Y exploded (M3-12 part 7): what can be
 * carried by `m` comes out as itself, the rest goes into a `*E` block referenced as `e` was.
 * Returns the objects made, or why nothing was.
 */
function explodeNonuniform(
  b: ChangeSetBuilder,
  model: DocumentModel,
  e: Entity,
  g: Extract<EntityGeometry, { kind: 'INSERT' }>,
  m: Matrix2D,
  names: AnonymousNames,
): EntityId[] | string {
  const contents = b.blockEntities(g.block).map((c) => b.entity(c)!);
  const carried: [Entity, EntityGeometry][] = [];
  const kept: Entity[] = [];
  for (const c of contents) {
    const geom = carriedGeometry(b, c.geom, m);
    if (geom) carried.push([c, geom]);
    else kept.push(c);
  }
  if (carried.length === 0)
    return 'nothing in a nonuniformly scaled block reference can be exploded';
  const identity = similarity(translation(0, 0));
  const stuck = kept.find((c) => copyProblem(c, identity));
  if (stuck) return `the block holds ${article(stuck.type)} that cannot be exploded`;
  const made = carried.map(
    ([c, geom]) => b.addEntity({ ...copiedProps(b, c), owner: e.owner, geom }).id,
  );
  if (kept.length > 0) {
    const def = b.block(g.block)!;
    const block = b.addBlock({ name: names.take('E'), basePoint: def.basePoint, flags: 1 });
    copyObjects(
      b,
      model,
      kept.map((c) => c.id),
      identity,
      {},
      block.handle,
      names,
    );
    const { attributes: _attributes, ...rest } = g;
    made.push(
      b.addEntity({
        ...copiedProps(b, e),
        owner: e.owner,
        geom: { ...rest, block: block.handle, attributes: [] },
      }).id,
    );
  }
  return made;
}

/** `g` carried by the nonuniform `m` as an object of its own kind, or undefined if it cannot be. */
function carriedGeometry(
  b: ChangeSetBuilder,
  g: EntityGeometry,
  m: Matrix2D,
): EntityGeometry | undefined {
  // Out of plan, an object's shape is not its plan view's image.
  if ('normal' in g && g.normal && (g.normal.x !== 0 || g.normal.y !== 0 || g.normal.z <= 0)) {
    return undefined;
  }
  const p = (v: { readonly x: number; readonly y: number }) => applyPoint(m, v);
  const planar = {
    ...('elevation' in g && g.elevation !== undefined && { elevation: g.elevation }),
    ...('thickness' in g && g.thickness !== undefined && { thickness: g.thickness }),
  };
  switch (g.kind) {
    case 'LINE':
    case 'RAY':
    case 'XLINE':
    case 'ELLIPSE':
      return { ...g, ...transformCurve(g, m, SQUARE) } as EntityGeometry;
    case 'CIRCLE':
    case 'ARC': {
      // An ellipse has no thickness in the file (DXF ELLIPSE): only the elevation stays.
      const c = transformCurve(g, m, SQUARE);
      return {
        ...c,
        ...(g.elevation !== undefined && { elevation: g.elevation }),
      } as EntityGeometry;
    }
    case 'SPLINE': {
      const c = transformCurve(g, m, SQUARE) as typeof g;
      return {
        ...g,
        controlPoints: c.controlPoints,
        ...(g.fitPoints && { fitPoints: g.fitPoints.map(p) }),
        ...(g.startTangent && { startTangent: applyVector(m, g.startTangent) }),
        ...(g.endTangent && { endTangent: applyVector(m, g.endTangent) }),
      };
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      // An arc is no polyline arc under the scale, and a width does not scale one way.
      const wide =
        (g.kind === 'LWPOLYLINE'
          ? (g.constantWidth ?? 0)
          : Math.max(g.startWidth ?? 0, g.endWidth ?? 0)) !== 0 ||
        g.vertices.some(
          (v) => v.bulge !== 0 || (v.startWidth ?? 0) !== 0 || (v.endWidth ?? 0) !== 0,
        );
      if (wide) return undefined;
      return {
        ...g,
        vertices: g.vertices.map((v) => ({ ...v, ...p(v) })),
        ...(g.kind === 'POLYLINE' && g.frame && { frame: g.frame.map(p) }),
      } as EntityGeometry;
    }
    case 'POINT':
      return { ...g, position: p(g.position) };
    case 'SOLID':
    case 'TRACE':
    case '3DFACE':
      return { ...g, corners: g.corners.map(p) as unknown as typeof g.corners } as EntityGeometry;
    case 'TEXT':
    case 'ATTDEF':
      return carriedText(g, m, planar);
    case 'INSERT':
      return carriedInsert(b, g, m);
    default:
      return undefined;
  }
}

/** The base vectors `u` (along) and `v` (up) carried by `m`, if they stay square to each other. */
function squareFrame(m: Matrix2D, angle: number) {
  const u = applyVector(m, { x: Math.cos(angle), y: Math.sin(angle) });
  const v = applyVector(m, { x: -Math.sin(angle), y: Math.cos(angle) });
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (Math.abs(u.x * v.x + u.y * v.y) > SQUARE.angular * lu * lv) return undefined;
  return { u, lu, lv, mirrored: determinant(m) < 0 };
}

/**
 * A text or attribute definition under the scale: its baseline and up direction must stay
 * square (an obliqued text must stay upright too), and the stretch goes into its height and
 * width factor. A mirror, aligned text (whose height its points set) and a multiline
 * definition are not carried.
 */
function carriedText(
  g: Extract<EntityGeometry, { kind: 'TEXT' | 'ATTDEF' }>,
  m: Matrix2D,
  planar: object,
): EntityGeometry | undefined {
  if (g.halign === 3 || (g.kind === 'ATTDEF' && g.mtext)) return undefined;
  const f = squareFrame(m, g.rotation);
  if (!f || f.mirrored || (g.oblique !== 0 && f.lu !== f.lv)) return undefined;
  return {
    ...g,
    ...planar,
    position: applyPoint(m, g.position),
    ...(g.alignmentPoint && { alignmentPoint: applyPoint(m, g.alignmentPoint) }),
    rotation: normalizeAngle(Math.atan2(f.u.y, f.u.x)),
    height: g.height * f.lv,
    widthFactor: (g.widthFactor * f.lu) / f.lv,
  };
}

/**
 * A nested block reference under the scale stays a reference when its axes stay square (an
 * INSERT's placement is a turn and a scale along its own axes), its attributes carried as text.
 */
function carriedInsert(
  b: ChangeSetBuilder,
  g: Extract<EntityGeometry, { kind: 'INSERT' }>,
  m: Matrix2D,
): EntityGeometry | undefined {
  if (g.array && (g.array.columns > 1 || g.array.rows > 1)) return undefined;
  const def = b.block(g.block);
  if (!def) return undefined;
  // The nested placement's own linear part, then the outer one.
  const inner = compose(scaling(g.scale.x, g.scale.y), rotation(g.rotation));
  const linear = compose(inner, { ...m, e: 0, f: 0 });
  const x = applyVector(linear, { x: 1, y: 0 });
  const y = applyVector(linear, { x: 0, y: 1 });
  const lx = Math.hypot(x.x, x.y);
  const ly = Math.hypot(y.x, y.y);
  if (lx === 0 || ly === 0 || Math.abs(x.x * y.x + x.y * y.y) > SQUARE.angular * lx * ly) {
    return undefined;
  }
  const attributes = [];
  for (const a of g.attributes) {
    const t = carriedText({ ...a, kind: 'ATTDEF', prompt: '' }, m, {});
    if (!t || t.kind !== 'ATTDEF') return undefined;
    const { kind: _kind, prompt: _prompt, ...fields } = t;
    attributes.push({ ...a, ...fields });
  }
  const sign = determinant(linear) < 0 ? -1 : 1;
  return {
    ...g,
    position: applyPoint(m, g.position),
    rotation: normalizeAngle(Math.atan2(x.y, x.x)),
    scale: { x: lx, y: sign * ly, z: g.scale.z },
    attributes,
  };
}

/** A piece of `dim`'s block, on its layer and in its colours where it was layer 0 or ByBlock. */
function asDrawnBy(b: ChangeSetBuilder, model: DocumentModel, id: EntityId, dim: Entity): void {
  const e = b.entity(id);
  if (!e) return;
  const zero = [...model.tables.layers.values()].find((l) => l.name === '0')?.handle;
  const patch: { -readonly [K in 'layer' | 'color' | 'linetype' | 'lineweight']?: Entity[K] } = {};
  if (e.layer === zero) patch.layer = dim.layer;
  if (e.color.kind === 'byBlock') patch.color = dim.color;
  if (e.linetype === 'ByBlock') patch.linetype = dim.linetype;
  if (e.lineweight === 'ByBlock') patch.lineweight = dim.lineweight;
  if (Object.keys(patch).length > 0) b.updateEntity(id, patch);
}
