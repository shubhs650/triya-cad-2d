// The dimension engine's health check over the public corpus (M2-10, DEC-011): every linear,
// aligned, radius, diameter and angular dimension with a stored `*D` block is regenerated and
// compared with that block (`dimensionHealth`). The roadmap asks for ≥ 95 % within tolerance;
// the ones that do not match are listed here with the reason, so a new mismatch fails.
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

/** Dimensions whose stored block the engine does not reproduce yet, `file handle` → why. */
const KNOWN: Readonly<Record<string, string>> = {};

describe('dimension health over the public corpus (M2-10)', () => {
  it('regenerates ≥ 95 % of stored dimensions within tolerance', () => {
    const fonts = bundledFontBook();
    const results: { key: string; ok: boolean; problems: readonly string[] }[] = [];
    for (const f of readable) {
      let model: DocumentModel;
      try {
        model = DocumentModel.create(documentInit(readCadDocument(readFileSync(`${corpusDir}${f.path}`))));
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
      // eslint-disable-next-line no-console
      console.log(`${results.length - failing.length}/${results.length} match\n${report}`);
    }
    const unexpected = failing.filter((r) => !(r.key in KNOWN)).map((r) => `${r.key}: ${r.problems.join('; ')}`);
    expect(unexpected, report).toEqual([]);
    const fixed = Object.keys(KNOWN).filter((k) => results.some((r) => r.key === k && r.ok));
    expect(fixed, 'now matching: remove from KNOWN').toEqual([]);
    expect(results.length).toBeGreaterThan(200);
    expect((results.length - failing.length) / results.length).toBeGreaterThanOrEqual(0.95);
  }, 300_000);
});
