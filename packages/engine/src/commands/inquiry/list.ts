// LIST (M3-07 part 2): the property data of the objects selected, as AutoCAD 2024 writes it on
// the command line (AutoCAD 2024 Help, "LIST (Command)"): the object's type and layer, the
// space it is in and its handle; its colour, linetype, lineweight and transparency where they
// are not BYLAYER; its thickness where it is not zero; an extrusion direction that is not
// +Z; then what is particular to its type, in the drawing's units:
//
//                     LINE      Layer: "0"
//                               Space: Model space
//                            Handle = 20
//                         from point, X=0.0000  Y=0.0000  Z=0.0000
//                           to point, X=10.0000  Y=0.0000  Z=0.0000
//                            Length = 10.0000,  Angle in XY Plane = 0
//                           Delta X = 10.0000, Delta Y = 0.0000, Delta Z = 0.0000
//
// The help names what is listed but not the columns. AutoCAD's text window pads its numbers to a
// fixed width; Triya's command line keeps one space after each label, which is right-aligned so
// the values line up, and lowercase handles as AutoCAD's LIST shows them. Objects are listed in
// the order selected, a blank line between two. AutoCAD pauses a long listing with "Press ENTER
// to continue" (QAFLAGS); the command line here scrolls instead. A type Triya does not read
// further (a region, an OLE object, a proxy) lists its header lines only.
import { arcSweep, bulgeArc, domain } from '../../geom/eval';
import type { Vec2 } from '../../geom/types';
import { angleOf, distance, length, sub } from '../../geom/vec';
import type { DocumentModel } from '../../model/document';
import type { Color, Entity, EntityGeometry, PolylineVertex } from '../../model/types';
import { polylineArea, polylineLength } from '../../properties/measure';
import type { CommandDef } from '../command';
import {
  drawingUnits,
  formatAngle,
  formatDistance,
  formatNumber,
  type DrawingUnits,
} from '../units';
import { areaText, measureObject } from './measure';

/** Where the values start: labels end in this column. */
const LABEL = 25;

const row = (label: string, value: string): string => `${label.padStart(LABEL)} ${value}`;

/** AutoCAD's names for ACI 1 to 7, as LIST writes them: `1 (red)`. */
const ACI_NAMES = ['', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white'];

function colorText(c: Color): string | undefined {
  switch (c.kind) {
    case 'byLayer':
      return undefined;
    case 'byBlock':
      return 'BYBLOCK';
    case 'aci':
      return ACI_NAMES[c.index] ? `${c.index} (${ACI_NAMES[c.index]})` : String(c.index);
    case 'rgb':
      return c.bookName ? `${c.bookName}$${c.colorName ?? ''}` : `RGB:${c.r},${c.g},${c.b}`;
  }
}

/** The DXF type name LIST heads an object with (a block reference is "BLOCK REFERENCE"). */
function typeName(e: Entity): string {
  if (e.geom.kind === 'INSERT') return 'BLOCK REFERENCE';
  if (e.geom.kind === 'IMAGE' || e.geom.kind === 'WIPEOUT') return e.geom.kind;
  return e.type;
}

/** The lines LIST writes for `e`. */
export function listObject(model: DocumentModel, e: Entity): string[] {
  const u = drawingUnits(model.header);
  const layer = model.tables.layers.get(e.layer)?.name ?? '';
  const space = model.tables.blockRecords.get(e.owner)?.name.toLowerCase();
  const lines = [
    `${' '.repeat(18)}${typeName(e).padEnd(8)}  Layer: "${layer}"`,
    row('Space:', space === '*model_space' ? 'Model space' : 'Paper space'),
  ];
  const color = colorText(e.color);
  if (color) lines.push(row('Color:', color));
  if (e.linetype !== 'ByLayer') {
    const name =
      e.linetype === 'ByBlock' ? 'BYBLOCK' : (model.tables.linetypes.get(e.linetype)?.name ?? '');
    lines.push(row('Linetype:', `"${name}"`));
  }
  if (e.lineweight !== 'ByLayer') {
    const w = e.lineweight;
    lines.push(
      row(
        'Lineweight:',
        typeof w === 'number'
          ? `${(w / 100).toFixed(2)} mm`
          : w === 'ByBlock'
            ? 'BYBLOCK'
            : 'Default',
      ),
    );
  }
  if (e.transparency !== 'ByLayer') {
    const t = e.transparency;
    // Transparency is a percentage: 0 opaque, 90 the most AutoCAD allows (alpha 255 opaque).
    const text = t === 'ByBlock' ? 'BYBLOCK' : String(Math.round(((255 - t.alpha) / 255) * 100));
    lines.push(row('Transparency:', text));
  }
  lines.push(row('Handle =', e.handle.toLowerCase()));
  const g = e.geom;
  const thickness = 'thickness' in g ? g.thickness : undefined;
  if (thickness) lines.push(row('Thickness =', formatDistance(thickness, u)));
  const normal = 'normal' in g ? g.normal : undefined;
  if (normal && (normal.x !== 0 || normal.y !== 0 || normal.z !== 1)) {
    const n = (v: number) => formatNumber(v, u.luprec);
    lines.push(
      row(
        'Extrusion direction',
        `relative to UCS: X=${n(normal.x)}  Y=${n(normal.y)}  Z=${n(normal.z)}`,
      ),
    );
  }
  lines.push(...typeLines(model, g, u));
  return lines;
}

/** A point as LIST writes it: `X=1.0000  Y=2.0000  Z=0.0000`, Z the object's elevation. */
function at(p: Vec2, u: DrawingUnits, z = 0): string {
  const d = (v: number) => formatDistance(v, u);
  return `X=${d(p.x)}  Y=${d(p.y)}  Z=${d(z)}`;
}

function elevationOf(g: EntityGeometry): number {
  return 'elevation' in g && typeof g.elevation === 'number' ? g.elevation : 0;
}

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

/** The lines particular to `g`'s type. */
function typeLines(model: DocumentModel, g: EntityGeometry, u: DrawingUnits): string[] {
  const d = (v: number) => formatDistance(v, u);
  const a = (r: number) => formatAngle(r, u);
  const z = elevationOf(g);
  const pt = (p: Vec2) => at(p, u, z);
  const styleName = (h: string) => `"${model.tables.textStyles.get(h)?.name ?? ''}"`;
  switch (g.kind) {
    case 'LINE': {
      const delta = sub(g.end, g.start);
      return [
        row('from point,', pt(g.start)),
        row('to point,', pt(g.end)),
        row('Length =', `${d(length(delta))},  Angle in XY Plane = ${a(angleOf(delta))}`),
        row('Delta X =', `${d(delta.x)}, Delta Y = ${d(delta.y)}, Delta Z = ${d(0)}`),
      ];
    }
    case 'CIRCLE':
      return [
        row('center point,', pt(g.center)),
        row('radius', d(g.radius)),
        row('circumference', d(2 * Math.PI * g.radius)),
        row('area', areaText(Math.PI * g.radius * g.radius, u)),
      ];
    case 'ARC': {
      const sweep = arcSweep(g);
      return [
        row('center point,', pt(g.center)),
        row('radius', d(g.radius)),
        row('length', d(g.radius * sweep)),
        row('total angle', a(sweep)),
        row('start angle', a(g.startAngle)),
        row('end angle', a(g.endAngle)),
      ];
    }
    case 'POINT':
      return [row('at point,', pt(g.position))];
    case 'XLINE':
    case 'RAY':
      return [
        row('base point,', pt(g.base)),
        row('second point,', pt({ x: g.base.x + g.direction.x, y: g.base.y + g.direction.y })),
      ];
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const p = { kind: 'LWPOLYLINE' as const, closed: g.closed, vertices: g.vertices };
      const out = [row(g.closed ? 'Closed' : 'Open', '').trimEnd()];
      const constant = constantWidth(g);
      if (constant !== undefined) out.push(row('Constant width', d(constant)));
      if (g.kind === 'LWPOLYLINE' && g.elevation) out.push(row('elevation', d(g.elevation)));
      if (g.vertices.length >= 2) {
        out.push(row('area', areaText(polylineArea({ ...p, closed: true }), u)));
        out.push(row(g.closed ? 'perimeter' : 'length', d(polylineLength(p))));
      }
      out.push('');
      g.vertices.forEach((v, i) => {
        out.push(row('at point', pt(v)));
        if (constant === undefined) {
          out.push(row('starting width', d(v.startWidth ?? 0)));
          out.push(row('ending width', d(v.endWidth ?? 0)));
        }
        const next = g.vertices[i + 1] ?? (g.closed ? g.vertices[0] : undefined);
        if (v.bulge && next) {
          const arc = bulgeArc(v, next, v.bulge);
          const end = arc.startAngle + arc.sweep;
          out.push(row('bulge', formatNumber(v.bulge, u.luprec)));
          out.push(row('center', pt(arc.center)));
          out.push(row('radius', d(arc.radius)));
          out.push(row('start angle', a(arc.startAngle)));
          out.push(row('end angle', a(end)));
        }
      });
      return out;
    }
    case 'ELLIPSE': {
      const m = measureObject(g);
      const minor = { x: -g.majorAxis.y * g.ratio, y: g.majorAxis.x * g.ratio };
      const dm = domain(g);
      const full = Math.abs(dm.end - dm.start - 2 * Math.PI) < 1e-12;
      const out = [
        row('Area:', areaText(m?.area ?? 0, u)),
        row(full ? 'Circumference:' : 'Length:', d(m?.perimeter ?? 0)),
        row('Center:', pt(g.center)),
        row('Major Axis:', at(g.majorAxis, u)),
        row('Minor Axis:', at(minor, u)),
        row('Radius Ratio:', formatNumber(g.ratio, u.luprec)),
      ];
      if (!full) {
        out.push(row('Start Angle:', a(g.startParam)), row('End Angle:', a(g.endParam)));
      }
      return out;
    }
    case 'SPLINE': {
      const m = measureObject(g);
      const dm = domain(g);
      const props = [
        'Planar',
        g.weights?.some((w) => w !== 1) ? 'Rational' : 'Non-Rational',
        g.periodic ? 'Periodic' : 'Non-Periodic',
      ];
      const out = [
        row(g.closed ? 'Perimeter:' : 'Length:', d(m?.perimeter ?? 0)),
        row('Order:', String(g.degree + 1)),
        row('Properties:', props.join(', ')),
        row('Parametric Range:', `Start ${formatNumber(dm.start, u.luprec)}`),
        row('', `End ${formatNumber(dm.end, u.luprec)}`),
        row('Number of control points:', String(g.controlPoints.length)),
      ];
      g.controlPoints.forEach((p, i) => out.push(row(i === 0 ? 'Control Points:' : '', at(p, u))));
      const fit = g.fitPoints ?? [];
      out.push(row('Number of fit points:', String(fit.length)));
      fit.forEach((p, i) => out.push(row(i === 0 ? 'User Data: Fit Points' : '', at(p, u))));
      return out;
    }
    case 'TEXT':
    case 'ATTDEF': {
      const out = [row('Style =', styleName(g.style))];
      if (g.kind === 'ATTDEF') {
        out.push(row('Tag:', g.tag), row('Prompt:', g.prompt), row('Default:', g.value));
      }
      out.push(row('start point,', pt(g.position)), row('height', d(g.height)));
      if (g.kind === 'TEXT') out.push(row('text', g.value));
      out.push(
        row('rotation angle', a(g.rotation)),
        row('width scale factor', formatNumber(g.widthFactor, u.luprec)),
        row('obliquing angle', a(g.oblique)),
        row('generation', generation(g.backward, g.upsideDown)),
      );
      return out;
    }
    case 'MTEXT':
      return [
        row('Location:', pt(g.position)),
        row('Width:', d(g.width)),
        row('Rotation:', a(g.rotation)),
        row('Text style:', styleName(g.style)),
        row('Text height:', d(g.height)),
        row('Attachment:', ATTACHMENTS[g.attachment] ?? String(g.attachment)),
        row('Contents:', g.contents),
      ];
    case 'INSERT': {
      const block = model.tables.blockRecords.get(g.block);
      const out = [
        row('Block Name:', `"${block?.name ?? ''}"`),
        row('at point,', pt(g.position)),
        row('X scale factor:', formatNumber(g.scale.x, u.luprec)),
        row('Y scale factor:', formatNumber(g.scale.y, u.luprec)),
        row('rotation angle:', a(g.rotation)),
        row('Z scale factor:', formatNumber(g.scale.z, u.luprec)),
      ];
      if (block) {
        out.push(
          row('Scale uniformly:', yesNo(!block.scalable)),
          row('Allow exploding:', yesNo(block.explodable)),
        );
      }
      if (g.array) {
        out.push(
          row('Columns:', String(g.array.columns)),
          row('Rows:', String(g.array.rows)),
          row('Column spacing:', d(g.array.columnSpacing)),
          row('Row spacing:', d(g.array.rowSpacing)),
        );
      }
      for (const att of g.attributes) {
        out.push(
          '',
          `${' '.repeat(18)}${'ATTRIBUTE'.padEnd(8)}  Layer: "${model.tables.layers.get(att.layer)?.name ?? ''}"`,
          row('Handle =', att.handle.toLowerCase()),
          row('Style =', styleName(att.style)),
          row('Tag:', att.tag),
          row('Value:', att.value),
          row('start point,', pt(att.position)),
          row('height', d(att.height)),
          row('rotation angle', a(att.rotation)),
        );
      }
      return out;
    }
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION': {
      const style = model.tables.dimStyles.get(g.style)?.name ?? '';
      const out = [row('type:', DIM_TYPES[g.dimType] ?? g.dimType)];
      const measured = dimensionMeasurement(g);
      if (measured !== undefined) {
        const angular = g.dimType === 'angular' || g.dimType === 'angular3pt';
        out.push(row('measurement:', angular ? a(measured) : d(measured)));
      }
      if (g.text !== '' && g.text !== '<>') out.push(row('text override:', g.text));
      out.push(row('text position,', pt(g.textPosition)), row('dimension style:', `"${style}"`));
      return out;
    }
    case 'HATCH':
      return [
        row('Hatch pattern', g.solid ? 'SOLID' : g.pattern),
        ...(g.solid
          ? []
          : [
              row('Hatch scale', formatNumber(g.patternScale, u.luprec)),
              row('Hatch angle', a(g.patternAngle)),
            ]),
        row('Associative:', yesNo(g.associative)),
      ];
    default:
      return [];
  }
}

const ATTACHMENTS = [
  '',
  'TopLeft',
  'TopCenter',
  'TopRight',
  'MiddleLeft',
  'MiddleCenter',
  'MiddleRight',
  'BottomLeft',
  'BottomCenter',
  'BottomRight',
];

const DIM_TYPES: Record<string, string> = {
  linear: 'Rotated',
  aligned: 'Aligned',
  angular: 'Angular',
  angular3pt: 'Angular 3 Point',
  radius: 'Radius',
  diameter: 'Diameter',
  ordinate: 'Ordinate',
  jogged: 'Jogged Radius',
  arc: 'Arc Length',
};

function generation(backward: boolean, upsideDown: boolean): string {
  if (backward && upsideDown) return 'backward, upside down';
  if (backward) return 'backward';
  if (upsideDown) return 'upside down';
  return 'normal';
}

/** One width for every segment, or undefined when they differ. */
function constantWidth(g: {
  readonly vertices: readonly PolylineVertex[];
  readonly constantWidth?: number;
}): number | undefined {
  if (g.constantWidth !== undefined) return g.constantWidth;
  const w = g.vertices[0]?.startWidth ?? 0;
  return g.vertices.every((v) => (v.startWidth ?? 0) === w && (v.endWidth ?? 0) === w)
    ? w
    : undefined;
}

type DimGeometry = Extract<
  EntityGeometry,
  { readonly kind: 'DIMENSION' | 'ARC_DIMENSION' | 'LARGE_RADIAL_DIMENSION' }
>;

/** What a dimension measures (a length, or an angle in radians), where it can be told. */
function dimensionMeasurement(g: DimGeometry): number | undefined {
  switch (g.dimType) {
    case 'aligned':
      return distance(g.first, g.second);
    case 'linear': {
      const r = g.rotation ?? 0;
      const delta = sub(g.second, g.first);
      return Math.abs(delta.x * Math.cos(r) + delta.y * Math.sin(r));
    }
    case 'radius':
    case 'jogged':
      return distance(g.definitionPoint, g.chordPoint);
    case 'diameter':
      return distance(g.definitionPoint, g.chordPoint);
    case 'angular3pt': {
      const a1 = angleOf(sub(g.first, g.vertex));
      const a2 = angleOf(sub(g.second, g.vertex));
      let s = a2 - a1;
      while (s < 0) s += 2 * Math.PI;
      return s > Math.PI ? 2 * Math.PI - s : s;
    }
    case 'arc': {
      let s = g.endAngle - g.startAngle;
      while (s <= 0) s += 2 * Math.PI;
      return distance(g.center, g.first) * s;
    }
    default:
      return undefined;
  }
}

/** LIST: "Select objects:", then each object's lines. */
export function listCommand(): CommandDef {
  return {
    name: 'LIST',
    usesSelection: 'during',
    async *run(ctx) {
      const a = yield ctx.prompt.selection({ message: 'Select objects' });
      if (a.kind !== 'selection') return;
      a.ids.forEach((id, i) => {
        const e = ctx.model.entity(id);
        if (!e) return;
        if (i > 0) ctx.message('');
        for (const line of listObject(ctx.model, e)) ctx.message(line);
      });
    },
  };
}
