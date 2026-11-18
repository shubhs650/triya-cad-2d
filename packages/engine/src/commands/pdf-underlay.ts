// The PDF underlay commands (M5-04 part 9; COMMANDS.md "Blocks and references"), with AutoCAD
// 2024's prompts:
//
// PDFCLIP (AutoCAD Help, "PDFCLIP (Command)"):
//   Select PDF to clip:
//   Enter PDF clipping option [ON/OFF/Delete/New boundary] <New boundary>:
//     ON / OFF       the clip applies, or the whole page shows; the boundary is kept
//     Delete         the boundary goes and the whole page shows again
//     New boundary   Delete old boundary? [Yes/No] <Yes>:   (when the underlay is clipped already)
//                    Outside mode - Objects outside boundary will be hidden.
//                    Specify clipping boundary [Select polyline/Polygonal/Rectangular] <Rectangular>:
//                    (Rectangular, Polygonal and Select polyline as XCLIP asks them)
//
// PDFADJUST (AutoCAD Help, "PDFADJUST (Command)"):
//   Select PDF underlay:
//   Enter PDF underlay option [Fade/Contrast/Monochrome/AdjustColorForBackground] <Fade>:
//     Fade                       Enter fade value (0-80) <0>:
//     Contrast                   Enter contrast value (0-100) <100>:
//     Monochrome                 Enter monochrome setting [Yes/No] <No>:
//     AdjustColorForBackground   Enter adjust colors for background setting [Yes/No] <Yes>:
//
// Each command is one undo step; the save writes the PDFUNDERLAY's DXF 11 and 280–282 (io
// export/entities.ts).
//
// Ambiguity: AutoCAD's PDFCLIP offers Invert clip after the boundary option; an underlay has no
// DXF group for an inverted boundary, so the option is left out (edit/underlay-clip.ts). With
// several underlays selected, PDFADJUST offers the first one's value (AutoCAD's help does not say
// which it offers), as IMAGEADJUST does.
import type { Vec2 } from '../geom/types';
import type { EntityId } from '../model/entity-ids';
import type { Entity, UnderlayGeometry } from '../model/types';
import {
  underlayClipFrom,
  withUnderlayClip,
  withUnderlayClipping,
  withoutUnderlayClip,
} from '../edit/underlay-clip';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { fromPolyline, polygonal, rectangular } from './xclip';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;
type Underlay = Entity & { geom: UnderlayGeometry };

/** DXF 280 bits PDFADJUST sets. */
const MONOCHROME = 4;
const ADJUST_COLORS = 8;

const keyword = (a: PromptAnswer): string | undefined =>
  a.kind === 'keyword' ? a.keyword : undefined;

const isUnderlay = (e: Entity | undefined): e is Underlay => e?.geom.kind === 'PDFUNDERLAY';

// ── PDFCLIP ─────────────────────────────────────────────────────────────────────────────────

/** Rectangular's corners: two along the world's axes become the rectangle's four. */
function corners(r: readonly Vec2[]): readonly Vec2[] {
  if (r.length !== 2) return r;
  const [a, b] = r as [Vec2, Vec2];
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

async function* newBoundary(ctx: CommandContext, e: Underlay): Sub<void> {
  if (e.geom.clip.length > 0) {
    const a = yield ctx.prompt.keyword({
      message: 'Delete old boundary?',
      options: ['Yes', 'No'],
      default: { kind: 'keyword', keyword: 'Yes' },
    });
    if (keyword(a) !== 'Yes') return;
  }
  ctx.message('Outside mode - Objects outside boundary will be hidden.');
  const a = yield ctx.prompt.keyword({
    message: 'Specify clipping boundary',
    options: ['Select polyline', 'Polygonal', 'Rectangular'],
    default: { kind: 'keyword', keyword: 'Rectangular' },
  });
  const how = keyword(a);
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
    const clip = underlayClipFrom(e.geom, rectangle ? corners(boundary) : boundary, { rectangle });
    if (clip) {
      ctx.edit((b) => b.updateEntity(e.id, { geom: withUnderlayClip(e.geom, clip) }));
      return;
    }
    ctx.message('The clipping boundary must enclose an area.');
  }
}

export function pdfclipCommand(): CommandDef {
  return {
    name: 'PDFCLIP',
    usesSelection: 'during',
    async *run(ctx) {
      let underlay: Underlay | undefined;
      while (!underlay) {
        const s = yield ctx.prompt.selection({
          message: 'Select PDF to clip',
          single: true,
          editable: true,
        });
        const ids: readonly EntityId[] = s.kind === 'selection' ? s.ids : [];
        if (ids.length === 0) return;
        const e = ctx.model.entity(ids[0]!);
        if (isUnderlay(e)) underlay = e;
        else ctx.message('Object is not a PDF underlay.');
      }
      const a = yield ctx.prompt.keyword({
        message: 'Enter PDF clipping option',
        options: ['ON', 'OFF', 'Delete', 'New boundary'],
        default: { kind: 'keyword', keyword: 'New boundary' },
      });
      const option = keyword(a);
      const e = underlay;
      switch (option) {
        case 'ON':
        case 'OFF': {
          if (e.geom.clip.length === 0) {
            ctx.message('The PDF underlay has no clipping boundary.');
            return;
          }
          const geom = withUnderlayClipping(e.geom, option === 'ON');
          if (geom.flags !== e.geom.flags) ctx.edit((b) => b.updateEntity(e.id, { geom }));
          return;
        }
        case 'Delete': {
          const geom = withoutUnderlayClip(e.geom);
          if (e.geom.clip.length > 0 || geom.flags !== e.geom.flags) {
            ctx.edit((b) => b.updateEntity(e.id, { geom }));
          }
          return;
        }
        case 'New boundary':
          yield* newBoundary(ctx, e);
          return;
      }
    },
  };
}

// ── PDFADJUST ───────────────────────────────────────────────────────────────────────────────

/** Fade and contrast: their prompt word and AutoCAD's range. */
const VALUES = {
  Fade: { field: 'fade', max: 80 },
  Contrast: { field: 'contrast', max: 100 },
} as const;

/** Monochrome and AdjustColorForBackground: their prompt words and DXF 280 bit. */
const SETTINGS = {
  Monochrome: { words: 'monochrome setting', bit: MONOCHROME },
  AdjustColorForBackground: { words: 'adjust colors for background setting', bit: ADJUST_COLORS },
} as const;

export function pdfadjustCommand(): CommandDef {
  return {
    name: 'PDFADJUST',
    usesSelection: 'during',
    async *run(ctx) {
      const s = yield ctx.prompt.selection({ message: 'Select PDF underlay', editable: true });
      const ids: readonly EntityId[] = s.kind === 'selection' ? s.ids : [];
      const underlays = ids.map((id) => ctx.model.entity(id)).filter(isUnderlay);
      const others = ids.length - underlays.length;
      if (others > 0) {
        ctx.message(
          `${others} ${others === 1 ? 'object is not a PDF underlay' : 'objects are not PDF underlays'}.`,
        );
      }
      if (underlays.length === 0) return;
      const first = underlays[0]!.geom;
      const a = yield ctx.prompt.keyword({
        message: 'Enter PDF underlay option',
        options: ['Fade', 'Contrast', 'Monochrome', 'AdjustColorForBackground'],
        default: { kind: 'keyword', keyword: 'Fade' },
      });
      const option = keyword(a);
      if (option === 'Fade' || option === 'Contrast') {
        const { field, max } = VALUES[option];
        for (;;) {
          const v = yield ctx.prompt.integer({
            message: `Enter ${field} value (0-${max})`,
            default: { kind: 'number', value: first[field] },
          });
          if (v.kind !== 'number') return;
          if (v.value < 0 || v.value > max) {
            ctx.message(`Value must be between 0 and ${max}.`);
            continue;
          }
          const value = v.value;
          const changing = underlays.filter((e) => e.geom[field] !== value);
          if (changing.length > 0) {
            ctx.edit((b) => {
              for (const e of changing) {
                b.updateEntity(e.id, { geom: { ...e.geom, [field]: value } });
              }
            });
          }
          return;
        }
      }
      if (option === 'Monochrome' || option === 'AdjustColorForBackground') {
        const { words, bit } = SETTINGS[option];
        const v = yield ctx.prompt.keyword({
          message: `Enter ${words}`,
          options: ['Yes', 'No'],
          default: { kind: 'keyword', keyword: (first.flags & bit) !== 0 ? 'Yes' : 'No' },
        });
        const k = keyword(v);
        if (k !== 'Yes' && k !== 'No') return;
        const set = (f: number) => (k === 'Yes' ? f | bit : f & ~bit);
        const changing = underlays.filter((e) => set(e.geom.flags) !== e.geom.flags);
        if (changing.length > 0) {
          ctx.edit((b) => {
            for (const e of changing) {
              b.updateEntity(e.id, { geom: { ...e.geom, flags: set(e.geom.flags) } });
            }
          });
        }
      }
    },
  };
}
