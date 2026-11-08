// M1-108: object transparency on the thread-authored corpus drawing `self-authored/transparency.dxf`
// (written by the committed ezdxf script scripts/corpus/transparency.py; DEC-047, no AutoCAD
// sample). Every source of an object's transparency reads into the model as the renderer needs
// it: an entity's own DXF 440, ByLayer from the layer's AcCmTransparency xdata, ByBlock inside a
// block, and a layer's VP override in one layout viewport.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DocumentModel, type Entity, type LayerRecord, type ViewportGeometry } from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';

const file = fileURLToPath(
  new URL('../../../../corpus/public/self-authored/transparency.dxf', import.meta.url),
);
const model = DocumentModel.create(
  documentInit(readCadDocument(new Uint8Array(readFileSync(file)))),
);
const layer = (name: string): LayerRecord =>
  [...model.tables.layers.values()].find((l) => l.name === name)!;
const all = [...model.entities()];
const on = (name: string, kind: string) =>
  all.filter((e) => e.layer === layer(name).handle && e.geom.kind === kind);
const blockNamed = (name: string) =>
  [...model.blocks.values()].find((b) => b.name === name)!.handle;

describe('object transparency in the corpus drawing (M1-108)', () => {
  it('reads each hatch’s own transparency, 0 to 90 %', () => {
    // Alpha = 255 × (1 − transparency), as acad-ts keeps it in whole percent.
    expect(on('CLEAR', 'HATCH').map((e) => e.transparency)).toEqual([
      { alpha: 255 },
      { alpha: 179 },
      { alpha: 102 },
      { alpha: 26 },
    ]);
  });

  it('reads GLASS as 50 % transparent, its objects ByLayer, and the band opaque', () => {
    expect(layer('GLASS').transparency).toEqual({ alpha: 127 });
    expect(layer('BACK').transparency).toEqual({ alpha: 255 });
    expect(on('GLASS', 'HATCH').map((e) => e.transparency)).toEqual(['ByLayer']);
    expect(on('GLASS', 'LINE').map((e) => e.transparency)).toEqual(['ByLayer']);
  });

  it('reads the block’s ByBlock hatch and the references’ own values', () => {
    const pane = blockNamed('PANE');
    const inPane = all.filter((e) => e.owner === pane);
    expect(inPane.map((e) => [e.geom.kind, e.transparency])).toEqual([
      ['HATCH', 'ByBlock'],
      ['CIRCLE', 'ByLayer'],
      ['LINE', { alpha: 255 }],
    ]);
    const refs = all.filter((e): e is Entity => e.geom.kind === 'INSERT');
    expect(refs.map((e) => e.transparency)).toEqual([{ alpha: 77 }, 'ByLayer']);
  });

  it('reads the BACK and GLASS overrides onto the right-hand viewport only', () => {
    const vps = all.filter(
      (e): e is Entity & { geom: ViewportGeometry } =>
        e.geom.kind === 'VIEWPORT' && e.geom.id !== 1,
    );
    const right = vps.find((v) => v.geom.center.x === 310)!.handle;
    expect(layer('BACK').viewportOverrides).toEqual([
      { viewport: right, transparency: { alpha: 102 } },
    ]);
    expect(layer('GLASS').viewportOverrides).toEqual([
      { viewport: right, transparency: { alpha: 255 } },
    ]);
  });
});
