// M6-01 part 1: LAYOUT New, Rename and Delete saved. Triya's metric drawing without a template
// (Layout1, the current one, and Layout2) is edited at the command line, saved and read again:
// the layouts read back as the engine has them, the layout made current in place of a deleted one
// on *Paper_Space, and the only layout deleted comes back as an empty Layout1.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  type DocumentInit,
  type Layout,
} from '@triya/engine';
import { documentInit, exportDocument, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { withPinnedClock } from '../roundtrip/clock.ts';

const file = fileURLToPath(
  new URL('../../../../assets/templates/no-template-metric.dxf', import.meta.url),
);
const bytes = new Uint8Array(readFileSync(file));

// The template states some limits as -0.0, which read back as 0: JSON makes the two one.
const comparable = ({ raw: _raw, ...rest }: Layout): unknown => JSON.parse(JSON.stringify(rest));

/** The drawing after `script` at the command line, and as its save reads back. */
async function savedAfter(script: string[]): Promise<{ model: DocumentModel; back: DocumentInit }> {
  const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  await bus.script(script);
  expect(bus.command).toBeUndefined();
  const saved = withPinnedClock(() =>
    exportDocument(readCadDocument(bytes), model, { format: 'dxf', binary: false }),
  );
  return { model, back: documentInit(readCadDocument(saved)) };
}

const sheetName = (init: DocumentInit, l: Layout) =>
  init.tables!.blockRecords!.find((r) => r.handle === l.blockRecord)?.name;

describe('LAYOUT saved', () => {
  it('a new layout, a rename and the current layout deleted read back as the engine has them', async () => {
    const { model, back } = await savedAfter([
      'LAYOUT',
      'N',
      '',
      'LAYOUT',
      'R',
      'Layout2',
      'Detail A',
      'LAYOUT',
      'D',
      'Layout1',
    ]);
    expect(model.layouts.map((l) => l.name)).toEqual(['Model', 'Detail A', 'Layout3']);
    expect(back.layouts!.map(comparable)).toEqual(model.layouts.map(comparable));
    const detail = back.layouts!.find((l) => l.name === 'Detail A')!;
    expect(sheetName(back, detail)).toBe('*Paper_Space');
    const made = back.layouts!.find((l) => l.name === 'Layout3')!;
    expect(made.plot).toMatchObject({
      paperSize: 'ISO_full_bleed_A4_(297.00_x_210.00_MM)',
      paperUnits: 'millimeters',
    });
  });

  it('the only layout deleted saves as an empty Layout1', async () => {
    const { model, back } = await savedAfter([
      'LAYOUT',
      'R',
      'Layout1',
      'Plan',
      'LAYOUT',
      'D',
      'Layout2',
      'LAYOUT',
      'D',
      'Plan',
    ]);
    expect(model.layouts.map((l) => l.name)).toEqual(['Model', 'Layout1']);
    expect(back.layouts!.map(comparable)).toEqual(model.layouts.map(comparable));
    const sheet = back.layouts!.find((l) => l.name === 'Layout1')!;
    expect(back.entities!.filter((e) => e.owner === sheet.blockRecord)).toEqual([]);
  });
});
