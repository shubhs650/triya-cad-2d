// M5-04 part 5: IMAGEATTACH on the PromptBus, as AutoCAD 2024's (AutoCAD Help, "IMAGEATTACH
// (Command)", "Attach Image Dialog Box"):
//   - the Attach Image dialog lists the drawing's images and opens with Insertion point and Scale
//     Specify On-screen, Rotation 0, then on the settings it last closed with;
//   - OK attaches the file: what is not Specify On-screen is taken from the dialog, the rest asked
//     ("Specify insertion point <0,0>", "Base image size: …", "Specify scale factor <1>",
//     "Specify rotation angle <0>"; AutoCAD's undocumented Unit option is left out);
//   - the size follows the dialog's Scale: unitless drawing or no resolution → the scale is the
//     width; otherwise the file's true width in drawing units times the scale;
//   - a new IMAGEDEF names the file (resolution in inches, else none); a file the drawing has a
//     definition for is attached with it; one undo step.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  attachedImageSize,
  definitionPpi,
  type DialogRequest,
  type DocumentModel,
  type ImageAttachSettings,
  type ImageDefinition,
  type ImageGeometry,
  type PromptAnswer,
} from '../../src/index';
import { MODEL_SPACE } from '../model/fixtures';
import { r6, setup } from './edit-harness';

type Request = Extract<DialogRequest, { type: 'imageattach' }>;

const ROOT = 'C';
const SITE: ImageDefinition = {
  type: 'IMAGEDEF',
  handle: '90',
  owner: '91',
  name: 'site',
  fileName: 'site.png',
  size: { x: 400, y: 300 },
  pixelSize: { x: 0.01, y: 0.01 },
  loaded: true,
  units: 5,
};

function setHeader(model: DocumentModel, name: string, value: number): void {
  const b = new ChangeSetBuilder(model);
  b.setHeader(name, value);
  model.apply(b.build());
}

function drawing(insUnits: number, defs: ImageDefinition[] = []) {
  const t = setup([], { objects: defs, meta: { rootDictionary: ROOT } });
  setHeader(t.model, '$INSUNITS', insUnits);
  const images = () =>
    t.model
      .blockEntities(MODEL_SPACE)
      .map((id) => t.model.entity(id)!)
      .filter((e) => e.geom.kind === 'IMAGE')
      .map((e) => e.geom as ImageGeometry);
  const defsNow = () =>
    [...t.model.objects.values()].filter((o): o is ImageDefinition => o.type === 'IMAGEDEF');
  const request = () => {
    const p = t.bus.prompt as { kind: string; dialog?: DialogRequest } | undefined;
    expect(p?.kind).toBe('dialog');
    expect(p!.dialog!.type).toBe('imageattach');
    return p!.dialog as Request;
  };
  /** OK with `file` and the dialog's settings changed by `patch`. */
  const ok = (file: unknown, patch: Partial<ImageAttachSettings> = {}) =>
    t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      imageAttach: { file, settings: { ...request().settings, ...patch } },
    } as PromptAnswer);
  return { ...t, images, defsNow, request, ok };
}

const PHOTO = { fileName: 'photo.jpg', width: 200, height: 100 };
const PLAN = { fileName: 'plan.png', width: 300, height: 150, ppi: { x: 150, y: 150 } };
const FIXED = { pointOnScreen: false, scaleOnScreen: false, rotationOnScreen: false };

describe('IMAGEATTACH: the Attach Image dialog', () => {
  it('opens with Insertion point and Scale on screen, listing the images and the units', async () => {
    const t = drawing(4, [SITE]);
    await t.bus.submit('IAT');
    const r = t.request();
    expect(r.settings).toEqual({
      pointOnScreen: true,
      point: { x: 0, y: 0 },
      scaleOnScreen: true,
      scale: 1,
      rotationOnScreen: false,
      rotation: 0,
    });
    expect(r.units).toBe(4);
    expect(r.images).toEqual([
      { name: 'site', fileName: 'site.png', width: 400, height: 300, ppi: { x: 100, y: 100 } },
    ]);
    expect(r.note).toBeUndefined();
  });

  it('asks again with a note when OK names no file or a scale of zero; Cancel attaches nothing', async () => {
    const t = drawing(0);
    await t.bus.submit('IMAGEATTACH');
    await t.ok(undefined);
    expect(t.request().note).toBe('Select an image file.');
    await t.ok({ fileName: 'x.png', width: 0, height: 10 });
    expect(t.request().note).toBe('Select an image file.');
    await t.ok(PHOTO, { scaleOnScreen: false, scale: 0 });
    expect(t.request().note).toBe('Value must be positive and nonzero.');
    await t.bus.cancel();
    expect(t.bus.command).toBeUndefined();
    expect(t.images()).toHaveLength(0);
  });
});

describe('IMAGEATTACH: placing the image', () => {
  it('takes the dialog values: in a unitless drawing the scale is the width', async () => {
    const t = drawing(0);
    await t.bus.submit('IMAGEATTACH');
    await t.ok(PHOTO, { ...FIXED, point: { x: 10, y: 20 }, scale: 50 });
    expect(t.bus.command).toBeUndefined();
    const [g] = t.images();
    expect(g!.position).toEqual({ x: 10, y: 20 });
    // 50 wide, square pixels: 0.25 a pixel.
    expect(g!.u).toEqual({ x: 0.25, y: 0 });
    expect([r6(g!.v.x), r6(g!.v.y)]).toEqual([0, 0.25]);
    expect(g!.size).toEqual({ x: 200, y: 100 });
    expect(g).toMatchObject({ displayFlags: 7, clipping: false, brightness: 50, contrast: 50 });
    expect(g!.clip.vertices).toEqual([
      { x: -0.5, y: -0.5 },
      { x: 199.5, y: 99.5 },
    ]);
    // A new definition named after the file; no resolution (DXF 281 0, a pixel 1 by 1); filed
    // under a new dictionary the save creates.
    const [d] = t.defsNow();
    expect(d).toMatchObject({
      name: 'photo',
      fileName: 'photo.jpg',
      size: { x: 200, y: 100 },
      pixelSize: { x: 1, y: 1 },
      units: 0,
      loaded: true,
    });
    expect(g!.definition).toBe(d!.handle);
  });

  it('sizes a file with a resolution at its true size in drawing units, times the scale', async () => {
    const t = drawing(4);
    await t.bus.submit('IMAGEATTACH');
    await t.ok(PLAN, { ...FIXED, scale: 2 });
    const [g] = t.images();
    // 300 px at 150 ppi = 2 in = 50.8 mm; twice that.
    expect(r6(g!.u.x * 300)).toBe(101.6);
    expect(r6(g!.v.y * 150)).toBe(50.8);
    expect(t.defsNow()[0]).toMatchObject({
      pixelSize: { x: 1 / 150, y: 1 / 150 },
      units: 5,
    });
  });

  it('asks the insertion point, scale and rotation on screen', async () => {
    const t = drawing(4);
    await t.bus.submit('IMAGEATTACH');
    await t.ok(PLAN, { rotationOnScreen: true });
    expect(t.bus.promptText).toBe('Specify insertion point <0,0>:');
    await t.bus.submit('100,50');
    expect(t.log).toContain('Base image size: Width: 50.8000, Height: 25.4000, Millimeters');
    expect(t.bus.promptText).toBe('Specify scale factor <1>:');
    await t.bus.submit('0.5');
    expect(t.bus.promptText).toBe('Specify rotation angle <0>:');
    await t.bus.submit('90');
    expect(t.bus.command).toBeUndefined();
    const [g] = t.images();
    expect(g!.position).toEqual({ x: 100, y: 50 });
    // Half of 50.8 wide, turned 90°: U runs up the Y axis, V back along -X.
    expect([r6(g!.u.x * 300), r6(g!.u.y * 300)]).toEqual([0, 25.4]);
    expect([r6(g!.v.x * 150), r6(g!.v.y * 150)]).toEqual([-12.7, 0]);
  });

  it('takes Enter as the insertion point 0,0 and the scale 1, and opens on the last settings', async () => {
    const t = drawing(0);
    await t.bus.submit('IMAGEATTACH');
    await t.ok(PHOTO, { rotation: Math.PI / 2 });
    await t.bus.script(['', '']);
    expect(t.bus.command).toBeUndefined();
    const [g] = t.images();
    expect(g!.position).toEqual({ x: 0, y: 0 });
    expect([r6(g!.u.x * 200), r6(g!.u.y * 200)]).toEqual([0, 1]);
    await t.bus.submit('IMAGEATTACH');
    expect(t.request().settings.rotation).toBe(Math.PI / 2);
  });

  it('refuses a scale that is not positive and asks again', async () => {
    const t = drawing(0);
    await t.bus.submit('IMAGEATTACH');
    await t.ok(PHOTO);
    await t.bus.script(['', '-2']);
    expect(t.log).toContain('Value must be positive and nonzero.');
    await t.bus.submit('3');
    expect(t.bus.command).toBeUndefined();
    expect(r6(t.images()[0]!.u.x * 200)).toBe(3);
  });

  it('attaches a file the drawing has with its definition, another of the same name under a new one', async () => {
    const t = drawing(0, [SITE]);
    await t.bus.submit('IMAGEATTACH');
    await t.ok({ fileName: 'SITE.PNG', width: 400, height: 300 }, FIXED);
    expect(t.images()[0]!.definition).toBe('90');
    await t.bus.submit('IMAGEATTACH');
    await t.ok({ fileName: 'site.jpg', width: 40, height: 30 }, FIXED);
    expect(t.defsNow().map((d) => [d.name, d.fileName, d.owner])).toEqual([
      ['site', 'site.png', '91'],
      ['site-1', 'site.jpg', '91'],
    ]);
  });

  it('attaches nothing when a prompt is cancelled or the dialog answers no settings', async () => {
    const t = drawing(0);
    for (const steps of [[], ['1,1'], ['1,1', '2']]) {
      await t.bus.submit('IMAGEATTACH');
      await t.ok(PHOTO, { rotationOnScreen: true });
      await t.bus.script(steps);
      await t.bus.cancel();
      expect(t.bus.command).toBeUndefined();
    }
    await t.bus.submit('IMAGEATTACH');
    await t.bus.answer({
      kind: 'dialog',
      action: 'ok',
      imageAttach: { file: PHOTO },
    } as PromptAnswer);
    expect(t.bus.command).toBeUndefined();
    expect(t.images()).toHaveLength(0);
  });

  it('is one undo step', async () => {
    const t = drawing(0);
    await t.bus.submit('IMAGEATTACH');
    await t.ok(PHOTO, FIXED);
    expect(t.images()).toHaveLength(1);
    await t.bus.script(['U']);
    expect(t.images()).toHaveLength(0);
    expect(t.defsNow()).toHaveLength(0);
  });
});

describe('attachedImageSize and definitionPpi', () => {
  it('follow the resolution units and AutoCAD sizing rule', () => {
    expect(attachedImageSize(1, PLAN, 1)).toEqual({ x: 2, y: 1 });
    // A resolution with non-square pixels keeps their shape when the scale is the width.
    expect(attachedImageSize(0, { ...PLAN, ppi: { x: 150, y: 75 } }, 3)).toEqual({ x: 3, y: 3 });
    expect(definitionPpi(SITE)).toEqual({ x: 100, y: 100 });
    expect(definitionPpi({ ...SITE, units: 2 })!.x).toBeCloseTo(254, 9);
    expect(definitionPpi({ ...SITE, units: 0 })).toBeUndefined();
  });
});
