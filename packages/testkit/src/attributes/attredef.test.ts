// M5-03 part 3: ATTREDEF on the title-block test drawing (fixture.ts), saved as AC1032 DXF and
// read back: TITLE-BLOCK redefined from a line, a new TITLE definition and a new CHECKED one
// drawn in model space. The block holds them (new handles, above the file's $HANDSEED), the
// objects are gone from model space, and the reference keeps TITLE's value (and its ATTRIB)
// while CHECKED comes in at its default and the definitions taken out leave it. CI's ezdxf
// audit reads the save (audit.py `FIXTURE_SAVES`, kind `attredef`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  EngineSession,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  type AttdefGeometry,
  type DocumentModel,
  type EntityGeometry,
  type InsertGeometry,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { TITLE_BLOCK, TITLE_BLOCK_DXF } from './fixture';

/** Where the audit gate finds the save (scripts/dxf-audit/audit.py `FIXTURE_SAVES`). */
const AUDIT_PATH = `fixtures/attributes/${TITLE_BLOCK_DXF}`;

const bytes = () =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../fixtures/attributes/${TITLE_BLOCK_DXF}`, import.meta.url)),
    ),
  );

const blockOf = (model: DocumentModel) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === TITLE_BLOCK)!.handle;

const reference = (model: DocumentModel) =>
  model
    .blockEntities(modelSpaceOf(model))
    .map((id) => model.entity(id)!.geom)
    .find((g): g is InsertGeometry => g.kind === 'INSERT')!;

const attdef = (style: string, tag: string, value: string, x: number, y: number): EntityGeometry =>
  ({
    kind: 'ATTDEF',
    tag,
    prompt: tag,
    value,
    flags: 0,
    style,
    position: { x, y },
    height: 4,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 0,
    valign: 0,
    backward: false,
    upsideDown: false,
  }) as AttdefGeometry;

const handseed = (model: DocumentModel) => parseInt(String(model.header.get('$HANDSEED')), 16);

describe('ATTREDEF saves (M5-03 part 3)', () => {
  it('writes the block redefined and the reference given its attributes', async () => {
    const model = new EngineSession(openDocument(readCadDocument(bytes())).init).model;
    const seed = handseed(model);
    const before = model.blockEntities(modelSpaceOf(model)).map((id) => model.entity(id)!.handle);
    const was = reference(model).attributes.find((a) => a.tag === 'TITLE')!;
    // The new definition's objects, drawn in model space.
    const space = modelSpaceOf(model);
    const layer = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
    const style = [...model.tables.textStyles.values()][0]!.handle;
    const b = new ChangeSetBuilder(model);
    const ids = [
      { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 180, y: 0 } } as EntityGeometry,
      attdef(style, 'TITLE', 'UNTITLED', 5, 30),
      attdef(style, 'CHECKED', 'XX', 5, 5),
    ].map((geom) => b.addEntity({ owner: space, layer, geom }).id);
    model.apply(b.build());

    const log: string[] = [];
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: false, message: '' }) },
    });
    bus.on((e) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bus.script(['ATTREDEF', TITLE_BLOCK]);
    await bus.answer({ kind: 'selection', ids });
    await bus.submit('0,0');
    expect(bus.command).toBeUndefined();
    expect(log.filter((l) => l.startsWith('; error'))).toEqual([]);

    const out = saveAc1032Dxf(readCadDocument(bytes()), model);
    writeAuditSave(AUDIT_PATH, 'attredef', () => out);
    const back = new EngineSession(openDocument(readCadDocument(out)).init).model;
    const block = blockOf(back);
    const contents = back.blockEntities(block).map((id) => back.entity(id)!);
    expect(
      contents.map((e) =>
        e.geom.kind === 'ATTDEF' ? (e.geom as AttdefGeometry).tag : e.geom.kind,
      ),
    ).toEqual(['LINE', 'TITLE', 'CHECKED']);
    // New objects get handles above the file's $HANDSEED; none renumbered.
    for (const e of contents) expect(parseInt(e.handle, 16)).toBeGreaterThanOrEqual(seed);
    // The objects left model space: it holds what the file had.
    expect(back.blockEntities(modelSpaceOf(back)).map((id) => back.entity(id)!.handle)).toEqual(
      before,
    );
    const ref = reference(back);
    expect(ref.attributes.map((a) => [a.tag, a.value])).toEqual([
      ['TITLE', was.value],
      ['CHECKED', 'XX'],
    ]);
    expect(ref.attributes[0]!.handle).toBe(was.handle);
    expect(ref.attributes[0]!.height).toBeCloseTo(4, 9);
  });
});
