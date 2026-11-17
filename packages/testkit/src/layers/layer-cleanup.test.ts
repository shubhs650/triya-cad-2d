// M5-06 part 2: what LAYDEL and LAYMRG leave saves cleanly. On ACadSharp's AC1032 sample (layers
// with objects in model space, the layouts and block definitions), every layer the commands can
// take is deleted with its objects, or merged into layer 0; the AC1032 DXF save re-reads with
// those layers gone and every other object as the model has it, and CI's ezdxf audit reads both
// saves (scripts/dxf-audit/audit.py `FIXTURE_SAVES`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  EngineSession,
  deleteLayersWithObjects,
  layerRemovalProblem,
  mergeLayers,
  type DocumentModel,
  type Handle,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';

/** The corpus file, as the audit gate names its saves. */
const AUDIT_PATH = 'third-party/acadsharp/sample_AC1032_ascii.dxf';
const FILE = fileURLToPath(new URL(`../../../../corpus/public/${AUDIT_PATH}`, import.meta.url));
const bytes = () => new Uint8Array(readFileSync(FILE));
const open = (b: Uint8Array): DocumentModel =>
  new EngineSession(openDocument(readCadDocument(b)).init).model;

/** The layers holding objects that LAYDEL and LAYMRG take (and no viewport with overrides). */
function takeable(model: DocumentModel): Handle[] {
  const used = new Set([...model.entities()].map((e) => e.layer));
  const overridden = new Set(
    [...model.tables.layers.values()].flatMap((l) =>
      (l.viewportOverrides ?? []).map((o) => o.viewport),
    ),
  );
  const blocked = new Set(
    [...model.entities()]
      .filter((e) => overridden.has(e.handle) || (e.geom.kind === 'VIEWPORT' && e.geom.id === 1))
      .map((e) => e.layer),
  );
  return [...model.tables.layers.values()]
    .filter(
      (l) =>
        used.has(l.handle) &&
        !blocked.has(l.handle) &&
        layerRemovalProblem(model, l, 'deleted') === undefined,
    )
    .map((l) => l.handle);
}

/** What the drawing keeps, without handles: layer names and each object's type and layer name. */
function shape(model: DocumentModel) {
  const name = (h: Handle) => model.tables.layers.get(h)?.name ?? `?${h}`;
  return {
    layers: [...model.tables.layers.values()].map((l) => l.name).sort(),
    objects: [...model.entities()].map((e) => `${e.geom.kind}@${name(e.layer)}`).sort(),
  };
}

describe('LAYDEL and LAYMRG saves (M5-06 part 2)', () => {
  it('knows the layers of the objects Triya keeps without mapping, which no layer edit takes', () => {
    const session = new EngineSession(openDocument(readCadDocument(bytes())).init);
    const meshes = [...session.model.tables.layers.values()].find(
      (l) => l.name === 'Layer_color_80',
    )!;
    // Its MESH is not mapped (FILE_FIDELITY.md), so the layer is in use.
    expect(session.model.passthroughLayers.has(meshes.handle)).toBe(true);
    expect(session.edit({ kind: 'layer-delete', layers: [meshes.handle] })).toMatchObject({
      ok: false,
    });
    expect(takeable(session.model)).not.toContain(meshes.handle);
  });

  it('deletes every layer LAYDEL can take, with its objects, and saves', () => {
    const model = open(bytes());
    const layers = takeable(model);
    expect(layers.length).toBeGreaterThan(1);
    const before = [...model.entities()].length;
    const b = new ChangeSetBuilder(model);
    expect(deleteLayersWithObjects(b, model, layers)).toBeUndefined();
    model.apply(b.build());
    expect([...model.entities()].length).toBeLessThan(before);
    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    writeAuditSave(AUDIT_PATH, 'laydel', () => out);
    expect(shape(open(out))).toEqual(shape(model));
  });

  it('merges every layer LAYMRG can take into layer 0, and saves', () => {
    const model = open(bytes());
    const layers = takeable(model);
    const zero = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
    const before = [...model.entities()].length;
    const b = new ChangeSetBuilder(model);
    expect(mergeLayers(b, model, layers, zero)).toBeUndefined();
    model.apply(b.build());
    expect([...model.entities()].length).toBe(before);
    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    writeAuditSave(AUDIT_PATH, 'laymrg', () => out);
    expect(shape(open(out))).toEqual(shape(model));
  });
});
