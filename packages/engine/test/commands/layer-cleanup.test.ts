// M5-06 part 2: LAYDEL and LAYMRG, with AutoCAD 2024's prompts (AutoCAD Help, "LAYDEL
// (Command)", "-LAYDEL", "LAYMRG (Command)", "-LAYMRG"): objects on the layers deleted, or moved
// to the target, in block definitions and a block reference's attributes too; the layers purged
// from the drawing, its viewports and its layer states; one undo step.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  mergeLayersChange,
  type BusEvent,
  type EntityGeometry,
  type Group,
} from '../../src/index';
import {
  PAPER_SPACE,
  blockRecord,
  entityInit,
  layer,
  lineGeom,
  sampleInit,
} from '../model/fixtures';
import { host } from './edit-harness';

const L0 = '10';
const WALLS = '11';
const DOORS = '12';
const NOTES = '13';
const SITE = '16';
const BLOCK = '17';
const INSERT = '2A';
const VIEWPORT = '2B';
const LAYERS = [L0, WALLS, DOORS, NOTES];
const NAMES: Record<string, string> = {
  [L0]: '0',
  [WALLS]: 'WALLS',
  [DOORS]: 'DOORS',
  [NOTES]: 'NOTES',
};

/**
 * Lines from x 0 to 10 on 0 (y 0, handle 30), WALLS (y 10, 31, current), DOORS (y 20, 32) and
 * NOTES (y 30, 33); block DOOR holding a line on DOORS (34) and one on 0 (35), inserted at
 * (100, 100) on 0 with attributes on DOORS (36) and 0 (37); a layout viewport freezing DOORS; an
 * xref-dependent layer Site|Walls.
 */
function setup(o: { passthroughLayers?: string[]; groups?: Group[] } = {}) {
  const init = sampleInit();
  const attributes = [
    { handle: '36', layer: DOORS, tag: 'A', value: '1' },
    { handle: '37', layer: L0, tag: 'B', value: '2' },
  ] as unknown as Extract<EntityGeometry, { kind: 'INSERT' }>['attributes'];
  const model = DocumentModel.create({
    ...init,
    tables: {
      ...init.tables,
      layers: [
        ...LAYERS.map((h) => layer(h, NAMES[h]!)),
        { ...layer(SITE, 'Site|Walls'), flags: 16 | 32 },
      ],
      blockRecords: [...init.tables!.blockRecords!, blockRecord(BLOCK, 'DOOR')],
    },
    blocks: [...init.blocks!, { handle: BLOCK, name: 'DOOR', basePoint: { x: 0, y: 0 } }],
    objects: [...init.objects!, ...(o.groups ?? [])],
    ...(o.passthroughLayers && { passthroughLayers: o.passthroughLayers }),
    entities: [
      ...LAYERS.map((h, i) =>
        entityInit((0x30 + i).toString(16).toUpperCase(), lineGeom(0, i * 10, 10, i * 10), {
          layer: h,
        }),
      ),
      entityInit('34', lineGeom(0, 0, 1, 0), { owner: BLOCK, layer: DOORS }),
      entityInit('35', lineGeom(0, 0, 0, 1), { owner: BLOCK, layer: L0 }),
      entityInit(
        INSERT,
        {
          kind: 'INSERT',
          block: BLOCK,
          position: { x: 100, y: 100 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: 0,
          attributes,
        },
        { layer: L0 },
      ),
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
          frozenLayers: [DOORS],
          plotStyleSheet: '',
          renderMode: 0,
        } as unknown as EntityGeometry,
        { owner: PAPER_SPACE },
      ),
    ],
  });
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: host(() => model, new Map()),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const has = (h: string) =>
    model.ids.idOf(h) !== undefined && model.entityByHandle(h) !== undefined;
  const layerOf = (h: string) => model.entityByHandle(h)!.layer;
  const geom = (h: string) => model.entityByHandle(h)!.geom;
  const on = (h: string) => ({ x: 5, y: LAYERS.indexOf(h) * 10 });
  return { model, bus, log, has, layerOf, geom, on };
}

const attributeLayers = (g: EntityGeometry) =>
  g.kind === 'INSERT' ? g.attributes.map((a) => `${a.handle}:${a.layer}`) : [];
const frozen = (g: EntityGeometry) => (g.kind === 'VIEWPORT' ? g.frozenLayers : []);

describe('LAYDEL', () => {
  it('deletes every object on the layers picked, in block definitions too, and purges them', async () => {
    const t = setup();
    await t.bus.script(['LAYDEL']);
    expect(t.bus.promptText).toBe('Select object on layer to delete or [Name]:');
    await t.bus.pick(t.on(DOORS));
    expect(t.log).toContain('Selected layers: DOORS');
    expect(t.bus.promptText).toBe('Select object on layer to delete or [Name/Undo]:');
    await t.bus.script(['']);
    expect(t.log).toContain('******** WARNING ********');
    expect(t.log).toContain('You are about to delete layer "DOORS" from this drawing.');
    expect(t.bus.promptText).toBe('Do you wish to continue? [Yes/No] <No>:');
    await t.bus.script(['Y']);
    expect(t.log).toContain('Deleting layer "DOORS".');
    expect(t.log).toContain('1 layer deleted.');
    expect(t.model.tables.layers.has(DOORS)).toBe(false);
    expect(t.has('32')).toBe(false);
    expect(t.has('34')).toBe(false);
    expect(t.has('35')).toBe(true);
    expect(attributeLayers(t.geom(INSERT))).toEqual([`37:${L0}`]);
    expect(frozen(t.geom(VIEWPORT))).toEqual([]);
    // One step: U brings the layer, its objects and the attribute back.
    await t.bus.script(['U']);
    expect(t.model.tables.layers.has(DOORS)).toBe(true);
    expect(t.has('32') && t.has('34')).toBe(true);
    expect(attributeLayers(t.geom(INSERT))).toEqual([`36:${DOORS}`, `37:${L0}`]);
    expect(frozen(t.geom(VIEWPORT))).toEqual([DOORS]);
  });

  it('deletes several layers, and changes nothing at No', async () => {
    const t = setup();
    await t.bus.script(['LAYDEL']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.pick(t.on(NOTES));
    expect(t.log).toContain('Selected layers: DOORS, NOTES');
    await t.bus.script(['']);
    expect(t.log).toContain('You are about to delete layers "DOORS", "NOTES" from this drawing.');
    await t.bus.script(['']);
    expect(t.model.tables.layers.has(DOORS) && t.model.tables.layers.has(NOTES)).toBe(true);
    expect(t.bus.undo.state.undoable).toBe(0);
    await t.bus.script(['LAYDEL']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['', 'Y']);
    expect(t.log).toContain('2 layers deleted.');
    expect(t.has('32') || t.has('33')).toBe(false);
  });

  it('refuses layer 0, the current layer and an xref layer, as they are picked or named', async () => {
    const t = setup();
    await t.bus.script(['LAYDEL']);
    await t.bus.pick(t.on(L0));
    expect(t.log).toContain('Layer "0" cannot be deleted.');
    await t.bus.pick(t.on(WALLS));
    expect(t.log).toContain('Layer "WALLS" is the current layer and cannot be deleted.');
    // The Delete Layers dialog does not list it, and refuses it should it come anyway.
    await t.bus.script(['N']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', layers: [SITE] });
    expect(t.log).toContain('Layer "Site|Walls" is xref-dependent and cannot be deleted.');
    expect(t.bus.promptText).toBe('Select object on layer to delete or [Name]:');
    await t.bus.script(['']);
    expect(t.log).not.toContain('******** WARNING ********');
    expect(t.model.tables.layers.size).toBe(5);
  });

  it('takes layers by Name (? lists them), and Undo takes the last one back', async () => {
    const t = setup();
    await t.bus.script(['-LAYDEL', 'N']);
    expect(t.bus.promptText).toBe('Enter layer name or [?]:');
    await t.bus.script(['?']);
    expect(t.log).toEqual(expect.arrayContaining(['Layers:', '  0', '  DOORS', '  Site|Walls']));
    await t.bus.script(['nothing']);
    expect(t.log).toContain('Layer "nothing" not found.');
    await t.bus.script(['notes']);
    expect(t.log).toContain('Selected layers: NOTES');
    await t.bus.script(['N', 'DOORS']);
    expect(t.log).toContain('Selected layers: NOTES, DOORS');
    await t.bus.script(['U']);
    expect(t.log.at(-1)).toBe('Selected layers: NOTES');
    await t.bus.script(['', 'Y']);
    expect(t.model.tables.layers.has(NOTES)).toBe(false);
    expect(t.model.tables.layers.has(DOORS)).toBe(true);
  });
});

describe('LAYMRG', () => {
  it('moves every object on the layers picked to the target layer and purges them', async () => {
    const t = setup();
    await t.bus.script(['LAYMRG']);
    expect(t.bus.promptText).toBe('Select object on layer to merge or [Name]:');
    await t.bus.pick(t.on(DOORS));
    await t.bus.pick(t.on(NOTES));
    expect(t.bus.promptText).toBe('Select object on layer to merge or [Name/Undo]:');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Select object on target layer or [Name]:');
    await t.bus.pick(t.on(WALLS));
    expect(t.log).toContain('You are about to merge layers "DOORS", "NOTES" into layer "WALLS".');
    await t.bus.script(['Y']);
    expect(t.log).toContain('Deleting layer "DOORS".');
    expect(t.log).toContain('2 layers deleted.');
    expect([t.layerOf('32'), t.layerOf('33'), t.layerOf('34')]).toEqual([WALLS, WALLS, WALLS]);
    expect(attributeLayers(t.geom(INSERT))).toEqual([`36:${WALLS}`, `37:${L0}`]);
    expect(frozen(t.geom(VIEWPORT))).toEqual([]);
    expect(t.model.tables.layers.has(DOORS) || t.model.tables.layers.has(NOTES)).toBe(false);
    await t.bus.script(['U']);
    expect([t.layerOf('32'), t.layerOf('33'), t.layerOf('34')]).toEqual([DOORS, NOTES, DOORS]);
  });

  it('refuses a target being merged or xref-dependent, and takes one by Name', async () => {
    const t = setup();
    await t.bus.script(['-LAYMRG']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['']);
    await t.bus.pick(t.on(DOORS));
    expect(t.log).toContain('Layer "DOORS" is being merged; select another layer.');
    await t.bus.script(['N', 'Site|Walls']);
    expect(t.log).toContain('Cannot merge into an xref-dependent layer.');
    await t.bus.script(['N', '0']);
    expect(t.log).toContain('You are about to merge layer "DOORS" into layer "0".');
    await t.bus.script(['Y']);
    expect(t.layerOf('32')).toBe(L0);
    expect(t.log).toContain('1 layer deleted.');
  });

  it('refuses the current layer as a layer to merge', async () => {
    const t = setup();
    await t.bus.script(['LAYMRG']);
    await t.bus.pick(t.on(WALLS));
    expect(t.log).toContain('Layer "WALLS" is the current layer and cannot be merged.');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Command:');
  });

  it('ends at Enter on the target, and changes nothing at No', async () => {
    const t = setup();
    await t.bus.script(['LAYMRG']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['', '']);
    expect(t.bus.promptText).toBe('Command:');
    await t.bus.script(['LAYMRG']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['']);
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['N']);
    expect(t.model.tables.layers.has(DOORS)).toBe(true);
    expect(t.bus.undo.state.undoable).toBe(0);
  });
});

describe('the layers LAYDEL and LAYMRG gather', () => {
  it('takes a layer once, says when none is left after Undo, and goes back at Enter on a name', async () => {
    const t = setup();
    await t.bus.script(['LAYDEL']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.pick({ x: 7, y: 20 });
    expect(t.log.filter((l) => l === 'Selected layers: DOORS')).toHaveLength(2);
    await t.bus.script(['U']);
    expect(t.log.at(-1)).toBe('No layers selected.');
    await t.bus.script(['N', '']);
    expect(t.bus.promptText).toBe('Select object on layer to delete or [Name]:');
  });

  it("refuses LAYDEL of a layer holding a layout's own view", async () => {
    const t = setup();
    const vp = t.model.entityByHandle(VIEWPORT)!;
    const sheet = new ChangeSetBuilder(t.model);
    sheet.updateEntity(vp.id, { layer: NOTES, geom: { ...vp.geom, id: 1 } as EntityGeometry });
    t.model.apply(sheet.build());
    await t.bus.script(['LAYDEL']);
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['', 'Y']);
    expect(t.log).toContain(
      'Layer "NOTES" holds a layout\'s paper-space view and cannot be deleted.',
    );
    expect(t.model.tables.layers.has(NOTES)).toBe(true);
  });

  // M6-02 part 18: the viewport goes, and so do the layer overrides naming it.
  it('LAYDEL of a layer holding a viewport with layer overrides drops the overrides with it', async () => {
    const t = setup();
    const vp = t.model.entityByHandle(VIEWPORT)!;
    const overrides = new ChangeSetBuilder(t.model);
    overrides.updateEntity(vp.id, { layer: NOTES });
    overrides.updateTableRecord('layers', DOORS, {
      viewportOverrides: [{ viewport: VIEWPORT, color: { kind: 'aci', index: 1 } }],
    });
    t.model.apply(overrides.build());
    await t.bus.script(['LAYDEL']);
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['', 'Y']);
    expect(t.log).toContain('Deleting layer "NOTES".');
    expect(t.has(VIEWPORT)).toBe(false);
    expect(t.model.tables.layers.has(NOTES)).toBe(false);
    expect(t.model.tables.layers.get(DOORS)!.viewportOverrides).toBeUndefined();
    await t.bus.script(['U']);
    expect(t.has(VIEWPORT)).toBe(true);
    expect(t.model.tables.layers.get(DOORS)!.viewportOverrides).toEqual([
      { viewport: VIEWPORT, color: { kind: 'aci', index: 1 } },
    ]);
  });

  it('LAYMRG of an overridden layer moves its objects; the target keeps its own overrides', async () => {
    const t = setup();
    const overrides = new ChangeSetBuilder(t.model);
    overrides.updateTableRecord('layers', DOORS, {
      viewportOverrides: [{ viewport: VIEWPORT, color: { kind: 'aci', index: 1 } }],
    });
    overrides.updateTableRecord('layers', WALLS, {
      viewportOverrides: [{ viewport: VIEWPORT, lineweight: 50 }],
    });
    t.model.apply(overrides.build());
    await t.bus.script(['LAYMRG']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['']);
    await t.bus.pick(t.on(WALLS));
    await t.bus.script(['Y']);
    expect(t.model.tables.layers.has(DOORS)).toBe(false);
    expect(t.layerOf('32')).toBe(WALLS);
    // AutoCAD 2024 Help, "LAYMRG": the objects "take on the properties of the target layer".
    expect(t.model.tables.layers.get(WALLS)!.viewportOverrides).toEqual([
      { viewport: VIEWPORT, lineweight: 50 },
    ]);
  });
});

describe('what LAYDEL and LAYMRG cannot take or leave', () => {
  const group = (handle: string, name: string, entities: string[]): Group => ({
    handle,
    type: 'GROUP',
    owner: 'C',
    name,
    description: '',
    selectable: true,
    entities,
  });

  it('refuses a layer holding objects Triya keeps without mapping', async () => {
    const t = setup({ passthroughLayers: [NOTES] });
    await t.bus.script(['LAYDEL']);
    await t.bus.pick(t.on(NOTES));
    expect(t.log).toContain(
      'Layer "NOTES" has objects Triya cannot edit yet and cannot be deleted.',
    );
    await t.bus.script(['', 'LAYMRG']);
    await t.bus.pick(t.on(NOTES));
    expect(t.log).toContain(
      'Layer "NOTES" has objects Triya cannot edit yet and cannot be merged.',
    );
    expect(mergeLayersChange(t.model, [NOTES], L0)).toBe(
      'Layer "NOTES" was not merged: it has objects Triya cannot edit yet.',
    );
  });

  it('removes a group LAYDEL leaves empty, and keeps one that keeps an object', async () => {
    const t = setup({
      groups: [group('3C', '*A1', ['32', '34']), group('3D', 'MIXED', ['32', '33'])],
    });
    await t.bus.script(['LAYDEL']);
    await t.bus.pick(t.on(DOORS));
    await t.bus.script(['', 'Y']);
    expect(t.model.objects.has('3C')).toBe(false);
    expect((t.model.objects.get('3D') as Group).entities).toEqual(['33']);
  });
});

// M5-06 part 3: Name opens AutoCAD's Delete Layers, Merge Layers and Merge to Layer dialogs
// (AutoCAD Help, "LAYDEL (Command)": "Name: Displays the Delete Layers dialog box"; "LAYMRG
// (Command)": the Merge Layers and Merge to Layer dialog boxes). The dash forms keep the names
// typed at the command line.
describe('the layer dialogs of LAYDEL and LAYMRG', () => {
  const dialogOf = (t: ReturnType<typeof setup>) => {
    const p = t.bus.prompt;
    return p?.kind === 'dialog' && p.dialog.type === 'layerlist' ? p.dialog : undefined;
  };
  const listed = (t: ReturnType<typeof setup>) => dialogOf(t)?.layers.map((l) => l.name);

  it("LAYDEL's Name lists the layers it can delete, and OK deletes the ones chosen", async () => {
    const t = setup();
    await t.bus.script(['LAYDEL', 'N']);
    expect(dialogOf(t)).toMatchObject({ title: 'Delete Layers', multiple: true });
    // Not 0, the current WALLS or the xref's Site|Walls.
    expect(listed(t)).toEqual(['DOORS', 'NOTES']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', layers: [DOORS, NOTES] });
    expect(t.log).toContain('You are about to delete layers "DOORS", "NOTES" from this drawing.');
    expect(t.bus.promptText).toBe('Do you wish to continue? [Yes/No] <No>:');
    await t.bus.script(['Y']);
    expect(t.model.tables.layers.has(DOORS) || t.model.tables.layers.has(NOTES)).toBe(false);
  });

  it('leaves a locked layer out of the Delete Layers list, as AutoCAD does', async () => {
    const t = setup();
    const b = new ChangeSetBuilder(t.model);
    b.updateTableRecord('layers', NOTES, { locked: true });
    t.model.apply(b.build());
    await t.bus.script(['LAYDEL', 'N']);
    expect(listed(t)).toEqual(['DOORS']);
  });

  it('goes back to the pick prompt at Cancel, keeping the layers already picked', async () => {
    const t = setup();
    await t.bus.script(['LAYDEL']);
    await t.bus.pick(t.on(NOTES));
    await t.bus.script(['N']);
    // NOTES is already chosen.
    expect(listed(t)).toEqual(['DOORS']);
    await t.bus.answer({ kind: 'escape' });
    expect(t.bus.promptText).toBe('Select object on layer to delete or [Name/Undo]:');
    await t.bus.script(['N']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', layers: [] });
    expect(t.bus.promptText).toBe('Select object on layer to delete or [Name/Undo]:');
    await t.bus.script(['', 'Y']);
    expect(t.model.tables.layers.has(NOTES)).toBe(false);
    expect(t.model.tables.layers.has(DOORS)).toBe(true);
  });

  it('refuses a layer the dialog was not offering', async () => {
    const t = setup();
    await t.bus.script(['LAYDEL', 'N']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', layers: [WALLS, DOORS] });
    expect(t.log).toContain('Layer "WALLS" is the current layer and cannot be deleted.');
    expect(t.log).toContain('You are about to delete layer "DOORS" from this drawing.');
  });

  it("LAYMRG's Name opens Merge Layers, and the target's Name opens Merge to Layer", async () => {
    const t = setup();
    await t.bus.script(['LAYMRG', 'N']);
    expect(dialogOf(t)).toMatchObject({ title: 'Merge Layers', multiple: true });
    expect(listed(t)).toEqual(['DOORS', 'NOTES']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', layers: [DOORS] });
    expect(t.bus.promptText).toBe('Select object on target layer or [Name]:');
    await t.bus.script(['N']);
    expect(dialogOf(t)).toMatchObject({ title: 'Merge to Layer', multiple: false });
    // Not DOORS (being merged) or the xref's layer.
    expect(listed(t)).toEqual(['0', 'NOTES', 'WALLS']);
    await t.bus.answer({ kind: 'escape' });
    expect(t.bus.promptText).toBe('Select object on target layer or [Name]:');
    await t.bus.script(['N']);
    await t.bus.answer({ kind: 'dialog', action: 'ok', layers: [NOTES] });
    expect(t.log).toContain('You are about to merge layer "DOORS" into layer "NOTES".');
    await t.bus.script(['Y']);
    expect(t.layerOf('32')).toBe(NOTES);
  });
});
