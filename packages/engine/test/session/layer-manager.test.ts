// M5-05 part 1: the Layer Properties Manager's edits, as the engine session applies them. A
// layer's properties set on one layer or on all the layers selected, a new layer (named LayerN,
// with the properties of the layer selected), deleting layers AutoCAD lets go and making a layer
// current; each one undo step named LAYER.
import { describe, expect, it } from 'vitest';
import { EngineSession, type DocumentInit, type LayerRecord } from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  PAPER_SPACE,
  entityInit,
  layer,
  lineGeom,
  linetype,
  sampleInit,
} from '../model/fixtures';

const LAYER_EMPTY = '12';
const LAYER_DEFPOINTS = '13';
const LAYER_XREF = '15';
const DASHED = '16';
const BLOCK = '30';
const VIEWPORT = '25';

/** The sample with three more layers (one empty, Defpoints, one xref-dependent), a dashed linetype, a block whose entity is on WALLS and a layout viewport freezing EMPTY. */
function managerInit(): DocumentInit {
  const init = sampleInit();
  return {
    ...init,
    tables: {
      ...init.tables,
      layers: [
        ...init.tables!.layers!,
        layer(LAYER_EMPTY, 'Empty'),
        { ...layer(LAYER_DEFPOINTS, 'Defpoints'), plot: false },
        { ...layer(LAYER_XREF, 'Site|Walls'), flags: 16 | 32 },
      ],
      linetypes: [...init.tables!.linetypes!, linetype(DASHED, 'DASHED')],
      blockRecords: [
        ...init.tables!.blockRecords!,
        { handle: BLOCK, name: 'DOOR', units: 0, explodable: true, scalable: true },
      ],
    },
    blocks: [...init.blocks!, { handle: BLOCK, name: 'DOOR', basePoint: { x: 0, y: 0 } }],
    entities: [
      ...init.entities!.map((e) => (e.layer === LAYER_WALLS ? { ...e, layer: LAYER_0 } : e)),
      entityInit('31', lineGeom(0, 0, 1, 0), { owner: BLOCK, layer: LAYER_WALLS }),
      entityInit(
        VIEWPORT,
        {
          kind: 'VIEWPORT',
          center: { x: 5, y: 5 },
          width: 10,
          height: 10,
          id: 2,
          status: 2,
          flags: 819232,
          viewCenter: { x: 0, y: 0 },
          viewHeight: 10,
          viewDirection: { x: 0, y: 0, z: 1 },
          viewTarget: { x: 0, y: 0, z: 0 },
          twist: 0,
          lensLength: 50,
          frontClip: 0,
          backClip: 0,
          frozenLayers: [LAYER_EMPTY],
          plotStyleSheet: '',
          renderMode: 0,
        },
        { owner: PAPER_SPACE },
      ),
    ],
  };
}

const layerOf = (s: EngineSession, h: string): LayerRecord => s.model.tables.layers.get(h)!;

describe('Layer Properties Manager edits (M5-05)', () => {
  it('sets every property a row edits, as one LAYER undo step', () => {
    const s = new EngineSession(managerInit());
    const r = s.edit({
      kind: 'layer',
      layer: LAYER_EMPTY,
      plot: false,
      color: { kind: 'aci', index: 1 },
      linetype: DASHED,
      lineweight: 50,
      transparency: { alpha: 76 },
      description: 'Not shown',
    });
    expect(r.ok).toBe(true);
    expect(layerOf(s, LAYER_EMPTY)).toMatchObject({
      plot: false,
      color: { kind: 'aci', index: 1 },
      linetype: DASHED,
      lineweight: 50,
      transparency: { alpha: 76 },
      description: 'Not shown',
    });
    expect(s.undoState.nextUndo).toBe('LAYER');
  });

  it('applies a change to every layer selected, in one change', () => {
    const s = new EngineSession(managerInit());
    const r = s.edit({ kind: 'layer', layer: [LAYER_0, LAYER_EMPTY], locked: true });
    expect(r.ok && r.change.tables?.layers?.updated?.length).toBe(2);
    expect(layerOf(s, LAYER_0).locked).toBe(true);
    expect(layerOf(s, LAYER_EMPTY).locked).toBe(true);
    // Freezing a selection that holds the current layer is refused, nothing changed.
    const f = s.edit({ kind: 'layer', layer: [LAYER_EMPTY, LAYER_WALLS], frozen: true });
    expect(f).toEqual({ ok: false, message: 'Cannot freeze the current layer.' });
    expect(layerOf(s, LAYER_EMPTY).frozen).toBe(false);
  });

  it('refuses what a layer cannot hold', () => {
    const s = new EngineSession(managerInit());
    const refused = (e: Record<string, unknown>) =>
      s.edit({ kind: 'layer', layer: LAYER_EMPTY, ...e });
    expect(refused({ color: { kind: 'byLayer' } })).toEqual({
      ok: false,
      message: 'A layer cannot be ByLayer or ByBlock.',
    });
    expect(refused({ linetype: 'FFF' })).toEqual({ ok: false, message: 'No linetype FFF.' });
    expect(refused({ lineweight: 'ByBlock' })).toEqual({
      ok: false,
      message: 'Invalid lineweight.',
    });
    expect(refused({ lineweight: 17 })).toEqual({ ok: false, message: 'Invalid lineweight.' });
    // AutoCAD's layer transparency is 0–90 %: alpha 25 (90 %) is the most transparent.
    expect(refused({ transparency: { alpha: 10 } })).toEqual({
      ok: false,
      message: 'Transparency must be between 0 and 90.',
    });
    expect(refused({ description: 'x'.repeat(256) })).toEqual({
      ok: false,
      message: 'A description is at most 255 characters.',
    });
  });

  it('renames a layer, following $CLAYER, and refuses names AutoCAD refuses', () => {
    const s = new EngineSession(managerInit());
    expect(s.edit({ kind: 'layer', layer: LAYER_WALLS, name: 'A-WALL' }).ok).toBe(true);
    expect(layerOf(s, LAYER_WALLS).name).toBe('A-WALL');
    expect(s.model.header.get('$CLAYER')).toBe('A-WALL');
    // A change of case only is a rename too.
    expect(s.edit({ kind: 'layer', layer: LAYER_EMPTY, name: 'EMPTY' }).ok).toBe(true);
    const named = (layer: string, name: string) => s.edit({ kind: 'layer', layer, name });
    expect(named(LAYER_EMPTY, 'a-wall')).toEqual({
      ok: false,
      message: 'A layer named "A-WALL" already exists.',
    });
    expect(named(LAYER_EMPTY, 'A<B')).toEqual({ ok: false, message: 'Invalid layer name.' });
    expect(named(LAYER_EMPTY, '  ')).toEqual({ ok: false, message: 'Invalid layer name.' });
    expect(named(LAYER_0, 'Zero')).toEqual({
      ok: false,
      message: 'The name of layer 0 cannot be changed.',
    });
    expect(named(LAYER_XREF, 'Mine')).toEqual({
      ok: false,
      message: 'An xref-dependent layer cannot be renamed.',
    });
    expect(s.edit({ kind: 'layer', layer: [LAYER_EMPTY, LAYER_DEFPOINTS], name: 'X' })).toEqual({
      ok: false,
      message: 'Select one layer to rename.',
    });
  });

  it('makes a new layer LayerN with the properties of the layer selected', () => {
    const s = new EngineSession(managerInit());
    s.edit({ kind: 'layer', layer: LAYER_EMPTY, color: { kind: 'aci', index: 3 }, plot: false });
    const r = s.edit({ kind: 'layer-new', like: LAYER_EMPTY });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [added] = r.change.tables?.layers?.added ?? [];
    expect(added).toMatchObject({
      name: 'Layer1',
      color: { kind: 'aci', index: 3 },
      plot: false,
      linetype: '14',
    });
    expect(added!.description).toBeUndefined();
    // Above $HANDSEED as every new handle is.
    expect(Number.parseInt(added!.handle, 16)).toBeGreaterThanOrEqual(0x40);
    const next = s.edit({ kind: 'layer-new' });
    expect(next.ok && next.change.tables?.layers?.added?.[0]).toMatchObject({
      name: 'Layer2',
      // Without one selected, layer 0's properties.
      color: { kind: 'aci', index: 7 },
      plot: true,
    });
    // A free number, compared without regard to case.
    s.edit({ kind: 'layer', layer: LAYER_EMPTY, name: 'LAYER3' });
    const third = s.edit({ kind: 'layer-new' });
    expect(third.ok && third.change.tables?.layers?.added?.[0]?.name).toBe('Layer4');
    expect(s.edit({ kind: 'layer-new', name: 'walls' })).toEqual({
      ok: false,
      message: 'A layer named "WALLS" already exists.',
    });
    expect(s.undoState.nextUndo).toBe('LAYER');
  });

  it('deletes layers nothing is on, taking them out of viewports that freeze them', () => {
    const s = new EngineSession(managerInit());
    const r = s.edit({ kind: 'layer-delete', layers: [LAYER_EMPTY] });
    expect(r.ok).toBe(true);
    expect(s.model.tables.layers.has(LAYER_EMPTY)).toBe(false);
    const vp = [...s.model.entities()].find((e) => e.handle === VIEWPORT)!;
    expect(vp.geom.kind === 'VIEWPORT' && vp.geom.frozenLayers).toEqual([]);
    expect(s.undoState.nextUndo).toBe('LAYER');
  });

  it('refuses to delete layer 0, Defpoints, the current layer, layers in use and xref layers', () => {
    const s = new EngineSession(managerInit());
    const deleted = (layers: string[]) => s.edit({ kind: 'layer-delete', layers });
    const why = (name: string, reason: string) => ({
      ok: false,
      message: `Layer "${name}" was not deleted: ${reason}.`,
    });
    expect(deleted([LAYER_0])).toEqual(why('0', 'layer 0 and Defpoints cannot be deleted'));
    expect(deleted([LAYER_DEFPOINTS])).toEqual(
      why('Defpoints', 'layer 0 and Defpoints cannot be deleted'),
    );
    // WALLS is current, and holds an object of block DOOR.
    expect(deleted([LAYER_WALLS])).toEqual(why('WALLS', 'it is the current layer'));
    s.edit({ kind: 'layer-current', layer: LAYER_0 });
    expect(deleted([LAYER_WALLS])).toEqual(
      why('WALLS', 'it has objects (including objects in block definitions)'),
    );
    expect(deleted([LAYER_XREF])).toEqual(why('Site|Walls', 'it is xref-dependent'));
    // One refused layer keeps the others too.
    expect(deleted([LAYER_EMPTY, LAYER_WALLS]).ok).toBe(false);
    expect(s.model.tables.layers.has(LAYER_EMPTY)).toBe(true);
    expect(deleted(['FFF'])).toEqual({ ok: false, message: 'No layer FFF.' });
  });

  it('makes a layer current, refusing a frozen or xref-dependent one', () => {
    const s = new EngineSession(managerInit());
    expect(s.edit({ kind: 'layer-current', layer: LAYER_EMPTY }).ok).toBe(true);
    expect(s.model.header.get('$CLAYER')).toBe('Empty');
    expect(s.undoState.nextUndo).toBe('LAYER');
    // Already current: nothing to do, no step.
    const steps = s.undoState.undoable;
    expect(s.edit({ kind: 'layer-current', layer: LAYER_EMPTY })).toEqual({ ok: true, change: {} });
    expect(s.undoState.undoable).toBe(steps);
    s.edit({ kind: 'layer', layer: LAYER_0, frozen: true });
    expect(s.edit({ kind: 'layer-current', layer: LAYER_0 })).toEqual({
      ok: false,
      message: 'Cannot set a frozen layer current.',
    });
    expect(s.edit({ kind: 'layer-current', layer: LAYER_XREF })).toEqual({
      ok: false,
      message: 'Cannot set an xref-dependent layer current.',
    });
  });

  it('undoes a new layer, a delete and a rename', async () => {
    const s = new EngineSession(managerInit());
    const before = [...s.model.tables.layers.values()].map((l) => l.name).sort();
    s.edit({ kind: 'layer-new' });
    s.edit({ kind: 'layer-delete', layers: [LAYER_EMPTY] });
    s.edit({ kind: 'layer', layer: LAYER_WALLS, name: 'B' });
    for (const text of ['UNDO', '3']) await s.command({ kind: 'submit', text });
    expect([...s.model.tables.layers.values()].map((l) => l.name).sort()).toEqual(before);
    expect(s.model.header.get('$CLAYER')).toBe('WALLS');
    const vp = [...s.model.entities()].find((e) => e.handle === VIEWPORT)!;
    expect(vp.geom.kind === 'VIEWPORT' && vp.geom.frozenLayers).toEqual([LAYER_EMPTY]);
  });

  it('covers the edges: a bad ACI, an unknown layer, a new layer like an xref layer', () => {
    const s = new EngineSession(managerInit());
    expect(
      s.edit({ kind: 'layer', layer: LAYER_EMPTY, color: { kind: 'aci', index: 256 } }),
    ).toEqual({ ok: false, message: 'Invalid color.' });
    expect(s.edit({ kind: 'layer', layer: 'FFF', on: false })).toEqual({
      ok: false,
      message: 'No layer FFF.',
    });
    expect(s.edit({ kind: 'layer-new', like: 'FFF' })).toEqual({
      ok: false,
      message: 'No layer FFF.',
    });
    expect(s.edit({ kind: 'layer-current', layer: 'FFF' })).toEqual({
      ok: false,
      message: 'No layer FFF.',
    });
    // An xref layer's frozen state is the xref's: the new layer, Triya's own, is thawed.
    s.edit({ kind: 'layer', layer: LAYER_XREF, frozen: true });
    const r = s.edit({ kind: 'layer-new', like: LAYER_XREF, name: 'Copy' });
    expect(r.ok && r.change.tables?.layers?.added?.[0]).toMatchObject({
      name: 'Copy',
      frozen: false,
    });
    expect(r.ok && r.change.tables?.layers?.added?.[0]?.flags).toBeUndefined();
    // A layer with a plot style gives it to the new one; a rename to the same name is no change.
    const styled = new EngineSession({
      ...managerInit(),
      tables: {
        ...managerInit().tables,
        layers: [{ ...layer(LAYER_0, '0'), plotStyle: '40' }],
      },
    });
    const n = styled.edit({ kind: 'layer-new' });
    expect(n.ok && n.change.tables?.layers?.added?.[0]?.plotStyle).toBe('40');
    expect(styled.edit({ kind: 'layer', layer: LAYER_0, name: '0' })).toEqual({
      ok: true,
      change: {},
    });
    // A drawing without layers (a damaged file) has nothing to copy.
    const bare = new EngineSession({
      ...managerInit(),
      tables: { ...managerInit().tables, layers: [] },
    });
    expect(bare.edit({ kind: 'layer-new' })).toEqual({
      ok: false,
      message: 'The drawing has no layers.',
    });
  });
});
