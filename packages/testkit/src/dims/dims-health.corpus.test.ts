// The dimension engine's health check over the public corpus (M2-10, DEC-011, DEC-050): every
// linear, aligned, radius, diameter and angular dimension with a stored `*D` block is
// regenerated and compared with that block (`dimensionHealth`). The roadmap asks for ≥ 95 %
// within tolerance. Two legacy samples cannot state their dimensions as their blocks were drawn
// (below); their dimensions are counted apart (DEC-050) and may not get worse.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dimensionHealth, generates } from '@triya/dims';
import { DocumentModel, type Color } from '@triya/engine';
import { aciOfTrueColor, documentInit, readCadDocument } from '@triya/io';
import { textMeasure } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { bundledFontBook } from '../render/bundled-fonts.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

/**
 * DXF DIMSTYLE records keep a true DIMCLRx colour only as AutoCAD's ACI for it, while the
 * stored block keeps the true colour itself: that ACI stands for it.
 */
const colors = (g: Color, s: Color): boolean =>
  g.kind === 'aci' && s.kind === 'rgb' && aciOfTrueColor(s.r, s.g, s.b) === g.index;

/** Files whose data cannot reproduce their stored blocks, and why (DEC-050). */
const LEGACY: Readonly<Record<string, string>> = {
  // The sample's DIMENSIONs name no DIMSTYLE (no DXF 3), so they read as STANDARD; their blocks
  // were drawn in ISO-25 and the custom styles.
  'public/third-party/acadsharp/sample_AC1009_ascii.dxf': 'R12: dimensions name no style',
  'public/third-party/acadsharp/sample_AC1009_binary.dxf': 'R12: dimensions name no style',
  // R14 has no DIMDSEP (the blocks show ISO-25's comma), and acad-ts reads this DWG's DIMSTYLE
  // switches shifted (custom_dim_style: DIMTIH off and DIMSE1 on, where every R2000+ copy has
  // DIMTIH on and DIMSE1 off). DWG reading gets no new work before launch (DEC-047).
  'public/third-party/acadsharp/sample_AC1014.dwg': 'R14: no DIMDSEP; DIMSTYLE switches misread',
};
/** Mismatches in the legacy files: may only go down. */
const LEGACY_MISMATCHES = 25;

describe('dimension health over the public corpus (M2-10)', () => {
  it('regenerates ≥ 95 % of stored dimensions within tolerance', () => {
    const fonts = bundledFontBook();
    const results: { key: string; ok: boolean; problems: readonly string[] }[] = [];
    for (const f of readable) {
      let model: DocumentModel;
      try {
        model = DocumentModel.create(
          documentInit(readCadDocument(readFileSync(`${corpusDir}${f.path}`))),
        );
      } catch {
        continue; // read failures are the round-trip suite's concern
      }
      const measure = textMeasure({ fonts, style: (h) => model.tables.textStyles.get(h) });
      for (const e of model.entities()) {
        if (!generates(e.geom)) continue;
        const health = dimensionHealth(e, model, measure, colors);
        if (!health) continue;
        results.push({ key: `${f.path} ${e.handle}`, ok: health.ok, problems: health.problems });
      }
    }
    const failing = results.filter((r) => !r.ok);
    const report = failing.map((r) => `${r.key}: ${r.problems.slice(0, 4).join('; ')}`).join('\n');
    if (process.env.TRIYA_DIMS_REPORT) {
      console.log(`${results.length - failing.length}/${results.length} match\n${report}`);
    }
    const legacy = (r: { key: string }) => r.key.split(' ')[0]! in LEGACY;
    const counted = results.filter((r) => !legacy(r));
    const mismatched = counted.filter((r) => !r.ok);
    expect(results.length).toBe(210);
    expect(counted.length).toBe(183);
    expect((counted.length - mismatched.length) / counted.length, report).toBeGreaterThanOrEqual(
      0.95,
    );
    // Today every counted dimension matches: keep it that way.
    expect(mismatched.map((r) => `${r.key}: ${r.problems.join('; ')}`)).toEqual([]);
    expect(failing.filter(legacy).length).toBeLessThanOrEqual(LEGACY_MISMATCHES);
  }, 300_000);
});
