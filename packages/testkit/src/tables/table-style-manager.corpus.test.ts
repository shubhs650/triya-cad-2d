// TABLESTYLE's Table Style dialog on every readable public corpus file (M4-05 part 5): a table is
// made with -TABLE in the current table style; New makes a style with every setting of the New
// Table Style dialog changed (direction, margins, and each cell style's fill, alignment, text
// style, height and colour and its borders' lineweight, colour and visibility); Modify changes the
// current style, which draws its tables again (the corpus's own and the one made); Set Current
// makes the new style current where the drawing keeps CTABLESTYLE; MATCHPROP's Table gives the
// made table the new style; a spare style is renamed and another deleted. A drawing without
// table styles gets AutoCAD's Standard with its first one. The drawing is saved as AC1032 DXF
// (DEC-047), read back by acad-ts and mapped: every style comes back as the dialog showed it
// (compared by name, text styles by name), the renamed one under its new name, the deleted one
// gone, and every table in a changed style with the rows and block the engine drew.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  tableStyleSettings,
  type Entity,
  type EntityId,
  type TableGeometry,
  type TableStyleAction,
  type TableStyleRecord,
  type TableStyleRequest,
  type TableStyleSettings,
} from '@triya/engine';
import { ACadVersion } from '@node-projects/acad-ts';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const PER_FILE_BUDGET_MS = 60_000;

type Table = Entity & { geom: TableGeometry };

const read = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

/** Numbers to 9 significant figures, so values compare across the DXF's text. */
function rounded(v: unknown): unknown {
  if (typeof v === 'number') return Number(v.toPrecision(9)) + 0;
  if (Array.isArray(v)) return v.map(rounded);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)]));
  }
  return v;
}

/** Settings with the text style names in one case, so files compare. */
const comparable = (s: TableStyleSettings) =>
  rounded({
    ...s,
    data: { ...s.data, textStyle: s.data.textStyle.toUpperCase() },
    header: { ...s.header, textStyle: s.header.textStyle.toUpperCase() },
    title: { ...s.title, textStyle: s.title.textStyle.toUpperCase() },
  });

const named = (model: DocumentModel, name: string): TableStyleRecord | undefined =>
  [...model.tables.tableStyles.values()].find((s) => s.name.toUpperCase() === name.toUpperCase());

/** `s` with every setting the dialog makes changed. */
function everything(s: TableStyleSettings, textStyle: string, k: number): TableStyleSettings {
  const cell = (c: TableStyleSettings['data'], n: number) => ({
    ...c,
    fill: n === 2 ? null : { kind: 'aci' as const, index: 1 + ((k + n) % 7) },
    alignment: 1 + ((k + n * 3) % 9),
    textStyle,
    textHeight: c.textHeight * 1.5,
    textColor: { kind: 'aci' as const, index: 2 + n },
    borders: c.borders.map((b, e) => ({
      lineweight: e % 2 === 0 ? 35 : ('ByLayer' as const),
      color: { kind: 'aci' as const, index: 3 + e },
      visible: e !== n + 1,
    })),
  });
  return {
    description: s.description,
    up: !s.up,
    horizontalMargin: s.horizontalMargin * 2,
    verticalMargin: s.verticalMargin * 1.5,
    data: cell(s.data, 0),
    header: cell(s.header, 1),
    title: cell(s.title, 2),
  };
}

describe('Table Style dialog on the public corpus (M4-05 part 5)', () => {
  let saved = 0;
  let styleless = 0;
  let current = 0;
  let redrawn = 0;
  const dwg2010s = new Set<string>();

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s keeps every table style setting the dialog makes through a save',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = read(bytes);
      const zero = [...model.tables.layers.values()].some((l) => l.name === '0');
      const picks: EntityId[] = [];
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: {
          request: (r) =>
            Promise.resolve(
              r.op === 'pick'
                ? { ok: true, ids: picks.splice(0, 1) }
                : { ok: false, message: 'no' },
            ),
        },
      });
      await bus.submit('TABLESTYLE');
      let p = bus.prompt;
      if (p?.kind !== 'dialog' || p.dialog.type !== 'tablestyle') throw new Error(f.path);
      let r = p.dialog as TableStyleRequest;
      // An R1 or R2.5 drawing has no text style, which a table style needs.
      if (r.styles.length === 0) {
        expect(r.textStyles, f.path).toEqual([]);
        styleless++;
        await bus.cancel();
        return;
      }
      await bus.answer({ kind: 'dialog', action: 'ok' });
      // A table in the current style, its editor closed at once (the dialog's tables include it).
      const before = new Set([...model.entities()].map((e) => e.id));
      if (zero) {
        for (const a of ['-TABLE', '3', '2', '0,-500']) await bus.submit(a);
        await bus.cancel();
      }
      const made = [...model.entities()].find(
        (e): e is Table => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
      );
      await bus.submit('TABLESTYLE');
      const act = async (tablestyle: TableStyleAction) => {
        await bus.answer({ kind: 'dialog', action: 'apply', tablestyle });
        p = bus.prompt;
        if (p?.kind !== 'dialog' || p.dialog.type !== 'tablestyle') throw new Error(f.path);
        return p.dialog as TableStyleRequest;
      };
      const opened = bus.prompt;
      if (opened?.kind !== 'dialog' || opened.dialog.type !== 'tablestyle') throw new Error(f.path);
      r = opened.dialog as TableStyleRequest;
      const shown = r.styles.find((s) => s.name === r.current)!;
      const textStyle = r.textStyles.at(-1)!;
      const fresh = everything(shown.settings, textStyle, 1);
      r = await act({ op: 'new', name: 'Triya Schedule', settings: fresh });
      expect(r.note, f.path).toBeUndefined();
      const modified = everything(shown.settings, r.textStyles[0]!, 4);
      r = await act({ op: 'modify', name: shown.name, settings: modified });
      expect(r.note, f.path).toBeUndefined();
      r = await act({ op: 'new', name: 'Triya Spare', settings: fresh });
      r = await act({ op: 'rename', name: 'Triya Spare', to: 'Triya Renamed' });
      r = await act({ op: 'new', name: 'Triya Gone', settings: shown.settings });
      r = await act({ op: 'delete', name: 'Triya Gone' });
      expect(r.note, f.path).toBeUndefined();
      const keeps = model.header.get('CTABLESTYLE') !== undefined;
      r = await act({ op: 'current', name: 'Triya Schedule' });
      expect(r.current, f.path).toBe(keeps ? 'Triya Schedule' : shown.name);
      if (keeps) current++;
      await bus.answer({ kind: 'dialog', action: 'ok' });
      expect(bus.promptText).toBe('Command:');

      // MATCHPROP Table: the made table takes the new style from a second table drawn in it.
      if (made) {
        const was = new Set([...model.entities()].map((e) => e.id));
        for (const a of ['-TABLE', '2', '1', 'Style', 'Triya Schedule', '0,-900']) {
          await bus.submit(a);
        }
        await bus.cancel();
        const source = [...model.entities()].find(
          (e): e is Table => !was.has(e.id) && e.geom.kind === 'ACAD_TABLE',
        )!;
        picks.push(source.id, made.id);
        await bus.submit('MATCHPROP');
        await bus.pick({ x: 0, y: -900 });
        await bus.pick({ x: 0, y: -500 });
        await bus.submit('');
        const now = model.entity(made.id) as Table;
        expect(now.geom.style, f.path).toBe(source.geom.style);
      }

      const save = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      const back = read(save);
      // Every style as the dialog showed it, by name.
      for (const s of model.tables.tableStyles.values()) {
        const b = named(back, s.name);
        expect(b, `${f.path} ${s.name}`).toBeDefined();
        const want = comparable(tableStyleSettings(model, s));
        const got = comparable(tableStyleSettings(back, b!));
        // A DWG from R2010 states its own styles' alignments and fills in its named cell styles'
        // content formats, which its AC1032 DXF save does not carry over (as
        // table-command.corpus.test.ts finds); DWG conversion gets no new work (DEC-047).
        const dwg2010 =
          /\.dwg$/i.test(f.path) &&
          (readCadDocument(bytes).header?.version ?? 0) >= ACadVersion.AC1024 &&
          !s.name.startsWith('Triya');
        if (dwg2010) {
          dwg2010s.add(f.path);
          const strip = (v: unknown) =>
            JSON.parse(JSON.stringify(v), (k, x: unknown) =>
              k === 'alignment' || k === 'fill' ? undefined : x,
            );
          expect(strip(got), `${f.path} ${s.name}`).toEqual(strip(want));
        } else expect(got, `${f.path} ${s.name}`).toEqual(want);
      }
      expect(named(back, 'Triya Renamed'), f.path).toBeDefined();
      expect(named(back, 'Triya Spare'), f.path).toBeUndefined();
      expect(named(back, 'Triya Gone'), f.path).toBeUndefined();
      if (keeps)
        expect(String(back.header.get('CTABLESTYLE')).toUpperCase()).toBe('TRIYA SCHEDULE');
      // Every table in a changed style reads back with its rows and the block the engine drew.
      const modifiedStyle = named(model, shown.name)!.handle;
      for (const t of model.entities()) {
        if (t.geom.kind !== 'ACAD_TABLE' || t.geom.style !== modifiedStyle) continue;
        if (t.geom.style === undefined) continue;
        const b = back.entityByHandle(t.handle) as Table | undefined;
        expect(b, `${f.path} ${t.handle}`).toBeDefined();
        expect(rounded(b!.geom.rowHeights), `${f.path} ${t.handle}`).toEqual(
          rounded(t.geom.rowHeights),
        );
        const kinds = (m: DocumentModel, g: TableGeometry) =>
          m.blockEntities(g.block!).map((id) => m.entity(id)!.geom.kind);
        expect(kinds(back, b!.geom), `${f.path} ${t.handle}`).toEqual(kinds(model, t.geom));
        redrawn++;
      }
      saved++;
    },
    PER_FILE_BUDGET_MS,
  );

  it('saved every drawing with a text style', () => {
    expect({ saved, styleless, total: readable.length }).toEqual({
      saved: readable.length - styleless,
      styleless: 4,
      total: readable.length,
    });
    expect(dwg2010s.size).toBe(17);
    expect(current).toBeGreaterThan(0);
    expect(redrawn).toBeGreaterThan(0);
  });
});
