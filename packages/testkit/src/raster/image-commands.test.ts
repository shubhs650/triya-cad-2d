// M5-04 part 4: IMAGECLIP, IMAGEADJUST, IMAGEQUALITY and IMAGEFRAME run on the PromptBus over
// ezdxf's images.dxf, saved as AC1032 DXF and read back: each image's clip (DXF 71/91/14,
// 280, 290), brightness, contrast and fade (281–283) and the drawing's RASTERVARIABLES (70, 71)
// are written where AutoCAD keeps them, IMAGEFRAME 2 kept through the save (acad-ts patch 0188),
// and CI's ezdxf audit reads the save (audit.py `FIXTURE_SAVES`,
// `third-party__ezdxf__examples_dxf__images.dxf.images.dxf`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  type BusEvent,
  type DocumentModel,
  type Entity,
  type EntityId,
  type ImageGeometry,
  type RasterVariables,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';

/** The corpus file, and the name the audit gate finds its save under. */
const AUDIT_PATH = 'third-party/ezdxf/examples_dxf/images.dxf';
const FILE = fileURLToPath(new URL(`../../../../corpus/public/${AUDIT_PATH}`, import.meta.url));
const bytes = () => new Uint8Array(readFileSync(FILE));

const images = (model: DocumentModel) =>
  model
    .blockEntities(modelSpaceOf(model))
    .map((id) => model.entity(id)!)
    .filter((e): e is Entity & { geom: ImageGeometry } => e.geom.kind === 'IMAGE');
const raster = (model: DocumentModel) =>
  [...model.objects.values()].find((o): o is RasterVariables => o.type === 'RASTERVARIABLES');
/** A world point at image pixel (i, j), counted from the lower-left corner. */
const at = (g: ImageGeometry, i: number, j: number) =>
  `${g.position.x + g.u.x * i + g.v.x * j},${g.position.y + g.u.y * i + g.v.y * j}`;

describe('image command saves (M5-04 part 4)', () => {
  it('writes clips, adjustments, IMAGEQUALITY and IMAGEFRAME 2 that read back', async () => {
    const model = new EngineSession(openDocument(readCadDocument(bytes())).init).model;
    // A runs along the drawing's axes (its rectangle stays one); B and C are two others.
    const all = images(model);
    const a = all.find((e) => e.geom.u.y === 0 && e.geom.v.x === 0);
    const [b, c] = all.filter((e) => e !== a);
    expect(c).toBeDefined();

    // A pick takes the target; with `windowed`, a pick finds nothing and the window takes them.
    let target: EntityId[] = [];
    let windowed = false;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(
            r.op === 'pick'
              ? { ok: true, ids: windowed ? [] : target }
              : r.op === 'select'
                ? { ok: true, ids: target }
                : { ok: false, message: '' },
          ),
      },
    });
    const log: string[] = [];
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    /** `name` on the images `on`, then `steps`. */
    const run = async (name: string, on: Entity[], steps: string[], select = false) => {
      target = on.map((e) => e.id);
      windowed = select;
      await bus.submit(name);
      await bus.pick({ x: 0, y: 0 });
      if (select) {
        await bus.pick({ x: 1, y: 1 });
        await bus.submit('');
      }
      await bus.script(steps);
      expect(bus.command, log.join('\n')).toBeUndefined();
    };

    const ga = a!.geom;
    const gb = b!.geom;
    const w = (g: ImageGeometry) => g.size.x;
    const h = (g: ImageGeometry) => g.size.y;
    // A rectangle over the middle of A; an inverted triangle on B; C clipped, then deleted.
    await run(
      'IMAGECLIP',
      [a!],
      ['', 'R', at(ga, w(ga) / 4, h(ga) / 4), at(ga, w(ga) / 2, h(ga) / 2)],
    );
    await run(
      'IMAGECLIP',
      [b!],
      ['N', 'I', 'P', at(gb, 0, 0), at(gb, w(gb), 0), at(gb, w(gb) / 2, h(gb)), ''],
    );
    await run('IMAGECLIP', [c!], ['', 'R', at(c!.geom, 1, 1), at(c!.geom, 10, 10)]);
    await run('IMAGECLIP', [c!], ['D']);
    await run('IMAGEADJUST', [a!, b!], ['B', '80'], true);
    await run('-IMAGEADJUST', [b!], ['C', '30'], true);
    await run('IMAGEADJUST', [a!], ['F', '25'], true);
    await bus.script(['IMAGEQUALITY', 'D', 'IMAGEFRAME', '2']);
    expect(raster(model)).toMatchObject({ frame: 2, quality: 'draft' });

    const expected = (h: string) => model.entityByHandle(h)!.geom as ImageGeometry;
    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    writeAuditSave(AUDIT_PATH, 'images', () => out);
    const back = new EngineSession(openDocument(readCadDocument(out)).init).model;
    const read = (h: string) => back.entityByHandle(h)!.geom as ImageGeometry;

    for (const e of [a!, b!, c!]) {
      const was = expected(e.handle);
      const now = read(e.handle);
      for (const k of ['clipping', 'brightness', 'contrast', 'fade'] as const) {
        expect(now[k], `${e.handle} ${k}`).toBe(was[k]);
      }
      expect(now.clip.type).toBe(was.clip.type);
      expect(now.clip.inverted).toBe(was.clip.inverted);
      expect(now.clip.vertices.length).toBe(was.clip.vertices.length);
      now.clip.vertices.forEach((p, i) => {
        expect(p.x).toBeCloseTo(was.clip.vertices[i]!.x, 9);
        expect(p.y).toBeCloseTo(was.clip.vertices[i]!.y, 9);
      });
    }
    expect(read(a!.handle)).toMatchObject({
      clipping: true,
      brightness: 80,
      fade: 25,
      clip: { type: 'rectangle', inverted: false },
    });
    expect(read(b!.handle)).toMatchObject({
      clipping: true,
      brightness: 80,
      contrast: 30,
      clip: { type: 'polygon', inverted: true },
    });
    expect(read(b!.handle).clip.vertices).toHaveLength(4);
    expect(read(c!.handle)).toMatchObject({ clipping: false, clip: { type: 'rectangle' } });
    expect(raster(back)).toMatchObject({ frame: 2, quality: 'draft' });
  });
});
