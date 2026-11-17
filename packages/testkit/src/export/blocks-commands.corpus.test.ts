// Blocks made and inserted at the command line save as DXF and read back (M5-01 part 1). On every
// readable public corpus file, -BLOCK makes a block of some of model space's curves (erasing
// them), -INSERT places it scaled and turned, and `*NAME` inserts it exploded; the drawing saves
// as AC1032 DXF (DEC-047), its saves audited by ezdxf as kind `block`, and reopens with the block,
// its reference and the exploded copies as made. A drawing authored here (DEC-047) checks a
// block with attribute definitions: the values -INSERT asks for save as the reference's ATTRIBs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ACadVersion,
  AttributeDefinition,
  AttributeEntity,
  CadDocument,
  Insert,
  Line,
  XYZ,
} from '@node-projects/acad-ts';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type Entity,
  type InsertGeometry,
} from '@triya/engine';
import { documentInit, readCadDocument, writeCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** The block each drawing gets. */
const NAME = 'M5-01 PART';
/** The objects of model space put in it, at most. */
const TAKEN = 5;
/** Readable files with nothing in model space on an unlocked layer but group members. */
const EMPTY = 17;

const open = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

const modelSpace = (model: DocumentModel) =>
  model.layouts.find((l) => l.name === 'Model')?.blockRecord ??
  [...model.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE')?.handle;

const blockNamed = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name);

const r9 = (v: number) => Number(v.toPrecision(9)) + 0;

describe('-BLOCK and -INSERT on the public corpus (M5-01)', () => {
  let made = 0;
  const skipped: string[] = [];

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves a block made of its curves, a reference and an exploded insert',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = open(bytes);
      const space = modelSpace(model);
      const locked = new Set(
        [...model.tables.layers.values()].filter((l) => l.locked).map((l) => l.handle),
      );
      // Not a group's members: erased, they would leave the group empty, which AutoCAD keeps
      // (PURGE's Groups category removes it, M5-09) and ezdxf's audit deletes.
      const grouped = new Set(
        [...model.objects.values()].flatMap((o) =>
          o.type === 'GROUP' ? (o as { entities: readonly string[] }).entities : [],
        ),
      );
      const curves =
        space === undefined
          ? []
          : model
              .blockEntities(space)
              .map((id) => model.entity(id)!)
              .filter((e) => !locked.has(e.layer) && !grouped.has(e.handle))
              .slice(0, TAKEN);
      if (curves.length === 0) {
        skipped.push(f.path);
        writeAuditSave(f.path, 'block', () =>
          withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), open(bytes))),
        );
        return;
      }
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: { request: () => Promise.resolve({ ok: false, message: 'no view' }) },
        space: () => space!,
      });
      await bus.script(['-BLOCK', NAME, '0,0']);
      await bus.answer({ kind: 'selection', ids: curves.map((e) => e.id) });
      expect(bus.promptText, f.path).toBe('Command:');
      const record = blockNamed(model, NAME);
      expect(record, f.path).toBeDefined();
      await bus.script(['-INSERT', NAME, '1000,1000', '2', '', '30']);
      const before = new Set(model.blockEntities(space!));
      await bus.script(['-INSERT', `*${NAME}`, '-1000,0', '', '0']);
      const exploded = model.blockEntities(space!).filter((id) => !before.has(id));
      expect(exploded, f.path).toHaveLength(curves.length);
      const ref = model
        .blockEntities(space!)
        .map((id) => model.entity(id)!)
        .find((e) => e.geom.kind === 'INSERT' && e.geom.block === record!.handle)!;

      const save = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      writeAuditSave(f.path, 'block', () => save);
      const back = open(save);
      const r = blockNamed(back, NAME);
      expect(r, f.path).toBeDefined();
      const contents = back.blockEntities(r!.handle).map((id) => back.entity(id)!.geom.kind);
      expect(contents, f.path).toEqual(curves.map((e) => e.geom.kind));
      for (const e of curves) expect(back.entityByHandle(e.handle), f.path).toBeUndefined();
      const saved = back.entityByHandle(ref.handle) as Entity & { geom: InsertGeometry };
      expect(saved.geom.block, f.path).toBe(r!.handle);
      expect([saved.geom.position.x, saved.geom.position.y].map(r9), f.path).toEqual([1000, 1000]);
      expect(r9(saved.geom.scale.x), f.path).toBe(r9((ref.geom as InsertGeometry).scale.x));
      expect((ref.geom as InsertGeometry).scale.x, f.path).toBe(2);
      // 30° typed, counter-clockwise or (ANGDIR 1) clockwise.
      expect(Math.abs(r9((ref.geom as InsertGeometry).rotation)), f.path).toBe(r9(Math.PI / 6));
      expect(r9(saved.geom.rotation), f.path).toBe(r9((ref.geom as InsertGeometry).rotation));
      for (const id of exploded) {
        const h = model.entity(id)!.handle;
        expect(back.entityByHandle(h)?.geom.kind, f.path).toBe(model.entity(id)!.geom.kind);
      }
      made++;
    },
  );

  it('made a block on every readable file with objects in model space', () => {
    expect(made + skipped.length).toBe(readable.length);
    expect(skipped).toHaveLength(EMPTY);
  });
});

/** A title block authored as AutoCAD saves one: a line and two attribute definitions. */
function authored(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.entities!.add(new Line(new XYZ(0, 0, 0), new XYZ(40, 0, 0)));
  const defs: [string, string, string, number][] = [
    ['NO', 'Drawing number', 'A-1', 2],
    ['REV', 'Revision', '0', 20],
  ];
  for (const [tag, prompt, value, x] of defs) {
    const a = new AttributeDefinition();
    a.tag = tag;
    a.prompt = prompt;
    a.value = value;
    a.height = 2.5;
    a.insertPoint = new XYZ(x, 2, 0);
    doc.entities!.add(a);
  }
  return writeCadDocument(doc, { format: 'dxf' });
}

describe('-INSERT of a block with attribute definitions saves its attributes (M5-01)', () => {
  it('saves each value asked for as an ATTRIB of the reference, placed with it', async () => {
    const bytes = authored();
    const model = open(bytes);
    const space = modelSpace(model)!;
    const bus = new PromptBus({ model, registry: builtinCommands(), space: () => space });
    await bus.script(['-BLOCK', 'TITLE', '0,0']);
    await bus.answer({ kind: 'selection', ids: model.blockEntities(space) });
    await bus.script(['-INSERT', 'TITLE', '100,50', '2', '', '0', 'M-101', '']);
    expect(bus.promptText).toBe('Command:');

    const save = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
    const doc = readCadDocument(save);
    const insert = [...doc.getCadObjects()].find((o): o is Insert => o instanceof Insert)!;
    expect(insert.block.name).toBe('TITLE');
    const attributes = [...insert.attributes] as AttributeEntity[];
    expect(attributes.map((a) => [a.tag, a.value])).toEqual([
      ['NO', 'M-101'],
      ['REV', '0'],
    ]);
    expect([attributes[0]!.insertPoint.x, attributes[0]!.insertPoint.y]).toEqual([104, 54]);
    expect(attributes[0]!.height).toBe(5);
    const defs = [...insert.block.entities].filter((e) => e instanceof AttributeDefinition);
    expect(defs).toHaveLength(2);

    const back = open(save);
    const ref = [...back.entities()].find((e) => e.geom.kind === 'INSERT')!;
    expect((ref.geom as InsertGeometry).attributes.map((a) => a.value)).toEqual(['M-101', '0']);
  });
});
