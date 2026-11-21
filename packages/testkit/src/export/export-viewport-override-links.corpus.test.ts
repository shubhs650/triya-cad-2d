// Viewport layer overrides follow their viewports when saved (M6-02 part 18), on the two test
// drawings with overrides of their own: the self-authored viewport-overrides.dxf (WALLS and
// PIPING overridden in one of its four viewports) and the named-plot-styles fixture (PIPING's
// plot style overridden in Layout1's right viewport). Each is changed as a drafter would, saved
// as AC1032 DXF (DEC-047) and read again; the layers' overrides read back as the engine has them,
// none naming a viewport the save left out:
//
//   - every layout copied (LAYOUT Copy), and the source's overridden viewports then erased
//     (ERASE), so the overrides name only the copies;
//   - every layout deleted (LAYOUT Delete; the last one emptied), so no override is left;
//   - every layout inserted into ezdxf's colors.dxf (LAYOUT Template), whose layers the
//     overrides land on by name, and written as a drawing of its own (LAYOUT SAveas).
//
// viewport-overrides.dxf's copy-and-erase save is kept for the ezdxf audit (audit.py
// `FIXTURE_SAVES`, `vp-override-links`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  copyLayout,
  copyLayoutName,
  deleteLayout,
  eraseObjects,
  insertLayoutTemplate,
  layoutTemplates,
  paperLayouts,
  templateLayoutName,
  type Clipboard,
  type LayoutTemplateCopy,
} from '@triya/engine';
import { documentInit, readCadDocument, writeBlockDrawing } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpus = (p: string) => fileURLToPath(new URL(`../../../../corpus/${p}`, import.meta.url));
const fixture = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const FILES = [
  {
    path: 'self-authored/viewport-overrides.dxf',
    file: corpus('public/self-authored/viewport-overrides.dxf'),
  },
  {
    path: 'fixtures/plot-styles/named-plot-styles.dxf',
    file: fixture('fixtures/plot-styles/named-plot-styles.dxf'),
  },
];
const TARGET = corpus('public/third-party/ezdxf/examples_dxf/colors.dxf');

const NOTHING: Clipboard = {
  base: { x: 0, y: 0 },
  entities: [],
  blockEntities: [],
  tables: {},
  blocks: [],
};

const read = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

/** Each layer's overrides, by layer name. */
const overrides = (model: DocumentModel) =>
  Object.fromEntries(
    [...model.tables.layers.values()]
      .filter((l) => l.viewportOverrides !== undefined)
      .map((l) => [l.name, JSON.parse(JSON.stringify(l.viewportOverrides)) as unknown])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
/** Every viewport any override names. */
const named = (model: DocumentModel) =>
  [...model.tables.layers.values()].flatMap((l) =>
    (l.viewportOverrides ?? []).map((o) => o.viewport),
  );

/** The Clipboard's overrides that override more than a plot style. */
const beyondPlotStyle = (list: Clipboard['viewportOverrides']) =>
  (list ?? []).filter(
    ({ override: { viewport: _v, plotStyle: _p, ...rest } }) => Object.keys(rest).length > 0,
  );

const edit = (model: DocumentModel, f: (b: ChangeSetBuilder) => void) => {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
};

describe('viewport layer overrides saved with their viewports', () => {
  for (const { path, file } of FILES) {
    const bytes = new Uint8Array(readFileSync(file));

    it(`${path}: LAYOUT Copy, then ERASE of the originals`, () => {
      withPinnedClock(() => {
        const model = read(bytes);
        const before = named(model);
        expect(before.length, path).toBeGreaterThan(0);
        for (const source of paperLayouts(model))
          edit(model, (b) => copyLayout(b, model, source, copyLayoutName(model, source)));
        // Each overridden viewport's copy is overridden alike.
        expect(named(model).length, path).toBe(before.length * 2);
        edit(model, (b) => {
          const r = eraseObjects(
            b,
            model,
            [...new Set(before)].map((h) => model.ids.idOf(h)!),
          );
          expect(r.refused.size, path).toBe(0);
        });
        expect(
          named(model).some((h) => before.includes(h)),
          path,
        ).toBe(false);
        expect(named(model).length, path).toBe(before.length);
        const save = () => saveAc1032Dxf(readCadDocument(bytes), model);
        if (path.startsWith('self-authored/')) writeAuditSave(path, 'vp-override-links', save);
        const back = read(save());
        expect(overrides(back), path).toEqual(overrides(model));
        for (const h of named(back))
          expect(back.entityByHandle(h)?.geom.kind, path).toBe('VIEWPORT');
      });
    });

    it(`${path}: LAYOUT Delete of every layout`, () => {
      withPinnedClock(() => {
        const model = read(bytes);
        for (const l of paperLayouts(model)) {
          const now = model.layouts.find((x) => x.handle === l.handle)!;
          edit(model, (b) => deleteLayout(b, model, now));
        }
        expect(named(model), path).toEqual([]);
        const back = read(saveAc1032Dxf(readCadDocument(bytes), model));
        expect(overrides(back), path).toEqual({});
      });
    });

    it(`${path}: LAYOUT Template into another drawing, and SAveas`, () => {
      withPinnedClock(() => {
        const source = read(bytes);
        const copies = structuredClone(layoutTemplates(source)) as LayoutTemplateCopy[];
        const targetBytes = new Uint8Array(readFileSync(TARGET));
        const target = read(targetBytes);
        const taken = new Set<string>();
        for (const c of copies) {
          const name = templateLayoutName(target, c.template.name, taken);
          taken.add(name.toUpperCase());
          edit(target, (b) => insertLayoutTemplate(b, target, c.template, name));
        }
        // Every override came along, onto the target's layers of the same names; colors.dxf
        // plots by colour, so a plot style override alone stays behind.
        expect(named(target).length, path).toBe(
          copies.flatMap((c) => beyondPlotStyle(c.template.content.viewportOverrides)).length,
        );
        for (const h of named(target))
          expect(target.entityByHandle(h)?.geom.kind, path).toBe('VIEWPORT');
        const back = read(saveAc1032Dxf(readCadDocument(targetBytes), target));
        expect(overrides(back), path).toEqual(overrides(target));

        // SAveas: each layout a drawing of its own, its viewports' overrides in it.
        for (const c of copies) {
          const header = {
            $INSUNITS: source.meta.insUnits ?? 0,
            $MEASUREMENT: source.header.get('$MEASUREMENT') ?? 0,
          };
          const out = read(writeBlockDrawing(NOTHING, header, c.template));
          // The blank drawing plots by colour too.
          const own = beyondPlotStyle(c.template.content.viewportOverrides);
          expect(named(out).length, `${path}: ${c.template.name}`).toBe(own.length);
        }
      });
    });
  }
});
