// M5-04 part 15: -XREF Path and Pathtype, and the References palette's Saved Path
// (`PromptBus.referencePath`), on the PromptBus. AutoCAD 2024 Help, "-XREF (Command)": Path
// "displays and edits the path name associated with a particular DWG reference"; Pathtype gives a
// Full, Relative or None path; "To Change the Path of a DWG Reference": "the program reloads the
// xref". The xref given a new path is loaded from it (the app's `xref` attach request), and the
// load is part of the one undo step.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  attachXref,
  DocumentModel,
  PromptBus,
  builtinCommands,
  referencePathProblem,
  setReferencePath,
  typedPath,
  withoutFolder,
  xrefLoadChange,
  type BusEvent,
  type ImageDefinition,
  type PdfDefinition,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { sampleInit } from '../model/fixtures';

/** The drawing files the app finds, by name (case aside). */
const FOUND = ['plan.dxf', 'site.dxf', 'Site Plan.dwg'];
const found = (path: string) => {
  const name = withoutFolder(path).toUpperCase();
  return FOUND.some((f) => f.toUpperCase() === name);
};

/**
 * A drawing with xref "plan" attached from `C:\work\plan.dxf` and loaded, an image and a PDF
 * page; the app loads an xref from the file its path names when it is one of `FOUND`.
 */
function drawing() {
  const model = DocumentModel.create(sampleInit());
  const requests: ViewRequest[] = [];
  const log: string[] = [];
  const bus: PromptBus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: {
      request: (r): Promise<ViewReply> => {
        requests.push(r);
        if (r.op === 'xrefFile')
          return Promise.resolve({ ok: true, xrefFile: { fileName: 'plan.dxf', units: 0 } });
        if (r.op !== 'xref' || r.action !== 'attach')
          return Promise.resolve({ ok: false, message: 'no' });
        const messages: string[] = [];
        for (const block of r.blocks) {
          const name = model.tables.blockRecords.get(block)!.name;
          if (!found(model.blocks.get(block)!.xrefPath!)) {
            messages.push(`Xref "${name}" not found.`);
            continue;
          }
          const change = xrefLoadChange(model, block, sampleInit());
          model.apply(change);
          bus.joinLoad(change);
          messages.push(`"${name}" loaded.`);
        }
        return Promise.resolve({ ok: true, messages });
      },
    },
  });
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const b = new ChangeSetBuilder(model);
  const image: ImageDefinition = {
    type: 'IMAGEDEF',
    handle: b.allocateHandle(),
    owner: '0',
    name: 'photo',
    fileName: '.\\img\\photo.png',
    size: { x: 10, y: 10 },
    pixelSize: { x: 1, y: 1 },
    loaded: true,
    units: 0,
  };
  const pdf: PdfDefinition = {
    type: 'PDFDEFINITION',
    handle: b.allocateHandle(),
    owner: '0',
    name: 'sheet - 1',
    fileName: 'D:\\pdf\\sheet.pdf',
    page: '1',
  };
  b.adoptObject(image);
  b.adoptObject(pdf);
  model.apply(b.build());
  const xref = () => [...model.tables.blockRecords.values()].find((r) => r.name === 'plan')!.handle;
  const def = () => model.blocks.get(xref())!;
  return { model, bus, log, requests, xref, def, image: image.handle, pdf: pdf.handle };
}

/** `drawing()` with "plan" attached at 0,0 and its saved path `C:\work\plan.dxf`. */
async function attached() {
  const t = drawing();
  await t.bus.script(['-XREF', 'A', 'plan', '0,0', '', '', '']);
  const b = new ChangeSetBuilder(t.model);
  b.updateBlock(t.xref(), { xrefPath: 'C:\\work\\plan.dxf' });
  t.model.apply(b.build());
  t.bus.undo.clear();
  t.log.length = 0;
  return t;
}

describe('-XREF Path and Pathtype (M5-04 part 15)', () => {
  it('offers Path and pathType', async () => {
    const t = drawing();
    await t.bus.script(['-XREF']);
    expect(t.bus.promptText).toBe(
      'Enter an option [?/Bind/Detach/Path/pathType/Unload/Reload/Overlay/Attach] <Attach>:',
    );
    await t.bus.script(['P']);
    expect(t.bus.promptText).toBe('Edit path for which xref(s):');
    await t.bus.cancel();
    await t.bus.script(['-XREF', 'T']);
    expect(t.bus.promptText).toBe('Edit xref name(s) to edit path type:');
  });

  it('Path shows the old path, takes the new one and reloads the xref from it: one undo step', async () => {
    const t = await attached();
    const before = t.def().xrefLoaded;
    await t.bus.script(['-XREF', 'P', 'pl*']);
    expect(t.log).toEqual(
      expect.arrayContaining(['Xref name: plan', 'Old path: C:\\work\\plan.dxf']),
    );
    expect(t.bus.promptText).toBe('Enter new path:');
    await t.bus.script(['"D:\\new folder\\site.dxf"']);
    expect(t.def().xrefPath).toBe('D:\\new folder\\site.dxf');
    // Loaded again, from the new file: new content.
    expect(t.def().xrefLoaded?.length).toBeGreaterThan(0);
    expect(t.def().xrefLoaded).not.toEqual(before);
    expect(t.log).toContain('"plan" loaded.');
    expect(t.requests.at(-1)).toEqual({ op: 'xref', action: 'attach', blocks: [t.xref()] });
    expect(t.bus.command).toBeUndefined();
    expect(t.bus.undo.state.nextUndo).toBe('XREF');
    await t.bus.script(['U']);
    expect(t.def().xrefPath).toBe('C:\\work\\plan.dxf');
    expect(t.def().xrefLoaded).toEqual(before);
    await t.bus.script(['REDO']);
    expect(t.def().xrefPath).toBe('D:\\new folder\\site.dxf');
    expect(t.def().xrefLoaded?.length).toBeGreaterThan(0);
  });

  it('a path whose file is not found leaves the xref waiting for it', async () => {
    const t = await attached();
    await t.bus.script(['-XREF', 'P', 'plan', 'elevation.dxf']);
    expect(t.def()).toMatchObject({ xrefPath: 'elevation.dxf' });
    expect(t.def().xrefLoaded).toBeUndefined();
    expect(t.log).toContain('Xref "plan" not found.');
  });

  it('Enter keeps the path; an unloaded xref stays unloaded with its new path', async () => {
    const t = await attached();
    await t.bus.script(['-XREF', 'P', 'plan', '']);
    expect(t.def().xrefPath).toBe('C:\\work\\plan.dxf');
    expect(t.bus.undo.state.nextUndo).toBeUndefined();
    const b = new ChangeSetBuilder(t.model);
    setReferencePath(b, t.model, t.xref(), 'C:\\work\\plan.dxf');
    expect(b.build()).toEqual({});
    // Unloaded (XREF Unload is no undo step).
    const u = new ChangeSetBuilder(t.model);
    u.updateBlock(t.xref(), { xrefLoaded: undefined, xrefHandles: undefined, xrefUnloaded: true });
    t.model.apply(u.build());
    const asked = t.requests.length;
    await t.bus.script(['-XREF', 'P', 'plan', 'site.dxf']);
    expect(t.def()).toMatchObject({ xrefPath: 'site.dxf', xrefUnloaded: true });
    expect(t.requests).toHaveLength(asked);
  });

  it('names no xref: says so', async () => {
    const t = await attached();
    await t.bus.script(['-XREF', 'P', 'elev*']);
    expect(t.log).toContain('No matching xref names found.');
    expect(t.bus.command).toBeUndefined();
  });

  it('a nested xref keeps the path its parent file saves', async () => {
    const t = await attached();
    // An xref the load of "plan" brought in: nested in it.
    const b = new ChangeSetBuilder(t.model);
    const nested = attachXref(b, t.model, { fileName: 'child.dxf', units: 0 }, false);
    b.updateBlock(t.xref(), { xrefLoaded: [...t.def().xrefLoaded!, nested] });
    t.model.apply(b.build());
    expect(referencePathProblem(t.model, nested, 'x.dxf')).toMatch(/is nested in "plan"/);
    expect(referencePathProblem(t.model, t.xref(), '  ')).toBe(
      'A path names a file: "plan" keeps its path.',
    );
    expect(referencePathProblem(t.model, 'FFFF', 'x.dxf')).toBe('No reference FFFF.');
  });

  it('Pathtype None keeps the file name alone; Full and Relative are refused with the reason', async () => {
    const t = await attached();
    await t.bus.script(['-XREF', 'T', 'plan']);
    expect(t.bus.promptText).toBe('New path type [Full/Relative/None] <None>:');
    await t.bus.script(['R']);
    expect(t.log).toContain(
      'Triya cannot make a relative path: the browser does not tell which folder a file is in.',
    );
    expect(t.def().xrefPath).toBe('C:\\work\\plan.dxf');
    t.log.length = 0;
    await t.bus.script(['-XREF', 'T', 'plan', '']);
    expect(t.def().xrefPath).toBe('plan.dxf');
    expect(t.log).toEqual(
      expect.arrayContaining(['Xref "plan" path changed to plan.dxf', '"plan" loaded.']),
    );
    expect(t.bus.undo.state.nextUndo).toBe('XREF');
    t.log.length = 0;
    await t.bus.script(['-XREF', 'T', 'plan', 'N']);
    expect(t.log).toContain('Xref "plan" has no path: plan.dxf');
  });

  it('the palette gives images, PDFs and xrefs a path in one undo step the command line does not echo', async () => {
    const t = await attached();
    await t.bus.referencePath([
      { handle: t.image, path: 'photo.png' },
      { handle: t.pdf, path: 'E:\\sheets\\sheet.pdf' },
      { handle: t.xref(), path: 'site.dxf' },
    ]);
    expect(t.model.objects.get(t.image)).toMatchObject({ fileName: 'photo.png', name: 'photo' });
    expect(t.model.objects.get(t.pdf)).toMatchObject({ fileName: 'E:\\sheets\\sheet.pdf' });
    expect(t.def()).toMatchObject({ xrefPath: 'site.dxf' });
    expect(t.def().xrefLoaded?.length).toBeGreaterThan(0);
    expect(t.log).toEqual(['"plan" loaded.']);
    expect(t.bus.undo.state.nextUndo).toBe('XREF');
    await t.bus.script(['U']);
    expect(t.model.objects.get(t.image)).toMatchObject({ fileName: '.\\img\\photo.png' });
    expect(t.def().xrefPath).toBe('C:\\work\\plan.dxf');
    // A problem is said, the rest done.
    await t.bus.referencePath([
      { handle: t.image, path: '' },
      { handle: t.pdf, path: 'sheet.pdf' },
    ]);
    expect(t.log).toContain('A path names a file: "photo" keeps its path.');
    expect(t.model.objects.get(t.pdf)).toMatchObject({ fileName: 'sheet.pdf' });
  });

  it('typed paths lose their blanks and quotes', () => {
    expect(typedPath('  "C:\\a b\\c.dxf" ')).toBe('C:\\a b\\c.dxf');
    expect(typedPath('c.dxf')).toBe('c.dxf');
    expect(withoutFolder('..\\x/y.dwg')).toBe('y.dwg');
  });
});
