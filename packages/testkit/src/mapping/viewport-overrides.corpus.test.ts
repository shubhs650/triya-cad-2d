// M1-62: viewport layer overrides and non-rectangular viewport clips, on the thread-authored
// corpus drawing `self-authored/viewport-overrides.dxf` (written by the committed ezdxf script
// scripts/corpus/viewport-overrides.py; DEC-047, no AutoCAD sample). Its four Layout1 viewports
// show one view: plain, with overrides on WALLS and PIPING, clipped by a closed LWPOLYLINE, and
// clipped by a CIRCLE. The overrides are the `ADSK_XREC_LAYER_*_OVR` XRECORDs of each layer's
// extension dictionary; a save keeps them as read, through edits to the layer's own values.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  VIEWPORT_NON_RECT_CLIP,
  viewportLayers,
  type Entity,
  type LayerRecord,
  type ViewportGeometry,
} from '@triya/engine';
import { documentInit, exportDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const file = fileURLToPath(
  new URL('../../../../corpus/public/self-authored/viewport-overrides.dxf', import.meta.url),
);
const bytes = new Uint8Array(readFileSync(file));

const open = () => DocumentModel.create(documentInit(readCadDocument(bytes)));
const layer = (model: DocumentModel, name: string): LayerRecord =>
  [...model.tables.layers.values()].find((l) => l.name === name)!;
/** Layout1's viewports by where their frames stand (the script's CENTERS). */
function viewports(model: DocumentModel) {
  const at = (x: number, y: number) =>
    [...model.entities()].find(
      (e): e is Entity & { geom: ViewportGeometry } =>
        e.geom.kind === 'VIEWPORT' && e.geom.center.x === x && e.geom.center.y === y,
    )!;
  return {
    plain: at(105, 212),
    overrides: at(305, 212),
    polyline: at(105, 80),
    circle: at(305, 80),
  };
}
const linetypeNamed = (model: DocumentModel, name: string) =>
  [...model.tables.linetypes.values()].find((l) => l.name === name)!.handle;

describe('viewport layer overrides (M1-62)', () => {
  it('maps the overrides of WALLS and PIPING onto the second viewport', () => {
    const model = open();
    const vp = viewports(model).overrides.handle;
    expect(layer(model, 'WALLS').viewportOverrides).toEqual([
      {
        viewport: vp,
        color: { kind: 'aci', index: 3 },
        lineweight: 70,
        transparency: { alpha: 127 },
      },
    ]);
    expect(layer(model, 'PIPING').viewportOverrides).toEqual([
      {
        viewport: vp,
        color: { kind: 'rgb', r: 255, g: 128, b: 0 },
        linetype: linetypeNamed(model, 'TRIYA_DASHED'),
      },
    ]);
    expect(layer(model, 'GRID').viewportOverrides).toBeUndefined();
    const shown = viewportLayers(model.tables.layers, vp)!;
    expect([...shown.overridden].map((h) => model.tables.layers.get(h)!.name).sort()).toEqual([
      'PIPING',
      'WALLS',
    ]);
    expect(viewportLayers(model.tables.layers, viewports(model).plain.handle)).toBeUndefined();
  });

  it('maps the clipped viewports onto their clip entities', () => {
    const model = open();
    const { plain, overrides, polyline, circle } = viewports(model);
    for (const vp of [plain, overrides]) {
      expect(vp.geom.clipBoundary).toBeUndefined();
      expect(vp.geom.flags & VIEWPORT_NON_RECT_CLIP).toBe(0);
    }
    const clipOf = (vp: typeof plain) =>
      [...model.entities()].find((e) => e.handle === vp.geom.clipBoundary);
    expect(polyline.geom.flags & VIEWPORT_NON_RECT_CLIP).not.toBe(0);
    expect(clipOf(polyline)).toMatchObject({ type: 'LWPOLYLINE', owner: polyline.owner });
    expect(circle.geom.flags & VIEWPORT_NON_RECT_CLIP).not.toBe(0);
    expect(clipOf(circle)).toMatchObject({ type: 'CIRCLE', owner: circle.owner });
  });

  it('saves the overrides as read, and through an edit of the layer', () => {
    withPinnedClock(() => {
      const model = open();
      const walls = layer(model, 'WALLS');
      const b = new ChangeSetBuilder(model);
      b.updateTableRecord('layers', walls.handle, { color: { kind: 'aci', index: 6 } });
      model.apply(b.build());
      const original = readCadDocument(bytes);
      const reopened = readCadDocument(
        exportDocument(readCadDocument(bytes), model, { format: 'dxf' }),
      );
      const back = DocumentModel.create(documentInit(reopened));
      expect(layer(back, 'WALLS').color).toEqual({ kind: 'aci', index: 6 });
      expect(layer(back, 'WALLS').viewportOverrides).toEqual(walls.viewportOverrides);
      expect(layer(back, 'PIPING').viewportOverrides).toEqual(
        layer(model, 'PIPING').viewportOverrides,
      );
      const ignoreHandles = new Set([Number.parseInt(walls.handle, 16)]);
      expect(structuralDiff(original, reopened, { ignoreHandles }).differences).toEqual([]);
    });
  });

  // No command edits overrides yet (VPLAYER and the Layer Properties Manager's VP columns are
  // M5 work); DEC-047: the writer comes with the command that first needs it.
  it('refuses a save that changes the overrides', () => {
    const model = open();
    const walls = layer(model, 'WALLS');
    const b = new ChangeSetBuilder(model);
    b.updateTableRecord('layers', walls.handle, { viewportOverrides: [] });
    model.apply(b.build());
    expect(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' })).toThrow(
      /WALLS .*viewport layer overrides change/,
    );
  });

  it('refuses a save that removes a viewport a layer overrides', () => {
    const model = open();
    const vp = viewports(model).overrides;
    const b = new ChangeSetBuilder(model);
    b.removeEntity(vp.id);
    model.apply(b.build());
    expect(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' })).toThrow(
      /WALLS .*overrides viewport .* the save removes/,
    );
  });
});
