// M4-14's acceptance, "corpus round-trip of both fields", on every readable public corpus file:
// the Multileader Style Manager makes a style with Maximum leader points unchecked (DXF 90 = 0,
// no limit) and Extend leader to text on (DXF 298), and Modify turns both the other way on the
// drawing's current style; every MULTILEADER's Extend leader to text (DXF 295) is turned over.
// The drawing is saved as AC1032 DXF (DEC-047), read back by acad-ts and mapped: the styles come
// back as the manager showed them and each multileader with its new value.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  mleaderStyleSettings,
  type MLeaderStyleAction,
  type MLeaderStyleRequest,
  type MultiLeaderGeometry,
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

const NEW = 'Triya M4-14';

const fieldsOf = (model: DocumentModel, name: string) => {
  const s = [...model.tables.mleaderStyles.values()].find(
    (x) => x.name.toUpperCase() === name.toUpperCase(),
  );
  if (!s) return undefined;
  const v = mleaderStyleSettings(s);
  return {
    maxLeaderPoints: s.maxLeaderPoints,
    extendLeaderToText: s.extendLeaderToText,
    maxPointsOn: v.maxPointsOn,
    extendToText: v.extendToText,
  };
};

const multileaders = (model: DocumentModel) =>
  new Map(
    [...model.entities()]
      .filter((e) => e.geom.kind === 'MULTILEADER')
      .map((e) => [e.handle, (e.geom as MultiLeaderGeometry).extendLeaderToText === true]),
  );

describe('Maximum leader points and Extend leader to text on the public corpus (M4-14)', () => {
  let saved = 0;
  let styleless = 0;
  let leaders = 0;
  let extendedRead = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s keeps both fields through a save',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = withPinnedClock(() =>
        DocumentModel.create(documentInit(readCadDocument(bytes))),
      );
      extendedRead += [...model.tables.mleaderStyles.values()].filter(
        (s) => s.extendLeaderToText,
      ).length;
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
      const act = async (mleaderstyle: MLeaderStyleAction) => {
        await bus.answer({ kind: 'dialog', action: 'apply', mleaderstyle });
        const next = bus.prompt;
        if (next?.kind !== 'dialog' || next.dialog.type !== 'mleaderstyle') throw new Error(f.path);
        return (next.dialog as MLeaderStyleRequest).note;
      };
      const made = await act({
        op: 'new',
        name: NEW,
        from: shown.name,
        settings: { ...shown.settings, maxPointsOn: false, extendToText: true },
      });
      expect(made, f.path).toBeUndefined();
      const modified = await act({
        op: 'modify',
        name: shown.name,
        settings: {
          ...shown.settings,
          maxPointsOn: !shown.settings.maxPointsOn,
          maxPoints: 3,
          extendToText: !shown.settings.extendToText,
        },
      });
      expect(modified, f.path).toBeUndefined();
      await bus.answer({ kind: 'dialog', action: 'ok' });
      expect(bus.command, f.path).toBeUndefined();

      // Every multileader's own value turned over.
      const b = new ChangeSetBuilder(model);
      for (const e of [...model.entities()]) {
        if (e.geom.kind !== 'MULTILEADER') continue;
        const { extendLeaderToText: on, ...rest } = e.geom;
        b.updateEntity(e.id, { geom: on ? rest : { ...rest, extendLeaderToText: true } });
      }
      model.apply(b.build());
      const want = multileaders(model);
      leaders += want.size;

      const out = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      saved++;
      const back = DocumentModel.create(documentInit(readCadDocument(out)));
      expect(fieldsOf(back, NEW), f.path).toEqual({
        maxLeaderPoints: 0,
        extendLeaderToText: true,
        maxPointsOn: false,
        extendToText: true,
      });
      expect(fieldsOf(back, shown.name), f.path).toEqual(fieldsOf(model, shown.name));
      expect(fieldsOf(back, shown.name)?.extendToText, f.path).toBe(!shown.settings.extendToText);
      expect(multileaders(back), f.path).toEqual(want);
    },
    30_000,
  );

  it('saved both fields on nearly every readable file, multileaders among them', () => {
    expect(saved + styleless).toBe(readable.length);
    expect(saved).toBeGreaterThan(readable.length / 2);
    expect(leaders).toBeGreaterThan(0);
    // ezdxf's examples from AutoCAD state Extend leader to text on in their styles.
    expect(extendedRead).toBeGreaterThan(0);
  });
});
