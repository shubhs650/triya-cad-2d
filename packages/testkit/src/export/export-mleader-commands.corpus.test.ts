// MLEADER and MLEADEREDIT (M2-09) on every readable public corpus file: the roadmap's
// acceptance, "MLEADER written is opened by acad-ts and renders identically". The commands run on
// the PromptBus as the command line drives them, in model space with the drawing's current
// multileader style (AutoCAD's Standard where it has none): a text multileader arrowhead first,
// a spline one without a landing, a text-first one in a box, one without content, a block one
// where the drawing has a block, then MLEADEREDIT adds a leader on each side of the first and
// removes one. M2-25 adds two with AutoCAD's built-in content blocks, which MLEADER authors
// (`_TagCircle`, and `_DetailCallout` content first), and TEXTEDIT edits the first one's text.
// M2-35 part 11 sets the first one's Text rows as the Properties palette does (Justify Right, a
// text height, the drawing's last text style; `applyPropertyEdit` with the widths the canvas
// measures), and the read-back text keeps its style, height, attachment and alignment. The drawing is saved as AC1032 DXF (DEC-047), read back by acad-ts and mapped, and
// each multileader draws the same parts (`multiLeaderParts`: lines, landings, arrowheads, text,
// block) as before the save. With TRIYA_DXF_AUDIT_DIR set the save also goes to the ezdxf audit
// as the file's `mleader` save.
//
// A drawing older than R2007 (AC1021) without a multileader style gets AutoCAD's Standard style
// from MLEADER and saves it: the save checks what it adds against AC1032, the version it writes
// (M2-13). Two R13/R14 drawings ezdxf wrote keep an R2007 STANDARD style as a proxy object, which
// the engine does not see and the save never replaces: MLEADER names its style Standard1 there
// (M2-29, `keptEntryNames`), and their session saves like the rest. R1 and R2.5 drawings have no
// text style, which a multileader style names, so MLEADER makes nothing there and their unedited
// save is audited.
//
// The fake canvas measures text as 0.6 of its height per character on one line: the far-side
// landing only needs some box, and the renderer's own measuring is tested in packages/render.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  applyPropertyEdit,
  builtinCommands,
  multiLeaderParts,
  multiLeaderTextsToMeasure,
  type Entity,
  type MTextGeometry,
  type MultiLeaderGeometry,
  type PropertyEdit,
  type ViewHost,
  type ViewReply,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));
const PER_FILE_BUDGET_MS = 30_000;
/** The drawings that keep a STANDARD style as a proxy object: R13 and R14 binary DXFs ezdxf wrote. */
const PROXY_STYLE = [
  'public/third-party/ezdxf/integration_tests/bin_dxf_r13.dxf',
  'public/third-party/ezdxf/integration_tests/bin_dxf_r14.dxf',
];

/** The drawing as read, for the audit's mleader save of a file the session cannot save yet. */
const unedited = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

/** An MTEXT's width as the fake canvas measures it: one line, 0.6 of its height per character. */
const widthOf = (t: MTextGeometry): number => t.contents.length * t.height * 0.6;

/** A canvas that measures an MTEXT as one line, 0.6 of its height per character. */
const canvas: ViewHost = {
  request: (r): Promise<ViewReply> => {
    if (r.op !== 'textBox') return Promise.resolve({ ok: false, message: 'no view' });
    const t = r.text;
    const w = widthOf(t);
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

/** A block a multileader can show: named, not a layout's, not anonymous, not an xref. */
function someBlock(model: DocumentModel): string | undefined {
  for (const b of model.blocks.values()) {
    // Not anonymous, nor an xref or one of its blocks (DXF 70 bits 4 and 32).
    if (b.name.startsWith('*') || ((b.flags ?? 0) & 36) !== 0) continue;
    const record = model.tables.blockRecords.get(b.handle);
    if (record?.layout !== undefined) continue;
    if (model.blockEntities(b.handle).length > 0) return b.name;
  }
  return undefined;
}

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

describe('MLEADER on the public corpus', () => {
  let saved = 0;
  const proxied: string[] = [];
  const textless: string[] = [];
  let blocks = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves its multileaders, which draw the same when read back',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = withPinnedClock(() =>
        DocumentModel.create(documentInit(readCadDocument(bytes))),
      );
      const before = new Set([...model.entities()].map((e) => e.id));
      const styled = model.tables.mleaderStyles.size > 0;
      const space = model.layouts.find((l) => l.name === 'Model')?.blockRecord;
      const bus = new PromptBus({
        model,
        registry: builtinCommands(),
        view: canvas,
        ...(space && { space: () => space }),
      });
      // R1 and R2.5 drawings have no text style, which a multileader style needs: MLEADER says
      // so before it asks for anything, and makes nothing.
      if (model.tables.textStyles.size === 0) {
        await bus.submit('MLEADER');
        expect(bus.command).toBeUndefined();
        expect([...model.entities()].filter((e) => !before.has(e.id))).toEqual([]);
        writeAuditSave(f.path, 'mleader', () =>
          withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), unedited(bytes))),
        );
        textless.push(f.path);
        return;
      }
      await bus.script(['MLEADER', '0,0', '100,50', 'Check {\\Ldetail} A', '']);
      await bus.script(['MLEADEREDIT', 'L', '20,80', '300,0', 'R', '20,79', '']);
      await bus.script(['MLEADER', 'O', 'L', 'P', 'A', 'N', 'X', '0,200', '50,250']);
      await bus.script(['First line', 'second', '']);
      await bus.script(['MLEADER', 'C', '400,100', '520,70', 'Boxed note', '', '600,0']);
      await bus.script(['MLEADER', 'H', 'O', 'C', 'N', 'X', '0,-100', '40,-80']);
      const block = someBlock(model);
      let hasBlock = false;
      if (block !== undefined) {
        await bus.script(['MLEADER', 'O', 'C', 'B', block, 'X', '0,-300', '60,-250']);
        // Whatever attributes the block asks for keep their defaults.
        while (bus.command === 'MLEADER') await bus.submit('');
        hasBlock = true;
      }
      await bus.script(['MLEADER', 'O', 'C', 'B', '_TagCircle', 'X', '-200,0', '-150,40', '7']);
      await bus.script(['MLEADER', 'O', 'C', 'B', '_DetailCallout', 'X', 'C', '-200,-200']);
      await bus.script(['3', 'A-501', '-260,-150']);
      await bus.script(['TEXTEDIT']);
      const firstLeader = [...model.entities()].find(
        (e) => !before.has(e.id) && e.geom.kind === 'MULTILEADER',
      )!;
      await bus.answer({ kind: 'selection', ids: [firstLeader.id] });
      await bus.answer({ kind: 'string', value: 'Check {\\Ldetail} B\\Psheet 2', editor: true });
      await bus.submit('');
      expect(bus.command).toBeUndefined();
      // The Properties palette's Text rows on the first one, one change set each.
      const palette = (edit: PropertyEdit) => {
        const now = [model.entity(firstLeader.id)!];
        const widths = new Map(
          multiLeaderTextsToMeasure(model, now, edit).map((m) => [
            m.id,
            {
              ...(m.before && { before: widthOf(m.before) }),
              ...(m.after && { after: widthOf(m.after) }),
            },
          ]),
        );
        const b = new ChangeSetBuilder(model);
        const report = applyPropertyEdit(b, model, now, edit, undefined, undefined, widths);
        expect(report, `${f.path} ${edit.key}`).toMatchObject({ changed: 1, refused: new Map() });
        model.apply(b.build());
      };
      // A named one: a shape file's style has no name.
      const lastStyle = [...model.tables.textStyles.values()].filter((t) => t.name).at(-1)!.handle;
      palette({ key: 'justify', value: 'Right' });
      palette({ key: 'height', value: 7 });
      if (lastStyle !== (model.entity(firstLeader.id)!.geom as MultiLeaderGeometry).text!.style)
        palette({ key: 'style', value: lastStyle });
      const edited = model.entity(firstLeader.id)!.geom as MultiLeaderGeometry;
      expect(edited.text).toMatchObject({ attachment: 3, height: 7, style: lastStyle });
      const added = [...model.entities()].filter(
        (e) => !before.has(e.id) && e.geom.kind === 'MULTILEADER',
      );
      // The built-in blocks: definitions with their parts, the multileaders' attribute values.
      const builtins = ['_TagCircle', '_DetailCallout'].map((n) =>
        [...model.blocks.values()].find((b) => b.name === n)!,
      );
      expect(builtins.every((b) => b !== undefined)).toBe(true);
      const tags = added.slice(-2).map((e) => (e.geom as MultiLeaderGeometry).block!);
      expect(tags.map((b) => b.block)).toEqual(builtins.map((b) => b.handle));
      expect(tags.map((b) => b.attributes!.map((a) => a.value))).toEqual([['7'], ['3', 'A-501']]);
      expect((added[0]!.geom as MultiLeaderGeometry).text!.content).toBe(
        'Check {\\Ldetail} B\\Psheet 2',
      );
      if (PROXY_STYLE.includes(f.path)) {
        // The proxy keeps its name, so the new style takes the next free one (M2-29).
        expect(styled).toBe(false);
        expect(model.meta.keptEntryNames).toEqual({ mleaderStyles: ['STANDARD'] });
        expect([...model.tables.mleaderStyles.values()].map((s) => s.name)).toEqual(['Standard1']);
        proxied.push(f.path);
      }
      expect(added.map((e) => e.type)).toEqual(
        Array.from({ length: block === undefined ? 6 : 7 }, () => 'MULTILEADER'),
      );
      const first = added[0]!.geom as MultiLeaderGeometry;
      expect(first.branches.map((b) => b.lines.length)).toEqual([1, 1]);

      const out = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      writeAuditSave(f.path, 'mleader', () => out);
      const back = DocumentModel.create(documentInit(readCadDocument(out)));
      saved++;
      if (hasBlock) blocks++;
      for (const e of added) {
        const r = back.entityByHandle(e.handle) as Entity;
        expect(r, `MULTILEADER ${e.handle}`).toBeDefined();
        expect(r.type).toBe('MULTILEADER');
        expect(partsOf(back, r), `MULTILEADER ${e.handle}`).toEqual(partsOf(model, e));
        expect((r.geom as MultiLeaderGeometry).style).toBe((e.geom as MultiLeaderGeometry).style);
      }
      const firstBack = back.entityByHandle(firstLeader.handle)!.geom as MultiLeaderGeometry;
      expect(firstBack.text).toMatchObject({ attachment: 3, height: 7, style: lastStyle });
      expect(firstBack.textAlignment).toBe(2);
      expect(firstBack.overrideFlags).toBe(edited.overrideFlags);
      // The built-in blocks come back with what they draw and their attribute definitions.
      for (const b of builtins) {
        const kinds = (m: DocumentModel, h: string) =>
          m.blockEntities(h).map((id) => {
            const g = m.entity(id)!.geom;
            return g.kind === 'ATTDEF' ? `ATTDEF ${g.tag}` : g.kind;
          });
        expect(back.blocks.get(b.handle)?.name).toBe(b.name);
        expect(kinds(back, b.handle)).toEqual(kinds(model, b.handle));
      }
    },
    PER_FILE_BUDGET_MS,
  );

  it('saved multileaders on every readable file with a text style, block content on most', () => {
    expect(proxied).toEqual(PROXY_STYLE);
    expect(textless).toEqual([
      'public/third-party/ezdxf/examples_dxf/Minimal_DXF_AC1006.dxf',
      'public/third-party/ezdxf/integration_tests/AC1003_LINE_Example.dxf',
    ]);
    expect(saved + textless.length).toBe(readable.length);
    expect(blocks).toBeGreaterThan(saved / 2);
  });
});
