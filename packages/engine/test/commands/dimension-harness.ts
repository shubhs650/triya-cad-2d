// The dimension commands' test canvas (M2-11, shared by M4-02's tests): a bus on a sample
// drawing whose dimension engine is a stand-in that draws a dimension as its definition points
// and says what it measures; the real engine is checked over the corpus in
// packages/testkit/src/dims/dims-commands.corpus.test.ts.
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  bulgeArc,
  type BusEvent,
  type DimStyleRecord,
  type DimensionGeometry,
  type DimensionRegenerator,
  type Entity,
  type EntityGeometry,
  type EntityInit,
  type HeaderValue,
  type StringPrompt,
  type TextStyleRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { MODEL_SPACE, entityInit, record, sampleInit } from '../model/fixtures';

export const STYLE = '27';
export const ACAD = '12';
export const ARC = '25';

export const standard = (vars: DimStyleRecord['vars'] = {}): DimStyleRecord => ({
  handle: STYLE,
  name: 'Standard',
  vars,
});

export const deg = (r: number) => Math.round((r * 180) / Math.PI);

/** What the stand-in engine says a dimension measures, rounded to whole units or degrees. */
export function measured(g: DimensionGeometry): string {
  switch (g.dimType) {
    case 'linear':
    case 'aligned': {
      const a =
        g.dimType === 'aligned'
          ? Math.atan2(g.second.y - g.first.y, g.second.x - g.first.x)
          : (g.rotation ?? 0);
      const d = (g.second.x - g.first.x) * Math.cos(a) + (g.second.y - g.first.y) * Math.sin(a);
      return String(Math.round(Math.abs(d) * 1000) / 1000);
    }
    case 'radius':
      return String(
        Math.hypot(g.chordPoint.x - g.definitionPoint.x, g.chordPoint.y - g.definitionPoint.y),
      );
    case 'diameter':
      return String(
        Math.hypot(g.chordPoint.x - g.definitionPoint.x, g.chordPoint.y - g.definitionPoint.y),
      );
    case 'angular3pt': {
      const a = Math.atan2(g.first.y - g.vertex.y, g.first.x - g.vertex.x);
      const b = Math.atan2(g.second.y - g.vertex.y, g.second.x - g.vertex.x);
      return `${Math.abs(deg(b - a))}°`;
    }
    case 'angular': {
      const a = Math.atan2(g.line1End.y - g.line1Start.y, g.line1End.x - g.line1Start.x);
      const b = Math.atan2(
        g.definitionPoint.y - g.line2Start.y,
        g.definitionPoint.x - g.line2Start.x,
      );
      return `${Math.abs(deg(b - a))}°`;
    }
    case 'ordinate': {
      const d =
        g.axis === 'x' ? g.feature.x - g.definitionPoint.x : g.feature.y - g.definitionPoint.y;
      return String(Math.abs(d));
    }
    case 'jogged':
      return `R${Math.hypot(g.chordPoint.x - g.definitionPoint.x, g.chordPoint.y - g.definitionPoint.y)}`;
    case 'arc': {
      const r = Math.hypot(g.first.x - g.center.x, g.first.y - g.center.y);
      const a = Math.atan2(g.first.y - g.center.y, g.first.x - g.center.x);
      const b = Math.atan2(g.second.y - g.center.y, g.second.x - g.center.x);
      let sweep = b - a;
      while (sweep <= 0) sweep += 2 * Math.PI;
      return String(Math.round(r * sweep * 1000) / 1000);
    }
    default:
      return '?';
  }
}

/** The stand-in dimension engine: the definition points, the text placed at DXF 11 + (0,1). */
export const regenerate: DimensionRegenerator = (e, _model, measure) => {
  const g = e.geom as DimensionGeometry;
  if (!('dimType' in g)) return undefined;
  const width = measure({
    kind: 'MTEXT',
    contents: measured(g),
    style: '',
    position: g.textPosition,
    height: 1,
    width: 0,
    rotation: 0,
    attachment: 5,
    direction: 1,
    lineSpacingStyle: 1,
    lineSpacing: 1,
  });
  if (width === undefined) return undefined;
  const at = g.textUserPositioned
    ? g.textPosition
    : { x: g.definitionPoint.x, y: g.definitionPoint.y + 1 };
  return {
    parts: [{ geom: { kind: 'POINT', position: g.definitionPoint }, defpoint: true }],
    geom: { ...g, textPosition: at },
    measurement: measured(g),
  };
};

/** Distance from `p` to segment a–b. */
export function toSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A test canvas: picks find model-space objects within 0.5; every character is 1 wide. */
export function setup(
  o: {
    styles?: DimStyleRecord[];
    dimensions?: boolean;
    /** Another stand-in dimension engine (one that draws lines, for DIMBREAK). */
    regenerate?: DimensionRegenerator;
    header?: [string, HeaderValue][];
    entities?: EntityInit[];
    textStyles?: TextStyleRecord[];
  } = {},
) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    header: new Map([...init.header!, ['$DIMSTYLE', 'Standard'], ...(o.header ?? [])]),
    tables: {
      ...init.tables,
      appIds: [record(ACAD, 'ACAD')],
      dimStyles: o.styles ?? [standard()],
      ...(o.textStyles && { textStyles: o.textStyles }),
    },
    entities: [
      ...(init.entities ?? []),
      ...(o.entities ?? []),
      entityInit(ARC, {
        kind: 'ARC',
        center: { x: 50, y: 0 },
        radius: 10,
        startAngle: 0,
        endAngle: Math.PI / 3,
      }),
      entityInit('26', { kind: 'LINE', start: { x: 0, y: 20 }, end: { x: 10, y: 20 } }),
      entityInit('28', {
        kind: 'LWPOLYLINE',
        closed: true,
        vertices: [
          { x: 100, y: 0, bulge: 0 },
          { x: 120, y: 0, bulge: 0 },
          { x: 120, y: 10, bulge: 0 },
          { x: 100, y: 10, bulge: 0 },
        ],
      }),
    ],
  });
  const before = new Set([...model.entities()].map((e) => e.id));
  const added = (): Entity[] =>
    [...model.entities()].filter((e) => !before.has(e.id) && e.owner === MODEL_SPACE);
  const near = (g: EntityGeometry, p: { x: number; y: number }): boolean => {
    switch (g.kind) {
      case 'LINE':
        return toSegment(p, g.start, g.end) <= 0.5;
      case 'CIRCLE':
      case 'ARC':
        return Math.abs(Math.hypot(p.x - g.center.x, p.y - g.center.y) - g.radius) <= 0.5;
      case 'LWPOLYLINE':
        return g.vertices.some((v, i) => {
          const w = g.vertices[(i + 1) % g.vertices.length]!;
          if (!g.closed && i === g.vertices.length - 1) return false;
          if (v.bulge === 0) return toSegment(p, v, w) <= 0.5;
          // An arc segment: near its circle within its sweep.
          const a = bulgeArc(v, w, v.bulge);
          const t = Math.atan2(p.y - a.center.y, p.x - a.center.x) - a.startAngle;
          const k = (((a.sweep >= 0 ? t : -t) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const r = Math.hypot(p.x - a.center.x, p.y - a.center.y);
          return k <= Math.abs(a.sweep) && Math.abs(r - a.radius) <= 0.5;
        });
      case 'LEADER':
        // Near its path (M4-15's DIMBREAK on leaders).
        return g.vertices.some((v, i) => i > 0 && toSegment(p, g.vertices[i - 1]!, v) <= 0.5);
      case 'MULTILEADER':
        // Near a leader line, which runs on to its branch's connection point.
        return g.branches.some((b) =>
          b.lines.some((l) => {
            const pts = [...l.vertices, b.connection];
            return pts.some((v, i) => i > 0 && toSegment(p, pts[i - 1]!, v) <= 0.5);
          }),
        );
      case 'DIMENSION':
      case 'ARC_DIMENSION':
      case 'LARGE_RADIAL_DIMENSION':
        return Object.values(g).some(
          (v) => v && typeof v === 'object' && 'x' in v && Math.hypot(v.x - p.x, v.y - p.y) <= 0.5,
        );
      default:
        return false;
    }
  };
  const editors: StringPrompt['editor'][] = [];
  const answer = (r: ViewRequest): ViewReply => {
    if (r.op === 'pick') {
      const ids = model
        .blockEntities(MODEL_SPACE)
        .filter((id) => near(model.entity(id)!.geom, r.point));
      return { ok: true, ids };
    }
    if (r.op === 'textWidths') return { ok: true, widths: r.texts.map((t) => t.contents.length) };
    return { ok: false, message: 'not drawn' };
  };
  const registry = builtinCommands();
  const bus = new PromptBus({
    model,
    registry,
    view: { request: (r) => Promise.resolve(answer(r)) },
    ...(o.dimensions !== false && { dimensions: o.regenerate ?? regenerate }),
  });
  const prompts: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'prompt') {
      prompts.push(bus.promptText);
      const p = bus.prompt;
      if (p?.kind === 'string' && p.editor) editors.push(p.editor);
    }
  });
  const dims = () =>
    added().filter(
      (e) =>
        e.geom.kind === 'DIMENSION' ||
        e.geom.kind === 'ARC_DIMENSION' ||
        e.geom.kind === 'LARGE_RADIAL_DIMENSION',
    );
  const dim = <T extends DimensionGeometry['dimType']>(i = -1) =>
    dims().at(i)!.geom as DimensionGeometry & { dimType: T };
  return { model, bus, added, dims, dim, prompts, editors };
}

export const said = (bus: PromptBus) => bus.history.join('\n');
