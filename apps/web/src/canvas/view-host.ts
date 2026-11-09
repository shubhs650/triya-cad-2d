// The app's side of the view host (M2-02 part 2): answers the view commands' requests (ZOOM,
// PAN, REGEN, VIEW) with the canvas of the space shown, the same calls the navigation bar makes.
// Every request gets a reply, a refusal when nothing is shown, because the command waits for it.
// The file commands (QSAVE, SAVEAS, CLOSE; M2-13) go to the app's `file`.
// Selection asks it too (M2-03): what a pick or a window takes, and ZOOM Object's extents, which
// the renderer answers, so those replies come later.
import type {
  Box,
  EntityId,
  FileAction,
  MTextGeometry,
  NamedViewInfo,
  Vec2,
  ViewReply,
  ViewRequest,
  ViewState,
} from '@triya/engine';
import type { ViewTransform } from '@triya/render';
import type { CanvasMode } from './controller';
import type { ViewportSize } from './navigate';
import { windowView } from './views';

/** What the view host needs of a canvas (CanvasController's view calls). */
export interface ViewTarget {
  readonly view: ViewTransform | undefined;
  readonly size: ViewportSize;
  readonly isLayout: boolean;
  readonly mode: CanvasMode;
  zoomExtents(): void;
  zoomAll(): void;
  zoomPrevious(): boolean;
  zoomScale(factor: number): void;
  zoomLimits(factor: number): void;
  zoomWindow(a: Vec2, b: Vec2): void;
  zoomCenter(center: Vec2, height: number): void;
  panWorld(by: Vec2): void;
  show(view: ViewTransform): void;
  setMode(mode: CanvasMode): void;
  regen(): void;
  pick(point: Vec2): Promise<EntityId[]>;
  selectWindow(a: Vec2, b: Vec2, crossing: boolean): Promise<EntityId[]>;
  zoomObjects(ids: readonly EntityId[]): Promise<boolean>;
  /** The box an MTEXT's glyphs fill (M2-09), or undefined when no loaded font draws it. */
  textBox(text: MTextGeometry): Promise<Box | undefined>;
}

/** A named view of the space shown; `view` is undefined when a 2D canvas cannot show it. */
export interface NamedView {
  readonly name: string;
  readonly inDrawing: boolean;
  readonly view: ViewTransform | undefined;
}

export interface ViewContext {
  /** The current viewport of the space shown, or undefined. */
  readonly target: ViewTarget | undefined;
  /** Every viewport of the space shown, for REGENALL. */
  readonly all: () => readonly ViewTarget[];
  /** The space's named views, as `target` would show them. */
  readonly views: () => readonly NamedView[];
  /** Saves a view of the space shown for the session (VIEW Save, as the navigation bar's). */
  readonly save: (name: string, view: ViewTransform) => void;
  /** QSAVE, SAVEAS and CLOSE (M2-13): the app saves or closes the drawing. */
  readonly file?: (action: FileAction) => Promise<ViewReply>;
}

export const NO_CANVAS = 'There is no view to change.';
export const NO_FILE = 'There is no drawing to save.';

export function stateOf(t: ViewTarget): ViewState | undefined {
  const v = t.view;
  if (!v || !(t.size.width > 0) || !(t.size.height > 0)) return undefined;
  return {
    center: v.center,
    height: t.size.height / v.scale,
    width: t.size.width / v.scale,
    paper: t.isLayout,
  };
}

export function answerView(r: ViewRequest, ctx: ViewContext): ViewReply | Promise<ViewReply> {
  // The file commands need the drawing, not a canvas.
  if (r.op === 'file') return ctx.file ? ctx.file(r.action) : { ok: false, message: NO_FILE };
  const t = ctx.target;
  if (!t || !stateOf(t)) return { ok: false, message: NO_CANVAS };
  const done = (): ViewReply => {
    const view = stateOf(t);
    return view ? { ok: true, view } : { ok: true };
  };
  switch (r.op) {
    case 'get':
      return done();
    case 'extents':
      t.zoomExtents();
      return done();
    case 'all':
      t.zoomAll();
      return done();
    case 'previous':
      return t.zoomPrevious() ? done() : { ok: false, message: 'No previous view saved.' };
    case 'scale':
      if (r.relativeTo === 'view') t.zoomScale(r.factor);
      // nXP is relative to paper space units: in a layout's paper space those are its own
      // units, so it scales as n against the layout's limits. Model space shown on its own tab
      // has no paper space to measure against; AutoCAD documents nXP for layout viewports only,
      // so we refuse it there rather than guess (a floating viewport's MSPACE comes later).
      else if (r.relativeTo === 'paper' && !t.isLayout) {
        return { ok: false, message: 'nXP needs paper space: use it in a layout, or nX here.' };
      } else t.zoomLimits(r.factor);
      return done();
    case 'window':
      t.zoomWindow(r.a, r.b);
      return done();
    case 'center':
      t.zoomCenter(r.center, r.height);
      return done();
    case 'pan':
      t.panWorld(r.by);
      return done();
    case 'realtime':
      t.setMode(r.mode);
      return done();
    case 'regen':
      for (const c of r.all ? ctx.all() : [t]) c.regen();
      return done();
    case 'views':
      return {
        ok: true,
        views: ctx.views().map((v): NamedViewInfo => ({
          name: v.name,
          inDrawing: v.inDrawing,
          restorable: v.view !== undefined,
        })),
      };
    case 'restore': {
      const found = ctx.views().find((v) => v.name.toUpperCase() === r.name.toUpperCase());
      if (!found) return { ok: false, message: `Cannot find view "${r.name}".` };
      if (!found.view) {
        return {
          ok: false,
          message: `View "${found.name}" is not a plan view; it cannot be shown yet.`,
        };
      }
      t.show(found.view);
      return done();
    }
    case 'pick':
      return t.pick(r.point).then((ids) => ({ ok: true, ids }));
    case 'select':
      return t.selectWindow(r.a, r.b, r.crossing).then((ids) => ({ ok: true, ids }));
    case 'objects':
      return t
        .zoomObjects(r.ids)
        .then((ok) => (ok ? done() : { ok: false, message: 'The objects have no extents.' }));
    case 'textBox':
      return t
        .textBox(r.text)
        .then((box) =>
          box ? { ok: true, box } : { ok: false, message: 'The text cannot be measured.' },
        );
    case 'save': {
      const view = r.window ? windowView(r.window.a, r.window.b, t.size) : t.view;
      if (!view) return { ok: false, message: 'The window has no area.' };
      ctx.save(r.name, view);
      return done();
    }
  }
}
