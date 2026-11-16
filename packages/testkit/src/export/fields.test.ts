// M4-10 part 1: UPDATEFIELD's new values save as AC1032 DXF and read back. uncommon.dxf's Date
// fields (on an attribute definition and an attribute) and mtext_complex_inline_codes.dxf's
// Filename fields are evaluated on a pinned clock and file name; the saved drawing reopens with
// each text, each FIELD's shown value and the date FIELD's own time as updated, and with every
// other FIELD group as read.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type DrawingField,
  type InsertGeometry,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/public/', import.meta.url));
const NOW = new Date(2026, 10, 16, 9, 30, 0);

const bytesOf = (path: string) => new Uint8Array(readFileSync(`${corpusDir}${path}`));
const modelOf = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

/** Each text with fields: handle → [shown text, field values, a date's time]. */
function fields(model: DocumentModel): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const row = (text: string, f: DrawingField) => [
    text,
    f.children.map((c) => c.value),
    f.children.map((c) => c.time ?? null),
  ];
  for (const e of model.entities()) {
    const g = e.geom;
    if ((g.kind === 'TEXT' || g.kind === 'ATTDEF') && g.field)
      out[e.handle] = row(g.value, g.field);
    if (g.kind === 'MTEXT' && g.field) out[e.handle] = row(g.contents, g.field);
    if (g.kind === 'INSERT') {
      for (const a of (g as InsertGeometry).attributes) {
        if (a.field) out[a.handle] = row(a.value, a.field);
      }
    }
  }
  return out;
}

async function updateAll(model: DocumentModel, fileName: string): Promise<string[]> {
  const view: ViewHost = {
    request: (r): Promise<ViewReply> =>
      Promise.resolve(
        r.op === 'sysvar' && r.name === 'DWGNAME' ? { ok: true, value: fileName } : { ok: true },
      ),
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view,
    clock: { now: () => NOW },
  });
  const log: string[] = [];
  bus.on((e) => {
    if (e.type === 'log') log.push(e.line);
  });
  await bus.submit('UPDATEFIELD');
  await bus.answer({ kind: 'selection', ids: [...model.entities()].map((e) => e.id) });
  expect(bus.command).toBeUndefined();
  return log;
}

describe('UPDATEFIELD saves as DXF and reads back', () => {
  it("writes uncommon.dxf's new dates onto its FIELDs", async () => {
    const bytes = bytesOf('third-party/ezdxf/examples_dxf/uncommon.dxf');
    const model = modelOf(bytes);
    expect(Object.values(fields(model)).map((r) => (r as unknown[])[0])).toEqual([
      '21/04/2020',
      '21/04/2020',
    ]);
    const log = await updateAll(model, 'uncommon.dxf');
    expect(log).toContain('2 field(s) found.');
    expect(log).toContain('2 field(s) updated.');
    const after = fields(model);
    expect(Object.values(after)).toEqual([
      ['16/11/2026', ['16/11/2026'], [NOW.getTime()]],
      ['16/11/2026', ['16/11/2026'], [NOW.getTime()]],
    ]);
    const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
    expect(fields(modelOf(saved))).toEqual(after);
    // The FIELD keeps its code, flags and format; its value string, shown text and date change.
    const text = new TextDecoder().decode(saved);
    expect(text).toContain('\\AcVar Date \\f "dd/MM/yyyy"');
    expect(text).toMatch(/302\r?\n16\/11\/2026\r?\n/);
    expect(text).toMatch(/301\r?\n16\/11\/2026\r?\n/);
    expect(text).not.toContain('21/04/2020');
  });

  it("writes mtext_complex_inline_codes.dxf's file name onto its MTEXTs and FIELDs", async () => {
    const bytes = bytesOf('third-party/ezdxf/examples_dxf/mtext_complex_inline_codes.dxf');
    const model = modelOf(bytes);
    await updateAll(model, 'Renamed.dxf');
    const after = fields(model);
    expect(Object.keys(after).length).toBeGreaterThan(0);
    for (const [handle, r] of Object.entries(after)) {
      const [contents, values] = r as [string, string[]];
      expect(values, handle).toEqual(['Renamed.dxf']);
      expect(contents, handle).toContain('Filename: Renamed.dxf\\P');
    }
    const saved = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
    const reopened = modelOf(saved);
    expect(fields(reopened)).toEqual(after);
    // The root FIELD, which holds the whole text as shown, takes the new text too.
    for (const e of reopened.entities()) {
      if (e.geom.kind === 'MTEXT' && e.geom.field) {
        expect(e.geom.field.value).toBe(e.geom.contents);
      }
    }
  });
});
