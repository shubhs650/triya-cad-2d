// The dimension commands (M2-11) on every readable public corpus file, with the real dimension
// engine (`regenerateDimension`) and the renderer's text measuring over the bundled fonts, as
// the app runs them: DIMLINEAR (horizontal, then vertical), DIMALIGNED, DIMCONTINUE twice,
// DIMBASELINE, DIMRADIUS and DIMDIAMETER on a circle drawn for them, DIMANGULAR by three points,
// and a grip drag of the first dimension's text. The drawing is saved as AC1032 DXF (DEC-047),
// read back by acad-ts and mapped: each dimension comes back where it was made, with its `*D`
// block, and the health check (stored block against what the engine draws, M2-10) passes on it.
// With TRIYA_DXF_AUDIT_DIR set the save goes to the ezdxf audit as the file's `dimension` save.
//
// A drawing without a dimension style (R1 and R2.5 drawings, ezdxf's minimal ones) makes no
// dimension: the commands say so, and its unedited save is audited instead.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dimensionHealth, regenerateDimension } from '@triya/dims';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  currentLayer,
  type Color,
  type DimensionGeometry,
  type Entity,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { aciOfTrueColor, documentInit, readCadDocument } from '@triya/io';
import { textMeasure } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { bundledFontBook } from '../render/bundled-fonts.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));
const PER_FILE_BUDGET_MS = 30_000;
const CIRCLE = { center: { x: 500, y: 0 }, radius: 20 };

/** As the health gate: a DXF DIMSTYLE's ACI stands for its block's true colour. */
const colors = (g: Color, s: Color): boolean =>
  g.kind === 'aci' && s.kind === 'rgb' && aciOfTrueColor(s.r, s.g, s.b) === g.index;

/** Numbers to 9 significant figures, so geometry compares across the DXF's 16-digit text. */
function rounded(v: unknown): unknown {
  if (typeof v === 'number') return Number(v.toPrecision(9)) + 0;
  if (Array.isArray(v)) return v.map(rounded);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)]));
  }
  return v;
}

/** What the save keeps of a dimension: its geometry without the block handle. */
const kept = (e: Entity) => {
  const { block: _b, ...g } = e.geom as DimensionGeometry;
  return rounded(g);
};

const unedited = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

describe('dimension commands on the public corpus (M2-11)', () => {
  let saved = 0;
  const styleless: string[] = [];
  let made = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves the dimensions the commands make, which read back healthy',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = unedited(bytes);
      const space =
        model.layouts.find((l) => l.name === 'Model')?.blockRecord ??
        [...model.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE')?.handle;
      if (model.tables.dimStyles.size === 0 || space === undefined) {
        const bus = new PromptBus({ model, registry: builtinCommands(), view: { request: () => Promise.resolve({ ok: false, message: 'no view' }) } });
        await bus.submit('DIMLINEAR');
        expect(bus.history).toContain('The drawing has no dimension style.');
        writeAuditSave(f.path, 'dimension', () =>
          withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), unedited(bytes))),
        );
        styleless.push(f.path);
        return;
      }
      // The circle DIMRADIUS and DIMDIAMETER pick.
      const b = new ChangeSetBuilder(model);
      const circle = b.addEntity({
        owner: space,
        layer: currentLayer(model),
        geom: { kind: 'CIRCLE', ...CIRCLE },
      });
      model.apply(b.build());
      const before = new Set([...model.entities()].map((e) => e.id));
      const fonts = bundledFontBook();
      const measure = textMeasure({ fonts, style: (h) => model.tables.textStyles.get(h) });
      const canvas: ViewHost = {
        request: (r): Promise<ViewReply> => {
          if (r.op === 'textWidths') {
            return Promise.resolve({ ok: true, widths: r.texts.map((t) => measure(t) ?? null) });
          }
          if (r.op === 'pick') {
            const d = Math.hypot(r.point.x - CIRCLE.center.x, r.point.y - CIRCLE.center.y);
            const ids = Math.abs(d - CIRCLE.radius) < 1 ? [circle.id] : [];
            // A dimension's text, for its grips.
            for (const e of model.entities()) {
              if (before.has(e.id) || !('dimType' in e.geom)) continue;
              const t = e.geom.textPosition;
              if (Math.hypot(t.x - r.point.x, t.y - r.point.y) < 1e-6) ids.push(e.id);
            }
            return Promise.resolve({ ok: true, ids });
          }
          return Promise.resolve({ ok: false, message: 'no view' });
        },
      };
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: canvas,
        space: () => space,
        dimensions: regenerateDimension,
      });
      await bus.script(['DIMLINEAR', '0,0', '100,40', '50,80']);
      await bus.script(['DIMLINEAR', '0,0', '100,40', '150,20']);
      await bus.script(['DIMALIGNED', '0,0', '100,40', '-10,30']);
      await bus.script(['DIMCONTINUE', '160,40', '240,20', '', '']);
      await bus.script(['DIMBASELINE', '300,0', '', '']);
      await bus.script(['DIMRADIUS', '520,0', '540,30']);
      await bus.script(['DIMDIAMETER', '500,20', '500,-60']);
      await bus.script(['DIMANGULAR', '', '0,-200', '100,-200', '0,-100', '30,-170']);
      expect(bus.command).toBeUndefined();
      const added = () => [...model.entities()].filter((e) => !before.has(e.id) && e.owner === space);
      expect(added().map((e) => (e.geom as DimensionGeometry).dimType)).toEqual([
        'linear',
        'linear',
        'aligned',
        'linear',
        'linear',
        'linear',
        'radius',
        'diameter',
        'angular3pt',
      ]);
      // The first dimension's text dragged by its grip: it stays where it is put.
      const first = added()[0]!;
      const text = (first.geom as DimensionGeometry).textPosition;
      await bus.pick(text);
      await bus.pick(text, { grip: 1e-6 });
      expect(bus.command).toBe('GRIP');
      await bus.submit(`${text.x + 10},${text.y + 15}`);
      await bus.cancel();
      const moved = model.entity(first.id)!.geom as DimensionGeometry;
      expect(moved.textUserPositioned).toBe(true);

      const dims = added();
      for (const e of dims) {
        const g = e.geom as DimensionGeometry;
        expect(g.block, `${e.handle} drawn`).toBeDefined();
        expect(model.blockEntities(g.block!).length, `${e.handle} block`).toBeGreaterThan(0);
      }
      const out = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      writeAuditSave(f.path, 'dimension', () => out);
      const back = DocumentModel.create(documentInit(readCadDocument(out)));
      const again = textMeasure({ fonts, style: (h) => back.tables.textStyles.get(h) });
      for (const e of dims) {
        const r = back.entityByHandle(e.handle);
        expect(r, `${f.path} ${e.handle}`).toBeDefined();
        expect(kept(r!), `${f.path} ${e.handle}`).toEqual(kept(e));
        const health = dimensionHealth(r!, back, again, colors);
        expect(health?.problems ?? ['no health'], `${f.path} ${e.handle}`).toEqual([]);
      }
      saved++;
      made += dims.length;
    },
    PER_FILE_BUDGET_MS,
  );

  it('made dimensions on every readable file with a dimension style', () => {
    expect(saved + styleless.length).toBe(readable.length);
    expect(saved).toBeGreaterThan(readable.length / 2);
    expect(made).toBe(saved * 9);
  });
});
