// M5-04 part 7: XBIND on the thread-authored xref set (M1-21), and the DXF it saves: the bound
// copies are the drawing's own records and blocks, read back without the xref files, and CI's
// ezdxf audit reads the save (`fixtures__xref__xref-parent.dxf.xbind.dxf`, audit.py
// `FIXTURE_SAVES`), and the save of a bound block holding an image and an underlay (part 16,
// `…xbind-pictures.dxf`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DocumentInit,
  type DocumentModel,
  type NonGraphicalObject,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { VISRETAIN_LAYER, XREF_CHILD, XREF_GRANDCHILD, XREF_PARENT } from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/xref/', import.meta.url));
const bytesOf = (name: string) => new Uint8Array(readFileSync(DIR + name));
const initOf = (name: string): DocumentInit => openDocument(readCadDocument(bytesOf(name))).init;

/** Where the audit gate finds the save (scripts/dxf-audit/audit.py `FIXTURE_SAVES`). */
const AUDIT_PATH = 'fixtures/xref/xref-parent.dxf';

const recordNamed = (model: DocumentModel, name: string) =>
  [...model.tables.blockRecords.values()].find((r) => r.name === name);
const layerNamed = (model: DocumentModel, name: string) =>
  [...model.tables.layers.values()].find((l) => l.name === name);

function load(session: EngineSession, name: string, file: string): void {
  const r = session.edit({
    kind: 'xref-load',
    block: recordNamed(session.model, name)!.handle,
    drawing: initOf(file),
  });
  expect(r).toMatchObject({ ok: true });
}

/** The parent with its xrefs loaded, and a bus on its session, as the app runs commands. */
function loadedParent() {
  const session = new EngineSession(initOf(XREF_PARENT));
  load(session, 'xref-child-tb', XREF_CHILD);
  load(session, 'xref-child-ovl', XREF_CHILD);
  load(session, 'xref-grandchild', XREF_GRANDCHILD);
  const log: string[] = [];
  const bus = new PromptBus({ model: session.model, registry: builtinCommands() });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  return { session, model: session.model, bus, log };
}

const save = (model: DocumentModel): Uint8Array =>
  saveAc1032Dxf(readCadDocument(bytesOf(XREF_PARENT)), model);
const reopened = (bytes: Uint8Array): DocumentModel =>
  new EngineSession(openDocument(readCadDocument(bytes)).init).model;

describe('XBIND on the xref set (M5-04 part 7)', () => {
  it("binds the child's block, a layer the drawing retains and the grandchild's layer; the save keeps them", async () => {
    const t = loadedParent();
    await t.bus.script(['-XBIND', 'B', 'xref-child-tb|LOGO']);
    await t.bus.script(['-XBIND', 'LA', `${VISRETAIN_LAYER},xref-grandchild|GC`]);
    expect(t.log).toEqual(
      expect.arrayContaining([
        'Block "xref-child-tb|LOGO" bound as "xref-child-tb$0$LOGO".',
        `Layer "${VISRETAIN_LAYER}" bound as "xref-child-tb$0$TB-LINES".`,
        'Layer "xref-grandchild|GC" bound as "xref-grandchild$0$GC".',
      ]),
    );
    const logo = recordNamed(t.model, 'xref-child-tb$0$LOGO')!;
    const drawn = t.model.blockEntities(logo.handle).length;
    expect(drawn).toBe(
      t.model.blockEntities(recordNamed(t.model, 'xref-child-tb|LOGO')!.handle).length,
    );
    // The retained layer's copy keeps the drawing's colour for it (red, VISRETAIN).
    expect(layerNamed(t.model, 'xref-child-tb$0$TB-LINES')?.color).toEqual({
      kind: 'aci',
      index: 1,
    });

    const out = save(t.model);
    writeAuditSave(AUDIT_PATH, 'xbind', () => out);
    const back = reopened(out);
    // The xrefs wait for their files again; the bound copies are the drawing's.
    const backLogo = recordNamed(back, 'xref-child-tb$0$LOGO')!;
    expect(back.blocks.get(backLogo.handle)?.xrefPath).toBeUndefined();
    expect((backLogo.flags ?? 0) & (4 | 8 | 16 | 32)).toBe(0);
    expect(back.blockEntities(backLogo.handle)).toHaveLength(drawn);
    for (const n of ['xref-child-tb$0$TB-LINES', 'xref-grandchild$0$GC']) {
      expect((layerNamed(back, n)?.flags ?? 0) & (16 | 32), n).toBe(0);
    }
    expect(layerNamed(back, 'xref-child-tb$0$TB-LINES')?.color).toEqual({ kind: 'aci', index: 1 });
    expect(layerNamed(back, 'xref-grandchild$0$GC')?.color).toEqual({ kind: 'aci', index: 6 });
    // The drawing's retained record is still the xref's.
    expect(layerNamed(back, VISRETAIN_LAYER)).toBeDefined();
    expect(recordNamed(back, 'xref-child-tb|LOGO')).toBeUndefined();
  });

  it("binds a block holding an image and a PDF underlay; the save files their definitions as the drawing's (part 16)", async () => {
    // The child as a drafter may leave it: its stamp drawn in LOGO, with an underlay of a sheet.
    const child = initOf(XREF_CHILD);
    const logo = (child.tables?.blockRecords ?? []).find((r) => r.name === 'LOGO')!.handle;
    const entities = (child.entities ?? []).map((e) =>
      e.geom.kind === 'IMAGE' ? { ...e, owner: logo } : e,
    );
    const stamp = entities.find((e) => e.geom.kind === 'IMAGE')!;
    const objects = [
      ...(child.objects ?? []),
      {
        type: 'PDFDEFINITION',
        handle: 'FF04',
        owner: 'FF05',
        name: 'sheet',
        fileName: '.\\sheet.pdf',
        page: '1',
      },
    ] as NonGraphicalObject[];
    const underlay = {
      ...stamp,
      handle: 'FF06',
      type: 'PDFUNDERLAY',
      geom: {
        kind: 'PDFUNDERLAY',
        definition: 'FF04',
        position: { x: -10, y: -10 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        flags: 2,
        contrast: 100,
        fade: 0,
        clip: [],
      },
    } as unknown as (typeof entities)[number];
    const drafted: DocumentInit = {
      ...child,
      handSeed: 'FF10',
      objects,
      entities: [...entities, underlay],
    };
    const session = new EngineSession(initOf(XREF_PARENT));
    for (const [name, drawing] of [
      ['xref-child-tb', drafted],
      ['xref-child-ovl', initOf(XREF_CHILD)],
      ['xref-grandchild', initOf(XREF_GRANDCHILD)],
    ] as const) {
      expect(
        session.edit({
          kind: 'xref-load',
          block: recordNamed(session.model, name)!.handle,
          drawing,
        }),
      ).toMatchObject({ ok: true });
    }
    const log: string[] = [];
    const bus = new PromptBus({ model: session.model, registry: builtinCommands() });
    bus.on((e: BusEvent) => {
      if (e.type === 'log') log.push(e.line);
    });
    await bus.script(['-XBIND', 'B', 'xref-child-tb|LOGO']);
    expect(log).toContain('Block "xref-child-tb|LOGO" bound as "xref-child-tb$0$LOGO".');
    const model = session.model;
    const pictures = (m: DocumentModel) => {
      const block = recordNamed(m, 'xref-child-tb$0$LOGO')!.handle;
      const out = new Map<string, { name: string; fileName: string }>();
      for (const id of m.blockEntities(block)) {
        const g = m.entity(id)!.geom;
        if (g.kind !== 'IMAGE' && g.kind !== 'PDFUNDERLAY') continue;
        out.set(g.kind, m.objects.get(g.definition!) as unknown as never);
      }
      return [...out]
        .map(([kind, d]) => [kind, d.name, d.fileName])
        .sort((a, b) => a[0]!.localeCompare(b[0]!));
    };
    const drawn = [
      ['IMAGE', 'xref-stamp', '.\\xref-stamp.png'],
      ['PDFUNDERLAY', 'sheet', '.\\sheet.pdf'],
    ];
    expect(pictures(model)).toEqual(drawn);

    const out = save(model);
    writeAuditSave(AUDIT_PATH, 'xbind-pictures', () => out);
    const back = reopened(out);
    // Without the xref files the bound block still shows both, by the drawing's own definitions.
    expect(pictures(back)).toEqual(drawn);
    const of = (type: string) =>
      [...back.objects.values()]
        .filter((o) => o.type === type)
        .map((d) => (d as unknown as { name: string }).name);
    expect(of('IMAGEDEF')).toEqual(['xref-stamp']);
    expect(of('PDFDEFINITION')).toEqual(['sheet']);
  });

  it('is one undo step: U takes the bound copies back', async () => {
    const t = loadedParent();
    const layers = t.model.tables.layers.size;
    await t.bus.script(['-XBIND', 'LA', 'xref-child-tb|*']);
    expect(t.model.tables.layers.size).toBeGreaterThan(layers);
    expect(t.bus.undo.state.nextUndo).toBe('XBIND');
    await t.bus.script(['U']);
    expect(t.model.tables.layers.size).toBe(layers);
  });
});
