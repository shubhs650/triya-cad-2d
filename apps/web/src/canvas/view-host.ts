// The app's side of the view host (M2-02 part 2): answers the view commands' requests (ZOOM,
// PAN, REGEN, VIEW) with the canvas of the space shown, the same calls the navigation bar makes.
// Every request gets a reply, a refusal when nothing is shown, because the command waits for it.
// The file commands (QSAVE, SAVEAS, CLOSE; M2-13) go to the app's `file`, the Clipboard commands'
// requests (M2-14 part 2) to its `clipboard`.
// Selection asks it too (M2-03): what a pick or a window takes, and ZOOM Object's extents, which
// the renderer answers, so those replies come later.
import type {
  EnclosedSpace,
  Box,
  Clipboard,
  EntityId,
  NestedPick,
  FileAction,
  Handle,
  MTextGeometry,
  NamedViewInfo,
  PaletteName,
  PatternPlacement,
  TextGeometry,
  TextOutline,
  TextPiece,
  UndoView,
  Vec2,
  ViewReply,
  ViewRequest,
  ViewState,
  ViewportGeometry,
} from '@triya/engine';
import type { ViewTransform } from '@triya/render';
import type { CanvasMode } from './controller';
import type { ViewportSize } from './navigate';

/** What the view host needs of a canvas (CanvasController's view calls). */
export interface ViewTarget {
  readonly view: ViewTransform | undefined;
  readonly size: ViewportSize;
  readonly isLayout: boolean;
  /** The layout viewport made current (MSPACE, M6-02 part 3): `view` is model space's then. */
  readonly viewport: Handle | undefined;
  /**
   * That viewport's own view (M6-02 part 4), what VIEWCTR and VIEWSIZE give in it and what ZOOM
   * Center starts from.
   */
  readonly viewportView?: { center: Vec2; height: number; width: number } | undefined;
  /**
   * MSPACE and PSPACE: the viewport to work through, or none (paper space); `maximized`, VPMAX
   * (M6-02 part 7): filling the canvas until VPMIN.
   */
  setViewport(
    handle: Handle | undefined,
    geometry: ViewportGeometry | undefined,
    maximized?: boolean,
  ): void;
  readonly mode: CanvasMode;
  /** Settles once a layout viewport made current, which measures model space first, has zoomed. */
  zoomExtents(): void | Promise<void>;
  zoomAll(): void | Promise<void>;
  zoomPrevious(): boolean;
  zoomScale(factor: number): void;
  zoomLimits(factor: number): void;
  /** ZOOM nXP (M6-02 part 4): a current layout viewport's scale; on paper, as `zoomLimits`. */
  zoomPaper(factor: number): void;
  zoomWindow(a: Vec2, b: Vec2): void;
  zoomCenter(center: Vec2, height: number): void;
  panWorld(by: Vec2): void;
  show(view: ViewTransform): void;
  /**
   * A model view restored in the layout viewport made current (M6-02 part 12): `box` fills it.
   * False when no viewport whose view can change is current.
   */
  showInViewport(box: { minX: number; minY: number; maxX: number; maxY: number }): boolean;
  setMode(mode: CanvasMode): void;
  regen(): void;
  /**
   * Resolves true once the canvas shows a view (at once if it does), false if none comes soon:
   * a just-opened drawing without a saved view shows its extents only after the renderer has
   * measured it.
   */
  whenViewed(): Promise<boolean>;
  pick(point: Vec2): Promise<EntityId[]>;
  /** The dimensional constraint drawn within the pickbox of a world point (M9-03 part 10). */
  constraintAt(point: Vec2): Promise<Handle | undefined>;
  /**
   * The dimensional constraints a selection window, polygon or fence takes (M9-03 part 14):
   * `area` is the request the objects were taken with.
   */
  constraintsIn(area: ConstraintArea): Promise<Handle[]>;
  /** What a pick hit inside a block reference (M5-06 part 5). */
  pickNested(point: Vec2, id: EntityId): Promise<NestedPick | undefined>;
  selectWindow(a: Vec2, b: Vec2, crossing: boolean): Promise<EntityId[]>;
  /** What a selection polygon (WPolygon, CPolygon) or fence takes (M3-04). */
  selectPath(points: readonly Vec2[], kind: 'window' | 'crossing' | 'fence'): Promise<EntityId[]>;
  zoomObjects(ids: readonly EntityId[]): Promise<boolean>;
  /** The box an MTEXT's glyphs fill (M2-09), or undefined when no loaded font draws it. */
  textBox(text: MTextGeometry): Promise<Box | undefined>;
  /** The widths MTEXTs are laid out at (M2-10 part 3), null for one no loaded font draws. */
  textWidths(texts: readonly MTextGeometry[]): Promise<(number | null)[]>;
  /** The TEXT runs and strokes MTEXTs explode into (M3-12 part 7), null for one not drawn. */
  textPieces(texts: readonly MTextGeometry[]): Promise<(readonly TextPiece[] | null)[]>;
  /** The frames MTEXTs are laid out in (M4-09), null for one no loaded font draws. */
  textFrames(
    texts: readonly MTextGeometry[],
  ): Promise<({ readonly width: number; readonly height: number } | null)[]>;
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
  /** The space enclosed around a point by the objects shown (M3-07, MEASUREGEOM Quick). */
  enclosed(point: Vec2): Promise<EnclosedSpace | undefined>;
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
  /**
   * Model space's tiled viewports when the Model tab is shown (M6-02 part 10): each tile's
   * canvas by tile index (undefined for one not made yet) and the current tile's index.
   */
  readonly tiles?: () =>
    { readonly targets: readonly (ViewTarget | undefined)[]; readonly current: number } | undefined;
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
  /** CLEANSCREENON/OFF (M7-06): the app hides or shows its ribbon and palettes. */
  readonly cleanScreen?: (on: boolean) => ViewReply;
  /** HIDEPALETTES and SHOWPALETTES (M7-06): the app hides or shows the palettes open. */
  readonly palettes?: (shown: boolean) => ViewReply;
  /** COMMANDLINE and COMMANDLINEHIDE (M7-06 part 3): the app shows or hides its command line. */
  readonly commandLine?: (shown: boolean) => ViewReply;
  /**
   * -PLOT (M2-17 part 5): a space's plot settings, and a plot made without the dialog; -EXPORT's
   * export (M2-39 part 5).
   */
  readonly plot?: (r: PlotScriptRequest) => Promise<ViewReply>;
  /** Properties' Pattern name (M2-35 part 3): a pattern from the app's library, placed. */
  readonly hatchPattern?: (name: string, placements: readonly PatternPlacement[]) => ViewReply;
  /** -HATCH's `?` (M4-07): the library's patterns, described. */
  readonly hatchPatternList?: () => ViewReply;
  /** -LINETYPE's file (M5-08): a .lin file of the bundled set or the user's, read. */
  readonly linetypeFile?: (file: string | undefined) => ViewReply;
  /** -LINETYPE Create (M5-08 part 4): a definition written to one of the user's .lin files. */
  readonly linetypeCreate?: (
    r: Extract<ViewRequest, { op: 'linetypeCreate' }>,
  ) => Promise<ViewReply>;
  /**
   * SETVAR (M2-42): a system variable the app keeps (the drafting aids, the per-user settings),
   * set to `value` when given, answered with its value.
   */
  readonly sysvar?: (name: string, value?: number | string) => ViewReply;
  /**
   * Selection cycling (M3-04 part 3): the Selection list of the overlapping objects a pick found,
   * by the pick; the reply holds the one chosen, none when the list is dismissed.
   */
  readonly cycle?: (r: Extract<ViewRequest, { op: 'cycle' }>) => Promise<ViewReply>;
  /**
   * SETVAR CTAB and TILEMODE (M2-59 part 5): the app shows the tab `name` names, or the layout
   * tab shown last.
   */
  readonly tab?: (name: string | undefined) => ViewReply;
  /**
   * CONSTRAINTBAR and a constraint applied (M9-05 part 2): the drawing's constraint bars shown
   * or hidden.
   */
  readonly constraintBars?: (r: Extract<ViewRequest, { op: 'constraintBars' }>) => ViewReply;
  /** AUTOCONSTRAIN (M9-05 part 3): the user's AutoConstrain settings, as `autoConstrain`. */
  readonly autoConstrain?: () => ViewReply;
  /**
   * BEDIT and BCLOSE (M5-02): the app shows the Block Editor on the block definition `block`,
   * or without one closes it.
   */
  readonly blockEditor?: (block: string | undefined, name: string | undefined) => ViewReply;
  /**
   * -XREF Unload and Reload (M5-04): the app unloads or reloads the xrefs, as the palette does;
   * XATTACH's Attach (M5-04 part 6): it loads the xrefs just attached from the file picked.
   */
  readonly xref?: (
    action: 'unload' | 'reload' | 'attach',
    blocks: readonly Handle[],
  ) => Promise<ViewReply>;
  /**
   * -INSERT `name=file` (M5-01 part 4): the drawing file of that name among the drawings open
   * and the files given for xrefs, its model space answered as `drawing`; none found, no drawing.
   */
  readonly drawingFile?: (file: string) => Promise<ViewReply>;
  /** LAYOUT Template (M6-01 part 4): the dialogs without `file`, else the drawing of that name. */
  readonly layoutFile?: (file?: string) => Promise<ViewReply>;
  /** -XREF Attach and Overlay (M5-04 part 12): the drawing file of that name, with its units. */
  readonly xrefFile?: (file: string) => Promise<ViewReply>;
  /** -PDFATTACH (M5-04 part 13): the PDF file of that name, with its pages' sizes. */
  readonly pdfFile?: (file: string) => Promise<ViewReply>;
  /** -LAYER stAte Import (M5-18 part 3): a layer state file or drawing of that name. */
  readonly layerStateFile?: (file: string) => Promise<ViewReply>;
  /** -LAYER stAte EXport (M5-18 part 3): the app writes the `.las` file and hands it over. */
  readonly writeLayerState?: (
    r: Extract<ViewRequest, { op: 'writeLayerState' }>,
  ) => Promise<ViewReply>;
  /** WBLOCK (M5-01 part 4): the app writes the new drawing file and hands it over. */
  readonly writeBlock?: (r: Extract<ViewRequest, { op: 'writeBlock' }>) => Promise<ViewReply>;
  /** REFCLOSE Save of an xref (M5-02 part 6): the xref's file read again (xref-files.ts). */
  readonly xrefDrawing?: (block: Handle) => Promise<ViewReply>;
  /** REFCLOSE Save of an xref (M5-02 part 6): the edits written to the xref's file. */
  readonly writeXref?: (r: Extract<ViewRequest, { op: 'writeXref' }>) => Promise<ViewReply>;
  /** VPORTS (M6-02 part 11): the Viewports dialog, answered when it closes. */
  readonly viewportsDialog?: (
    r: Extract<ViewRequest, { op: 'viewportsDialog' }>,
  ) => ViewReply | Promise<ViewReply>;
  /** SCALELISTEDIT (M6-02 part 22): the Edit Drawing Scales dialog, answered when it closes. */
  readonly scaleListDialog?: (
    r: Extract<ViewRequest, { op: 'scaleListDialog' }>,
  ) => ViewReply | Promise<ViewReply>;
  /** ULAYERS (M2-56 part 1): the Underlay Layers dialog, answered when it closes. */
  readonly underlayLayers?: (
    r: Extract<ViewRequest, { op: 'underlayLayers' }>,
  ) => ViewReply | Promise<ViewReply>;
}

/** A selection window or path whose constraints `constraintsIn` asks for (M9-03 part 14). */
export type ConstraintArea = Extract<ViewRequest, { op: 'constraintsIn' }>['area'];

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
export const NO_LINETYPES = 'There are no linetype files here.';
export const NO_SETTINGS = 'There are no settings here.';
export const NO_DIALOGS = 'There are no dialogs here.';
export const NO_TABS = 'There are no tabs here.';

export function stateOf(t: ViewTarget): ViewState | undefined {
  const v = t.view;
  if (!v || !(t.size.width > 0) || !(t.size.height > 0)) return undefined;
  // In a layout viewport made current, its own view (M6-02 part 4).
  const own = t.viewportView;
  if (own) return { ...own, paper: false };
  return {
    center: v.center,
    height: t.size.height / v.scale,
    width: t.size.width / v.scale,
    paper: t.isLayout && t.viewport === undefined,
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
  if (r.op === 'xref') {
    return ctx.xref ? ctx.xref(r.action, r.blocks) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'drawingFile') {
    return ctx.drawingFile ? ctx.drawingFile(r.file) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'layoutFile') {
    return ctx.layoutFile ? ctx.layoutFile(r.file) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'xrefFile') {
    return ctx.xrefFile ? ctx.xrefFile(r.file) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'pdfFile') {
    return ctx.pdfFile ? ctx.pdfFile(r.file) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'layerStateFile') {
    return ctx.layerStateFile ? ctx.layerStateFile(r.file) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'writeLayerState') {
    return ctx.writeLayerState ? ctx.writeLayerState(r) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'writeBlock') {
    return ctx.writeBlock ? ctx.writeBlock(r) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'xrefDrawing') {
    return ctx.xrefDrawing ? ctx.xrefDrawing(r.block) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'writeXref') {
    return ctx.writeXref ? ctx.writeXref(r) : { ok: false, message: NO_FILE };
  }
  if (r.op === 'palette') {
    return ctx.palette ? ctx.palette(r.palette, r.open) : { ok: false, message: NO_PALETTE };
  }
  if (r.op === 'cleanScreen') {
    return ctx.cleanScreen ? ctx.cleanScreen(r.on) : { ok: false, message: NO_PALETTE };
  }
  if (r.op === 'palettes') {
    return ctx.palettes ? ctx.palettes(r.shown) : { ok: false, message: NO_PALETTE };
  }
  if (r.op === 'commandLine') {
    return ctx.commandLine ? ctx.commandLine(r.shown) : { ok: false, message: NO_PALETTE };
  }
  if (r.op === 'linetypeFile') {
    return ctx.linetypeFile ? ctx.linetypeFile(r.file) : { ok: false, message: NO_LINETYPES };
  }
  if (r.op === 'linetypeCreate') {
    return ctx.linetypeCreate ? ctx.linetypeCreate(r) : { ok: false, message: NO_LINETYPES };
  }
  if (r.op === 'hatchPatternList') {
    return ctx.hatchPatternList ? ctx.hatchPatternList() : { ok: false, message: NO_PATTERNS };
  }
  if (r.op === 'hatchPattern') {
    return ctx.hatchPattern
      ? ctx.hatchPattern(r.name, r.placements)
      : { ok: false, message: NO_PATTERNS };
  }
  if (r.op === 'sysvar') {
    return ctx.sysvar ? ctx.sysvar(r.name, r.text ?? r.value) : { ok: false, message: NO_SETTINGS };
  }
  if (r.op === 'cycle') {
    return ctx.cycle ? ctx.cycle(r) : { ok: false, message: NO_DIALOGS };
  }
  if (r.op === 'tab') {
    return ctx.tab ? ctx.tab(r.name) : { ok: false, message: NO_TABS };
  }
  if (r.op === 'constraintBars') {
    return ctx.constraintBars ? ctx.constraintBars(r) : { ok: false, message: NO_CANVAS };
  }
  if (r.op === 'autoConstrain') {
    return ctx.autoConstrain ? ctx.autoConstrain() : { ok: false, message: NO_SETTINGS };
  }
  if (r.op === 'blockEditor') {
    return ctx.blockEditor ? ctx.blockEditor(r.block, r.name) : { ok: false, message: NO_TABS };
  }
  if (r.op === 'underlayLayers') {
    return ctx.underlayLayers ? ctx.underlayLayers(r) : { ok: false, message: NO_DIALOGS };
  }
  if (r.op === 'viewportsDialog') {
    return ctx.viewportsDialog ? ctx.viewportsDialog(r) : { ok: false, message: NO_DIALOGS };
  }
  if (r.op === 'scaleListDialog') {
    return ctx.scaleListDialog ? ctx.scaleListDialog(r) : { ok: false, message: NO_DIALOGS };
  }
  if (r.op === 'clipboard') {
    return ctx.clipboard ? ctx.clipboard(r.content) : { ok: false, message: NO_CLIPBOARD };
  }
  if (r.op === 'tiles') {
    // -VPORTS (M6-02 part 10): every Model tile's view, by tile index, and the current one.
    const tiles = ctx.tiles?.();
    if (!tiles) return { ok: false, message: NO_CANVAS };
    return {
      ok: true,
      tiles: {
        views: tiles.targets.map((t) => (t && stateOf(t)) ?? null),
        current: tiles.current,
      },
    };
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
      // With the canvas's size in CSS pixels, SCREENSIZE (M2-59).
      return {
        ok: true,
        view: stateOf(t)!,
        screen: { width: t.size.width, height: t.size.height },
      };
    case 'extents':
    case 'all': {
      // A layout viewport made current measures model space first (M6-02 part 4).
      const zoomed = r.op === 'all' ? t.zoomAll() : t.zoomExtents();
      return zoomed ? zoomed.then(done) : done();
    }
    case 'previous':
      return t.zoomPrevious() ? done() : { ok: false, message: 'No previous view saved.' };
    case 'scale':
      if (r.relativeTo === 'view') t.zoomScale(r.factor);
      // nXP is relative to paper space units: in a layout's paper space those are its own
      // units, so it scales as n against the layout's limits. Model space shown on its own tab
      // has no paper space to measure against; AutoCAD documents nXP for layout viewports only,
      // so we refuse it there rather than guess. In a layout viewport made current it sets the
      // viewport's scale (M6-02 part 4).
      else if (r.relativeTo === 'paper' && !t.isLayout) {
        return { ok: false, message: 'nXP needs paper space: use it in a layout, or nX here.' };
      } else if (r.relativeTo === 'paper') t.zoomPaper(r.factor);
      else t.zoomLimits(r.factor);
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
    case 'viewport':
      t.setViewport(r.viewport ?? undefined, r.geometry, r.maximized === true);
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
      // A model view into the layout viewport made current (-VIEW Restore, M6-02 part 14).
      if (r.window && t.viewport !== undefined) {
        return t.showInViewport(r.window)
          ? done()
          : { ok: false, message: 'The viewport is display locked: its view cannot change.' };
      }
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
    case 'constraintAt':
      return t.constraintAt(r.point).then((constraint) => ({
        ok: true,
        ...(constraint !== undefined && { constraint }),
      }));
    case 'constraintsIn':
      return t.constraintsIn(r.area).then((constraints) => ({ ok: true, constraints }));
    case 'nested':
      return t
        .pickNested(r.point, r.id)
        .then((nested) => ({ ok: true, ...(nested && { nested }) }));
    case 'select':
      return t.selectWindow(r.a, r.b, r.crossing).then((ids) => ({ ok: true, ids }));
    case 'selectPath':
      return t.selectPath(r.points, r.kind).then((ids) => ({ ok: true, ids }));
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
    case 'textPieces':
      return t.textPieces(r.texts).then((pieces) => ({ ok: true, pieces }));
    case 'textFrames':
      return t.textFrames(r.texts).then((frames) => ({ ok: true, frames }));
    case 'columnCounts':
      return t.columnCounts(r.texts).then((counts) => ({ ok: true, counts }));
    case 'textOutlines':
      return t
        .textOutlines(r.texts)
        .then((outlines) => ({ ok: true, outlines, pickbox: t.pickbox }));
    case 'enclosed':
      return t.enclosed(r.point).then((enclosed) => ({ ok: true, ...(enclosed && { enclosed }) }));
    case 'bounds':
      return t
        .boundsOf(r.ids)
        .then((box) =>
          box ? { ok: true, box } : { ok: false, message: 'The objects have no extents.' },
        );
  }
}
