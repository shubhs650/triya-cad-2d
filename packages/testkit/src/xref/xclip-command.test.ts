// M5-04 part 3: XCLIP run on the PromptBus over ezdxf's xclip.dxf (nine clipped references:
// rectangular, polygonal, turned, inverted, one with XCLIP OFF) and a reference placed beside
// them, saved as AC1032 DXF and read back: every option's clip is written where AutoCAD keeps it
// (io export/xclips.ts), and CI's ezdxf audit reads the save (audit.py `FIXTURE_SAVES`,
// `third-party__ezdxf__examples_dxf__xclip.dxf.xclip.dxf`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DocumentModel } from '@triya/engine';
import {
  ChangeSetBuilder,
  EngineSession,
  PromptBus,
  builtinCommands,
  clipBoundary,
  modelSpaceOf,
  type BusEvent,
  type EntityId,
  type InsertGeometry,
  type SpatialFilter,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';

/** The corpus file, and the name the audit gate finds its save under. */
const AUDIT_PATH = 'third-party/ezdxf/examples_dxf/xclip.dxf';
const FILE = fileURLToPath(new URL(`../../../../corpus/public/${AUDIT_PATH}`, import.meta.url));
const bytes = () => new Uint8Array(readFileSync(FILE));

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const filters = (model: DocumentModel) =>
  [...model.objects.values()].filter((o): o is SpatialFilter => o.type === 'SPATIAL_FILTER');
const clipOf = (model: DocumentModel, insert: string) =>
  filters(model).find((f) => f.insert === insert);
/** A clip in its block's coordinates, rounded: what it hides, whatever its storage. */
const inBlock = (f: SpatialFilter | undefined) =>
  f && clipBoundary(f)!.map((p) => [r6(p.x), r6(p.y)]);

describe('XCLIP saves (M5-04 part 3)', () => {
  it('writes a new, a replaced, a turned-off and a deleted clip, and a generated polyline', async () => {
    const model = new EngineSession(openDocument(readCadDocument(bytes())).init).model;
    const space = modelSpaceOf(model);
    const base = [...model.tables.blockRecords.values()].find((r) => r.name === 'BaseBlock')!;

    // A reference of BaseBlock at 50,0 with no extension dictionary: its first clip makes one.
    const b = new ChangeSetBuilder(model);
    const fresh = b.addEntity({
      owner: space,
      layer: [...model.tables.layers.values()].find((l) => l.name === '0')!.handle,
      geom: {
        kind: 'INSERT',
        block: base.handle,
        position: { x: 50, y: 0 },
        scale: { x: 2, y: 2, z: 2 },
        rotation: 0,
        attributes: [],
      },
    });
    model.apply(b.build());

    let target: EntityId[] = [];
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) =>
          Promise.resolve(r.op === 'pick' ? { ok: true, ids: target } : { ok: false, message: '' }),
      },
    });
    const log: string[] = [];
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    /** XCLIP on the reference `handle`, then `steps`. */
    const xclip = async (handle: string, steps: string[]) => {
      target = [model.ids.idOf(handle)!];
      await bus.submit('XCLIP');
      await bus.pick({ x: 0, y: 0 });
      await bus.submit('');
      await bus.script(steps);
      expect(bus.command).toBeUndefined();
    };

    const polygon = inBlock(clipOf(model, 'CF'));
    await xclip(fresh.handle, ['', '', '51,1', '55,3']);
    await xclip('B9', ['', '', 'P', '5,5', '9,5', '7,8', '']);
    // 809 is the inverted clip: its new boundary leaves its ACAD_XREC_ROUNDTRIP record behind.
    await xclip('809', ['', '', 'R', '25,6', '27,8']);
    await xclip('CF', ['OFF']);
    await xclip('E3', ['D']);
    const before = model.blockEntities(space).length;
    await xclip('F0', ['P']);
    expect(model.blockEntities(space)).toHaveLength(before + 1);
    const outline = model.entity(model.blockEntities(space).at(-1)!)!;
    const expected = {
      fresh: inBlock(clipOf(model, fresh.handle)),
      B9: inBlock(clipOf(model, 'B9')),
      '809': inBlock(clipOf(model, '809')),
    };
    expect(expected.fresh).toEqual([
      [0.5, 0.5],
      [2.5, 0.5],
      [2.5, 1.5],
      [0.5, 1.5],
    ]);

    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    writeAuditSave(AUDIT_PATH, 'xclip', () => out);
    const back = new EngineSession(openDocument(readCadDocument(out)).init).model;

    expect(filters(back)).toHaveLength(filters(model).length);
    expect(inBlock(clipOf(back, fresh.handle))).toEqual(expected.fresh);
    expect(back.entityByHandle(fresh.handle)!.extDict).toBe(
      model.entityByHandle(fresh.handle)!.extDict,
    );
    expect(inBlock(clipOf(back, 'B9'))).toEqual(expected.B9);
    expect(clipOf(back, 'B9')!.boundary).toHaveLength(3);
    expect(inBlock(clipOf(back, '809'))).toEqual(expected['809']);
    expect(clipOf(back, '809')!.extDict).toBeUndefined();
    expect(clipOf(back, 'CF')).toMatchObject({ enabled: false });
    expect(inBlock(clipOf(back, 'CF'))).toEqual(polygon);
    expect(clipOf(back, 'E3')).toBeUndefined();
    const pl = back.entityByHandle(outline.handle)!;
    expect(pl.geom).toMatchObject({ kind: 'LWPOLYLINE', closed: true });
    // F0 is turned 45°: its polyline is the clip in its block placed as the reference stands,
    // p = position + R(rotation) · S(scale) · (b − base), the DXF reference's placement.
    const f0 = clipOf(back, 'F0')!;
    const g = back.entityByHandle('F0')!.geom as InsertGeometry;
    expect(g.rotation).toBeCloseTo(Math.PI / 4, 12);
    const origin = back.blocks.get(g.block)!.basePoint;
    const [c, s] = [Math.cos(g.rotation), Math.sin(g.rotation)];
    const placed = clipBoundary(f0)!.map((b) => {
      const x = (b.x - origin.x) * g.scale.x;
      const y = (b.y - origin.y) * g.scale.y;
      return [r6(g.position.x + c * x - s * y), r6(g.position.y + s * x + c * y)];
    });
    const vertices = (pl.geom as unknown as { vertices: { x: number; y: number }[] }).vertices;
    expect(vertices.map((v) => [r6(v.x), r6(v.y)])).toEqual(placed);
  });
});
