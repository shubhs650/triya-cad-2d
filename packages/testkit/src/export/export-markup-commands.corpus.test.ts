// REVCLOUD, WIPEOUT, DRAWORDER, TEXTTOFRONT and HATCHTOBACK (M2-08) on every readable public
// corpus file: a markup session saves as AC1032 DXF (DEC-047) and reopens with AutoCAD's
// structure. The commands run on the PromptBus as the command line drives them: a rectangular
// and a calligraphy polygonal cloud and a wipeout in model space, WIPEOUTFRAME turned off, text
// brought to the front and hatches sent to the back; then every other object of each layout is
// brought to the front, as DRAWORDER does, over whatever SORTENTSTABLE the drawing has.
//
// Reopened, each cloud is a closed LWPOLYLINE whose every bulge is AutoCAD's revision cloud bulge
// with `RevcloudProps` xdata (what ezdxf's `revcloud.is_revcloud` asks), the wipeout keeps its
// frame and boundary, WIPEOUTFRAME is off, and every layout draws in the order the session left.
// With TRIYA_DXF_AUDIT_DIR set the save also goes to the ezdxf audit as the file's `markup` save.
//
// A drawing older than R14 (AC1014), which had no wipeouts or draw order (and before R11 no
// xdata), saves them too: the save checks what it adds against AC1032, the version it writes
// (M2-13).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  REVCLOUD_APP,
  REVCLOUD_BULGE,
  blockDrawOrder,
  builtinCommands,
  moveInDrawOrder,
  sortTableOf,
  wipeoutFrame,
  type Entity,
  type Handle,
  type ImageGeometry,
  type LwPolylineGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));
const PER_FILE_BUDGET_MS = 30_000;

/** The layouts' blocks' draw orders, as entity handles. */
function layoutOrders(model: DocumentModel): Map<Handle, Handle[]> {
  const b = new ChangeSetBuilder(model);
  const out = new Map<Handle, Handle[]>();
  for (const l of model.layouts) {
    if (!model.hasBlock(l.blockRecord)) continue;
    const order = blockDrawOrder(model, l.blockRecord, sortTableOf(b, model, l.blockRecord));
    out.set(
      l.blockRecord,
      order.map((e) => model.ids.handleOf(e.id)!),
    );
  }
  return out;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));

describe('the markup commands on the public corpus', () => {
  let clouds = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves after REVCLOUD, WIPEOUT, TEXTTOFRONT, HATCHTOBACK and DRAWORDER',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = withPinnedClock(() =>
        DocumentModel.create(documentInit(readCadDocument(bytes))),
      );
      const before = new Set([...model.entities()].map((e) => e.id));
      const space = model.layouts.find((l) => l.name === 'Model')?.blockRecord;
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        ...(space && { space: () => space }),
      });
      await bus.script(['REVCLOUD', 'A', '5', '5', '0,0', '100,50']);
      await bus.script(['REVCLOUD', 'A', '3', '6', 'S', 'C', 'P', '200,0', '260,0', '230,40', '']);
      await bus.script(['WIPEOUT', '0,100', '40,100', '20,130', '']);
      await bus.script(['WIPEOUT', 'F', 'OFF']);
      await bus.script(['TEXTTOFRONT', '']);
      await bus.script(['HATCHTOBACK']);
      expect(bus.command).toBeUndefined();
      const added = [...model.entities()].filter((e) => !before.has(e.id));
      expect(added.map((e) => e.type)).toEqual(['LWPOLYLINE', 'LWPOLYLINE', 'WIPEOUT']);
      // DRAWORDER Front of every other object of each layout.
      const b = new ChangeSetBuilder(model);
      for (const l of model.layouts) {
        if (!model.hasBlock(l.blockRecord)) continue;
        const ids = model.blockEntities(l.blockRecord).filter((_, i) => i % 2 === 0);
        moveInDrawOrder(b, model, ids, { to: 'front' });
      }
      model.apply(b.build());
      const orders = layoutOrders(model);

      const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      writeAuditSave(f.path, 'markup', () => saved);
      const back = DocumentModel.create(documentInit(readCadDocument(saved)));
      clouds++;

      const app = [...back.tables.appIds.values()].find(
        (r) => r.name.toUpperCase() === REVCLOUD_APP.toUpperCase(),
      );
      expect(app, 'RevcloudProps APPID').toBeDefined();
      for (const e of added) {
        const r = back.entityByHandle(e.handle) as Entity;
        expect(r, `${e.type} ${e.handle}`).toBeDefined();
        expect(r.type).toBe(e.type);
        if (e.type === 'LWPOLYLINE') {
          const g = r.geom as LwPolylineGeometry;
          const want = e.geom as LwPolylineGeometry;
          expect(g.closed).toBe(true);
          expect(g.vertices.every((v) => near(Math.abs(v.bulge), REVCLOUD_BULGE))).toBe(true);
          expect(g.vertices).toHaveLength(want.vertices.length);
          g.vertices.forEach((v, i) => {
            const w = want.vertices[i]!;
            expect(near(v.x, w.x) && near(v.y, w.y)).toBe(true);
            expect(near(v.endWidth ?? 0, w.endWidth ?? 0)).toBe(true);
          });
          const x = r.xdata?.find((d) => d.appId === app!.handle);
          expect(x?.values.map((v) => [v.code, Number(v.value)])).toEqual(
            e.xdata![0]!.values.map((v) => [v.code, Number(v.value)]),
          );
        } else {
          const g = r.geom as ImageGeometry;
          const want = e.geom as typeof g;
          expect(near(g.position.x, want.position.x) && near(g.u.x, want.u.x)).toBe(true);
          expect(g.clip.vertices).toEqual(want.clip.vertices);
        }
      }
      expect(wipeoutFrame(back)).toBe(false);
      expect(layoutOrders(back)).toEqual(orders);
    },
    PER_FILE_BUDGET_MS,
  );

  it('saved clouds on every readable file', () => {
    expect(clouds).toBe(readable.length);
  });
});
