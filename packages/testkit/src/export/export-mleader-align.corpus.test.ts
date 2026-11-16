// MLEADERALIGN and MLEADERCOLLECT (M4-04 part 3) on every readable public corpus file. MLEADER
// makes three text multileaders and three with AutoCAD's built-in `_TagCircle` block (authored
// where the drawing lacks it); MLEADERALIGN lines the text up with each of its modes (Use current
// spacing, Specify spacing, Make leader segments parallel, Distribute) and MLEADERCOLLECT wraps
// the blocks two to a row under the first one's leader, leaving the other two without leader
// lines. The drawing is saved as AC1032 DXF (DEC-047), read back by acad-ts and mapped: each
// multileader keeps its leader lines (none for the collected ones) and draws the same parts as
// before the save. Drawings without a text style (R1, R2.5), which MLEADER needs, are skipped.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  multiLeaderParts,
  type Entity,
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
const PER_FILE_BUDGET_MS = 30_000;

/** A canvas that measures an MTEXT as one line, 0.6 of its height per character. */
const canvas: ViewHost = {
  request: (r): Promise<ViewReply> => {
    if (r.op !== 'textBox') return Promise.resolve({ ok: false, message: 'no view' });
    const t = r.text;
    const w = t.contents.length * t.height * 0.6;
    const col = (t.attachment - 1) % 3;
    const row = Math.floor((t.attachment - 1) / 3);
    const minX = t.position.x - (col === 0 ? 0 : col === 1 ? w / 2 : w);
    const maxY = t.position.y + (row === 0 ? 0 : row === 1 ? t.height / 2 : t.height);
    return Promise.resolve({
      ok: true,
      box: { minX, maxX: minX + w, minY: maxY - t.height, maxY },
    });
  },
};

/** Numbers to 9 significant figures, so parts compare across the DXF's 16-digit text. */
function rounded(v: unknown): unknown {
  if (typeof v === 'number') return Number(v.toPrecision(9)) + 0;
  if (Array.isArray(v)) return v.map(rounded);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)]));
  }
  return v;
}

const partsOf = (model: DocumentModel, e: Entity) =>
  rounded(multiLeaderParts(e.geom as MultiLeaderGeometry, model));

describe('MLEADERALIGN and MLEADERCOLLECT on the public corpus', () => {
  let saved = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves aligned and collected multileaders, which draw the same when read back',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = withPinnedClock(() =>
        DocumentModel.create(documentInit(readCadDocument(bytes))),
      );
      if (model.tables.textStyles.size === 0) return;
      const before = new Set([...model.entities()].map((e) => e.id));
      const space = model.layouts.find((l) => l.name === 'Model')?.blockRecord;
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: canvas,
        ...(space && { space: () => space }),
      });
      const newest = () =>
        [...model.entities()].filter((e) => !before.has(e.id) && e.geom.kind === 'MULTILEADER');
      await bus.script(['MLEADER', '0,0', '100,50', 'First', '']);
      await bus.script(['MLEADER', '20,-40', '130,90', 'Second', '']);
      await bus.script(['MLEADER', '40,-80', '160,-10', 'Third', '']);
      const texts = newest().map((e) => e.id);
      await bus.script(['MLEADER', 'O', 'C', 'B', '_TagCircle', 'X', '-200,0', '-150,40', '1']);
      await bus.script(['MLEADER', '-220,-60', '-140,-30', '2']);
      await bus.script(['MLEADER', '-240,-120', '-130,-90', '3']);
      const tags = newest()
        .map((e) => e.id)
        .filter((id) => !texts.includes(id));
      expect(tags).toHaveLength(3);
      const align = async (options: string[], points: string[], reference = true) => {
        await bus.submit('MLEADERALIGN');
        await bus.answer({ kind: 'selection', ids: texts });
        await bus.script(options);
        if (reference) await bus.answer({ kind: 'selection', ids: [texts[0]!] });
        await bus.script(points);
        expect(bus.command).toBeUndefined();
      };
      const base = (model.entity(texts[0]!)!.geom as MultiLeaderGeometry).contentBase;
      await align([], [`${base.x},${base.y + 100}`]);
      await align(['O', 'S', '5'], [`${base.x},${base.y - 100}`]);
      await align(['O', 'P'], [`${base.x + 100},${base.y}`]);
      await align(['O', 'D'], ['200,0', '200,150'], false);
      await bus.submit('MLEADERCOLLECT');
      await bus.answer({ kind: 'selection', ids: tags });
      await bus.script(['W', 'N', '2', '-300,100']);
      expect(bus.command).toBeUndefined();
      const leaderLines = (m: DocumentModel, id: Entity['id']) =>
        (m.entity(id)!.geom as MultiLeaderGeometry).branches.length;
      expect(tags.map((id) => leaderLines(model, id))).toEqual([1, 0, 0]);

      const out = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      const back = DocumentModel.create(documentInit(readCadDocument(out)));
      saved++;
      for (const e of newest()) {
        const r = back.entityByHandle(e.handle) as Entity;
        expect(r?.type, `MULTILEADER ${e.handle}`).toBe('MULTILEADER');
        expect((r.geom as MultiLeaderGeometry).branches.length).toBe(leaderLines(model, e.id));
        expect(partsOf(back, r), `MULTILEADER ${e.handle}`).toEqual(partsOf(model, e));
      }
    },
    PER_FILE_BUDGET_MS,
  );

  it('saved most of the corpus', () => {
    expect(saved).toBeGreaterThan(readable.length - 10);
  });
});
