// M5-04 part 13: -PDFATTACH on the PromptBus, AutoCAD 2024's command-line form of PDFATTACH
// (AutoCAD Help, "-PDFATTACH (Command)"):
//   Path to PDF file to attach <last>:     (the app finds the file by name: `pdfFile`; ~ the dialog)
//   Enter page number or [?] <1>:          (? asks "Enter page(s) to list <*>" and lists them)
//   Specify insertion point:
//   Specify scale factor <1.0000>:
//   Specify rotation <0>:
// The page is attached as PDFATTACH's dialog attaches one (pdf-attach.test.ts): its true size
// times the scale, a definition "<file> - <page>", one undo step.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  type BusEvent,
  type DialogRequest,
  type PdfDefinition,
  type PromptAnswer,
  type UnderlayGeometry,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { MODEL_SPACE, sampleInit } from '../model/fixtures';
import { r6 } from './edit-harness';

/** A4 portrait (8.27 × 11.69 in) and A3 landscape pages. */
const A4 = { page: '1', width: 8.27, height: 11.69 };
const A3 = { page: '2', width: 16.54, height: 11.69 };

/** What the app holds, by file name: its pages. */
const HELD: Readonly<Record<string, readonly (typeof A4)[]>> = {
  'plan.pdf': [A4, A3],
  'Site Plan.pdf': [{ ...A3, page: '1' }],
};

/**
 * A drawing in `insUnits` and a bus whose app finds the PDFs of `HELD` by name (folders, case and
 * the extension aside).
 */
function drawing(insUnits = 4, o: { unreadable?: boolean } = {}) {
  const init = sampleInit();
  const model = DocumentModel.create({ ...init, meta: { ...init.meta!, rootDictionary: 'C' } });
  const b = new ChangeSetBuilder(model);
  b.setHeader('$INSUNITS', insUnits);
  model.apply(b.build());
  const requests: ViewRequest[] = [];
  const log: string[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> => {
        requests.push(r);
        if (r.op !== 'pdfFile') return Promise.resolve({ ok: false, message: 'no' });
        if (o.unreadable)
          return Promise.resolve({ ok: false, message: 'plan.pdf is not a PDF file' });
        const key = r.file.split(/[\\/]/).pop()!.toUpperCase();
        const name = Object.keys(HELD).find(
          (n) => n.toUpperCase() === key || n.toUpperCase().replace(/\.PDF$/, '') === key,
        );
        return Promise.resolve(
          name ? { ok: true, pdfFile: { fileName: name, pages: HELD[name]! } } : { ok: true },
        );
      },
    },
  });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const underlays = () =>
    model
      .blockEntities(MODEL_SPACE)
      .map((id) => model.entity(id)!.geom)
      .filter((g): g is UnderlayGeometry => g.kind === 'PDFUNDERLAY');
  const defs = () =>
    [...model.objects.values()].filter((d): d is PdfDefinition => d.type === 'PDFDEFINITION');
  return { model, bus, log, requests, underlays, defs };
}

describe('-PDFATTACH (M5-04 part 13)', () => {
  it('attaches the page of the file named, asking the insertion point, scale and rotation', async () => {
    const t = drawing();
    await t.bus.script(['-PDFATTACH']);
    expect(t.bus.promptText).toBe('Path to PDF file to attach:');
    await t.bus.script(['plan']);
    expect(t.requests).toContainEqual({ op: 'pdfFile', file: 'plan' });
    expect(t.bus.promptText).toBe('Enter page number or [?] <1>:');
    await t.bus.script(['']);
    expect(t.bus.promptText).toBe('Specify insertion point:');
    await t.bus.script(['10,20']);
    expect(t.bus.promptText).toBe('Specify scale factor <1.0000>:');
    await t.bus.script(['2']);
    expect(t.bus.promptText).toBe('Specify rotation <0>:');
    await t.bus.script(['90']);
    expect(t.bus.command).toBeUndefined();
    const [g] = t.underlays();
    expect(g!.position).toEqual({ x: 10, y: 20 });
    // 25.4 mm an inch, twice.
    expect(g!.scale).toEqual({ x: 50.8, y: 50.8, z: 50.8 });
    expect(r6(g!.rotation)).toBe(r6(Math.PI / 2));
    expect(t.defs()).toEqual([
      expect.objectContaining({ name: 'plan - 1', fileName: 'plan.pdf', page: '1' }),
    ]);
    // One undo step.
    expect(t.bus.undo.state.nextUndo).toBe('PDFATTACH');
    await t.bus.script(['U']);
    expect(t.underlays()).toEqual([]);
    expect(t.defs()).toEqual([]);
  });

  it('takes the page typed, refusing one the file does not have', async () => {
    const t = drawing(1);
    await t.bus.script(['-PDFATTACH', 'plan.pdf', '3']);
    expect(t.log).toContain('Invalid page number.');
    expect(t.bus.promptText).toBe('Enter page number or [?] <1>:');
    await t.bus.script(['0']);
    expect(t.bus.promptText).toBe('Enter page number or [?] <1>:');
    await t.bus.script(['2', '0,0', '', '']);
    expect(t.bus.command).toBeUndefined();
    expect(t.defs()).toEqual([expect.objectContaining({ name: 'plan - 2', page: '2' })]);
    // An inch drawing: scale 1.
    expect(t.underlays()[0]!.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('lists the pages at ?, all or those asked for, then asks the page again', async () => {
    const t = drawing();
    await t.bus.script(['-PDFATTACH', 'plan', '?']);
    expect(t.bus.promptText).toBe('Enter page(s) to list <*>:');
    await t.bus.script(['']);
    // Each page's size in the drawing's units at scale 1, as the dialog's list shows it.
    expect(t.log).toEqual(
      expect.arrayContaining([
        'Page 1: 210.0580 x 296.9260',
        'Page 2: 420.1160 x 296.9260',
        'Total page(s): 2',
      ]),
    );
    expect(t.bus.promptText).toBe('Enter page number or [?] <1>:');
    t.log.length = 0;
    await t.bus.script(['?', '2']);
    expect(t.log.filter((l) => l.startsWith('Page '))).toEqual(['Page 2: 420.1160 x 296.9260']);
    expect(t.log).toContain('Total page(s): 1');
    t.log.length = 0;
    await t.bus.script(['?', '1-2,7']);
    expect(t.log.filter((l) => l.startsWith('Page '))).toHaveLength(2);
    t.log.length = 0;
    await t.bus.script(['?', '9']);
    expect(t.log).toContain('No matching pages found.');
    expect(t.bus.promptText).toBe('Enter page number or [?] <1>:');
  });

  it('takes a name with spaces, folders and quotes, and offers the file it last attached', async () => {
    const t = drawing();
    await t.bus.script(['-PDFATTACH', '"C:\\work\\site plan.pdf"', '', '0,0', '', '']);
    expect(t.requests).toContainEqual({ op: 'pdfFile', file: 'C:\\work\\site plan.pdf' });
    expect(t.defs()[0]).toMatchObject({ name: 'Site Plan - 1', fileName: 'Site Plan.pdf' });
    await t.bus.script(['-PDFATTACH']);
    expect(t.bus.promptText).toBe('Path to PDF file to attach <Site Plan.pdf>:');
    await t.bus.script(['', '', '50,0', '', '']);
    // The page's definition is reused.
    expect(t.underlays()).toHaveLength(2);
    expect(t.defs()).toHaveLength(1);
  });

  it('says when the file is not found or cannot be read, attaching nothing', async () => {
    const t = drawing();
    await t.bus.script(['-PDFATTACH', 'elevation']);
    expect(t.log).toContain('File "elevation" not found.');
    expect(t.bus.command).toBeUndefined();
    const u = drawing(4, { unreadable: true });
    await u.bus.script(['-PDFATTACH', 'plan']);
    expect(u.log).toContain('plan.pdf is not a PDF file');
    expect(u.bus.command).toBeUndefined();
    expect(u.underlays()).toEqual([]);
    expect(u.bus.undo.state.nextUndo).toBeUndefined();
  });

  it('ends at an empty name with no default, and Esc at the insertion point attaches nothing', async () => {
    const t = drawing();
    await t.bus.script(['-PDFATTACH', '']);
    expect(t.bus.command).toBeUndefined();
    expect(t.requests.filter((r) => r.op === 'pdfFile')).toEqual([]);
    await t.bus.script(['-PDFATTACH', 'plan', '']);
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
    expect(t.underlays()).toEqual([]);
    expect(t.defs()).toEqual([]);
  });

  it('refuses a scale that is not positive', async () => {
    const t = drawing(0);
    await t.bus.script(['-PDFATTACH', 'plan', '', '0,0', '-1']);
    expect(t.log).toContain('Value must be positive and nonzero.');
    await t.bus.script(['', '']);
    expect(t.bus.command).toBeUndefined();
    // A unitless drawing: a unit is the page's inch.
    expect(t.underlays()[0]!.scale.x).toBe(1);
  });

  it('opens the Attach PDF Underlay dialog at ~', async () => {
    const t = drawing();
    await t.bus.script(['-PDFATTACH', '~']);
    const p = t.bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.dialog?.type).toBe('pdfattach');
    const settings = (p!.dialog as Extract<DialogRequest, { type: 'pdfattach' }>).settings;
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      pdfAttach: {
        file: { fileName: 'plan.pdf', pages: [A4] },
        settings: { ...settings, pointOnScreen: false, point: { x: 3, y: 4 } },
      },
    } as PromptAnswer);
    expect(t.bus.command).toBeUndefined();
    expect(t.underlays()[0]?.position).toEqual({ x: 3, y: 4 });
    expect(t.requests.filter((r) => r.op === 'pdfFile')).toEqual([]);
  });
});
