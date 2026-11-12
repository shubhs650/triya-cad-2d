// The view host (M2-02 part 2): how the view commands (ZOOM, PAN, REGEN, VIEW) reach the canvas,
// and the file commands (QSAVE, SAVEAS, CLOSE; M2-13) and the Clipboard (M2-14 part 2) the app.
// The command engine runs in the engine worker and holds no view; the canvas of the space shown
// does, on the main thread. A command asks the host and awaits its reply; the engine session
// carries each request to the app as a `CommandOutput` and the reply back as a `CommandInput`.
import type { Vec2 } from '../../geom/types';
import type { Box } from '../../geom/bounds';
import type { EntityId } from '../../model/entity-ids';
import type { HatchPatternLine, MTextGeometry, TextGeometry } from '../../model/types';
import type { Clipboard } from '../../edit/clipboard';

/** The view of the current viewport, in world units. */
export interface ViewState {
  readonly center: Vec2;
  /** World units the window shows from top to bottom (AutoCAD's VIEWSIZE). */
  readonly height: number;
  readonly width: number;
  /** A layout's paper space is shown, not model space. */
  readonly paper: boolean;
}

/** A named view the space shown can restore: one saved in the drawing's VIEW table. */
export interface NamedViewInfo {
  readonly name: string;
  /**
   * Saved in the drawing's VIEW table. Always true since VIEW Save writes there (M2-29); kept for
   * hosts that keep views of their own.
   */
  readonly inDrawing: boolean;
  /** A 2D canvas can show it (a plan view without twist). */
  readonly restorable: boolean;
}

export type ViewRequest =
  | { readonly op: 'get' }
  | { readonly op: 'extents' }
  | { readonly op: 'all' }
  | { readonly op: 'previous' }
  /**
   * ZOOM Scale: `view` is nX (the current view's magnification times n), `limits` plain n
   * (relative to the limits: 1 fits them), `paper` nXP (relative to paper space units).
   */
  | {
      readonly op: 'scale';
      readonly factor: number;
      readonly relativeTo: 'view' | 'limits' | 'paper';
    }
  | { readonly op: 'window'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly op: 'center'; readonly center: Vec2; readonly height: number }
  /** Moves the drawing by `by` world units (-PAN's displacement). */
  | { readonly op: 'pan'; readonly by: Vec2 }
  /** Real-time PAN or ZOOM with the left button, until `none`. */
  | { readonly op: 'realtime'; readonly mode: 'pan' | 'zoom' | 'none' }
  | { readonly op: 'regen'; readonly all: boolean }
  | { readonly op: 'views' }
  | { readonly op: 'restore'; readonly name: string }
  /**
   * Selection (M2-03): the objects of the space shown within the pickbox of `point`, nearest
   * first. What a pick takes depends on what is drawn, so the canvas answers it.
   */
  | { readonly op: 'pick'; readonly point: Vec2 }
  /** The objects a window takes: wholly inside it, or, `crossing`, inside or crossing it. */
  | { readonly op: 'select'; readonly a: Vec2; readonly b: Vec2; readonly crossing: boolean }
  /** ZOOM Object: the view fitted around the objects' extents. */
  | { readonly op: 'objects'; readonly ids: readonly EntityId[] }
  /**
   * The box an MTEXT's glyphs fill (M2-09: MLEADEREDIT places a landing on the far side of a
   * multileader's text), which only the renderer, with the fonts, can measure.
   */
  | { readonly op: 'textBox'; readonly text: MTextGeometry }
  /**
   * The widths the renderer lays MTEXTs out at, each its widest line's advance (the
   * `TextMeasure` of TOLERANCE frames), null for one no loaded font draws: what a dimension's
   * regeneration measures its text by (M2-10 part 3).
   */
  | { readonly op: 'textWidths'; readonly texts: readonly MTextGeometry[] }
  /**
   * How many dynamic columns each MTEXT's text takes, as the renderer lays it out in the fonts
   * loaded now, null for one no loaded font draws: what a column grip recounts by (M2-26 part 2).
   */
  | { readonly op: 'columnCounts'; readonly texts: readonly MTextGeometry[] }
  /**
   * Where TEXTs and MTEXTs lie as the renderer draws them (M2-27): an attribute picked by its
   * text (EATTEDIT, a double click), and the baseline start of an attribute given another
   * justification. The reply's `pickbox` says how near a pick must come.
   */
  | { readonly op: 'textOutlines'; readonly texts: readonly (TextGeometry | MTextGeometry)[] }
  /**
   * The file commands (M2-13): QSAVE saves the drawing (in place when it can), SAVEAS and SAVE
   * save it under a name the drafter picks, CLOSE closes it (asking to save changes first). The
   * app holds the file, so the host does it; the reply's `file` is the name saved under.
   */
  | {
      readonly op: 'file';
      readonly action: FileAction;
      /** PLOT's window (M2-17 part 2): the corners picked after the dialog's Window< button. */
      readonly window?: { readonly a: Vec2; readonly b: Vec2 };
      /**
       * PLOT opens the dialog again after its Window< button (M2-17 part 3): with the settings
       * it closed with, and `window` when one was picked (Esc at the corners picks none).
       */
      readonly resume?: boolean;
    }
  /** The objects' extents (COPYCLIP's base point, M2-14 part 2), which the renderer answers. */
  | { readonly op: 'bounds'; readonly ids: readonly EntityId[] }
  /**
   * The app's Clipboard (M2-14 part 2), shared by its drawings: with `content`, COPYCLIP puts it
   * there; without, a paste reads it.
   */
  | { readonly op: 'clipboard'; readonly content?: Clipboard }
  /** PROPERTIES and PROPERTIESCLOSE (M2-21): the app opens or closes a palette. */
  | { readonly op: 'palette'; readonly palette: PaletteName; readonly open: boolean }
  /**
   * -PLOT (M2-17 part 5): what the space named (the space shown without `layout`) would plot
   * with, as the Plot dialog opens on it, and what the app can plot it with.
   */
  | { readonly op: 'plotSetup'; readonly layout?: string; readonly pageSetup?: string }
  /** -PLOT: plots a space with the settings given at the command line, without the dialog. */
  | { readonly op: 'plotScript'; readonly script: PlotScript }
  /**
   * A hatch given another pattern by name (Properties' Pattern name, M2-35 part 3): the app's
   * pattern library (the bundled patterns and the user's .pat files, M1-50) places it once per
   * hatch, as AutoCAD's HATCH stores it (DXF 53–49).
   */
  | {
      readonly op: 'hatchPattern';
      readonly name: string;
      readonly placements: readonly PatternPlacement[];
    }
  /**
   * A system variable the app keeps (SETVAR, M2-42: the drafting aids and the per-user settings
   * of `APP_VARIABLES`): set to `value` when one is given (already checked against the
   * variable's range), and answered with the value it holds.
   */
  | { readonly op: 'sysvar'; readonly name: string; readonly value?: number };

/** Where a hatch's pattern lies: its angle, its scale and the point its lines start from. */
export interface PatternPlacement {
  readonly angle: number;
  readonly scale: number;
  readonly origin: Vec2;
}

/** What `hatchPattern` found: the pattern's name as its file spells it, and its lines. */
export interface PlacedPattern {
  readonly name: string;
  /** From the user's own .pat files (DXF 76 = 2, Custom), not the bundled set (1, Predefined). */
  readonly custom: boolean;
  /** One set of lines per placement, in order. */
  readonly lines: readonly (readonly HatchPatternLine[])[];
}

/**
 * A text as drawn (`textOutlines`): the four corners of its box in drawing coordinates (a
 * TEXT's along its baseline, from its font's descender to its height; otherwise the box of its
 * glyphs), and a horizontal TEXT's advance and descent below the baseline (0 otherwise).
 */
export interface TextOutline {
  readonly corners: readonly Vec2[];
  readonly width: number;
  readonly below: number;
}

/** -PLOT's plot areas (AutoCAD's View is not offered: M6-04). */
export type PlotScriptArea = 'layout' | 'extents' | 'display' | 'limits' | 'window';

/**
 * What -PLOT sets, as the Plot dialog's settings hold it: millimetres of paper throughout (the
 * prompts show inches for a page setup in inches), the paper and device by the app's own ids.
 */
export interface PlotScriptSettings {
  readonly device: string;
  readonly paper: string;
  readonly orientation: 'portrait' | 'landscape';
  readonly upsideDown: boolean;
  readonly area: PlotScriptArea;
  readonly window?: Box | undefined;
  readonly fit: boolean;
  /** `mm` millimetres of paper = `units` drawing units. */
  readonly scale: { readonly mm: number; readonly units: number };
  readonly center: boolean;
  /** Millimetres from the paper's lower-left corner. */
  readonly offset: Vec2;
  readonly plotStyles: boolean;
  /** The plot style table's name; '' for none. */
  readonly table: string;
  readonly lineweights: boolean;
  readonly scaleLineweights: boolean;
  readonly paperspaceLast: boolean;
}

/** A name -PLOT accepts and shows (`name`) for one of the app's ids. */
export interface PlotScriptChoice {
  readonly id: string;
  readonly name: string;
}

/** The answer to `plotSetup`: one space's plot settings and what -PLOT may choose from. */
export interface PlotScriptSetup {
  /** The space these settings are for: `Model` or a layout's name. */
  readonly layout: string;
  /** Model, then the layouts in tab order. */
  readonly layouts: readonly string[];
  readonly devices: readonly PlotScriptChoice[];
  readonly papers: readonly PlotScriptChoice[];
  readonly areas: readonly PlotScriptArea[];
  /** The plot style tables the device has for the drawing (CTBs, or STBs). */
  readonly tables: readonly string[];
  /** The space's page setup is in inches: the prompts show inches. */
  readonly inches: boolean;
  /** The space is a layout: its own plot options are asked. */
  readonly paper: boolean;
  /** The space has a page setup "Save changes to page setup" can write. */
  readonly canSave: boolean;
  /** The file the plot is written to unless another is named. */
  readonly file: string;
  readonly settings: PlotScriptSettings;
  /**
   * The named page setups the space can plot with (M2-17 part 6: model space's or the layouts'),
   * as "Enter a page setup name" takes them.
   */
  readonly pageSetups: readonly string[];
  /** The named page setup these settings are from; absent for the space's own. */
  readonly pageSetup?: string;
}

/** What -PLOT plots. */
export interface PlotScript {
  readonly layout: string;
  /** The named page setup the settings start from (M2-17 part 6); absent for the space's own. */
  readonly pageSetup?: string;
  readonly settings: PlotScriptSettings;
  /** The file to write, by name. */
  readonly file: string;
  /** "Save changes to page setup": the settings into the space's page setup first. */
  readonly save: boolean;
  /** "Proceed with plot". */
  readonly plot: boolean;
}

/** The palettes a command opens or closes (M2-21). */
export type PaletteName = 'properties';

/**
 * What a file command asks of the app (M2-13): `recover` (DRAWINGRECOVERY, M2-14 part 2) shows
 * the drawings it can recover again; `plot` (PLOT, PRINT; M2-17) opens the Plot dialog and
 * `publish` (PUBLISH, M2-17 part 2) the Publish dialog; `preview` (PREVIEW, M2-18 part 2) shows
 * the plot preview and answers when it closes; `export` (EXPORT) and `exportpdf` (EXPORTPDF; M2-39
 * part 2) open the Export Data and Save As PDF dialogs, which may ask for a window as `plot` does.
 */
export type FileAction =
  | 'qsave'
  | 'saveas'
  | 'close'
  | 'closeall'
  | 'recover'
  | 'plot'
  | 'publish'
  | 'preview'
  | 'export'
  | 'exportpdf';

export type ViewReply =
  | {
      readonly ok: true;
      /** The view after the request (every request but `views` answers it). */
      readonly view?: ViewState;
      readonly views?: readonly NamedViewInfo[];
      /** What a `pick` or `select` took. */
      readonly ids?: readonly EntityId[];
      /** What `textBox` measured. */
      readonly box?: Box;
      /** What `textWidths` measured, one per text. */
      readonly widths?: readonly (number | null)[];
      /** What `columnCounts` counted, one per text. */
      readonly counts?: readonly (number | null)[];
      /** What `textOutlines` found, one per text (null: no loaded font draws it). */
      readonly outlines?: readonly (TextOutline | null)[];
      /** The pickbox's half size in world units, with `outlines`. */
      readonly pickbox?: number;
      /** The file a `file` request saved the drawing as. */
      readonly file?: string;
      /**
       * The Plot dialog closed on its Window< button (M2-17 part 2): PLOT asks for the window's
       * corners and opens the dialog again with them.
       */
      readonly pickWindow?: boolean;
      /** What a `clipboard` read found; absent when the Clipboard is empty. */
      readonly clipboard?: Clipboard;
      /** The Clipboard's objects were copied from this drawing (PASTEORIG refuses them). */
      readonly sameDrawing?: boolean;
      /**
       * Text another app put on the system clipboard (M2-32 part 5), newer than any objects
       * copied: PASTECLIP pastes it as multiline text.
       */
      readonly text?: string;
      /** What `plotSetup` found (-PLOT, M2-17 part 5). */
      readonly plotSetup?: PlotScriptSetup;
      /** What `hatchPattern` placed (M2-35 part 3). */
      readonly pattern?: PlacedPattern;
      /** What a `sysvar` variable holds (M2-42). */
      readonly value?: number;
    }
  | { readonly ok: false; readonly message: string };

export interface ViewHost {
  request(r: ViewRequest): Promise<ViewReply>;
}

/**
 * The request is answered by the drafter in the app, not by the canvas at once (M2-41): the file
 * commands' dialogs and pickers (Plot, Publish, Export, Save Drawing As, CLOSE's "Save changes"),
 * and the preview, which waits until the drafter leaves it. While a command waits on one, no
 * prompt shows: AutoCAD's command line shows none while its dialog is up.
 */
export function waitsOnApp(r: ViewRequest): boolean {
  return r.op === 'file';
}

/** The host of a bus no canvas listens to (scripts, tests): every request is refused. */
export const NO_VIEW: ViewHost = {
  request: () => Promise.resolve({ ok: false, message: 'There is no view to change.' }),
};
