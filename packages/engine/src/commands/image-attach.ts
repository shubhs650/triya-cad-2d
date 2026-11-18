// IMAGEATTACH (M5-04 part 5; COMMANDS.md "Blocks and references"), alias IAT, as AutoCAD 2024's
// (AutoCAD Help, "IMAGEATTACH (Command)", "Attach Image Dialog Box"): the Attach Image dialog
// (`ImageAttachRequest`), then what it leaves Specify On-screen asked at the command line:
//   Specify insertion point <0,0>:
//   Base image size: Width: 1.000000, Height: 0.750000, Millimeters
//   Specify scale factor <1>:
//   Specify rotation angle <0>:
// The image's lower-left corner goes to the insertion point; its size follows the dialog's Scale
// as AutoCAD's help states it (edit/picture.ts `attachedImageSize`); the rotation counts from the
// current UCS's X axis, as INSERT's does. One undo step.
//
// The app picks the file and reads its size and resolution (AutoCAD's Select Reference File
// dialog and Browse...; a browser cannot name a file's folder, so the definition names the file
// alone: Path type "No path", which AutoCAD and Triya look for beside the drawing, M1-21).
// Settled for the common drafter expectation (noted in the PR):
// - the dialog opens on the settings it last closed with, per drawing (AutoCAD keeps them for the
//   session), with Insertion point and Scale Specify On-screen and Rotation 0 the first time, as
//   AutoCAD's dialog opens;
// - a file the drawing has a definition for already (its name, case aside) is attached with that
//   definition, as AutoCAD reuses an attached image's;
// - the scale prompt's Unit option is left out (AutoCAD's help does not document it; INSUNITS
//   sets the units the image is sized in).
import type { Vec2 } from '../geom/types';
import type { ImageDefinition } from '../model/types';
import {
  attachImage,
  attachedImageSize,
  definitionPpi,
  hasPixels,
  type AttachedImageFile,
} from '../edit/picture';
import { insUnitsOf } from '../model/units';
import { currentProps } from '../properties/current';
import { toWorld } from '../input/ucs';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { currentUcs } from './ucs';
import { INSUNITS_NAMES } from './drawing-units';
import { drawingUnits, formatDistance } from './units';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The Attach Image dialog's Insertion point, Scale and Rotation. */
export interface ImageAttachSettings {
  readonly pointOnScreen: boolean;
  /** The insertion point, in the current UCS. */
  readonly point: Vec2;
  readonly scaleOnScreen: boolean;
  readonly scale: number;
  readonly rotationOnScreen: boolean;
  /** Radians, from the current UCS's X axis. */
  readonly rotation: number;
}

/** An image the drawing has already, which the dialog's Name list offers. */
export interface ImageAttachEntry extends AttachedImageFile {
  /** Its IMAGEDEF's name. */
  readonly name: string;
}

/** IMAGEATTACH's Attach Image dialog. */
export interface ImageAttachRequest {
  readonly type: 'imageattach';
  readonly settings: ImageAttachSettings;
  /** The drawing's images (IMAGEDEFs), by name. */
  readonly images: readonly ImageAttachEntry[];
  /** The drawing's INSUNITS, which Image Information's sizes are in. */
  readonly units: number;
  /** Why the last OK attached nothing. */
  readonly note?: string;
}

/** The Attach Image dialog's answer: the image file and the fields as OK closed it. */
export interface ImageAttachAnswer {
  readonly file: AttachedImageFile;
  readonly settings: ImageAttachSettings;
}

/** The settings the dialog closed with last, per drawing. */
const lastSettings = new WeakMap<object, ImageAttachSettings>();

const DEFAULTS: ImageAttachSettings = {
  pointOnScreen: true,
  point: { x: 0, y: 0 },
  scaleOnScreen: true,
  scale: 1,
  rotationOnScreen: false,
  rotation: 0,
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whether `s` is settings the dialog can give (the bus hands the command any object). */
function validSettings(s: unknown): s is ImageAttachSettings {
  const v = s as ImageAttachSettings | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    finite(v.point?.x) &&
    finite(v.point?.y) &&
    finite(v.scale) &&
    finite(v.rotation)
  );
}

/** Whether `f` names a file with pixels. */
function validFile(f: unknown): f is AttachedImageFile {
  const v = f as AttachedImageFile | undefined;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.fileName === 'string' &&
    v.fileName.trim() !== '' &&
    hasPixels(v)
  );
}

function entryOf(d: ImageDefinition): ImageAttachEntry {
  const ppi = definitionPpi(d);
  return {
    name: d.name,
    fileName: d.fileName,
    width: d.size.x,
    height: d.size.y,
    ...(ppi && { ppi }),
  };
}

/** The drawing's IMAGEDEFs, by name. */
function imagesOf(ctx: CommandContext): ImageAttachEntry[] {
  const out: ImageAttachEntry[] = [];
  for (const o of ctx.model.objects.values()) {
    if (o.type === 'IMAGEDEF') out.push(entryOf(o as ImageDefinition));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The image's frame at `scale` and `rotation` with its lower-left corner at `at`. */
function frame(ctx: CommandContext, f: AttachedImageFile, at: Vec2, scale: number, rotation = 0) {
  const size = attachedImageSize(insUnitsOf(ctx.model), f, scale);
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const corner = (x: number, y: number) => ({
    x: at.x + x * c - y * s,
    y: at.y + x * s + y * c,
    bulge: 0,
  });
  return {
    kind: 'LWPOLYLINE' as const,
    closed: true,
    vertices: [corner(0, 0), corner(size.x, 0), corner(size.x, size.y), corner(0, size.y)],
  };
}

/** Attaches the file as the settings say, asking what is Specify On-screen. */
async function* place(
  ctx: CommandContext,
  f: AttachedImageFile,
  s: ImageAttachSettings,
): Sub<void> {
  const ucs = currentUcs(ctx);
  let at = toWorld(ucs, s.point);
  if (s.pointOnScreen) {
    const origin = { x: 0, y: 0 };
    ctx.preview([frame(ctx, f, origin, s.scaleOnScreen ? 1 : s.scale, ucs.angle)]);
    const a = yield ctx.prompt.point({
      message: 'Specify insertion point',
      defaultLabel: '0,0',
      drag: { kind: 'preview', from: origin },
    });
    ctx.preview([]);
    if (a.kind === 'enter') at = toWorld(ucs, origin);
    else if (a.kind === 'point') at = a.point;
    else return;
  }

  let scale = s.scale;
  if (s.scaleOnScreen) {
    const base = attachedImageSize(insUnitsOf(ctx.model), f, 1);
    const u = drawingUnits(ctx.model.header);
    ctx.message(
      `Base image size: Width: ${formatDistance(base.x, u)}, Height: ${formatDistance(base.y, u)}, ` +
        `${INSUNITS_NAMES[insUnitsOf(ctx.model)] ?? INSUNITS_NAMES[0]}`,
    );
    for (;;) {
      const a = yield ctx.prompt.distance({
        message: 'Specify scale factor',
        base: at,
        defaultLabel: '1',
      });
      if (a.kind === 'enter') scale = 1;
      else if (a.kind === 'distance') scale = a.value;
      else return;
      if (scale > 0) break;
      ctx.message('Value must be positive and nonzero.');
    }
  }

  let rotation = ucs.angle + s.rotation;
  if (s.rotationOnScreen) {
    const a = yield ctx.prompt.angle({
      message: 'Specify rotation angle',
      base: at,
      default: { kind: 'angle', value: ucs.angle },
    });
    if (a.kind !== 'angle') return;
    rotation = a.value;
  }

  const props = currentProps(ctx.model);
  ctx.edit((b) => {
    attachImage(b, ctx.model, f, ctx.space, at, scale, rotation, props);
  });
}

export function imageattachCommand(): CommandDef {
  return {
    name: 'IMAGEATTACH',
    usesSelection: 'none',
    async *run(ctx) {
      let settings: ImageAttachSettings = { ...DEFAULTS, ...lastSettings.get(ctx.model) };
      let note: string | undefined;
      for (;;) {
        const a = yield ctx.prompt.dialog({
          message: 'Attach Image',
          dialog: {
            type: 'imageattach',
            settings,
            images: imagesOf(ctx),
            units: insUnitsOf(ctx.model),
            ...(note !== undefined && { note }),
          },
        });
        if (a.kind !== 'dialog' || a.action !== 'ok') return;
        const answer = a.imageAttach;
        if (!validSettings(answer?.settings)) return;
        settings = answer.settings;
        note = !validFile(answer.file)
          ? 'Select an image file.'
          : !settings.scaleOnScreen && !(settings.scale > 0)
            ? 'Value must be positive and nonzero.'
            : undefined;
        if (note) continue;
        lastSettings.set(ctx.model, settings);
        yield* place(ctx, answer.file, settings);
        return;
      }
    },
  };
}
