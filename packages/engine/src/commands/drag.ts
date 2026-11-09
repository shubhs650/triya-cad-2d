// Dragging (M2-06 part 2): while MOVE, COPY, ROTATE, SCALE, MIRROR, STRETCH or a grip asks for a
// point, the objects follow the cursor, as AutoCAD drags them (DRAGMODE Auto). The prompt says
// what is dragged and how (`DragPreview`); the front-end turns each cursor position into the
// motion the renderer draws (`dragMotion`), the same motion the answer will make.
import type { Box } from '../geom/bounds';
import { IDENTITY, mirror, rotation, scaling, translation, type Matrix2D } from '../geom/transform';
import type { Vec2 } from '../geom/types';
import { add, angleOf, distance, sub } from '../geom/vec';
import type { EntityId } from '../model/entity-ids';

export type DragPreview =
  /**
   * PASTECLIP, PASTEBLOCK (M2-14 part 2): the command's preview geometry (`ctx.preview`), which
   * is not in the drawing yet, by the cursor less `from`.
   */
  | { readonly kind: 'preview'; readonly from: Vec2 }
  /** MOVE, COPY: by the cursor less `from`. */
  | { readonly kind: 'move'; readonly ids: readonly EntityId[]; readonly from: Vec2 }
  /** ROTATE: about `base` by the cursor's angle less `reference` (radians). */
  | {
      readonly kind: 'rotate';
      readonly ids: readonly EntityId[];
      readonly base: Vec2;
      readonly reference: number;
    }
  /** SCALE: about `base` by the cursor's distance over `reference`. */
  | {
      readonly kind: 'scale';
      readonly ids: readonly EntityId[];
      readonly base: Vec2;
      readonly reference: number;
    }
  /** MIRROR: in the line from `from` to the cursor. */
  | { readonly kind: 'mirror'; readonly ids: readonly EntityId[]; readonly from: Vec2 }
  /**
   * STRETCH and grip stretching: `ids` move whole by the cursor less `from`; `shape` have their
   * points inside `window` moved (`stretchGeometry`).
   */
  | {
      readonly kind: 'stretch';
      readonly ids: readonly EntityId[];
      readonly shape: readonly EntityId[];
      readonly window: Box;
      readonly from: Vec2;
    }
  /**
   * The STRETCH grip mode: the grip at `grip` of each of `ids` moved by the cursor less `from`
   * (the grip itself unless another base point was given).
   */
  | {
      readonly kind: 'grip';
      readonly ids: readonly EntityId[];
      readonly grip: Vec2;
      readonly from: Vec2;
    };

/** What the renderer draws for a cursor position: `ids` through `m`, `shape` stretched by `d`. */
export interface DragMotion {
  readonly ids: readonly EntityId[];
  readonly m: Matrix2D;
  readonly stretch?: {
    readonly ids: readonly EntityId[];
    readonly window: Box;
    readonly d: Vec2;
  };
  /** Each of `ids` with its grip at `from` dragged to `to` (`moveGrip`). */
  readonly grip?: {
    readonly ids: readonly EntityId[];
    readonly from: Vec2;
    readonly to: Vec2;
  };
}

/** The motion a drag makes with the cursor at `cursor`; undefined where it makes none. */
export function dragMotion(drag: DragPreview, cursor: Vec2): DragMotion | undefined {
  switch (drag.kind) {
    case 'preview':
      // The front-end moves the preview itself; no object of the drawing moves.
      return undefined;
    case 'move': {
      const d = sub(cursor, drag.from);
      return { ids: drag.ids, m: translation(d.x, d.y) };
    }
    case 'rotate': {
      if (distance(cursor, drag.base) === 0) return undefined;
      const a = angleOf(sub(cursor, drag.base)) - drag.reference;
      return { ids: drag.ids, m: rotation(a, drag.base) };
    }
    case 'scale': {
      const k = distance(cursor, drag.base) / drag.reference;
      if (!(k > 0) || !Number.isFinite(k)) return undefined;
      return { ids: drag.ids, m: scaling(k, k, drag.base) };
    }
    case 'mirror':
      if (distance(cursor, drag.from) === 0) return undefined;
      return { ids: drag.ids, m: mirror(drag.from, cursor) };
    case 'stretch': {
      const d = sub(cursor, drag.from);
      return {
        ids: drag.ids,
        m: translation(d.x, d.y),
        ...(drag.shape.length > 0 && { stretch: { ids: drag.shape, window: drag.window, d } }),
      };
    }
    case 'grip': {
      const to = add(drag.grip, sub(cursor, drag.from));
      return { ids: [], m: IDENTITY, grip: { ids: drag.ids, from: drag.grip, to } };
    }
  }
}
