// M5-08 part 1: linetypes loaded by LINETYPE's Linetype Manager, saved as AC1032 DXF and read
// back. On ezdxf's colors.dxf (ByBlock, ByLayer, Continuous; Standard text style) the bundled
// files' linetypes are loaded, a text one made current, one of them deleted again in a second
// LINETYPE and another reloaded; the save writes the new LTYPE records (text elements on the
// Standard STYLE, U= as DXF 74 bit 8) and $CELTYPE, and reads back as loaded. CI's ezdxf audit
// reads the save (audit.py `FIXTURE_SAVES`, kind `linetype`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  type DocumentModel,
  type LinetypeAnswer,
  type LinetypeDefinition,
  type PromptAnswer,
} from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { BUNDLED_LIN_FILES, parseLin } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';

const PATH = 'third-party/ezdxf/examples_dxf/colors.dxf';
const corpus = (path: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${path}`, import.meta.url))),
  );

const bundled: LinetypeDefinition[] = BUNDLED_LIN_FILES.flatMap(
  (f) => parseLin(f.source).linetypes,
);
const named = (m: DocumentModel, name: string) =>
  [...m.tables.linetypes.values()].find((l) => l.name.toUpperCase() === name.toUpperCase());

async function manager(bus: PromptBus, answer: LinetypeAnswer): Promise<void> {
  await bus.submit('LINETYPE');
  await bus.answer({ kind: 'dialog', action: 'ok', linetype: answer } as PromptAnswer);
  expect(bus.command).toBeUndefined();
}

describe('linetypes loaded and saved (M5-08)', () => {
  it('writes loaded, reloaded and deleted linetypes and CELTYPE, which read back', async () => {
    const model = new EngineSession(openDocument(readCadDocument(corpus(PATH))).init).model;
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: false, message: '' }) },
    });
    await manager(bus, { load: bundled, current: 'TRIYA_GAS', ltscale: 2 });
    // 14 ISO, 3 utility and (part 2) 12 drafting linetypes: the drafting files' inch and
    // millimetre twins share their names, so the second of each loads no more.
    expect(model.tables.linetypes.size).toBe(3 + 17 + 12);
    const iso10 = named(model, 'TRIYA_ISO10')!;
    await manager(bus, {
      delete: [named(model, 'TRIYA_ISO15')!.handle],
      load: [{ ...bundled.find((l) => l.name === 'TRIYA_ISO02')!, name: 'TRIYA_ISO10' }],
    });
    expect(named(model, 'TRIYA_ISO15')).toBeUndefined();
    expect(named(model, 'TRIYA_ISO10')!.handle).toBe(iso10.handle);

    const out = saveAc1032Dxf(readCadDocument(corpus(PATH)), model);
    writeAuditSave(PATH, 'linetype', () => out);
    const back = new EngineSession(openDocument(readCadDocument(out)).init).model;

    expect(back.header.get('$CELTYPE')).toBe('TRIYA_GAS');
    expect(back.header.get('$LTSCALE')).toBe(2);
    expect(named(back, 'TRIYA_ISO15')).toBeUndefined();
    const standard = [...back.tables.textStyles.values()].find((s) => s.name === 'Standard')!;
    for (const l of model.tables.linetypes.values()) {
      const b = named(back, l.name);
      expect(b, l.name).toBeDefined();
      expect(b!.handle).toBe(l.handle);
      expect(b!.description).toBe(l.description);
      expect(b!.patternLength).toBeCloseTo(l.patternLength, 9);
      expect(b!.elements.map((e) => e.length)).toEqual(l.elements.map((e) => e.length));
    }
    const gas = named(back, 'TRIYA_GAS')!;
    expect(gas.elements[1]).toMatchObject({
      shapeFlags: 2 | 8,
      style: standard.handle,
      text: 'GAS',
      scale: 2.5,
      offset: { x: 0, y: -1.25 },
    });
    expect(named(back, 'TRIYA_ISO10')!.description).toBe('ISO 02 dashed');
  });
});
