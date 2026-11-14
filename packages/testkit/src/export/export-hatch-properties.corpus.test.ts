// A hatch's gradient, Origin and Associative rows in the Properties palette (M2-35 part 13), set
// on every readable public corpus file as the palette sets them (`applyPropertyEdit`, one change
// set per row), saved as AC1032 DXF (DEC-047) and read back. Up to eight hatches per drawing,
// on unlocked layers: a gradient gets another name, colours, angle and centring (a one-colour
// gradient its tint), a pattern hatch a new origin (its lines moved with it), and an associative
// hatch lets go of its boundary, whose objects no longer list it in their reactors. With
// TRIYA_DXF_AUDIT_DIR set every drawing's save goes to the ezdxf audit as its `hatch` save.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  applyPropertyEdit,
  type Entity,
  type HatchGeometry,
  type PropertyEdit,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

const PER_FILE = 8;
const PER_FILE_BUDGET_MS = 30_000;
const GRADIENT = {
  name: 'INVHEMISPHERICAL',
  color1: { kind: 'rgb', r: 12, g: 34, b: 56 },
  color2: { kind: 'aci', index: 3 },
  angle: Math.PI / 6,
  tint: 0.75,
} as const;

const hatchOf = (e: Entity | undefined): HatchGeometry | undefined =>
  e?.geom.kind === 'HATCH' ? e.geom : undefined;

describe('a hatch’s gradient, origin and associative rows save and read back', () => {
  let gradients = 0;
  let origins = 0;
  let dissociated = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      await withPinnedClock(async () => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const hatches = [...model.entities()]
          .filter((e) => hatchOf(e) && model.tables.layers.get(e.layer)?.locked !== true)
          .slice(0, PER_FILE);
        const handle = (e: Entity) => model.ids.handleOf(e.id)!;
        const set = (objects: readonly Entity[], edit: PropertyEdit) => {
          if (objects.length === 0) return;
          const b = new ChangeSetBuilder(model);
          const now = objects.map((e) => model.entity(e.id)!);
          const report = applyPropertyEdit(b, model, now, edit);
          expect(report.invalid, `${f.path} ${edit.key}`).toBeUndefined();
          expect(report.refused.size, `${f.path} ${edit.key}`).toBe(0);
          model.apply(b.build());
        };
        const gradient = hatches.filter((e) => hatchOf(e)!.gradient);
        const two = gradient.filter((e) => !hatchOf(e)!.gradient!.singleColor);
        const one = gradient.filter((e) => hatchOf(e)!.gradient!.singleColor);
        const patterned = hatches.filter((e) => !hatchOf(e)!.solid && !hatchOf(e)!.gradient);
        const associative = hatches.filter((e) => hatchOf(e)!.associative);
        const sources = new Map(
          associative.map((e) => [handle(e), hatchOf(e)!.loops.flatMap((l) => l.sources ?? [])]),
        );
        const bases = new Map(
          patterned.map((e) => [handle(e), hatchOf(e)!.patternLines.map((l) => l.base)]),
        );
        const origin = (e: Entity) => hatchOf(e)!.patternLines[0]?.base ?? { x: 0, y: 0 };
        // Each pattern's origin moves by (1, -2) from where it is.
        const moved = new Map(patterned.map((e) => [handle(e), origin(e)]));

        set(gradient, { key: 'gradientName', value: GRADIENT.name });
        set(gradient, { key: 'gradientColor1', value: 'rgb:12,34,56' });
        set(two, { key: 'gradientColor2', value: 'aci:3' });
        set(one, { key: 'gradientTint', value: String(GRADIENT.tint) });
        set(gradient, { key: 'gradientAngle', value: '30' });
        set(gradient, { key: 'gradientCentered', value: 'no' });
        for (const e of patterned) {
          const o = moved.get(handle(e))!;
          set([e], { key: 'patternOriginX', value: String(o.x + 1) });
          set([e], { key: 'patternOriginY', value: String(o.y - 2) });
        }
        set(associative, { key: 'associative', value: 'no' });

        const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
        writeAuditSave(f.path, 'hatch', save);
        const back = DocumentModel.create(documentInit(readCadDocument(save())));
        const wrong: string[] = [];
        const near = (a: number, b: number) =>
          Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
        for (const e of gradient) {
          const h = handle(e);
          const g = hatchOf(back.entityByHandle(h))?.gradient;
          const ok =
            g &&
            g.name === GRADIENT.name &&
            JSON.stringify(g.colors[0]?.color) === JSON.stringify(GRADIENT.color1) &&
            (g.singleColor
              ? near(g.tint, GRADIENT.tint)
              : JSON.stringify(g.colors[1]?.color) === JSON.stringify(GRADIENT.color2)) &&
            near(g.angle, GRADIENT.angle) &&
            g.shift === 1;
          if (!ok) wrong.push(`${h}: gradient ${JSON.stringify(g)}`);
        }
        for (const e of patterned) {
          const h = handle(e);
          const g = hatchOf(back.entityByHandle(h));
          const was = bases.get(h)!;
          const ok =
            g &&
            g.patternLines.length === was.length &&
            g.patternLines.every(
              (l, i) => near(l.base.x, was[i]!.x + 1) && near(l.base.y, was[i]!.y - 2),
            );
          if (!ok) wrong.push(`${h}: pattern lines ${JSON.stringify(g?.patternLines)}`);
        }
        for (const e of associative) {
          const h = handle(e);
          const g = hatchOf(back.entityByHandle(h));
          if (!g || g.associative || g.loops.some((l) => (l.sources ?? []).length > 0)) {
            wrong.push(`${h}: still associative`);
          }
          for (const s of sources.get(h)!) {
            if (back.entityByHandle(s)?.reactors?.includes(h)) {
              wrong.push(`${h}: boundary object ${s} still lists it`);
            }
          }
        }
        expect(wrong, f.path).toEqual([]);
        gradients += gradient.length;
        origins += patterned.length;
        dissociated += associative.length;
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('covered gradients, pattern origins and associative hatches', () => {
    // Numbers at the time of writing (32, 132, 157): a floor, so a corpus file added later
    // only raises them.
    expect(gradients).toBeGreaterThanOrEqual(30);
    expect(origins).toBeGreaterThanOrEqual(120);
    expect(dissociated).toBeGreaterThanOrEqual(150);
  });
});
