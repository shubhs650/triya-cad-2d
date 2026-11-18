// M5-04 part 8: PDFATTACH on the PromptBus, as AutoCAD 2024's (AutoCAD Help, "PDFATTACH
// (Command)", "Attach PDF Underlay Dialog Box", "-PDFATTACH (Command)"):
//   - the Attach PDF Underlay dialog lists the drawing's PDF files (by name) with the pages it
//     shows of each, and opens with Insertion point Specify On-screen, Scale 1 and Rotation 0, then
//     on the settings it last closed with;
//   - OK attaches each page selected: what is not Specify On-screen is taken from the dialog, the
//     rest asked ("Specify insertion point:", "Specify scale factor <1.0000>:", "Specify rotation
//     <0>:"; the scale prompt's Unit option is left out);
//   - a page is its true size in drawing units times the scale (DXF 41/42 = scale × drawing units
//     an inch), its lower-left corner at the insertion point, the next page selected to the right
//     of the one before, an inch (at the scale) apart;
//   - a new PDFDEFINITION per page, named "<file> - <page>" as AutoCAD names them; a page of a
//     file the drawing shows already is attached with its definition; one undo step.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  type DialogRequest,
  type DocumentModel,
  type PdfAttachSettings,
  type PdfDefinition,
  type PromptAnswer,
  type UnderlayGeometry,
} from '../../src/index';
import { MODEL_SPACE } from '../model/fixtures';
import { r6, setup } from './edit-harness';

type Request = Extract<DialogRequest, { type: 'pdfattach' }>;

const ROOT = 'C';
const SHEET: PdfDefinition = {
  type: 'PDFDEFINITION',
  handle: '90',
  owner: '91',
  name: 'sheet - 2',
  fileName: '..\\plans\\sheet.pdf',
  page: '2',
};

function setHeader(model: DocumentModel, name: string, value: number): void {
  const b = new ChangeSetBuilder(model);
  b.setHeader(name, value);
  model.apply(b.build());
}

function drawing(insUnits: number, defs: PdfDefinition[] = [], meta: object = {}) {
  const t = setup([], { objects: defs, meta: { rootDictionary: ROOT, ...meta } });
  setHeader(t.model, '$INSUNITS', insUnits);
  const underlays = () =>
    t.model
      .blockEntities(MODEL_SPACE)
      .map((id) => t.model.entity(id)!)
      .filter((e) => e.geom.kind === 'PDFUNDERLAY')
      .map((e) => e.geom as UnderlayGeometry);
  const defsNow = () =>
    [...t.model.objects.values()].filter((o): o is PdfDefinition => o.type === 'PDFDEFINITION');
  const request = () => {
    const p = t.bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe('pdfattach');
    return p!.dialog as Request;
  };
  /** OK with `file` and the dialog's settings changed by `patch`. */
  const ok = (file: unknown, patch: Partial<PdfAttachSettings> = {}) =>
    t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      pdfAttach: { file, settings: { ...request().settings, ...patch } },
    } as PromptAnswer);
  return { ...t, underlays, defsNow, request, ok };
}

/** A4 portrait (8.27 × 11.69 in) and A3 landscape pages. */
const A4 = { page: '1', width: 8.27, height: 11.69 };
const A3 = { page: '2', width: 16.54, height: 11.69 };
const PLAN = { fileName: 'plan.pdf', pages: [A4] };
const FIXED = { pointOnScreen: false, scaleOnScreen: false, rotationOnScreen: false };

describe('PDFATTACH: the Attach PDF Underlay dialog', () => {
  it('opens with Insertion point on screen, Scale 1 and Rotation 0, listing the PDF files', async () => {
    const t = drawing(4, [SHEET, { ...SHEET, handle: '92', name: 'sheet - 1', page: '1' }]);
    await t.bus.submit('PDFATTACH');
    const r = t.request();
    expect(r.settings).toEqual({
      pointOnScreen: true,
      point: { x: 0, y: 0 },
      scaleOnScreen: false,
      scale: 1,
      rotationOnScreen: false,
      rotation: 0,
    });
    expect(r.units).toBe(4);
    expect(r.unitsPerInch).toBe(25.4);
    expect(r.pdfs).toEqual([
      { name: 'sheet', fileName: '..\\plans\\sheet.pdf', pages: ['1', '2'] },
    ]);
    expect(r.note).toBeUndefined();
  });

  it('asks again with a note when OK names no file, no page or a scale of zero; Cancel attaches nothing', async () => {
    const t = drawing(0);
    await t.bus.submit('PDFATTACH');
    await t.ok(undefined);
    expect(t.request().note).toBe('Select a PDF file.');
    await t.ok({ fileName: 'x.pdf', pages: [] });
    expect(t.request().note).toBe('Select one or more pages.');
    await t.ok({ fileName: 'x.pdf', pages: [{ page: '1', width: 0, height: 3 }] });
    expect(t.request().note).toBe('Select one or more pages.');
    await t.ok(PLAN, { scale: 0 });
    expect(t.request().note).toBe('Value must be positive and nonzero.');
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
    expect(t.underlays()).toHaveLength(0);
  });
});

describe('PDFATTACH: placing the underlay', () => {
  it('takes the dialog values: a millimetre drawing gets the page at its true size', async () => {
    const t = drawing(4);
    await t.bus.submit('PDFATTACH');
    await t.ok(PLAN, { ...FIXED, point: { x: 10, y: 20 }, scale: 2 });
    expect(t.bus.command).toBeUndefined();
    const [g] = t.underlays();
    expect(g!.position).toEqual({ x: 10, y: 20 });
    // 25.4 mm an inch, twice.
    expect(g!.scale).toEqual({ x: 50.8, y: 50.8, z: 50.8 });
    expect(g!.rotation).toBe(0);
    // On, adjusted for the background; the file's own colours, unfaded; unclipped.
    expect(g).toMatchObject({ flags: 10, contrast: 100, fade: 0, clip: [] });
    // A new definition named as AutoCAD names one, filed under a new dictionary the save creates.
    const [d] = t.defsNow();
    expect(d).toMatchObject({ name: 'plan - 1', fileName: 'plan.pdf', page: '1' });
    expect(d!.owner).not.toBe(ROOT);
    expect(g!.definition).toBe(d!.handle);
  });

  it('files a new definition under the drawing’s ACAD_PDFDEFINITIONS', async () => {
    const t = drawing(1, [], { pdfDictionary: 'A0' });
    await t.bus.submit('PDFATTACH');
    await t.ok(PLAN, FIXED);
    expect(t.defsNow()[0]!.owner).toBe('A0');
    // An inch drawing: scale 1.
    expect(t.underlays()[0]!.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('asks the insertion point, scale and rotation on screen', async () => {
    const t = drawing(4);
    await t.bus.submit('PDFATTACH');
    await t.ok(PLAN, { scaleOnScreen: true, rotationOnScreen: true });
    expect(t.bus.promptText).toBe('Specify insertion point:');
    // Enter is no point: asked again.
    await t.bus.submit('');
    expect(t.bus.promptText).toBe('Specify insertion point:');
    await t.bus.submit('100,50');
    expect(t.bus.promptText).toBe('Specify scale factor <1.0000>:');
    await t.bus.submit('0.5');
    expect(t.bus.promptText).toBe('Specify rotation <0>:');
    await t.bus.submit('90');
    expect(t.bus.command).toBeUndefined();
    const [g] = t.underlays();
    expect(g!.position).toEqual({ x: 100, y: 50 });
    expect(g!.scale.x).toBe(12.7);
    expect(r6(g!.rotation)).toBe(r6(Math.PI / 2));
  });

  it('takes Enter as the scale 1, refuses a scale that is not positive, and opens on the last settings', async () => {
    const t = drawing(0);
    setHeader(t.model, '$MEASUREMENT', 0);
    await t.bus.submit('PDFATTACH');
    await t.ok(PLAN, { scaleOnScreen: true, rotation: Math.PI / 2 });
    await t.bus.script(['5,5', '-2']);
    expect(t.log).toContain('Value must be positive and nonzero.');
    await t.bus.submit('');
    expect(t.bus.command).toBeUndefined();
    const [g] = t.underlays();
    // A unitless drawing in inches (MEASUREMENT 0, imperial): scale 1, turned 90°.
    expect(g!.scale.x).toBe(1);
    expect(r6(g!.rotation)).toBe(r6(Math.PI / 2));
    await t.bus.submit('PDFATTACH');
    expect(t.request().settings).toMatchObject({ scaleOnScreen: true, rotation: Math.PI / 2 });
  });

  it('places the pages selected side by side, an inch at the scale apart, along the rotation', async () => {
    const t = drawing(4);
    await t.bus.submit('PDFATTACH');
    await t.ok(
      { fileName: 'set.pdf', pages: [A4, A3] },
      { ...FIXED, point: { x: 0, y: 0 }, rotation: Math.PI / 2 },
    );
    const [a, b] = t.underlays();
    expect(a!.position).toEqual({ x: 0, y: 0 });
    // (8.27 + 1) in × 25.4 up the Y axis.
    expect([r6(b!.position.x), r6(b!.position.y)]).toEqual([0, r6(9.27 * 25.4)]);
    expect(t.defsNow().map((d) => [d.name, d.page])).toEqual([
      ['set - 1', '1'],
      ['set - 2', '2'],
    ]);
    // Both one undo step.
    await t.bus.script(['U']);
    expect(t.underlays()).toHaveLength(0);
    expect(t.defsNow()).toHaveLength(0);
  });

  it('attaches a page the drawing shows with its definition, a new page of the file under its own', async () => {
    const t = drawing(0, [SHEET]);
    await t.bus.submit('PDFATTACH');
    await t.ok({ fileName: 'SHEET.PDF', pages: [A4, A3] }, FIXED);
    const [one, two] = t.underlays();
    expect(two!.definition).toBe('90');
    // A unitless metric drawing (MEASUREMENT 1) in millimetres.
    expect(one!.scale.x).toBe(25.4);
    expect(
      t.defsNow().map((d) => [d.handle === one!.definition, d.name, d.fileName, d.owner]),
    ).toEqual([
      [false, 'sheet - 2', '..\\plans\\sheet.pdf', '91'],
      [true, 'sheet - 1', 'SHEET.PDF', '91'],
    ]);
  });

  it('numbers a definition whose name another file has', async () => {
    const t = drawing(0, [{ ...SHEET, name: 'plan - 1', fileName: 'other.pdf', page: '1' }]);
    await t.bus.submit('PDFATTACH');
    await t.ok(PLAN, FIXED);
    expect(t.defsNow().map((d) => d.name)).toEqual(['plan - 1', 'plan-1 - 1']);
  });

  it('attaches nothing when a prompt is cancelled or the dialog answers no settings', async () => {
    const t = drawing(0);
    for (const steps of [[], ['1,1'], ['1,1', '2']]) {
      await t.bus.submit('PDFATTACH');
      await t.ok(PLAN, { scaleOnScreen: true, rotationOnScreen: true });
      await t.bus.script(steps);
      await t.bus.cancel();
      expect(t.bus.command).toBeUndefined();
    }
    await t.bus.submit('PDFATTACH');
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      pdfAttach: { file: PLAN },
    } as unknown as PromptAnswer);
    expect(t.bus.command).toBeUndefined();
    expect(t.underlays()).toHaveLength(0);
  });
});
