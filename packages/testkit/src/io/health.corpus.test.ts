// M1-25 on the public corpus: every readable file gets a health report against the bundled
// fonts and patterns alone (what a fresh install has), naming its release and units, every
// text style font with what draws it instead, the references it stores and what Triya keeps
// without understanding. A few files are checked line by line.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  healthReport,
  mapEntities,
  openDocument,
  readCadDocument,
  summarizeDocument,
  detectFormat,
  type HealthReport,
} from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { bundledFontBook, bundledFontFiles } from '../render/bundled-fonts.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const ioDir = new URL('../../../io/', import.meta.url);
const manifest = loadManifest(`${corpusDir}corpus.json`);
const files = manifest.files.filter((f) => f.path.startsWith('public/'));
const bundled = new Set(bundledFontFiles().keys());

const reports = new Map<string, HealthReport>();

describe('health report on the public corpus', () => {
  it.each(files.map((f) => [f.path]))('%s', (path) => {
    const bytes = new Uint8Array(readFileSync(corpusDir + path));
    let doc;
    try {
      doc = readCadDocument(bytes);
    } catch {
      return; // unreadable files are the read-error baseline's business
    }
    const opened = openDocument(doc);
    // The facts cross from the I/O worker as a structured clone.
    const facts = structuredClone(opened.facts);
    expect(facts).toEqual(opened.facts);
    const r = healthReport(facts, { fonts: bundledFontBook() });
    reports.set(path, r);

    expect(r.version.code).toBe(summarizeDocument(doc, detectFormat(bytes)).version);
    expect(r.version.release, r.version.code).toBeDefined();
    expect(r.units.name).not.toMatch(/^Unknown/);
    // Only bundled fonts are loaded, so every style font is missing; text fonts draw with a
    // bundled stand-in, shape files and big fonts with nothing.
    const missing = new Map(r.fonts.missing.map((m) => [m.font, m]));
    for (const s of facts.textStyles) {
      if (bundled.has(s.font.toLowerCase().replace(/\.shx$/, ''))) continue;
      const m = missing.get(s.font);
      expect(m, `${s.name}: ${s.font}`).toBeDefined();
      expect(m!.styles).toContain(s.name);
      if (s.shapeFile) expect(m!.substitute).toBeUndefined();
      else expect(bundled.has(m!.substitute!), `${s.font} → ${m!.substitute}`).toBe(true);
    }
    expect(r.unmappedEntities.total).toBe(mapEntities(doc).unmapped.length);
  });

  it('reports the files the checks below rely on', () => {
    const r = (name: string) => {
      const found = [...reports].find(([p]) => p.endsWith(name));
      expect(found, name).toBeDefined();
      return found![1];
    };

    // An AutoCAD Architecture drawing: AEC objects kept, its walls, doors and windows not drawn.
    const aec = r('aec_objects/AecObjects.dwg');
    expect(aec.version).toEqual({ code: 'AC1032', release: 'AutoCAD 2018' });
    expect(aec.units.name).toBe('Millimeters');
    expect(aec.unmappedEntities.byType).toEqual([
      { type: 'AEC_DOOR', reason: 'not mapped yet', count: 1 },
      { type: 'AEC_WALL', reason: 'not mapped yet', count: 1 },
      { type: 'AEC_WINDOW', reason: 'not mapped yet', count: 2 },
    ]);
    expect(aec.unknownObjects.byType.some((o) => o.type.startsWith('AEC_'))).toBe(true);
    expect(aec.fonts.missing).toContainEqual({
      font: 'romans.shx',
      substitute: 'oet-simplex',
      styles: ['Annotative', 'Arch-Dim', 'RomanS'],
    });

    // An R14 sample with an image and a PDF underlay, and TrueType styles.
    const r14 = r('acadsharp/sample_AC1014.dwg');
    expect(r14.version).toEqual({ code: 'AC1014', release: 'AutoCAD R14' });
    expect(r14.references).toEqual([
      { kind: 'image', name: 'IMAGE', path: '.\\image.JPG', status: 'unchecked' },
      {
        kind: 'pdf',
        name: 'PDF-DEFINITION_-_1',
        path: '..\\pdf-definition.pdf',
        status: 'unchecked',
      },
    ]);
    expect(r14.fonts.missing.find((m) => m.font === 'consola.ttf')).toEqual({
      font: 'consola.ttf',
      substitute: 'oet-simplex',
      styles: ['CUSTOM_TEXT_STYLE'],
    });

    // The R12 DXF: unitless, and its shape files (one by full path) drawn by nothing.
    const r12 = r('acadsharp/sample_AC1009_ascii.dxf');
    expect(r12.version).toEqual({ code: 'AC1009', release: 'AutoCAD R11/R12' });
    expect(r12.units).toEqual({
      insUnits: 0,
      name: 'Unspecified (no units)',
      measurement: 'metric',
    });
    const shapes = r12.fonts.missing.filter((m) => m.font.toLowerCase().endsWith('shape.shx'));
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.substitute).toBeUndefined();
    expect(r12.fonts.missing).toContainEqual({
      font: 'ltypeshp.shx',
      substitute: undefined,
      styles: [''], // a shape file's style has an empty name
    });
  });

  it('covers what the corpus holds', () => {
    const all = [...reports.values()];
    const sum = (f: (r: HealthReport) => number) => all.reduce((n, r) => n + f(r), 0);
    // What the public corpus holds today. No corpus hatch is stored without its lines, so the
    // missing-patterns list is covered by the unit tests alone.
    expect({
      files: all.length,
      withReferences: all.filter((r) => r.references.length > 0).length,
      missingFonts: sum((r) => r.fonts.missing.length),
      missingPatterns: sum((r) => r.patterns.missing.length),
    }).toEqual({ files: 119, withReferences: 22, missingFonts: 234, missingPatterns: 0 });
    // Unknown-object and unmapped-entity totals are left out: they move whenever acad-ts reads
    // more of a file (M1-32, M1-33) or Triya maps more types, which is not this report's doing.
  });
});

describe('@triya/io/health', () => {
  it('loads no acad-ts, so the main thread can import it', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', ioDir), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports['./health']).toBe('./src/health/report.ts');
    const source = readFileSync(new URL('src/health/report.ts', ioDir), 'utf8');
    const values = [...source.matchAll(/^import (?!type )[^;]*? from '([^']+)';/gms)].map(
      (m) => m[1],
    );
    expect(values).toEqual(['@triya/hatch', '@triya/text']);
  });
});
