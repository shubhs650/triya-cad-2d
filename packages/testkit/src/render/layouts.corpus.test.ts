// M1-18 on the public corpus: every layout's sheet, and every viewport's view of model space.
//
// AutoCAD sets a layout's limits (LIMMIN/LIMMAX) to its paper when it sets the layout up, so
// on those layouts the sheet `layoutSheet` computes from the page setup alone must be the
// stored limits: that checks the margin turn for rotated plots and the inch/mm conversion on
// real files. Layouts written by other programs (ezdxf, BricsCAD) or never set up keep
// whatever limits they had, and are listed below with the reason.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutSheet } from '@triya/engine';
import { readCadDocument } from '@triya/io';
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
const MATCHING = 70;

describe('layouts on the public corpus', () => {
  it.each(files.map((f) => [f.path]))('%s', (path) => {
    let doc;
    try {
      doc = readCadDocument(new Uint8Array(readFileSync(corpusDir + path)));
    } catch {
      return; // unreadable files are the read-error baseline's business
    }
    const { model } = corpusDrawing(doc);
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
  });

  it('checks the AutoCAD-set layouts and lists every exception it still needs', () => {
    // Layouts whose sheet is their limits, from DWG, ASCII and binary DXF.
    expect(checked - Object.keys(LIMITS_DIFFER).length).toBe(MATCHING);
  });
});
