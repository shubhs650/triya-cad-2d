// MVIEW NEw and NAmed (M6-02 part 14): a view of model space placed on the layout in a new
// layout viewport sized to show it at a scale (AutoCAD 2024 Help, "MVIEW (Command)": NEw
// "Creates and places a new view and layout viewport on the layout"; NAmed "Inserts a named view
// that was previously saved in model space together with a new layout viewport onto the current
// layout"). Both viewports are display locked and "set to a default scale".
//
// NEw shows the Model tab ("temporarily switches to a maximized view of model space"), takes the
// view's two corners there and shows the layout again; NAmed asks for a model view by name. Then
// the viewport follows the cursor until it is placed. Help gives no command-line prompts (the
// ribbon's Insert View drives them), so these are chosen, as MVIEW's others read:
//   NEw:    Specify first corner:  Specify opposite corner:
//   NAmed:  Enter view name or [?]:
//   both:   Specify viewport location or [Scale]:      the click is the viewport's centre
//           Scale: Enter viewport scale or [?] <1:50>:  a scale of the list, a:b, a=b or nXP
// The default scale is "the view's annotation scale or the most convenient scale if none exists"
// (Autodesk's own blog on Insert View). Triya's named views keep no annotation scale, so it is the
// largest scale of the drawing's scale list (AutoCAD's default list when it has none) at which the
// view fits the layout's printable area, as "automatically scaled to fit within the layout"
// (AutoCAD 2020 Help, "Have You Tried: Pre-scale Layout Viewports"); with no area to fit, the
// current annotation scale (CANNOSCALE), else 1:1.
import type { Box } from '../geom/bounds';
import type { Vec2 } from '../geom/types';
import { currentAnnotationScale } from '../annotation/annotation-scale';
import { annotationScales } from '../annotation/scale-list';
import { isPaperView, namedViewWindow, type ViewExtent } from '../edit/named-view';
import { layoutSheet } from '../layout/sheet';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { LwPolylineGeometry, ViewRecord } from '../model/types';
import type { CommandContext } from './command';
import type { Prompt, PromptAnswer } from './prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** A scale a placed viewport can have: its name and paper units per drawing unit. */
export interface ViewportScale {
  readonly name: string;
  readonly value: number;
}

/**
 * AutoCAD's default scale list (its metric SCALELISTEDIT Reset list), for a drawing that has
 * none of its own.
 */
export const DEFAULT_VIEWPORT_SCALES: readonly ViewportScale[] = [
  ['1:1', 1],
  ['1:2', 1 / 2],
  ['1:4', 1 / 4],
  ['1:5', 1 / 5],
  ['1:8', 1 / 8],
  ['1:10', 1 / 10],
  ['1:16', 1 / 16],
  ['1:20', 1 / 20],
  ['1:30', 1 / 30],
  ['1:40', 1 / 40],
  ['1:50', 1 / 50],
  ['1:100', 1 / 100],
  ['2:1', 2],
  ['4:1', 4],
  ['8:1', 8],
  ['10:1', 10],
  ['100:1', 100],
].map(([name, value]) => ({ name: name as string, value: value as number }));

/** The drawing's scale list (its ACAD_SCALELIST), else AutoCAD's default one. */
export function viewportScales(model: Pick<DocumentModel, 'objects'>): readonly ViewportScale[] {
  const own = annotationScales(model);
  return own.length > 0 ? own : DEFAULT_VIEWPORT_SCALES;
}

/**
 * The largest of `scales` at which `view` fits `area` whole, else the smallest of them (the view
 * is then larger than the area at every scale); `fallback` when there is no area.
 */
export function fittingScale(
  scales: readonly ViewportScale[],
  view: { readonly width: number; readonly height: number },
  area: Box | undefined,
  fallback: ViewportScale,
): ViewportScale {
  if (!area || scales.length === 0) return fallback;
  const w = area.maxX - area.minX;
  const h = area.maxY - area.minY;
  const fits = scales.filter((s) => view.width * s.value <= w && view.height * s.value <= h);
  const pick = (list: readonly ViewportScale[], larger: boolean) =>
    list.reduce((a, b) => (larger === b.value > a.value ? b : a));
  return fits.length > 0 ? pick(fits, true) : pick(scales, false);
}

const NUMBER = String.raw`(\d*\.?\d+(?:e[+-]?\d+)?)`;

/**
 * A typed viewport scale: a scale of `scales` by name (case ignored), `a:b` or `a=b` (paper units
 * to drawing units, as the scale list writes them) or `nXP` (ZOOM's paper scale); undefined for
 * anything else or a scale that is not positive.
 */
export function parseViewportScale(
  text: string,
  scales: readonly ViewportScale[],
): ViewportScale | undefined {
  const t = text.trim();
  const named = scales.find((s) => s.name.toUpperCase() === t.toUpperCase());
  if (named) return named;
  const ratio = new RegExp(`^${NUMBER}\\s*[:=]\\s*${NUMBER}$`, 'i').exec(t);
  if (ratio) {
    const value = Number(ratio[1]) / Number(ratio[2]);
    return value > 0 && Number.isFinite(value)
      ? { name: `${ratio[1]}:${ratio[2]}`, value }
      : undefined;
  }
  const xp = new RegExp(`^${NUMBER}\\s*xp$`, 'i').exec(t);
  if (xp) {
    const value = Number(xp[1]);
    return value > 0 && Number.isFinite(value) ? { name: `${xp[1]}xp`, value } : undefined;
  }
  return undefined;
}

/** The frame on the sheet that shows `view` at `scale`, centred on `at`. */
export function placedFrame(at: Vec2, view: ViewExtent, scale: number): Box {
  const w = (view.width * scale) / 2;
  const h = (view.height * scale) / 2;
  return { minX: at.x - w, minY: at.y - h, maxX: at.x + w, maxY: at.y + h };
}

/** The frame as a closed rectangle about the origin: what follows the cursor until placed. */
function framePreview(view: ViewExtent, scale: number): LwPolylineGeometry {
  const f = placedFrame({ x: 0, y: 0 }, view, scale);
  return {
    kind: 'LWPOLYLINE',
    vertices: [
      { x: f.minX, y: f.minY, bulge: 0 },
      { x: f.maxX, y: f.minY, bulge: 0 },
      { x: f.maxX, y: f.maxY, bulge: 0 },
      { x: f.minX, y: f.maxY, bulge: 0 },
    ],
    closed: true,
  };
}

/** What the default scale fits: the layout's printable area, else its paper, else its limits. */
function placingArea(model: DocumentModel, sheet: Handle): Box | undefined {
  const layout = model.layouts.find((l) => l.blockRecord === sheet);
  if (!layout) return undefined;
  const s = layoutSheet(layout);
  if (s) return s.printable;
  const lim = layout.limits;
  return lim && lim.max.x > lim.min.x && lim.max.y > lim.min.y
    ? { minX: lim.min.x, minY: lim.min.y, maxX: lim.max.x, maxY: lim.max.y }
    : undefined;
}

/** The scale a view is placed at to start with (the header comment says how it is chosen). */
export function defaultViewportScale(
  model: DocumentModel,
  sheet: Handle,
  view: ViewExtent,
): ViewportScale {
  const scales = viewportScales(model);
  const current = currentAnnotationScale(model);
  const fallback = current && current.value > 0 ? current : { name: '1:1', value: 1 };
  return fittingScale(scales, view, placingArea(model, sheet), fallback);
}

/** "Enter viewport scale or [?] <current>:", until a scale is typed; undefined at Esc. */
async function* scaleAsked(
  ctx: CommandContext,
  current: ViewportScale,
): Sub<ViewportScale | undefined> {
  const scales = viewportScales(ctx.model);
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter viewport scale or',
      options: ['?'],
      default: { kind: 'string', value: current.name },
    });
    if (a.kind === 'keyword' || (a.kind === 'string' && a.value.trim() === '?')) {
      ctx.message(`Scales: ${scales.map((s) => s.name).join(', ')}`);
      continue;
    }
    if (a.kind !== 'string') return undefined;
    if (a.value.trim() === '') return current;
    const s = parseViewportScale(a.value, scales);
    if (s) return s;
    ctx.message('Invalid scale.');
  }
}

/**
 * "Specify viewport location or [Scale]:" with the frame following the cursor: the frame that
 * shows `view` at the scale chosen, centred where it is clicked, or undefined at Esc.
 */
export async function* placeView(
  ctx: CommandContext,
  sheet: Handle,
  view: ViewExtent,
): Sub<Box | undefined> {
  let scale = defaultViewportScale(ctx.model, sheet, view);
  try {
    for (;;) {
      ctx.message(`Viewport scale: ${scale.name}`);
      ctx.preview([framePreview(view, scale.value)]);
      const a = yield ctx.prompt.point({
        message: 'Specify viewport location or',
        options: ['Scale'],
        drag: { kind: 'preview', from: { x: 0, y: 0 } },
      });
      if (a.kind === 'keyword') {
        ctx.preview([]);
        const s = yield* scaleAsked(ctx, scale);
        if (!s) return undefined;
        scale = s;
        continue;
      }
      if (a.kind !== 'point') return undefined;
      return placedFrame(a.point, view, scale.value);
    }
  } finally {
    ctx.preview([]);
  }
}

/** The model-space views that can be placed: plan views, as MVIEW NAmed lists them. */
const modelViews = (model: DocumentModel): ViewRecord[] =>
  [...model.tables.views.values()].filter((v) => !isPaperView(v));

/**
 * NAmed: "Enter view name or [?]:" until a model-space plan view is named; its window, or
 * undefined at Esc or Enter.
 */
export async function* namedViewAsked(ctx: CommandContext): Sub<ViewExtent | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({
      message: 'Enter view name or',
      options: ['?'],
      spaces: true,
    });
    if (a.kind === 'keyword' || (a.kind === 'string' && a.value.trim() === '?')) {
      const views = modelViews(ctx.model);
      if (views.length === 0) ctx.message('No model space views.');
      else {
        ctx.message('Model space views:');
        for (const v of views) ctx.message(`  ${v.name}`);
      }
      continue;
    }
    if (a.kind !== 'string' || a.value.trim() === '') return undefined;
    const name = a.value.trim();
    const key = name.toUpperCase();
    const view = modelViews(ctx.model).find((v) => v.name.toUpperCase() === key);
    const window = view && namedViewWindow(view);
    if (window) return window;
    ctx.message(
      view
        ? `View "${view.name}" is not a plan view; it cannot be placed yet.`
        : `Cannot find model space view "${name}".`,
    );
  }
}

/** The Model tab's name, which `{op: 'tab'}` shows (SETVAR CTAB's). */
const MODEL_TAB = 'Model';

/**
 * NEw: the Model tab shown, "Specify first corner:" and "Specify opposite corner:" there, and the
 * layout `sheet` shown again (at Esc too); the window picked, or undefined.
 */
export async function* newViewWindow(
  ctx: CommandContext,
  sheet: Handle,
): Sub<ViewExtent | undefined> {
  const layout = ctx.model.layouts.find((l) => l.blockRecord === sheet);
  const shown = await ctx.view.request({ op: 'tab', name: MODEL_TAB });
  if (!shown.ok) {
    ctx.message(shown.message);
    return undefined;
  }
  try {
    for (;;) {
      const a = yield ctx.prompt.point({ message: 'Specify first corner' });
      if (a.kind !== 'point') return undefined;
      const b = yield ctx.prompt.point({
        message: 'Specify opposite corner',
        rubberBand: { from: a.point, box: true },
      });
      if (b.kind !== 'point') return undefined;
      const width = Math.abs(b.point.x - a.point.x);
      const height = Math.abs(b.point.y - a.point.y);
      if (width > 0 && height > 0) {
        const center = { x: (a.point.x + b.point.x) / 2, y: (a.point.y + b.point.y) / 2 };
        return { center, width, height };
      }
      ctx.message('Invalid window specification.');
    }
  } finally {
    if (layout) await ctx.view.request({ op: 'tab', name: layout.name });
  }
}
