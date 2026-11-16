// M4-04's acceptance, "style round-trip tests", for STYLE's Text Style dialog on every readable
// public corpus file: New makes a TrueType style with every field of the dialog set (bold and
// italic, height, width factor, oblique angle, backwards, upside down) and an SHX style with a
// big font and vertical text; Apply changes the current style's font and effects; Set Current
// makes the new one current; Rename and Delete act on a spare style. The drawing is saved as
// AC1032 DXF (DEC-047), read back by acad-ts and mapped: every style comes back as the dialog
// showed it, the renamed one under its new name, the deleted one gone, TEXTSTYLE naming the new
// current style.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  textStyleSettings,
  type TextStyleAction,
  type TextStyleRequest,
  type TextStyleSettings,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

const TRUETYPE: TextStyleSettings = {
  font: 'arial.ttf',
  bigFont: '',
  bold: true,
  italic: true,
  height: 3.5,
  widthFactor: 0.75,
  obliqueAngle: 12.5,
  backwards: true,
  upsideDown: true,
  vertical: false,
};

const SHX: TextStyleSettings = {
  font: 'romans.shx',
  bigFont: 'bigfont.shx',
  bold: false,
  italic: false,
  height: 0,
  widthFactor: 1.25,
  obliqueAngle: -20,
  backwards: false,
  upsideDown: false,
  vertical: true,
};

/** Settings as the comparison sees them: reals to 12 figures, file names in any case. */
const comparable = (s: TextStyleSettings) => ({
  ...s,
  font: s.font.toLowerCase(),
  bigFont: s.bigFont.toLowerCase(),
  height: Number(s.height.toPrecision(12)),
  widthFactor: Number(s.widthFactor.toPrecision(12)),
  obliqueAngle: Number(s.obliqueAngle.toPrecision(10)),
});

const named = (model: DocumentModel, name: string) =>
  [...model.tables.textStyles.values()].find((s) => s.name.toUpperCase() === name.toUpperCase());

describe('Text Style dialog on the public corpus (M4-04)', () => {
  let saved = 0;
  let styleless = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s keeps every text style setting the dialog makes through a save',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = withPinnedClock(() =>
        DocumentModel.create(documentInit(readCadDocument(bytes))),
      );
      const bus = new PromptBus({ model, registry: builtinCommands() });
      await bus.submit('STYLE');
      const p = bus.prompt;
      if (p?.kind !== 'dialog' || p.dialog.type !== 'textstyle') throw new Error(f.path);
      const request = p.dialog as TextStyleRequest;
      const current = request.styles.find((s) => s.name === request.current);
      if (!current || current.xref) {
        styleless++;
        await bus.cancel();
        return;
      }
      const act = async (textstyle: TextStyleAction) => {
        await bus.answer({ kind: 'dialog', action: 'apply', textstyle });
        const next = bus.prompt;
        if (next?.kind !== 'dialog' || next.dialog.type !== 'textstyle') throw new Error(f.path);
        expect((next.dialog as TextStyleRequest).note, `${f.path} ${textstyle.op}`).toBeUndefined();
      };
      // A TrueType font with every effect, and an SHX font with a big font and vertical text.
      await act({ op: 'new', name: 'Triya M4-04 TTF', settings: TRUETYPE });
      await act({ op: 'new', name: 'Triya M4-04 SHX', settings: SHX });
      await act({ op: 'new', name: 'Triya M4-04 spare', settings: SHX });
      await act({ op: 'new', name: 'Triya M4-04 gone', settings: SHX });
      // The current style's font and effects (whatever it used, an SHX font with backwards).
      const changed: TextStyleSettings = {
        ...current.settings,
        font: 'simplex.shx',
        bigFont: '',
        bold: false,
        italic: false,
        backwards: !current.settings.backwards,
        widthFactor: 0.9,
        vertical: false,
      };
      await act({ op: 'apply', name: current.name, settings: changed });
      await act({ op: 'current', name: 'Triya M4-04 TTF' });
      await act({ op: 'rename', name: 'Triya M4-04 spare', to: 'Triya M4-04 renamed' });
      await act({ op: 'delete', name: 'Triya M4-04 gone' });
      await bus.answer({ kind: 'dialog', action: 'ok' });
      expect(bus.command, f.path).toBeUndefined();

      const out = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      saved++;
      const back = DocumentModel.create(documentInit(readCadDocument(out)));
      const settingsOf = (m: DocumentModel, name: string) => {
        const s = named(m, name);
        expect(s, `${f.path} ${name}`).toBeDefined();
        return comparable(textStyleSettings(s!));
      };
      expect(settingsOf(back, 'Triya M4-04 TTF'), f.path).toEqual(comparable(TRUETYPE));
      expect(settingsOf(back, 'Triya M4-04 SHX'), f.path).toEqual(comparable(SHX));
      expect(settingsOf(back, 'Triya M4-04 renamed'), f.path).toEqual(comparable(SHX));
      expect(settingsOf(back, current.name), f.path).toEqual(comparable(changed));
      expect(named(back, 'Triya M4-04 spare'), f.path).toBeUndefined();
      expect(named(back, 'Triya M4-04 gone'), f.path).toBeUndefined();
      expect(back.header.get('$TEXTSTYLE'), f.path).toBe('Triya M4-04 TTF');
    },
    30_000,
  );

  it('saved the styles on nearly every readable file', () => {
    expect(saved + styleless).toBe(readable.length);
    expect(saved).toBeGreaterThan(readable.length / 2);
  });
});
