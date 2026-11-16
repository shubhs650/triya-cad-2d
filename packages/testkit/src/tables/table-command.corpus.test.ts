// -TABLE on every readable public corpus file (M4-05), as the nozzle-schedule scenario: a table
// of four columns and three data rows inserted with the drawing's current table style (AutoCAD's
// Standard where it has none), its cells then filled in as a nozzle schedule (title, header and
// rows) in the cell editor that opens in its first cell, Tab moving on to each next cell, and its
// `*T` block drawn again by the table engine after each. The drawing is saved as AC1032 DXF (DEC-047) and read back by
// acad-ts: the table maps back as it was made, and its stored block is what the engine draws for
// it. With TRIYA_DXF_AUDIT_DIR set the save goes to the ezdxf audit as the file's `table` save.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DocumentModel,
  PromptBus,
  blockExtentsOf,
  builtinCommands,
  tableParts,
  type Entity,
  type TableGeometry,
  type TablePart,
} from '@triya/engine';
import { ACadVersion } from '@node-projects/acad-ts';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const PER_FILE_BUDGET_MS = 30_000;
/** Readable files that get a table. */
const MADE = 118;
/** DWG files from R2010 (their tables are only checked to read back as drawn). */
const DWG_2010 = 17;
/** R1 and R2.5 drawings, which have no text style. */
const STYLELESS = 4;

type Table = Entity & { geom: TableGeometry };

/** The nozzle schedule typed into the table, row by row (the title spans the columns). */
const SCHEDULE = [
  ['NOZZLE SCHEDULE'],
  ['MARK', 'SIZE', 'RATING', 'SERVICE'],
  ['N1', '150', 'PN16', 'Inlet'],
  ['N2', '100', 'PN16', 'Outlet'],
  ['N3', '50', 'PN40', '{\\fArial|b1;Drain}'],
];

/** Numbers to 9 significant figures, so geometry compares across the DXF's 16-digit text. */
function rounded(v: unknown): unknown {
  if (typeof v === 'number') return Number(v.toPrecision(9)) + 0;
  if (Array.isArray(v)) return v.map(rounded);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)]));
  }
  return v;
}

/** What a block entity or a part draws. */
const drawn = (p: Pick<TablePart, 'geom' | 'color' | 'linetype' | 'lineweight'>) =>
  rounded({
    geom: p.geom,
    color: p.color ?? { kind: 'byBlock' },
    linetype: p.linetype ?? 'ByLayer',
    lineweight: p.lineweight ?? 'ByLayer',
  });

/** A table's geometry without its block handle, which the save renumbers nothing of. */
const kept = (g: TableGeometry) => {
  const { block: _b, ...rest } = g;
  return rounded(rest);
};

const unedited = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

describe('-TABLE on the public corpus (M4-05)', () => {
  let made = 0;
  let dwg2010 = 0;
  const skipped: string[] = [];
  const styleless_: string[] = [];

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves a nozzle schedule that reads back as the engine draws it',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = unedited(bytes);
      const zero = [...model.tables.layers.values()].some((l) => l.name === '0');
      const space =
        model.layouts.find((l) => l.name === 'Model')?.blockRecord ??
        [...model.blocks.values()].find((b) => b.name.toUpperCase() === '*MODEL_SPACE')?.handle;
      // R1 and R2.5 drawings have no text style for the Standard table style to name.
      const styleless = model.tables.tableStyles.size === 0 && model.tables.textStyles.size === 0;
      if (!zero || space === undefined || styleless) {
        if (styleless) {
          const bus = new PromptBus({ model, registry: builtinCommands() });
          await bus.submit('-TABLE');
          expect(bus.history).toContain(
            'The drawing has no text style, which a table style needs.',
          );
          styleless_.push(f.path);
        } else skipped.push(f.path);
        writeAuditSave(f.path, 'table', () =>
          withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), unedited(bytes))),
        );
        return;
      }
      const before = new Set([...model.entities()].map((e) => e.id));
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: { request: () => Promise.resolve({ ok: false, message: 'no view' }) },
      });
      for (const answer of ['-TABLE', '4', '3', '0,-500']) await bus.submit(answer);
      const table = [...model.entities()].find(
        (e): e is Table => !before.has(e.id) && e.geom.kind === 'ACAD_TABLE',
      )!;
      expect(table, f.path).toBeDefined();

      // The schedule typed in the cell editor that opens in the title cell, Tab to each next
      // cell (the merged title's covered cells are passed over), the block drawn again each time.
      const order = table.geom.cells.flatMap((row, i) =>
        row.flatMap((c, j) => (c.merged ? [] : [SCHEDULE[i]![j]!])),
      );
      for (const [k, value] of order.entries()) {
        expect(bus.promptText, f.path).toBe('Enter text:');
        await bus.answer({
          kind: 'string',
          value,
          editor: true,
          ...(k < order.length - 1 && { cell: 'next' as const }),
        });
      }
      expect(bus.promptText).toBe('Command:');
      const made_ = model.entity(table.id) as Table;
      expect(made_.geom.cells[4]![3]!.text).toBe('{\\fArial|b1;Drain}');

      const save = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      writeAuditSave(f.path, 'table', () => save);
      const back = unedited(save);
      const reread = back.entityByHandle(made_.handle) as Table | undefined;
      expect(reread, f.path).toBeDefined();
      expect(kept(reread!.geom), f.path).toEqual(kept(made_.geom));
      // Its block reads back as the engine drew it.
      const entities = (m: DocumentModel, t: Table) =>
        m
          .blockEntities(t.geom.block!)
          .map((id) => m.entity(id)!)
          .map((e) =>
            drawn({ geom: e.geom, color: e.color, linetype: e.linetype, lineweight: e.lineweight }),
          );
      const stored = entities(back, reread!);
      expect(stored, f.path).toEqual(entities(model, made_));
      made++;
      // And the engine draws it so again from what the file says. A DWG from R2010 states its
      // table style's alignments in content formats, which its AC1032 DXF save does not carry
      // over (each row reads alignment 0 there); DWG conversion gets no new work (DEC-047).
      if (
        /\.dwg$/i.test(f.path) &&
        (readCadDocument(bytes).header?.version ?? 0) >= ACadVersion.AC1024
      ) {
        dwg2010++;
        return;
      }
      const style = back.tables.tableStyles.get(reread!.geom.style!);
      expect(style?.name, f.path).toBe(model.tables.tableStyles.get(made_.geom.style!)?.name);
      const standard = [...back.tables.textStyles.values()].find(
        (s) => s.name.toUpperCase() === 'STANDARD',
      );
      const want = tableParts(reread!.geom, style, {
        textStyle: standard?.handle ?? '',
        blockExtents: (h) => blockExtentsOf(back, h),
      }).map(drawn);
      expect(stored, f.path).toEqual(want);
    },
    PER_FILE_BUDGET_MS,
  );

  it('made a table in every drawing with a layer 0 and a model space', () => {
    expect({ made, dwg2010, skipped, styleless: styleless_.length }).toEqual({
      made: MADE,
      dwg2010: DWG_2010,
      skipped: [],
      styleless: STYLELESS,
    });
  });
});
