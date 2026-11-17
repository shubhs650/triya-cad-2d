// The Properties palette's Background color row for pattern hatches (M4-18), set on every
// readable public corpus file as the palette sets it (`applyPropertyEdit`, one change set per
// edit): up to eight of the drawing's own pattern hatches on unlocked layers take a pale blue
// true colour, then the first of them an index colour and the second None again. The drawing is
// saved as AC1032 DXF (DEC-047) and read back by acad-ts: each hatch's background (its
// HATCHBACKGROUNDCOLOR xdata) is as set, and a drawing without the APPID gains it. The ezdxf
// audit already loads this xdata in the `hatch` save (hatch-command.corpus.test.ts), so this
// suite writes no save of its own to the gate.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  HATCH_BACKGROUND_APP,
  applyPropertyEdit,
  isPatterned,
  type Entity,
  type HatchGeometry,
  type PropertyEdit,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** Hatches edited per drawing, to keep the suite quick. */
const PER_FILE = 8;
const PER_FILE_BUDGET_MS = 30_000;
const PALE_BLUE = { kind: 'rgb', r: 200, g: 220, b: 240 } as const;
const RED = { kind: 'aci', index: 1 } as const;

type Hatch = Entity & { geom: HatchGeometry };

describe('a pattern hatch’s Background color set in the Properties palette saves and reads back', () => {
  let edited = 0;
  let drawings = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      await withPinnedClock(async () => {
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const hatches = [...model.entities()]
          .filter(
            (e): e is Hatch =>
              e.geom.kind === 'HATCH' &&
              isPatterned(e.geom) &&
              model.tables.layers.get(e.layer)?.locked !== true,
          )
          .slice(0, PER_FILE);
        const want = new Map<string, HatchGeometry['background']>();
        if (hatches.length > 0) {
          const set = (objects: readonly Hatch[], edit: PropertyEdit) => {
            const b = new ChangeSetBuilder(model);
            const now = objects.map((e) => model.entity(e.id)!);
            const report = applyPropertyEdit(b, model, now, edit);
            expect(report.invalid, `${f.path} ${edit.value}`).toBeUndefined();
            model.apply(b.build());
          };
          set(hatches, { key: 'hatchBackground', value: 'rgb:200,220,240' });
          for (const h of hatches) want.set(h.handle, PALE_BLUE);
          set(hatches.slice(0, 1), { key: 'hatchBackground', value: 'aci:1' });
          want.set(hatches[0]!.handle, RED);
          if (hatches[1]) {
            set(hatches.slice(1, 2), { key: 'hatchBackground', value: 'none' });
            want.set(hatches[1].handle, undefined);
          }
          edited += hatches.length;
          drawings++;
        }

        const save = saveAc1032Dxf(readCadDocument(bytes), model);
        const back = DocumentModel.create(documentInit(readCadDocument(save)));
        if (want.size > 0) {
          expect(
            [...back.tables.appIds.values()].some(
              (a) => a.name.toUpperCase() === HATCH_BACKGROUND_APP,
            ),
            f.path,
          ).toBe(true);
        }
        const wrong: string[] = [];
        for (const [handle, w] of want) {
          const e = back.entityByHandle(handle);
          const got = e?.geom.kind === 'HATCH' ? e.geom.background : 'gone';
          if (JSON.stringify(got) !== JSON.stringify(w)) {
            wrong.push(`${handle}: ${JSON.stringify(got)} for ${JSON.stringify(w)}`);
          }
        }
        expect(wrong, f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('covered pattern hatches', () => {
    // A floor at the time of writing (M4-18), so a corpus file added later only raises it.
    expect(drawings).toBeGreaterThan(0);
    expect(edited).toBeGreaterThan(0);
  });
});
