// M4-04's acceptance, "style round-trip tests", for MLEADERSTYLE's Multileader Style Manager on
// every readable public corpus file (part 2): New makes a block style with every field of the
// Leader Format, Leader Structure and Content tabs set (a spline leader with AutoCAD's Dot
// arrowhead and the built-in `_TagBox` block, both added to the drawing), and a text style with
// vertical attachment, three leader points and scaled to its layout; Modify changes the current style's leader, text
// and landing; Set Current makes the text style current where the drawing keeps CMLEADERSTYLE;
// Rename and Delete act on spare styles. A drawing without multileader styles (one from before
// R2007) gets AutoCAD's Standard with the first new style. The drawing is saved as AC1032 DXF
// (DEC-047), read back by acad-ts and mapped: every style comes back as the manager showed it
// (records compared by name), the renamed one under its new name, the deleted one gone.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  mleaderStyleSettings,
  type MLeaderStyleAction,
  type MLeaderStyleRecord,
  type MLeaderStyleRequest,
  type MLeaderStyleSettings,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** A canvas that measures text as 0.6 of its height per character. */
const canvas: ViewHost = {
  request: (r): Promise<ViewReply> => {
    if (r.op === 'textWidths') {
      return Promise.resolve({
        ok: true,
        widths: r.texts.map((t) => t.contents.length * t.height * 0.6),
      });
    }
    return Promise.resolve({ ok: false, message: 'no view' });
  },
};

/** Settings with record handles read as the names they point at, so files compare. */
function comparable(model: DocumentModel, s: MLeaderStyleSettings) {
  const block = (h: string) => model.blocks.get(h)?.name.toUpperCase() ?? h;
  return {
    ...s,
    linetype: model.tables.linetypes.get(s.linetype)?.name.toUpperCase() ?? s.linetype,
    textStyle: model.tables.textStyles.get(s.textStyle)?.name.toUpperCase() ?? s.textStyle,
    arrowhead: block(s.arrowhead),
    block: block(s.block),
    arrowheadSize: Number(s.arrowheadSize.toPrecision(12)),
    firstAngle: Number(s.firstAngle.toPrecision(10)),
    secondAngle: Number(s.secondAngle.toPrecision(10)),
  };
}

const named = (model: DocumentModel, name: string): MLeaderStyleRecord | undefined =>
  [...model.tables.mleaderStyles.values()].find((s) => s.name.toUpperCase() === name.toUpperCase());

describe('Multileader Style Manager on the public corpus (M4-04 part 2)', () => {
  let saved = 0;
  let styleless = 0;
  let current = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s keeps every multileader style setting the manager makes through a save',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = withPinnedClock(() =>
        DocumentModel.create(documentInit(readCadDocument(bytes))),
      );
      const bus = new PromptBus({ model, registry: builtinCommands(), view: canvas });
      await bus.submit('MLEADERSTYLE');
      const p = bus.prompt;
      if (p?.kind !== 'dialog' || p.dialog.type !== 'mleaderstyle') throw new Error(f.path);
      const request = p.dialog as MLeaderStyleRequest;
      const shown = request.styles.find((s) => s.name === request.current);
      // An R1 or R2.5 drawing has no text style, which a multileader style needs.
      if (!shown) {
        styleless++;
        await bus.cancel();
        return;
      }
      const lists = request.lists;
      const textStyle = lists.textStyles.at(-1)!.value;
      const linetype = lists.linetypes.at(-1)!.value;
      const act = async (mleaderstyle: MLeaderStyleAction) => {
        await bus.answer({ kind: 'dialog', action: 'apply', mleaderstyle });
        const next = bus.prompt;
        if (next?.kind !== 'dialog' || next.dialog.type !== 'mleaderstyle') throw new Error(f.path);
        return next.dialog as MLeaderStyleRequest;
      };
      const blocks: MLeaderStyleSettings = {
        ...shown.settings,
        leaderType: '2',
        lineColor: 'aci:1',
        linetype,
        lineweight: '35',
        arrowhead: '_DOT',
        arrowheadSize: 0.125,
        breakSize: 1.5,
        maxPoints: 4,
        firstAngleOn: true,
        firstAngle: 45,
        secondAngleOn: true,
        secondAngle: 90,
        landing: false,
        landingDistance: 5,
        scaleToLayout: false,
        scale: 2,
        contentType: '1',
        block: '_TagBox',
        blockConnection: '1',
        blockColor: 'rgb:10,20,30',
        blockScale: 1.5,
        textStyle,
        textHeight: 2.5,
      };
      const texts: MLeaderStyleSettings = {
        ...shown.settings,
        leaderType: '0',
        maxPoints: 3,
        scaleToLayout: true,
        contentType: '2',
        defaultText: 'NOTE',
        textStyle,
        textAngle: '2',
        textColor: 'aci:5',
        textHeight: 3,
        alwaysLeft: true,
        frame: true,
        attachment: '1',
        leftAttachment: '8',
        rightAttachment: '5',
        landingGap: 0.5,
        topAttachment: '10',
        bottomAttachment: '10',
      };
      for (const [name, settings] of [
        ['Triya M4-04 blocks', blocks],
        ['Triya M4-04 text', texts],
        ['Triya M4-04 spare', texts],
        ['Triya M4-04 gone', texts],
      ] as const) {
        const r = await act({ op: 'new', name, from: shown.name, settings });
        expect(r.note, `${f.path} new ${name}`).toBeUndefined();
      }
      // The current style's leader, text and landing (the Standard a styleless drawing got).
      const was = (await act({ op: 'current', name: shown.name })).styles.find(
        (s) => s.name === shown.name,
      )!.settings;
      const changed: MLeaderStyleSettings = {
        ...was,
        lineColor: 'aci:3',
        arrowheadSize: was.arrowheadSize * 2,
        landingDistance: was.landingDistance + 1,
        textHeight: was.textHeight * 1.5,
        landingGap: was.landingGap / 2,
      };
      expect((await act({ op: 'modify', name: shown.name, settings: changed })).note).toBe(
        undefined,
      );
      const made = await act({ op: 'current', name: 'Triya M4-04 text' });
      const madeCurrent = made.note === undefined;
      if (madeCurrent) current++;
      else expect(model.header.get('CMLEADERSTYLE'), f.path).toBeUndefined();
      const renamed = await act({
        op: 'rename',
        name: 'Triya M4-04 spare',
        to: 'Triya M4-04 renamed',
      });
      expect(renamed.note, f.path).toBeUndefined();
      expect((await act({ op: 'delete', name: 'Triya M4-04 gone' })).note, f.path).toBe(undefined);
      await bus.answer({ kind: 'dialog', action: 'ok' });
      expect(bus.command, f.path).toBeUndefined();

      const out = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      saved++;
      const back = DocumentModel.create(documentInit(readCadDocument(out)));
      const settingsOf = (m: DocumentModel, name: string) => {
        const s = named(m, name);
        expect(s, `${f.path} ${name}`).toBeDefined();
        return comparable(m, mleaderStyleSettings(s!));
      };
      for (const name of [
        'Triya M4-04 blocks',
        'Triya M4-04 text',
        'Triya M4-04 renamed',
        shown.name,
      ]) {
        expect(settingsOf(back, name), `${f.path} ${name}`).toEqual(settingsOf(model, name));
      }
      expect(settingsOf(back, 'Triya M4-04 blocks')).toMatchObject({
        arrowhead: '_DOT',
        block: '_TAGBOX',
        maxPoints: 4,
        lineColor: 'aci:1',
      });
      expect(settingsOf(back, 'Triya M4-04 text')).toMatchObject({
        maxPoints: 3,
        scaleToLayout: true,
        attachment: '1',
      });
      expect(named(back, 'Triya M4-04 spare'), f.path).toBeUndefined();
      expect(named(back, 'Triya M4-04 gone'), f.path).toBeUndefined();
      if (madeCurrent) expect(back.header.get('CMLEADERSTYLE'), f.path).toBe('Triya M4-04 text');
    },
    30_000,
  );

  it('saved the styles on nearly every readable file', () => {
    expect(saved + styleless).toBe(readable.length);
    expect(saved).toBeGreaterThan(readable.length / 2);
    expect(current).toBeGreaterThan(0);
  });
});
