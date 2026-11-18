// The image commands (M5-04 part 4; COMMANDS.md "Blocks and references"), with AutoCAD 2024's
// prompts:
//
// IMAGECLIP (AutoCAD Help, "IMAGECLIP (Command)"), alias ICL:
//   Select image to clip:
//   Enter image clipping option [ON/OFF/Delete/New boundary] <New>:
//     ON / OFF       the clip applies, or the whole image shows; the boundary is kept
//     Delete         the boundary goes and the whole image shows again
//     New boundary   Delete old boundary? [Yes/No] <Yes>:   (when the image is clipped already)
//                    Outside mode - Objects outside boundary will be hidden.
//                    Specify clipping boundary or select invert option
//                      [Select polyline/Polygonal/Rectangular/Invert clip] <Rectangular>:
//                    (Rectangular, Polygonal and Select polyline as XCLIP asks them; Invert clip
//                    switches to Inside mode and back)
//
// IMAGEADJUST / -IMAGEADJUST (AutoCAD Help, "IMAGEADJUST (Command)", "Image Adjust Dialog Box",
// "-IMAGEADJUST (Command)"), alias IAD:
//   Select image(s):
//   IMAGEADJUST on one image opens the Image Adjust dialog (`ImageAdjustRequest`: Brightness,
//   Contrast and Fade 0–100, the Image Preview, Reset); on several, and -IMAGEADJUST always:
//   Enter image adjust option [Contrast/Fade/Brightness] <Brightness>:
//   Enter brightness value (0-100) <50>:
//
// IMAGEQUALITY (AutoCAD Help, "IMAGEQUALITY (Command)"):
//   Enter image quality setting [High/Draft] <High>:
//
// IMAGEFRAME is a system variable (0, 1, 2), kept with IMAGEQUALITY in the drawing's
// RASTERVARIABLES (`setImageFrame`, SETVAR's `raster` store).
//
// Each command is one undo step; the save writes the IMAGE's DXF 14/71/280/290 and 281–283 and
// RASTERVARIABLES 70/71 (io export/entities.ts, export/image-objects.ts).
//
// Ambiguity: AutoCAD's help names the dialog for IMAGEADJUST without saying what it does with
// several images; the dialog shows one image's values and preview, so several are asked at the
// command line as -IMAGEADJUST asks (M5-04 part 10). With several images selected, the value
// offered is the first image's (AutoCAD's help does not say which it offers).
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type {
  Entity,
  ImageDefinition,
  ImageFrame,
  ImageGeometry,
  NonGraphicalObject,
  RasterVariables,
} from '../model/types';
import {
  imageClipFrom,
  withImageClip,
  withImageClipping,
  withoutImageClip,
} from '../edit/image-clip';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { fromPolyline, polygonal, rectangular } from './xclip';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

const keyword = (a: PromptAnswer): string | undefined =>
  a.kind === 'keyword' ? a.keyword : undefined;

const isImage = (e: Entity | undefined): e is Entity & { geom: ImageGeometry } =>
  e?.geom.kind === 'IMAGE';

/** The drawing's RASTERVARIABLES, if it has one. */
export function rasterVariables(model: DocumentModel): RasterVariables | undefined {
  for (const o of model.objects.values()) {
    if (o.type === 'RASTERVARIABLES') return o as RasterVariables;
  }
  return undefined;
}

/** IMAGEFRAME: the drawing's RASTERVARIABLES, else AutoCAD's initial 1 (shown and plotted). */
export const imageFrame = (model: DocumentModel): ImageFrame => rasterVariables(model)?.frame ?? 1;

/** IMAGEQUALITY: the drawing's RASTERVARIABLES, else AutoCAD's initial High. */
export const imageQuality = (model: DocumentModel): 'draft' | 'high' =>
  rasterVariables(model)?.quality ?? 'high';

/**
 * Sets RASTERVARIABLES fields (IMAGEFRAME, IMAGEQUALITY): in the drawing's object, made when it
 * has none and a value differs from AutoCAD's initial one (frame 1, quality high). AutoCAD files
 * it in the root dictionary as ACAD_IMAGE_VARS (the save names the entry). False, with a message,
 * when the drawing has nowhere to keep it.
 */
function setRasterVariables(
  ctx: CommandContext,
  patch: Partial<Pick<RasterVariables, 'frame' | 'quality'>>,
  name: string,
): boolean {
  const vars = rasterVariables(ctx.model);
  if (vars) {
    const changed = Object.entries(patch).some(([k, v]) => vars[k as keyof RasterVariables] !== v);
    if (changed) ctx.edit((b) => b.updateObject(vars.handle, patch as Partial<NonGraphicalObject>));
    return true;
  }
  if ((patch.frame ?? 1) === 1 && (patch.quality ?? 'high') === 'high') return true;
  const root = ctx.model.meta.rootDictionary;
  if (root === undefined) {
    ctx.message(`The drawing has no named object dictionary to keep ${name} in.`);
    return false;
  }
  ctx.edit((b) =>
    b.addObject({
      type: 'RASTERVARIABLES',
      owner: root,
      frame: 1,
      quality: 'high',
      // DXF 72, the units images are inserted in: none, as acad-ts makes the object.
      units: 0,
      ...patch,
    } as Omit<RasterVariables, 'handle'>),
  );
  return true;
}

/** Sets IMAGEFRAME (SETVAR, a variable's name typed at Command:). */
export function setImageFrame(ctx: CommandContext, frame: ImageFrame): boolean {
  return setRasterVariables(ctx, { frame }, 'IMAGEFRAME');
}

// ── IMAGECLIP ───────────────────────────────────────────────────────────────────────────────

/** Rectangular's corners: two along the world's axes become the rectangle's four. */
function corners(r: readonly Vec2[]): readonly Vec2[] {
  if (r.length !== 2) return r;
  const [a, b] = r as [Vec2, Vec2];
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

async function* newBoundary(ctx: CommandContext, e: Entity & { geom: ImageGeometry }): Sub<void> {
  if (e.geom.clipping) {
    const a = yield ctx.prompt.keyword({
      message: 'Delete old boundary?',
      options: ['Yes', 'No'],
      default: { kind: 'keyword', keyword: 'Yes' },
    });
    if (keyword(a) !== 'Yes') return;
  }
  let inverted = false;
  ctx.message('Outside mode - Objects outside boundary will be hidden.');
  for (;;) {
    const a = yield ctx.prompt.keyword({
      message: 'Specify clipping boundary or select invert option',
      options: ['Select polyline', 'Polygonal', 'Rectangular', 'Invert clip'],
      default: { kind: 'keyword', keyword: 'Rectangular' },
    });
    const how = keyword(a);
    if (how === 'Invert clip') {
      inverted = !inverted;
      ctx.message(
        inverted
          ? 'Inside mode - Objects inside boundary will be hidden.'
          : 'Outside mode - Objects outside boundary will be hidden.',
      );
      continue;
    }
    for (;;) {
      const boundary =
        how === 'Select polyline'
          ? yield* fromPolyline(ctx)
          : how === 'Polygonal'
            ? yield* polygonal(ctx)
            : how === 'Rectangular'
              ? yield* rectangular(ctx)
              : undefined;
      if (!boundary) return;
      const rectangle = how === 'Rectangular';
      const clip = imageClipFrom(e.geom, rectangle ? corners(boundary) : boundary, {
        rectangle,
        inverted,
      });
      if (clip) {
        ctx.edit((b) => b.updateEntity(e.id, { geom: withImageClip(e.geom, clip) }));
        return;
      }
      ctx.message('The clipping boundary must overlap the image.');
    }
  }
}

export function imageclipCommand(): CommandDef {
  return {
    name: 'IMAGECLIP',
    usesSelection: 'during',
    async *run(ctx) {
      let image: (Entity & { geom: ImageGeometry }) | undefined;
      while (!image) {
        const s = yield ctx.prompt.selection({
          message: 'Select image to clip',
          single: true,
          editable: true,
        });
        const ids: readonly EntityId[] = s.kind === 'selection' ? s.ids : [];
        if (ids.length === 0) return;
        const e = ctx.model.entity(ids[0]!);
        if (isImage(e)) image = e;
        else ctx.message('Object is not an image.');
      }
      const a = yield ctx.prompt.keyword({
        message: 'Enter image clipping option',
        options: ['ON', 'OFF', 'Delete', 'New boundary'],
        defaultLabel: 'New',
      });
      const option = a.kind === 'enter' ? 'New boundary' : keyword(a);
      const e = image;
      switch (option) {
        case 'ON':
        case 'OFF':
          ctx.edit((b) =>
            b.updateEntity(e.id, { geom: withImageClipping(e.geom, option === 'ON') }),
          );
          return;
        case 'Delete':
          ctx.edit((b) => b.updateEntity(e.id, { geom: withoutImageClip(e.geom) }));
          return;
        case 'New boundary':
          yield* newBoundary(ctx, e);
          return;
        default:
          return;
      }
    },
  };
}

// ── IMAGEADJUST ─────────────────────────────────────────────────────────────────────────────

const ADJUSTMENTS = {
  Brightness: 'brightness',
  Contrast: 'contrast',
  Fade: 'fade',
} as const;

/** The values the Image Adjust dialog sets (DXF 281 / 282 / 283), 0–100. */
export interface ImageAdjustSettings {
  readonly brightness: number;
  readonly contrast: number;
  readonly fade: number;
}

/**
 * IMAGEADJUST's Image Adjust dialog on one image: its values, and its IMAGEDEF's name and file,
 * which the app previews it from (absent when the image has no definition).
 */
export interface ImageAdjustRequest extends ImageAdjustSettings {
  readonly type: 'imageadjust';
  readonly name?: string;
  readonly file?: string;
}

/** A dialog value kept to a whole number 0–100, as the dialog's own fields keep it. */
const percent = (v: number, was: number): number =>
  Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : was;

/** The Image Adjust dialog on `image`; OK sets what it changed as one undo step. */
async function* adjustDialog(
  ctx: CommandContext,
  image: Entity & { geom: ImageGeometry },
): Sub<void> {
  const g = image.geom;
  const def = g.definition === undefined ? undefined : ctx.model.objects.get(g.definition);
  const file =
    def?.type === 'IMAGEDEF'
      ? { name: (def as ImageDefinition).name, file: (def as ImageDefinition).fileName }
      : {};
  const a = yield ctx.prompt.dialog({
    message: 'Image Adjust',
    dialog: {
      type: 'imageadjust',
      brightness: g.brightness,
      contrast: g.contrast,
      fade: g.fade,
      ...file,
    },
  });
  if (a.kind !== 'dialog' || a.action !== 'ok' || !a.imageAdjust) return;
  const v = a.imageAdjust;
  const next = {
    brightness: percent(v.brightness, g.brightness),
    contrast: percent(v.contrast, g.contrast),
    fade: percent(v.fade, g.fade),
  };
  if (next.brightness === g.brightness && next.contrast === g.contrast && next.fade === g.fade) {
    return;
  }
  ctx.edit((b) => b.updateEntity(image.id, { geom: { ...g, ...next } }));
}

function imageadjust(name: string): CommandDef {
  return {
    name,
    usesSelection: 'during',
    async *run(ctx) {
      const s = yield ctx.prompt.selection({ message: 'Select image(s)', editable: true });
      const ids: readonly EntityId[] = s.kind === 'selection' ? s.ids : [];
      const images = ids.map((id) => ctx.model.entity(id)).filter(isImage);
      const others = ids.length - images.length;
      if (others > 0) {
        ctx.message(
          `${others} ${others === 1 ? 'object is not an image' : 'objects are not images'}.`,
        );
      }
      if (images.length === 0) return;
      if (name === 'IMAGEADJUST' && images.length === 1) {
        yield* adjustDialog(ctx, images[0]!);
        return;
      }
      const a = yield ctx.prompt.keyword({
        message: 'Enter image adjust option',
        options: ['Contrast', 'Fade', 'Brightness'],
        default: { kind: 'keyword', keyword: 'Brightness' },
      });
      const option = keyword(a) as keyof typeof ADJUSTMENTS | undefined;
      if (!option || !(option in ADJUSTMENTS)) return;
      const field = ADJUSTMENTS[option];
      for (;;) {
        const v = yield ctx.prompt.integer({
          message: `Enter ${field} value (0-100)`,
          default: { kind: 'number', value: images[0]!.geom[field] },
        });
        if (v.kind !== 'number') return;
        if (v.value < 0 || v.value > 100) {
          ctx.message('Value must be between 0 and 100.');
          continue;
        }
        const value = v.value;
        const changing = images.filter((e) => e.geom[field] !== value);
        if (changing.length > 0) {
          ctx.edit((b) => {
            for (const e of changing) b.updateEntity(e.id, { geom: { ...e.geom, [field]: value } });
          });
        }
        return;
      }
    },
  };
}

export const imageadjustCommand = (): CommandDef => imageadjust('IMAGEADJUST');
export const imageadjustDashCommand = (): CommandDef => imageadjust('-IMAGEADJUST');

// ── IMAGEQUALITY ────────────────────────────────────────────────────────────────────────────

export function imagequalityCommand(): CommandDef {
  return {
    name: 'IMAGEQUALITY',
    async *run(ctx) {
      const a = yield ctx.prompt.keyword({
        message: 'Enter image quality setting',
        options: ['High', 'Draft'],
        default: {
          kind: 'keyword',
          keyword: imageQuality(ctx.model) === 'draft' ? 'Draft' : 'High',
        },
      });
      const k = keyword(a);
      if (k !== 'High' && k !== 'Draft') return;
      setRasterVariables(ctx, { quality: k === 'Draft' ? 'draft' : 'high' }, 'IMAGEQUALITY');
    },
  };
}
