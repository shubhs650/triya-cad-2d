// Linetype patterns as the renderer uses them, from a drawing's LTYPE records or a .lin file,
// and the scale that applies to them (ARCHITECTURE.md §7.2).

import type { LinetypeRecord, Vec2 } from '@triya/engine';

/**
 * How an embedded text or shape turns. AutoCAD .lin syntax: `R=` relative to the line
 * (tangential), `A=` absolute, `U=` upright (relative, but turned half a turn when it would
 * read upside down).
 */
export type EmbedRotation = 'relative' | 'absolute' | 'upright';

/** A text string or shape carried by a pattern element, drawn at the element's end. */
export interface PatternEmbed {
  readonly kind: 'text' | 'shape';
  /** The string, for text. */
  readonly text?: string;
  /** Shape name as written in a .lin file (`[CON1,ep.shx]`). */
  readonly shapeName?: string;
  /** Shape number in its SHX file, as LTYPE records store it (DXF 75). */
  readonly shapeNumber?: number;
  /** Text style or shape file: a STYLE handle for a record, the name or file for a .lin. */
  readonly style?: string;
  /** `S=`: multiplies the style's fixed height (text) or the shape's own scale. */
  readonly scale: number;
  /** Radians. */
  readonly rotation: number;
  readonly rotationMode: EmbedRotation;
  /** `X=` along the line and `Y=` across it; scaled by the linetype scale but not by `S=`. */
  readonly offset: Vec2;
}

export interface PatternElement {
  /** Dash > 0, gap < 0, dot 0, in drawing units before scaling. */
  readonly length: number;
  readonly embed?: PatternEmbed;
}

export interface LinePattern {
  readonly name: string;
  readonly description: string;
  /** Empty for a continuous linetype. */
  readonly elements: readonly PatternElement[];
}

/** DXF 74 bits (acad-ts `LineTypeShapeFlags`). */
const ABSOLUTE = 1;
const TEXT = 2;
const SHAPE = 4;

/**
 * The pattern of an LTYPE record. DXF has no upright bit, so `U=` rotation saved by AutoCAD
 * reads as relative; that is all the record can say.
 */
export function patternOf(record: LinetypeRecord): LinePattern {
  return {
    name: record.name,
    description: record.description,
    elements: record.elements.map((e): PatternElement => {
      const kind = e.shapeFlags & TEXT ? 'text' : e.shapeFlags & SHAPE ? 'shape' : undefined;
      if (!kind) return { length: e.length };
      return {
        length: e.length,
        embed: {
          kind,
          ...(kind === 'text' ? { text: e.text ?? '' } : { shapeNumber: e.shapeNumber }),
          ...(e.style ? { style: e.style } : {}),
          scale: e.scale,
          rotation: e.rotation,
          rotationMode: e.shapeFlags & ABSOLUTE ? 'absolute' : 'relative',
          offset: e.offset,
        },
      };
    }),
  };
}

/** Sum of the absolute element lengths: one repetition, before scaling. */
export function patternLength(p: LinePattern): number {
  return p.elements.reduce((s, e) => s + Math.abs(e.length), 0);
}

export interface LinetypeScaleInput {
  /** `$LTSCALE`, the global factor. */
  readonly ltscale: number;
  /** The object's own linetype scale (DXF 48; new objects take `$CELTSCALE`). */
  readonly objectScale: number;
  /**
   * Model-space objects seen through a layout viewport whose layout has `$PSLTSCALE` = 1:
   * the viewport's paper units per model unit. Dash lengths are then in paper units.
   */
  readonly viewportScale?: number;
  /**
   * On the Model tab with `$MSLTSCALE` = 1: drawing units per paper unit of the current
   * annotation scale (50 for 1:50, that is 1 / `$CANNOSCALEVALUE`).
   */
  readonly annotationScale?: number;
}

/**
 * The factor every pattern length is multiplied by, in drawing units of the space the object
 * is drawn in. AutoCAD: "The object's current linetype scale is multiplied by the global scale
 * factor to get the displayed linetype scale"; PSLTSCALE 1 makes "the dash lengths of a line in
 * a viewport … the same as the dash lengths of a line in paper space"; MSLTSCALE 1 scales
 * Model-tab linetypes "by the annotation scale".
 */
export function linetypeScale(s: LinetypeScaleInput): number {
  let k = s.ltscale * s.objectScale;
  if (s.viewportScale !== undefined && s.viewportScale > 0) k /= s.viewportScale;
  if (s.annotationScale !== undefined && s.annotationScale > 0) k *= s.annotationScale;
  return k;
}
