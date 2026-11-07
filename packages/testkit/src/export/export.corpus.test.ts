// TriyaToAcad on the public corpus (M1-05, M1-75): a markup-style edit of every entity Triya can
// write (move it; grow circles and arcs, turn arcs, text, blocks and feature control frames;
// move hatches with their pattern origin, images, wipeouts, underlays, multilines, multileaders
// and viewport frames; move tables, widen their first column, heighten their first row and retype
// their cells), with what the Layers palette and a markup session change outside the
// entities (every layer turned off or on, locked or unlocked and recoloured; every text style
// widened and slanted; every linetype redescribed and its pattern doubled; every dimension style
// rescaled, its text enlarged and moved inside, and its dimension lines recoloured; every table
// style before R2010 redescribed, its margins and data text doubled, its title filled and its
// header's top border thickened; $LTSCALE, $TEXTSIZE
// and the current layer; every block's draw order turned upside down; every image definition
// repathed, unloaded or reloaded and its pixel size doubled, and IMAGEFRAME, IMAGEQUALITY and
// WIPEOUTFRAME toggled), must save so that the
// edited entities, records and header variables map back to the edit, and every other object in the file comes back exactly as
// read: `structuralDiff` ignoring only the edited handles and variables reports nothing
// (TESTING.md §3).
// The unedited save is the round-trip suite (roundtrip/corpus-roundtrip.test.ts).
import { readFileSync } from 'node:fs';
import {
  ACadVersion,
  Insert,
  Polyline,
  type CadDictionary,
  type Viewport,
} from '@node-projects/acad-ts';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
  type Handle,
  type DimStyleRecord,
  type MLeaderStyleRecord,
  type HatchGeometry,
  type LeaderGeometry,
  type HeaderValue,
  type ImageDefinition,
  type LayerRecord,
  type LinetypeRecord,
  type NonGraphicalObject,
  type RasterVariables,
  type SortEntsTable,
  type TableStyleRecord,
  type TextFields,
  type TextStyleRecord,
  type UcsRecord,
  type Vec2,
  type ViewRecord,
  type VportRecord,
  type WipeoutVariables,
} from '@triya/engine';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  WRITABLE_TYPES,
  type CadFormat,
} from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));
const writable = new Set<string>(WRITABLE_TYPES);
/** Each file opens, maps, saves and reopens twice; the slowest takes about 1 s alone. */
const PER_FILE_BUDGET_MS = 10_000;

const D: Vec2 = { x: 0.5, y: -0.25 };
const move = (p: Vec2): Vec2 => ({ x: p.x + D.x, y: p.y + D.y });
const TURN = 0.1;
const TWO_PI = 2 * Math.PI;
const turn = (a: number): number => (a + TURN) % TWO_PI;

/** MOVE of a text frame (TEXT, ATTDEF, ATTRIB), with ROTATE in place. */
function movedText<T extends TextFields>(g: T): T {
  return {
    ...g,
    position: move(g.position),
    ...(g.alignmentPoint ? { alignmentPoint: move(g.alignmentPoint) } : {}),
    rotation: turn(g.rotation),
  };
}

type DimensionGeometry = Extract<
  EntityGeometry,
  { kind: 'DIMENSION' | 'ARC_DIMENSION' | 'LARGE_RADIAL_DIMENSION' }
>;

/** MOVE of a dimension: every point (its block, the drawn graphics, is not regenerated). */
function movedDimension(g: DimensionGeometry): EntityGeometry {
  const shared = { definitionPoint: move(g.definitionPoint), textPosition: move(g.textPosition) };
  switch (g.dimType) {
    case 'linear':
    case 'aligned':
    case 'angular3pt':
      return {
        ...g,
        ...shared,
        first: move(g.first),
        second: move(g.second),
        ...(g.dimType === 'angular3pt' ? { vertex: move(g.vertex) } : {}),
      } as EntityGeometry;
    case 'angular':
      return {
        ...g,
        ...shared,
        line1Start: move(g.line1Start),
        line1End: move(g.line1End),
        line2Start: move(g.line2Start),
        arcPoint: move(g.arcPoint),
      };
    case 'radius':
    case 'diameter':
      return { ...g, ...shared, chordPoint: move(g.chordPoint) };
    case 'ordinate':
      return { ...g, ...shared, feature: move(g.feature), leaderEnd: move(g.leaderEnd) };
    case 'jogged':
      return {
        ...g,
        ...shared,
        chordPoint: move(g.chordPoint),
        overrideCenter: move(g.overrideCenter),
        jogPoint: move(g.jogPoint),
      };
    case 'arc':
      return {
        ...g,
        ...shared,
        first: move(g.first),
        second: move(g.second),
        center: move(g.center),
        ...(g.leader ? { leader: [move(g.leader[0]), move(g.leader[1])] as const } : {}),
      };
  }
}

type HatchEdge = NonNullable<HatchGeometry['loops'][number]['edges']>[number];

function movedHatchEdge(e: HatchEdge): HatchEdge {
  switch (e.type) {
    case 'line':
      return { ...e, start: move(e.start), end: move(e.end) };
    case 'arc':
    case 'ellipse':
      return { ...e, center: move(e.center) };
    case 'spline':
      return {
        ...e,
        controlPoints: e.controlPoints.map(move),
        ...(e.fitPoints ? { fitPoints: e.fitPoints.map(move) } : {}),
      };
  }
}

/** MOVE of a hatch: its boundary, seed points and pattern origin (the boundary objects stay). */
function movedHatch(g: HatchGeometry): HatchGeometry {
  return {
    ...g,
    loops: g.loops.map((l) => ({
      ...l,
      ...(l.polyline
        ? {
            polyline: {
              ...l.polyline,
              vertices: l.polyline.vertices.map((v) => ({ ...v, ...move(v) })),
            },
          }
        : {}),
      ...(l.edges ? { edges: l.edges.map(movedHatchEdge) } : {}),
    })),
    seedPoints: g.seedPoints.map(move),
    patternLines: g.patternLines.map((l) => ({ ...l, base: move(l.base) })),
  };
}

/** The edit: what MOVE, SCALE (about the centre) and ROTATE (in place) would leave. */
function edited(g: EntityGeometry): EntityGeometry {
  switch (g.kind) {
    case 'LINE':
      return { ...g, start: move(g.start), end: move(g.end) };
    case 'XLINE':
    case 'RAY':
      return { ...g, base: move(g.base) };
    case 'CIRCLE':
      return { ...g, center: move(g.center), radius: g.radius * 2 };
    case 'ARC':
      return {
        ...g,
        center: move(g.center),
        radius: g.radius * 2,
        startAngle: turn(g.startAngle),
        endAngle: turn(g.endAngle),
      };
    case 'ELLIPSE':
      return { ...g, center: move(g.center) };
    case 'POINT':
      return { ...g, position: move(g.position) };
    case 'LWPOLYLINE':
      return { ...g, vertices: g.vertices.map((v) => ({ ...v, ...move(v) })) };
    case 'TEXT':
    case 'ATTDEF':
      return movedText(g);
    case 'INSERT':
      // MOVE takes the ATTRIBs along (a multiline one's embedded MTEXT too); ROTATE turns the
      // block about its insertion point.
      return {
        ...g,
        position: move(g.position),
        rotation: turn(g.rotation),
        attributes: g.attributes.map((a) => ({
          ...movedText(a),
          ...(a.mtext ? { mtext: { ...a.mtext, position: move(a.mtext.position) } } : {}),
        })),
      };
    case 'MTEXT':
      return { ...g, position: move(g.position), rotation: turn(g.rotation) };
    case 'SOLID':
    case '3DFACE': {
      const [a, b, c, d] = g.corners.map(move);
      return { ...g, corners: [a!, b!, c!, d!] };
    }
    case 'SPLINE':
      return {
        ...g,
        controlPoints: g.controlPoints.map(move),
        ...(g.fitPoints ? { fitPoints: g.fitPoints.map(move) } : {}),
      };
    case 'POLYLINE':
      return {
        ...g,
        vertices: g.vertices.map((v) => ({ ...v, ...move(v) })),
        ...(g.frame ? { frame: g.frame.map(move) } : {}),
      };
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION':
      return movedDimension(g);
    case 'LEADER':
      return { ...g, vertices: g.vertices.map(move) };
    case 'TOLERANCE':
      return { ...g, position: move(g.position), rotation: turn(g.rotation) };
    case 'HATCH':
      return movedHatch(g);
    case 'IMAGE':
    case 'WIPEOUT':
    case 'PDFUNDERLAY':
      return { ...g, position: move(g.position) };
    case 'MLINE':
      return {
        ...g,
        start: move(g.start),
        vertices: g.vertices.map((v) => ({ ...v, position: move(v.position) })),
      };
    case 'MULTILEADER':
      return {
        ...g,
        contentBase: move(g.contentBase),
        ...(g.text ? { text: { ...g.text, position: move(g.text.position) } } : {}),
        ...(g.block ? { block: { ...g.block, position: move(g.block.position) } } : {}),
        branches: g.branches.map((b) => ({
          ...b,
          connection: move(b.connection),
          lines: b.lines.map((l) => ({ ...l, vertices: l.vertices.map(move) })),
        })),
      };
    case 'VIEWPORT':
      // MOVE of the frame in paper space; the view it shows stays.
      return { ...g, center: move(g.center) };
    case 'ACAD_TABLE':
      // MOVE, a wider first column and a taller first row (the grips), and every cell that can
      // be typed in retyped (number and date cells become the text typed).
      return {
        ...g,
        position: move(g.position),
        rowHeights: g.rowHeights.map((h, i) => (i === 0 ? h * 1.5 : h)),
        columnWidths: g.columnWidths.map((w, j) => (j === 0 ? w * 1.5 : w)),
        cells: g.cells.map((row) =>
          row.map((c) =>
            c.type === 'text' && !c.merged ? { ...c, text: `${c.text} (edited)` } : c,
          ),
        ),
      };
    default:
      throw new Error(`no edit for ${g.kind}`);
  }
}

/** The Layers palette's toggles and a colour change, on every layer. */
function editedLayer(l: LayerRecord): Partial<LayerRecord> {
  const index = l.color.kind === 'aci' && l.color.index === 3 ? 4 : 3;
  return { on: !l.on, locked: !l.locked, color: { kind: 'aci', index } };
}

/** The STYLE dialog on every text style: a wider width factor, and slanted or upright. */
function editedTextStyle(s: TextStyleRecord): Partial<TextStyleRecord> {
  return {
    widthFactor: s.widthFactor * 1.25,
    obliqueAngle: s.obliqueAngle === 0 ? Math.PI / 12 : 0,
  };
}

/** LTYPE records with a pattern to edit: all but ByLayer and ByBlock, which stand for others. */
const editableLinetype = (l: LinetypeRecord): boolean =>
  !['BYLAYER', 'BYBLOCK'].includes(l.name.toUpperCase());

/** A new description, and a linetype's pattern twice as long (Continuous has none). */
function editedLinetype(l: LinetypeRecord): Partial<LinetypeRecord> {
  return {
    description: `${l.description} (edited)`,
    ...(l.elements.length > 0
      ? {
          patternLength: l.patternLength * 2,
          elements: l.elements.map((e) => ({ ...e, length: e.length * 2 })),
        }
      : {}),
  };
}

/**
 * The DIMSTYLE manager on every dimension style: twice the overall scale, larger text forced
 * inside the extension lines, and red or yellow dimension lines (variables every version stores).
 */
function editedDimStyle(s: DimStyleRecord): {
  readonly [K in keyof DimStyleRecord]?: DimStyleRecord[K] | undefined;
} {
  const v = s.vars;
  // An ACI of its own replaces an R2004+ DWG's true colour, as the DIMSTYLE manager does.
  const { DIMCLRD: _dimclrd, ...trueColors } = s.trueColors ?? {};
  return {
    trueColors: Object.keys(trueColors).length > 0 ? trueColors : undefined,
    vars: {
      ...v,
      DIMSCALE: (v.DIMSCALE as number) === 0 ? 1 : (v.DIMSCALE as number) * 2,
      DIMTXT: (v.DIMTXT as number) * 1.5,
      DIMTIX: !v.DIMTIX,
      DIMCLRD: v.DIMCLRD === 1 ? 2 : 1,
    },
  };
}

/** MLEADERSTYLE: text, landing and colour edits, as the multileader style manager makes. */
function editedMLeaderStyle(s: MLeaderStyleRecord): Partial<MLeaderStyleRecord> {
  return {
    description: `${s.description} (edited)`,
    textHeight: s.textHeight * 2,
    landingGap: s.landingGap + 0.5,
    maxLeaderPoints: s.maxLeaderPoints + 1,
    textFrame: !s.textFrame,
    lineColor: {
      kind: 'aci',
      index: s.lineColor.kind === 'aci' && s.lineColor.index === 1 ? 2 : 1,
    },
  };
}

/** TABLESTYLE: margins, text, fill and a border, as the table style dialog changes them. */
function editedTableStyle(s: TableStyleRecord): Partial<TableStyleRecord> {
  const [data, title, header] = s.cellStyles;
  return {
    description: `${s.description} (edited)`,
    horizontalMargin: s.horizontalMargin * 2,
    verticalMargin: s.verticalMargin * 2,
    cellStyles: [
      { ...data!, textHeight: data!.textHeight * 2 },
      {
        ...title!,
        fillOn: !title!.fillOn,
        fillColor: {
          kind: 'aci',
          index: title!.fillColor.kind === 'aci' && title!.fillColor.index === 8 ? 9 : 8,
        },
      },
      {
        ...header!,
        borders: header!.borders.map((b, i) =>
          i === 0 ? { ...b, lineweight: b.lineweight === 50 ? 35 : 50 } : b,
        ),
      },
    ],
  };
}

/** UCS: the origin moved, as the UCS command's Origin option does. */
function editedUcs(u: UcsRecord): Partial<UcsRecord> {
  return { origin: { x: u.origin.x + 1, y: u.origin.y - 2, z: u.origin.z } };
}

/** VIEW and VPORT records: zoomed out 2× about a point moved off the centre, as ZOOM and PAN do. */
function editedView<T extends ViewRecord | VportRecord>(v: T): Partial<T> {
  return {
    center: { x: v.center.x + 10, y: v.center.y - 5 },
    height: v.height * 2,
    ...('width' in v ? { width: v.width * 2 } : {}),
  } as Partial<T>;
}

type ImageObject = ImageDefinition | RasterVariables | WipeoutVariables;

const IMAGE_OBJECTS = new Set(['IMAGEDEF', 'RASTERVARIABLES', 'WIPEOUTVARIABLES']);

/**
 * The External References palette's repath and Unload / Reload with a doubled pixel size;
 * IMAGEFRAME, IMAGEQUALITY (and the insertion units) and WIPEOUTFRAME toggled.
 */
function editedImageObject(o: ImageObject): Partial<ImageObject> {
  if (o.type === 'IMAGEDEF') {
    return {
      fileName: `..\\moved\\${o.fileName.split(/[\\/]/).pop() ?? 'image.png'}`,
      loaded: !o.loaded,
      pixelSize: { x: o.pixelSize.x * 2, y: o.pixelSize.y * 2 },
      units: o.units === 5 ? 2 : 5,
    };
  }
  if (o.type === 'RASTERVARIABLES') {
    return {
      frame: !o.frame,
      quality: o.quality === 'draft' ? 'high' : 'draft',
      units: (o.units + 1) % 9,
    };
  }
  return { frame: !o.frame };
}

/** A record as it maps back, without the reader's link. */
function withoutRaw<T extends { raw?: unknown }>(r: T | undefined): Omit<T, 'raw'> | undefined {
  if (!r) return r;
  const { raw: _raw, ...rest } = r;
  return rest;
}

/** Header variables a markup session changes: LTSCALE, TEXTSIZE and the current layer. */
function editedHeader(model: DocumentModel): Map<string, HeaderValue> {
  const out = new Map<string, HeaderValue>();
  const ltscale = model.header.get('$LTSCALE');
  const textsize = model.header.get('$TEXTSIZE');
  if (typeof ltscale === 'number') out.set('$LTSCALE', ltscale * 2);
  if (typeof textsize === 'number') out.set('$TEXTSIZE', textsize + 1);
  const current = model.header.get('$CLAYER');
  const other = [...model.tables.layers.values()].find((l) => l.name !== current);
  if (typeof current === 'string' && other) out.set('$CLAYER', other.name);
  return out;
}

/** A layer as it maps back: `raw` is the reader's link, and DXF 70 holds frozen/locked. */
function comparableLayer(l: LayerRecord | undefined): unknown {
  if (!l) return l;
  const { raw: _raw, flags, ...rest } = l;
  const others = (flags ?? 0) & ~5;
  return { ...rest, ...(others ? { flags: others } : {}) };
}

function edit(model: DocumentModel, e: Entity, geom: EntityGeometry): void {
  const b = new ChangeSetBuilder(model);
  b.updateEntity(e.id, { geom });
  model.apply(b.build());
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Equal up to float noise relative to the drawing's magnitude; angles compared mod 2π. */
function near(a: unknown, b: unknown, key = ''): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    if (Math.abs(a - b) <= tol) return true;
    if (/angle|rotation|param/i.test(key)) {
      const d = Math.abs(a - b) % TWO_PI;
      return Math.min(d, TWO_PI - d) <= 1e-9;
    }
    return false;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Object.is(a, b);
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], k),
  );
}

describe('TriyaToAcad edits on the public corpus', () => {
  it('covers the readable corpus', () => {
    expect(readable.length).toBeGreaterThan(100);
  });

  describe('an R12 viewport’s view, which lives in its MVIEW xdata (M1-86)', () => {
    const path = 'public/third-party/acadsharp/sample_AC1009_ascii.dxf';
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
    const open = (): DocumentModel => DocumentModel.create(documentInit(readCadDocument(bytes)));
    const viewports = (m: DocumentModel): Entity[] =>
      [...m.entities()].filter((e) => e.type === 'VIEWPORT');
    type View = Extract<EntityGeometry, { kind: 'VIEWPORT' }>;
    // ViewportStatusFlags (DXF 90): R12 says these through VIEWMODE and the MVIEW 1070s.
    const GRID = 512;
    const SNAP = 256;
    const ISO_TOP = 4096;
    const ISO_RIGHT = 8192;
    const HIDE_PLOT = 2048;
    const UCS_AT_ORIGIN = 64;
    const ZOOM_LOCK = 16384;
    const OFF = 131072;

    const views: [string, (g: View) => Partial<View>][] = [
      [
        'the view itself',
        (g) => ({
          viewCenter: { x: g.viewCenter.x + 2, y: g.viewCenter.y - 1 },
          viewHeight: g.viewHeight * 2,
          twist: 0.5,
          viewTarget: { x: 1, y: 2, z: 3 },
          viewDirection: { x: 1, y: -1, z: 1 },
          lensLength: 35,
          frontClip: 2,
          backClip: -4,
        }),
      ],
      ['perspective with front and back clipping', (g) => ({ flags: g.flags | 0b10111 })],
      [
        'snap, grid, isometric snap on the top plane, hidden in plot',
        (g) => ({ flags: (g.flags ^ GRID ^ SNAP ^ UCS_AT_ORIGIN) | 1024 | ISO_TOP | HIDE_PLOT }),
      ],
      ['the right isometric plane', (g) => ({ flags: g.flags | 1024 | ISO_RIGHT })],
    ];
    it.each(views)('saves %s and maps it back', (_what, change) => {
      withPinnedClock(() => {
        const model = open();
        const targets = viewports(model);
        expect(targets).toHaveLength(2);
        for (const vp of targets) {
          edit(model, vp, { ...vp.geom, ...change(vp.geom as View) } as EntityGeometry);
        }
        const original = readCadDocument(bytes);
        const reopened = readCadDocument(
          exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
        );
        const back = new Map(documentInit(reopened).entities?.map((e) => [e.handle, e]));
        for (const vp of targets.map((e) => model.entity(e.id)!)) {
          expect(near(back.get(vp.handle)?.geom, vp.geom), vp.handle).toBe(true);
        }
        const ignoreHandles = new Set(targets.map((e) => Number.parseInt(e.handle, 16)));
        expect(structuralDiff(original, reopened, { ignoreHandles }).differences).toEqual([]);
      });
    });

    // R12 names a viewport's frozen layers as 1003 strings in its MVIEW xdata (acad-ts patch
    // 0135). No corpus R12 viewport freezes a layer: freeze two, save, then thaw one.
    it('freezes and thaws layers in a viewport and maps them back (M1-90)', () => {
      withPinnedClock(() => {
        const saveAndCheck = (from: Uint8Array, frozen: string[]): Uint8Array => {
          const model = DocumentModel.create(documentInit(readCadDocument(from)));
          const layer = (name: string): Handle =>
            [...model.tables.layers.values()].find((l) => l.name === name)!.handle;
          const [first, second] = viewports(model);
          edit(model, first!, {
            ...first!.geom,
            frozenLayers: frozen.map(layer),
          } as EntityGeometry);
          const original = readCadDocument(from);
          const saved = exportDocument(readCadDocument(from), model, { format: 'dxf' });
          const reopened = readCadDocument(saved);
          const back = new Map(documentInit(reopened).entities?.map((e) => [e.handle, e]));
          for (const vp of [first!, second!].map((e) => model.entity(e.id)!)) {
            expect(near(back.get(vp.handle)?.geom, vp.geom), vp.handle).toBe(true);
          }
          const v = reopened.getCadObject(Number.parseInt(first!.handle, 16)) as Viewport;
          const names = v.frozenLayers.map((l) => l.name);
          expect(names).toEqual(frozen);
          const ignoreHandles = new Set([Number.parseInt(first!.handle, 16)]);
          expect(structuralDiff(original, reopened, { ignoreHandles }).differences).toEqual([]);
          return saved;
        };
        const frozen = saveAndCheck(bytes, ['LAYER_VP_FREEZE', 'LAYER2']);
        // As R12 says it: 1003 names in the MVIEW xdata, no 331 handles.
        const text = new TextDecoder('latin1').decode(frozen);
        expect(text).toMatch(
          /1002\r?\n\{\r?\n1003\r?\nLAYER_VP_FREEZE\r?\n1003\r?\nLAYER2\r?\n1002\r?\n\}/,
        );
        expect(text).not.toMatch(/\n331\r?\n/);
        saveAndCheck(frozen, ['LAYER2']);
      });
    });

    const refused: [string, (g: View) => Partial<View>, RegExp][] = [
      ['a plot style table', () => ({ plotStyleSheet: 'monochrome.ctb' }), /R12 has no/],
      ['a render mode', () => ({ renderMode: 1 }), /R12 has no/],
      ['a flag R12 has no place for', (g) => ({ flags: g.flags | ZOOM_LOCK }), /R12 has no/],
      ['an off flag without status 0', (g) => ({ flags: g.flags | OFF }), /status 0/],
      ['status 0 without the off flag', () => ({ status: 0 }), /status 0/],
      ['both isometric planes', (g) => ({ flags: g.flags | ISO_TOP | ISO_RIGHT }), /isometric/],
    ];
    it('saves a new viewport in paper space and maps it back (M1-89)', () => {
      withPinnedClock(() => {
        const model = open();
        const like = viewports(model)[1]!;
        const g = like.geom as View;
        const vpFreeze = [...model.tables.layers.values()].find(
          (l) => l.name === 'LAYER_VP_FREEZE',
        )!.handle;
        const b = new ChangeSetBuilder(model);
        const draft = b.addEntity({
          owner: like.owner,
          layer: like.layer,
          geom: {
            ...g,
            id: 3,
            center: { x: g.center.x + 1, y: g.center.y },
            viewCenter: { x: 1, y: 2 },
            viewHeight: 4,
            flags: g.flags | GRID,
            frozenLayers: [vpFreeze],
          },
        });
        model.apply(b.build());
        const added = model.entity(draft.id)!;
        const original = readCadDocument(bytes);
        const saved = exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
        const reopened = readCadDocument(saved);
        // In paper space: R12 says so by 67 = 1, beside the view in its MVIEW xdata.
        const v = reopened.getCadObject(Number.parseInt(added.handle, 16));
        expect(v?.owner).toBe(reopened.paperSpace);
        const back = new Map(documentInit(reopened).entities?.map((e) => [e.handle, e]));
        // The record's handle is made up (R12 has no BLOCK_RECORD table), and the made-up handles
        // move up past the new viewport's on the next read.
        expect(back.get(added.handle)?.owner).toBe(
          reopened.paperSpace!.handle.toString(16).toUpperCase(),
        );
        // The frozen layer's handle is made up too, so it is compared by name.
        const { frozenLayers: _, ...geom } = added.geom as View;
        const { frozenLayers, ...backGeom } = back.get(added.handle)?.geom as View;
        expect(near(backGeom, geom)).toBe(true);
        expect((v as Viewport).frozenLayers.map((l) => l.name)).toEqual(['LAYER_VP_FREEZE']);
        expect(frozenLayers).toEqual([
          (v as Viewport).frozenLayers[0]!.handle.toString(16).toUpperCase(),
        ]);
        // The edit: the viewport and the paper space record that lists it.
        const ignoreHandles = new Set([
          Number.parseInt(added.handle, 16),
          original.paperSpace!.handle,
        ]);
        // The handles acad-ts makes up on read (R12 has no BLOCK_RECORD table, and its table
        // entries state none) are numbered above the highest the file states, so the new one
        // moves them all up by the same amount.
        const was = original.madeUpHandles!;
        const now = reopened.madeUpHandles!;
        expect(now.last - now.first).toBe(was.last - was.first);
        const handleOfB = (h: number): number =>
          h >= now.first && h <= now.last ? h - now.first + was.first : h;
        expect(
          structuralDiff(original, reopened, { ignoreHandles, handleOfB }).differences,
        ).toEqual([]);
      });
    });

    it('refuses a new viewport with a clip boundary', () => {
      const model = open();
      const like = viewports(model)[1]!;
      const b = new ChangeSetBuilder(model);
      b.addEntity({
        owner: like.owner,
        layer: like.layer,
        geom: {
          ...(like.geom as View),
          id: 3,
          clipBoundary: like.handle,
        },
      });
      model.apply(b.build());
      expect(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' })).toThrow(
        /R12 has no viewport clip boundary/,
      );
    });

    it.each(refused)('refuses %s', (_what, change, message) => {
      const model = open();
      const vp = viewports(model)[1]!;
      const g = vp.geom as View;
      edit(model, vp, { ...g, ...change(g) } as EntityGeometry);
      expect(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' })).toThrow(
        message,
      );
    });
  });

  it('refuses an edit of the layer 0 an R12 file does not have (acad-ts makes it up)', () => {
    const path = 'public/third-party/ezdxf/examples_dxf/Minimal_DXF_AC1006.dxf';
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
    const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
    const zero = [...model.tables.layers.values()].find((l) => l.name === '0')!;
    const b = new ChangeSetBuilder(model);
    b.updateTableRecord('layers', zero.handle, { color: { kind: 'aci', index: 3 } });
    model.apply(b.build());

    expect(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' })).toThrow(
      /layer 0 .*made it up/,
    );
  });

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const original = readCadDocument(bytes);
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const targets = [...model.entities()].filter((e) => writable.has(e.type));
        // An R12 file without layer 0 reads with a made-up one, which saves only as read.
        const madeUp = original.madeUpHandles?.added;
        const layers = [...model.tables.layers.values()].filter(
          (l) => !madeUp?.has(Number.parseInt(l.handle, 16)),
        );
        const kept = (r: { handle: Handle }): boolean =>
          !madeUp?.has(Number.parseInt(r.handle, 16));
        const textStyles = [...model.tables.textStyles.values()].filter(kept);
        const linetypes = [...model.tables.linetypes.values()]
          .filter(kept)
          .filter(editableLinetype);
        const dimStyles = [...model.tables.dimStyles.values()].filter(kept);
        const mleaderStyles = [...model.tables.mleaderStyles.values()];
        // From R2010 AutoCAD keeps a table style's cell styles, which Triya does not map (M1-96).
        const version = original.header?.version ?? ACadVersion.AC1032;
        const tableStyles =
          version < ACadVersion.AC1024 ? [...model.tables.tableStyles.values()] : [];
        const ucs = [...model.tables.ucs.values()].filter(kept);
        const views = [...model.tables.views.values()].filter(kept);
        const vports = [...model.tables.vports.values()].filter(kept);
        const header = editedHeader(model);
        // DRAWORDER: each block's draw order turned upside down among the entities it lists.
        const drawOrder = [...model.objects.values()]
          .filter((o): o is SortEntsTable => o.type === 'SORTENTSTABLE')
          .filter((t) => t.entries.length > 1)
          .map((t) => ({
            ...t,
            entries: t.entries.map((en, i, all) => ({
              ...en,
              sort: all[all.length - 1 - i]!.sort,
            })),
          }));
        const imageObjects = [...model.objects.values()].filter((o): o is ImageObject =>
          IMAGE_OBJECTS.has(o.type),
        );
        const b = new ChangeSetBuilder(model);
        for (const o of imageObjects)
          b.updateObject(o.handle, editedImageObject(o) as Partial<NonGraphicalObject>);
        for (const e of targets) b.updateEntity(e.id, { geom: edited(e.geom) });
        // Each LEADER lets go of its annotation, which drops the leader from its reactors.
        const detached = targets
          .filter((e) => e.geom.kind === 'LEADER' && e.geom.annotation !== undefined)
          .map((e) => {
            const { annotation, ...g } = b.entity(e.id)!.geom as LeaderGeometry;
            b.updateEntity(e.id, { geom: g });
            const a = model.entityByHandle(annotation!)!;
            const reactors = (a.reactors ?? []).filter((h) => h !== e.handle);
            b.updateEntity(a.id, { reactors });
            return { leader: e, annotation: a };
          });
        for (const t of drawOrder)
          b.updateObject(t.handle, { entries: t.entries } as Partial<NonGraphicalObject>);
        for (const l of layers) b.updateTableRecord('layers', l.handle, editedLayer(l));
        for (const t of textStyles) b.updateTableRecord('textStyles', t.handle, editedTextStyle(t));
        for (const l of linetypes) b.updateTableRecord('linetypes', l.handle, editedLinetype(l));
        for (const d of dimStyles) b.updateTableRecord('dimStyles', d.handle, editedDimStyle(d));
        for (const s of mleaderStyles)
          b.updateTableRecord('mleaderStyles', s.handle, editedMLeaderStyle(s));
        for (const s of tableStyles)
          b.updateTableRecord('tableStyles', s.handle, editedTableStyle(s));
        for (const u of ucs) b.updateTableRecord('ucs', u.handle, editedUcs(u));
        for (const v of views) b.updateTableRecord('views', v.handle, editedView(v));
        for (const v of vports) b.updateTableRecord('vports', v.handle, editedView(v));
        for (const [name, value] of header) b.setHeader(name, value);
        model.apply(b.build());

        const saved = exportDocument(readCadDocument(bytes), model, options);
        const reopened = readCadDocument(saved);
        const init = documentInit(reopened);
        const back = new Map(init.entities?.map((e) => [e.handle, e]));
        const wrong = targets
          .map((e) => model.entity(e.id) as Entity)
          .filter((e) => !near(back.get(e.handle)?.geom, e.geom))
          .map((e) => `${e.type} ${e.handle}`);
        expect(wrong, f.path).toEqual([]);
        const wrongReactors = detached
          .filter(({ leader, annotation }) =>
            (back.get(annotation.handle)?.reactors ?? []).includes(leader.handle),
          )
          .map(({ annotation }) => `${annotation.type} ${annotation.handle}`);
        expect(wrongReactors, f.path).toEqual([]);
        const backLayers = new Map(init.tables?.layers?.map((l) => [l.handle, l]));
        const wrongLayers = layers
          .map((l) => model.tables.layers.get(l.handle)!)
          .filter((l) => !same(comparableLayer(backLayers.get(l.handle)), comparableLayer(l)))
          .map((l) => l.name);
        expect(wrongLayers, f.path).toEqual([]);
        const backStyles = new Map(init.tables?.textStyles?.map((t) => [t.handle, t]));
        const wrongStyles = textStyles
          .map((t) => model.tables.textStyles.get(t.handle)!)
          .filter((t) => !near(withoutRaw(backStyles.get(t.handle)), withoutRaw(t)))
          .map((t) => t.name);
        expect(wrongStyles, f.path).toEqual([]);
        const backLinetypes = new Map(init.tables?.linetypes?.map((l) => [l.handle, l]));
        const wrongLinetypes = linetypes
          .map((l) => model.tables.linetypes.get(l.handle)!)
          .filter((l) => !near(withoutRaw(backLinetypes.get(l.handle)), withoutRaw(l)))
          .map((l) => l.name);
        expect(wrongLinetypes, f.path).toEqual([]);
        const backDimStyles = new Map(init.tables?.dimStyles?.map((d) => [d.handle, d]));
        const wrongDimStyles = dimStyles
          .map((d) => model.tables.dimStyles.get(d.handle)!)
          .filter((d) => !near(withoutRaw(backDimStyles.get(d.handle)), withoutRaw(d)))
          .map((d) => d.name);
        expect(wrongDimStyles, f.path).toEqual([]);
        const backMLeaderStyles = new Map(init.tables?.mleaderStyles?.map((s) => [s.handle, s]));
        const wrongMLeaderStyles = mleaderStyles
          .map((s) => model.tables.mleaderStyles.get(s.handle)!)
          .filter((s) => !near(withoutRaw(backMLeaderStyles.get(s.handle)), withoutRaw(s)))
          .map((s) => s.name);
        expect(wrongMLeaderStyles, f.path).toEqual([]);
        const backTableStyles = new Map(init.tables?.tableStyles?.map((s) => [s.handle, s]));
        const wrongTableStyles = tableStyles
          .map((s) => model.tables.tableStyles.get(s.handle)!)
          .filter((s) => !near(withoutRaw(backTableStyles.get(s.handle)), withoutRaw(s)))
          .map((s) => s.name);
        expect(wrongTableStyles, f.path).toEqual([]);
        const wrongViewRecords = (['ucs', 'views', 'vports'] as const).flatMap((table) => {
          const backRecords = new Map(
            (init.tables?.[table] ?? []).map((r: { handle: Handle; raw?: unknown }) => [
              r.handle,
              r,
            ]),
          );
          return { ucs, views, vports }[table]
            .map((r) => model.tables[table].get(r.handle)!)
            .filter((r) => !near(withoutRaw(backRecords.get(r.handle)), withoutRaw(r)))
            .map((r) => `${table} ${r.name} (${r.handle})`);
        });
        expect(wrongViewRecords, f.path).toEqual([]);
        const backObjects = new Map(init.objects?.map((o) => [o.handle, o]));
        const wrongDrawOrder = drawOrder
          .filter((t) => !same(backObjects.get(t.handle), t))
          .map((t) => t.handle);
        expect(wrongDrawOrder, f.path).toEqual([]);
        const wrongImageObjects = imageObjects
          .map((o) => model.objects.get(o.handle)!)
          .filter((o) => !near(withoutRaw(backObjects.get(o.handle)), withoutRaw(o)))
          .map((o) => `${o.type} ${o.handle}`);
        expect(wrongImageObjects, f.path).toEqual([]);
        const backHeader = new Map(init.header);
        expect(
          [...header.keys()].filter((n) => !same(backHeader.get(n), header.get(n))),
          f.path,
        ).toEqual([]);

        // A polyline's VERTEX entities and an INSERT's ATTRIBs are edited with it, under their
        // own handles.
        const ignoreHandles = new Set(
          [
            ...targets,
            ...layers,
            ...textStyles,
            ...linetypes,
            ...dimStyles,
            ...mleaderStyles,
            ...tableStyles,
            ...ucs,
            ...views,
            ...vports,
            ...drawOrder,
            ...imageObjects,
            ...detached.map((d) => d.annotation),
          ].map((e) => Number.parseInt(e.handle, 16)),
        );
        for (const h of [...ignoreHandles]) {
          const o = original.getCadObject(h);
          if (o instanceof Polyline) for (const v of o.vertices) ignoreHandles.add(v.handle);
          if (o instanceof Insert) for (const a of o.attributes) ignoreHandles.add(a.handle);
        }
        // The edited variables, and the header's current-layer record ($CLAYER), are the edit.
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences.filter(
          (d) =>
            d.handle !== '0' ||
            ![...header.keys(), '_currentLayer'].some(
              (n) => d.path === n || d.path.startsWith(`${n}.`),
            ),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  // M1-95: every multileader style but Standard, every table style but Standard before R2010
  // (from R2010 a table style keeps cell styles Triya does not map, M1-96) and every image
  // definition renamed, with CMLEADERSTYLE and CTABLESTYLE following, as AutoCAD's RENAME and
  // the External References palette do. Each keeps its dictionary entry, in place, under its
  // handle; MULTILEADERs, TABLEs and IMAGEs point at it by handle and come back as read.
  it.each(readable.map((f) => [f.path, f] as const))(
    'renames dictionary-named objects in place in %s',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const original = readCadDocument(bytes);
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const version = original.header?.version ?? ACadVersion.AC1032;
        const renamed = (name: string) => `${name} renamed`;
        const mleaderStyles = [...model.tables.mleaderStyles.values()].filter(
          (s) => s.name.toUpperCase() !== 'STANDARD',
        );
        const tableStyles =
          version < ACadVersion.AC1024
            ? [...model.tables.tableStyles.values()].filter(
                (s) => s.name.toUpperCase() !== 'STANDARD',
              )
            : [];
        const images = [...model.objects.values()].filter(
          (o): o is ImageDefinition => o.type === 'IMAGEDEF',
        );
        if (mleaderStyles.length + tableStyles.length + images.length === 0) return;
        const header = new Map<string, HeaderValue>();
        for (const [name, styles] of [
          ['CMLEADERSTYLE', mleaderStyles],
          ['CTABLESTYLE', tableStyles],
        ] as const) {
          const current = model.header.get(name);
          const style = styles.find(
            (s) => typeof current === 'string' && s.name.toUpperCase() === current.toUpperCase(),
          );
          if (style) header.set(name, renamed(style.name));
        }
        const b = new ChangeSetBuilder(model);
        for (const s of mleaderStyles)
          b.updateTableRecord('mleaderStyles', s.handle, { name: renamed(s.name) });
        for (const s of tableStyles)
          b.updateTableRecord('tableStyles', s.handle, { name: renamed(s.name) });
        for (const o of images)
          b.updateObject(o.handle, { name: renamed(o.name) } as Partial<NonGraphicalObject>);
        for (const [name, value] of header) b.setHeader(name, value);
        model.apply(b.build());

        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const init = documentInit(reopened);
        const names = (rs: readonly { handle: Handle; name: string }[] | undefined) =>
          new Map(rs?.map((r) => [r.handle, r.name]));
        const backMLeader = names(init.tables?.mleaderStyles);
        const backTable = names(init.tables?.tableStyles);
        const backImages = names(
          init.objects?.filter((o): o is ImageDefinition => o.type === 'IMAGEDEF'),
        );
        expect(
          [
            ...mleaderStyles.filter((s) => backMLeader.get(s.handle) !== renamed(s.name)),
            ...tableStyles.filter((s) => backTable.get(s.handle) !== renamed(s.name)),
            ...images.filter((o) => backImages.get(o.handle) !== renamed(o.name)),
          ].map((r) => r.name),
          f.path,
        ).toEqual([]);
        const backHeader = new Map(init.header);
        for (const [name, value] of header) expect(backHeader.get(name), f.path).toBe(value);

        // Each owning dictionary lists the same entries, in the same order, under the new names.
        const newName = new Map<number, string>(
          [...mleaderStyles, ...tableStyles, ...images].map((r) => [
            Number.parseInt(r.handle, 16),
            renamed(r.name),
          ]),
        );
        const owners = new Set<number>();
        for (const h of newName.keys()) {
          const dict = original.getCadObject(h)!.owner as CadDictionary;
          owners.add(dict.handle);
          const back = reopened.getCadObject(dict.handle) as CadDictionary;
          expect(
            { names: back.entryNames, handles: back.entryHandles },
            `${f.path} ${dict.name}`,
          ).toEqual({
            names: dict.entryNames.map((n, i) => newName.get(dict.entryHandles[i]!) ?? n),
            handles: dict.entryHandles,
          });
        }
        // Nothing else changes: not the entities pointing at the renamed objects either.
        // CMLEADERSTYLE and CTABLESTYLE are DICTIONARYVAR objects, whose value is the edit.
        const variables = original.rootDictionary?.get('AcDbVariableDictionary') as
          CadDictionary | undefined;
        const ignoreHandles = new Set([
          ...newName.keys(),
          ...owners,
          ...[...header.keys()].map((n) => variables!.getEntry(n)!.handle),
        ]);
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences.filter(
          (d) =>
            d.handle !== '0' ||
            ![...header.keys()].some((n) => d.path === n || d.path.startsWith(`${n}.`)),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );
});
