// M1-18 on the public corpus: every layout's sheet, and every viewport's view of model space.
//
// AutoCAD sets a layout's limits (LIMMIN/LIMMAX) to its paper when it sets the layout up, so
// on those layouts the sheet `layoutSheet` computes from the page setup alone must be the
// stored limits: that checks the margin turn for rotated plots and the inch/mm conversion on
// real files. Layouts written by other programs (ezdxf, BricsCAD) or never set up keep
// whatever limits they had, and are listed below with the reason.
//
// Then every layout is drawn on a recording canvas fitted to its viewports: each viewport that
// shows model space, and has model-space entities under its view, must draw them inside its
// clip (one save/clip/restore group with at least one path), and the frame must not throw.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  layoutSheet,
  viewportFrame,
  viewportShowsModel,
  viewportTransform,
  invert,
  applyPoint,
  type Box,
  type DocumentModel,
  type Handle,
  type SpatialIndex,
} from '@triya/engine';
import { readCadDocument } from '@triya/io';
import {
  Canvas2DRenderer,
  defaultPaint,
  expands,
  fitView,
  tessellate,
  type Canvas2D,
  type Surface,
} from '@triya/render';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { corpusDrawing } from './document.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

const EZDXF =
  'page setup written by ezdxf (plot flags 0) with its template limits, which follow neither ' +
  'the paper units nor the rotation';
const STALE =
  'limits left from an earlier sheet: viewports.dxf has a Letter sheet’s limits on ANSI D, ' +
  'xclip.dxf Layout1 the A3 defaults on A4 (its Layout2 matches)';

/** Sheets that differ from the stored limits, by `file | layout`, and why. */
const LIMITS_DIFFER: Record<string, string> = {
  // M1-75: traces.dxf draws in model space only and leaves ezdxf's Layout1 as made.
  'public/self-authored/traces.dxf | Layout1': EZDXF,
  // M1-111: so does multileaders.dxf.
  'public/self-authored/multileaders.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/caret_encoding.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/circle_radius_le_0.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/clockwise_arcs_hatch.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/mtext_columns_R2000.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/mtext_columns_R2007.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/mtext_columns_R2018.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/multi_insert_with_attribs.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/text_alignments.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/text_fonts.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/text_mirror_shx_font.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/text_mirror_true_type_font.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/text_oblique_rotate.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/text_stacked_shx_font.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/text_stacked_true_type_font.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/transform_hatch_pattern.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/valid_lineweights.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/viewports.dxf | Layout1': STALE,
  'public/third-party/ezdxf/examples_dxf/wipeout_random.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/examples_dxf/xclip.dxf | Layout1': STALE,
  'public/third-party/ezdxf/integration_tests/MODEL.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/integration_tests/bin_dxf_r2000.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/integration_tests/dxf_unicode.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/integration_tests/layout_missing_block_definition.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/integration_tests/layout_missing_block_definition.dxf | Layout2': EZDXF,
  'public/third-party/ezdxf/integration_tests/layout_missing_block_record.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/integration_tests/mtext_framed_columns.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/integration_tests/mtext_text_frame.dxf | Layout1': EZDXF,
  'public/third-party/ezdxf/integration_tests/r2000_blocks_with_no_name_and_no_block_record.dxf | Layout1':
    EZDXF,
  'public/third-party/ezdxf/integration_tests/r2000_blocks_with_no_names.dxf | Layout1': EZDXF,
};

const files = manifest.files;

let checked = 0;
let viewportsDrawn = 0;

/**
 * A canvas that only counts what the renderer does inside clips, one group per outermost clip
 * (a viewport's); clips inside it (an XCLIPped reference's, M1-103) count towards it. Paths
 * count once stroked or filled, so the outline a viewport is clipped by (M1-62) does not.
 */
function recorder(): Surface & { groups: number[] } {
  let depth = 0;
  let pending = 0;
  const groups: number[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === 'save')
          return () => {
            if (depth === 0) groups.push(0);
            depth++;
          };
        if (name === 'restore') return () => void depth--;
        if (name === 'moveTo' || name === 'arc' || name === 'ellipse') return () => void pending++;
        if (name === 'clip' || name === 'beginPath') return () => void (pending = 0);
        if (name === 'stroke' || name === 'fill' || name === 'fillRect')
          return () => {
            if (depth > 0) groups[groups.length - 1]! += Math.max(pending, 1);
            pending = 0;
          };
        if (name === 'createLinearGradient' || name === 'createRadialGradient')
          return () => ({ addColorStop: () => undefined });
        return () => undefined;
      },
      set: () => true,
    },
  ) as Canvas2D;
  return { canvas: { width: 0, height: 0 }, ctx, image: {} as CanvasImageSource, groups };
}

/** Draws a layout fitted to its viewports; how many viewports drew, and how many should. */
function drawLayout(
  model: DocumentModel,
  index: SpatialIndex,
  block: Handle,
): { expected: number; drawn: number } {
  const ms = [...model.tables.blockRecords.values()].find(
    (r) => r.name.toLowerCase() === '*model_space',
  )!.handle;
  let expected = 0;
  let fit: Box | undefined;
  for (const id of model.blockEntities(block)) {
    const e = model.entity(id)!;
    if (e.geom.kind !== 'VIEWPORT' || !viewportShowsModel(e.geom)) continue;
    const frame = viewportFrame(e.geom);
    fit = fit
      ? {
          minX: Math.min(fit.minX, frame.minX),
          minY: Math.min(fit.minY, frame.minY),
          maxX: Math.max(fit.maxX, frame.maxX),
          maxY: Math.max(fit.maxY, frame.maxY),
        }
      : frame;
    const toModel = invert(viewportTransform(e.geom));
    const a = applyPoint(toModel, { x: frame.minX, y: frame.minY });
    const b = applyPoint(toModel, { x: frame.maxX, y: frame.maxY });
    const view = {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
    };
    // Something drawable under the view: a shown entity with known bounds that draws without
    // fonts (text has none here), or a block reference.
    const shows = index.query(ms, view).some((h) => {
      const en = model.entity(h);
      const bd = index.bounds(h);
      if (!en || !bd || bd.kind !== 'box') return false;
      const paint = defaultPaint(en, model);
      const draws =
        expands(en, (b) => model.blocks.get(b)) ||
        (paint !== undefined && tessellate(en.geom, paint).length > 0);
      const inView =
        bd.box.maxX >= view.minX &&
        bd.box.minX <= view.maxX &&
        bd.box.maxY >= view.minY &&
        bd.box.minY <= view.maxY;
      return inView && draws;
    });
    if (shows) expected++;
  }
  const visible = recorder();
  const layers: ReturnType<typeof recorder>[] = [];
  const r = new Canvas2DRenderer({
    model,
    index,
    block,
    surface: visible,
    createLayer: () => {
      const l = recorder();
      layers.push(l);
      return l;
    },
    requestIdle: () => undefined,
  });
  r.resize(1000, 700, 1);
  if (fit) r.setView(fitView(fit, 1000, 700));
  r.frame();
  return { expected, drawn: layers[0]!.groups.filter((n) => n > 0).length };
}
// 70 → 71 with self-authored/viewport-overrides.dxf (M1-62), whose ezdxf page setup sets limits.
// 71 → 72 with self-authored/transparency.dxf (M1-108), the same.
const MATCHING = 72;
// 74 → 82 with images and wipeouts (M1-19): viewports that show only those now draw.
// 82 → 84 with R12 paper space (M1-89): the R12 sample's viewport, ASCII and binary, draws in
// the Layout1 its paper space now reads with.
// 84 → 88 with the four viewports of self-authored/viewport-overrides.dxf (M1-62).
// 88 → 90 with the two viewports of self-authored/transparency.dxf (M1-108).
const VIEWPORTS_DRAWN = 90;

describe('layouts on the public corpus', () => {
  it.each(files.map((f) => [f.path]))('%s', (path) => {
    let doc;
    try {
      doc = readCadDocument(new Uint8Array(readFileSync(corpusDir + path)));
    } catch {
      return; // unreadable files are the read-error baseline's business
    }
    const { model, index } = corpusDrawing(doc);
    const differ: string[] = [];
    const listed: string[] = [];
    for (const layout of model.layouts) {
      const sheet = layoutSheet(layout);
      const key = `${path} | ${layout.name}`;
      const space = model.tables.blockRecords.get(layout.blockRecord)?.name.toLowerCase();
      if (space === '*model_space' || !sheet || !layout.limits) continue;
      const tol = 1e-4 * Math.max(1, sheet.paper.maxX - sheet.paper.minX);
      const same =
        Math.abs(sheet.paper.minX - layout.limits.min.x) < tol &&
        Math.abs(sheet.paper.minY - layout.limits.min.y) < tol &&
        Math.abs(sheet.paper.maxX - layout.limits.max.x) < tol &&
        Math.abs(sheet.paper.maxY - layout.limits.max.y) < tol;
      if (!same) differ.push(key);
      if (key in LIMITS_DIFFER) listed.push(key);
      checked++;
    }
    expect(differ).toEqual(listed);

    for (const layout of model.layouts) {
      const space = model.tables.blockRecords.get(layout.blockRecord)?.name.toLowerCase();
      if (space === '*model_space') continue;
      const { expected, drawn } = drawLayout(model, index, layout.blockRecord);
      expect({ key: `${path} | ${layout.name}`, drawn }).toEqual({
        key: `${path} | ${layout.name}`,
        drawn: expected,
      });
      viewportsDrawn += drawn;
    }
  });

  it('checks the AutoCAD-set layouts and lists every exception it still needs', () => {
    // Layouts whose sheet is their limits, from DWG, ASCII and binary DXF.
    expect(checked - Object.keys(LIMITS_DIFFER).length).toBe(MATCHING);
    // Viewports drawn with their views, across the corpus.
    expect(viewportsDrawn).toBe(VIEWPORTS_DRAWN);
  });
});
