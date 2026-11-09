// The view host (M2-02 part 2): how the view commands (ZOOM, PAN, REGEN, VIEW) reach the canvas,
// and the file commands (QSAVE, SAVEAS, CLOSE; M2-13) and the Clipboard (M2-14 part 2) the app.
// The command engine runs in the engine worker and holds no view; the canvas of the space shown
// does, on the main thread. A command asks the host and awaits its reply; the engine session
// carries each request to the app as a `CommandOutput` and the reply back as a `CommandInput`.
import type { Vec2 } from '../../geom/types';
import type { Box } from '../../geom/bounds';
import type { EntityId } from '../../model/entity-ids';
import type { MTextGeometry } from '../../model/types';
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

/** A named view the space shown can restore: one saved in the drawing or this session. */
export interface NamedViewInfo {
  readonly name: string;
  /** Saved in the drawing's VIEW table (rather than this session). */
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
  /** Saves the current view, or the window between `a` and `b`, as a named view. */
  | {
      readonly op: 'save';
      readonly name: string;
      readonly window?: { readonly a: Vec2; readonly b: Vec2 };
    }
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
   * The file commands (M2-13): QSAVE saves the drawing (in place when it can), SAVEAS and SAVE
   * save it under a name the drafter picks, CLOSE closes it (asking to save changes first). The
   * app holds the file, so the host does it; the reply's `file` is the name saved under.
   */
  | { readonly op: 'file'; readonly action: FileAction }
  /** The objects' extents (COPYCLIP's base point, M2-14 part 2), which the renderer answers. */
  | { readonly op: 'bounds'; readonly ids: readonly EntityId[] }
  /**
   * The app's Clipboard (M2-14 part 2), shared by its drawings: with `content`, COPYCLIP puts it
   * there; without, a paste reads it.
   */
  | { readonly op: 'clipboard'; readonly content?: Clipboard }
  /** PROPERTIES and PROPERTIESCLOSE (M2-21): the app opens or closes a palette. */
  | { readonly op: 'palette'; readonly palette: PaletteName; readonly open: boolean };

/** The palettes a command opens or closes (M2-21). */
export type PaletteName = 'properties';

/**
 * What a file command asks of the app (M2-13): `recover` (DRAWINGRECOVERY, M2-14 part 2) shows
 * the drawings it can recover again.
 */
export type FileAction = 'qsave' | 'saveas' | 'close' | 'recover';

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
      /** The file a `file` request saved the drawing as. */
      readonly file?: string;
      /** What a `clipboard` read found; absent when the Clipboard is empty. */
      readonly clipboard?: Clipboard;
      /** The Clipboard's objects were copied from this drawing (PASTEORIG refuses them). */
      readonly sameDrawing?: boolean;
    }
  | { readonly ok: false; readonly message: string };

export interface ViewHost {
  request(r: ViewRequest): Promise<ViewReply>;
}

/** The host of a bus no canvas listens to (scripts, tests): every request is refused. */
export const NO_VIEW: ViewHost = {
  request: () => Promise.resolve({ ok: false, message: 'There is no view to change.' }),
};
