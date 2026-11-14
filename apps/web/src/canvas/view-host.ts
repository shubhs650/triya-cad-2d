// The app's side of the view host (M2-02 part 2): answers the view commands' requests (ZOOM,
// PAN, REGEN, VIEW) with the canvas of the space shown, the same calls the navigation bar makes.
// Every request gets a reply, a refusal when nothing is shown, because the command waits for it.
// The file commands (QSAVE, SAVEAS, CLOSE; M2-13) go to the app's `file`, the Clipboard commands'
// requests (M2-14 part 2) to its `clipboard`.
// Selection asks it too (M2-03): what a pick or a window takes, and ZOOM Object's extents, which
// the renderer answers, so those replies come later.
import type {
  Box,
  Clipboard,
  EntityId,
  FileAction,
  MTextGeometry,
  NamedViewInfo,
  PaletteName,
  PatternPlacement,
  TextGeometry,
  TextOutline,
  UndoView,
  Vec2,
  ViewReply,
  ViewRequest,
  ViewState,
} from '@triya/engine';
import type { ViewTransform } from '@triya/render';
import type { CanvasMode } from './controller';
import type { ViewportSize } from './navigate';

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
  /**
   * Resolves true once the canvas shows a view (at once if it does), false if none comes soon:
   * a just-opened drawing without a saved view shows its extents only after the renderer has
   * measured it.
   */
  whenViewed(): Promise<boolean>;
  pick(point: Vec2): Promise<EntityId[]>;
  selectWindow(a: Vec2, b: Vec2, crossing: boolean): Promise<EntityId[]>;
  zoomObjects(ids: readonly EntityId[]): Promise<boolean>;
  /** The box an MTEXT's glyphs fill (M2-09), or undefined when no loaded font draws it. */
  textBox(text: MTextGeometry): Promise<Box | undefined>;
  /** The widths MTEXTs are laid out at (M2-10 part 3), null for one no loaded font draws. */
  textWidths(texts: readonly MTextGeometry[]): Promise<(number | null)[]>;
  /** How many dynamic columns MTEXTs take (M2-26 part 2), null for one no loaded font draws. */
  columnCounts(texts: readonly MTextGeometry[]): Promise<(number | null)[]>;
  /** Where texts lie as drawn (M2-27), null for one no loaded font draws. */
  textOutlines(texts: readonly (TextGeometry | MTextGeometry)[]): Promise<(TextOutline | null)[]>;
  /**
   * A view step undone or redone (M2-47 part 4): shows `view`, recorded for neither ZOOM
   * Previous nor the undo history, and answers with the view it replaced (none before the
   * canvas first showed one).
   */
  swapView(view: UndoView): UndoView | undefined;
  /** The pickbox's half size in world units (M2-27: an attribute picked by its text). */
  readonly pickbox: number;
  /** The objects' extents as drawn (M2-14 part 2: COPYCLIP's base point), or undefined. */
  boundsOf(ids: readonly EntityId[]): Promise<Box | undefined>;
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
  /**
   * The canvas a view step names (M2-47 part 4), shown or not, by the name its `view-step`
   * input gave it; undefined once it is gone.
   */
  readonly viewport?: (key: string) => ViewTarget | undefined;
  /**
   * QSAVE, SAVEAS and CLOSE (M2-13): the app saves or closes the drawing; PLOT's `window` is the
   * plot window just picked (M2-17 part 2).
   */
  readonly file?: (
    action: FileAction,
    window?: { readonly a: Vec2; readonly b: Vec2 },
    /** PLOT opens its dialog again as it closed (M2-17 part 3). */
    resume?: boolean,
  ) => Promise<ViewReply>;
  /**
   * The app's Clipboard (M2-14 part 2), which every drawing shares: `content` puts objects on
   * it, none reads it (and the system clipboard first, M2-32 part 5).
   */
  readonly clipboard?: (content: Clipboard | undefined) => ViewReply | Promise<ViewReply>;
  /** PROPERTIES and PROPERTIESCLOSE (M2-21): the app opens or closes the palette. */
  readonly palette?: (name: PaletteName, open: boolean) => ViewReply;
  /**
   * -PLOT (M2-17 part 5): a space's plot settings, and a plot made without the dialog; -EXPORT's
   * export (M2-39 part 5).
   */
  readonly plot?: (r: PlotScriptRequest) => Promise<ViewReply>;
  /** Properties' Pattern name (M2-35 part 3): a pattern from the app's library, placed. */
  readonly hatchPattern?: (name: string, placements: readonly PatternPlacement[]) => ViewReply;
  /**
   * SETVAR (M2-42): a system variable the app keeps (the drafting aids, the per-user settings),
   * set to `value` when given, answered with its value.
   */
  readonly sysvar?: (name: string, value?: number) => ViewReply;
}

/** What -PLOT and -EXPORT (M2-39 part 5) ask of the app. */
export type PlotScriptRequest = Extract<
  ViewRequest,
  { op: 'plotSetup' | 'plotScript' | 'exportScript' }
>;

export const NO_CANVAS = 'There is no view to change.';
export const NO_FILE = 'There is no drawing to save.';
export const NO_CLIPBOARD = 'There is no Clipboard here.';
export const NO_PALETTE = 'There are no palettes here.';
export const NO_PATTERNS = 'There is no pattern library here.';
export const NO_SETTINGS = 'There are no settings here.';

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
  if (r.op === 'file') {
    return ctx.file ? ctx.file(r.action, r.window, r.resume) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'plotSetup' || r.op === 'plotScript' || r.op === 'exportScript') {
    return ctx.plot ? ctx.plot(r) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'palette') {
    return ctx.palette ? ctx.palette(r.palette, r.open) : { ok: false, message: NO_PALETTE };
  }
  if (r.op === 'hatchPattern') {
    return ctx.hatchPattern
      ? ctx.hatchPattern(r.name, r.placements)
      : { ok: false, message: NO_PATTERNS };
  }
  if (r.op === 'sysvar') {
    return ctx.sysvar ? ctx.sysvar(r.name, r.value) : { ok: false, message: NO_SETTINGS };
  }
  if (r.op === 'clipboard') {
    return ctx.clipboard ? ctx.clipboard(r.content) : { ok: false, message: NO_CLIPBOARD };
  }
  if (r.op === 'swap') {
    // Not the space shown: the viewport the step was made in, which U may reach from another.
    const v = ctx.viewport?.(r.viewport);
    const replaced = v?.swapView(r.view);
    if (!v || !replaced) return { ok: false, message: NO_CANVAS };
    const { width, height } = v.size;
    return {
      ok: true,
      view: {
        ...replaced,
        width: height > 0 ? (replaced.height * width) / height : replaced.height,
        paper: v.isLayout,
      },
    };
  }
  const t = ctx.target;
  if (t && !t.view && t.size.width > 0 && t.size.height > 0) {
    // A view command typed as the drawing opens (ZOOM straight after it shows) reaches a sized
    // canvas still waiting for its first view: it waits for it rather than finding no view.
    return t
      .whenViewed()
      .then((ok) => (ok ? answerView(r, ctx) : { ok: false, message: NO_CANVAS }));
  }
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
    case 'glance':
      // Edit Boundaries' look at a view (M2-47 part 5): no ZOOM Previous or undo step.
      t.swapView(r.view);
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
    case 'textWidths':
      return t.textWidths(r.texts).then((widths) => ({ ok: true, widths }));
    case 'columnCounts':
      return t.columnCounts(r.texts).then((counts) => ({ ok: true, counts }));
    case 'textOutlines':
      return t
        .textOutlines(r.texts)
        .then((outlines) => ({ ok: true, outlines, pickbox: t.pickbox }));
    case 'bounds':
      return t
        .boundsOf(r.ids)
        .then((box) =>
          box ? { ok: true, box } : { ok: false, message: 'The objects have no extents.' },
        );
  }
}
