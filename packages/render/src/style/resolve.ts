// ByLayer / ByBlock resolution of colour, linetype and lineweight, done once per entity at
// cache time (ARCHITECTURE.md §7.2), and lineweight display width.
//
// The inheritance rules are AutoCAD's: ByLayer takes the layer's value; ByBlock takes the
// value of the INSERT that holds the entity, and outside a block it shows as colour 7, the
// Continuous linetype and the default lineweight ("objects are created using the default
// lineweight setting until the objects are grouped into a block"). An object on layer 0 inside
// a block takes its ByLayer values from the layer of the INSERT. AutoCAD's help states the
// ByBlock rules; the layer-0 rule is long-standing AutoCAD behaviour that the help pages we
// could reach do not spell out, so it is encoded here as drafters expect it.

import type { Color, Handle, LayerRecord, Lineweight, Transparency } from '@triya/engine';
import { aciRgb, rgbHex } from './aci';

/**
 * A CSS colour, or `foreground` for ACI 7 (and ByBlock outside a block), which AutoCAD shows
 * white on a dark background and black on a light one. The renderer resolves `foreground` per
 * frame, so a background change needs no re-tessellation.
 */
export type PaintColor = string | 'foreground';

/** What an entity inside a block inherits from the INSERT that holds it, already resolved. */
export interface BlockContext {
  readonly color: PaintColor;
  /** The INSERT's layer, used by objects on layer 0. */
  readonly layer: LayerRecord | undefined;
  /** LTYPE handle, or undefined for Continuous. */
  readonly linetype: Handle | undefined;
  /** Hundredths of a millimetre. */
  readonly lineweight: number;
  /** Alpha, 0 clear to 255 opaque (M1-108). */
  readonly transparency: number;
}

/** What resolution reads from the drawing. */
export interface StyleSource {
  readonly layers: ReadonlyMap<Handle, LayerRecord>;
  /** `$LWDEFAULT`, hundredths of a millimetre; AutoCAD's initial value is 25 (0.25 mm). */
  readonly lwDefault: number;
}

export interface Styled {
  readonly color: Color;
  readonly layer: Handle;
  readonly linetype: Handle | 'ByLayer' | 'ByBlock';
  readonly lineweight: Lineweight;
  /** DXF 440 (M1-108); absent is ByLayer. */
  readonly transparency?: Transparency;
}

/** The layer whose values ByLayer takes: the INSERT's for an object on layer 0 in a block. */
export function effectiveLayer(
  e: Pick<Styled, 'layer'>,
  src: StyleSource,
  block?: BlockContext,
): LayerRecord | undefined {
  const own = src.layers.get(e.layer);
  return block && own?.name === '0' ? (block.layer ?? own) : own;
}

export function colorValue(c: Color): PaintColor {
  switch (c.kind) {
    case 'aci': {
      // A negative layer colour only means the layer is off.
      const i = Math.abs(c.index);
      return i === 7 || i === 0 || i > 255 ? 'foreground' : rgbHex(aciRgb(i));
    }
    case 'rgb':
      return rgbHex([c.r, c.g, c.b]);
    default:
      // A layer cannot be ByLayer or ByBlock; show such a value as colour 7.
      return 'foreground';
  }
}

export function resolveColor(e: Styled, src: StyleSource, block?: BlockContext): PaintColor {
  if (e.color.kind === 'byBlock') return block ? block.color : 'foreground';
  if (e.color.kind === 'byLayer') {
    const layer = effectiveLayer(e, src, block);
    return layer ? colorValue(layer.color) : 'foreground';
  }
  return colorValue(e.color);
}

/** LTYPE handle the entity is drawn with, or undefined for Continuous. */
export function resolveLinetype(
  e: Styled,
  src: StyleSource,
  block?: BlockContext,
): Handle | undefined {
  if (e.linetype === 'ByBlock') return block?.linetype;
  if (e.linetype === 'ByLayer') return effectiveLayer(e, src, block)?.linetype;
  return e.linetype;
}

/** Lineweight in hundredths of a millimetre, with Default replaced by `$LWDEFAULT`. */
export function resolveLineweight(e: Styled, src: StyleSource, block?: BlockContext): number {
  const fixed = (w: Lineweight | undefined): number =>
    typeof w === 'number' && w >= 0 ? w : src.lwDefault;
  if (e.lineweight === 'ByBlock') return block ? block.lineweight : src.lwDefault;
  if (e.lineweight === 'ByLayer') return fixed(effectiveLayer(e, src, block)?.lineweight);
  return fixed(e.lineweight);
}

/** Opaque: alpha 255. */
const OPAQUE = 255;

/**
 * Alpha, 0 clear to 255 opaque (M1-108), resolved as colour is: ByLayer from the layer (the
 * INSERT's for an object on layer 0 in a block), ByBlock from the INSERT. AutoCAD's help: "ByBlock
 * — the transparency of the block", and objects created ByBlock are opaque "until the objects are
 * grouped into a block", so ByBlock outside a block is opaque. A reference's transparency reaches
 * only its ByBlock objects; those with a value of their own (or ByLayer) keep it, as with colour.
 */
export function resolveTransparency(e: Styled, src: StyleSource, block?: BlockContext): number {
  const t = e.transparency ?? 'ByLayer';
  if (t === 'ByBlock') return block ? block.transparency : OPAQUE;
  if (t === 'ByLayer') {
    const l = effectiveLayer(e, src, block)?.transparency;
    // A layer has a value; one read as ByLayer or ByBlock shows opaque.
    return typeof l === 'object' ? l.alpha : OPAQUE;
  }
  return t.alpha;
}

/** The context an INSERT hands to the entities of its block. */
export function blockContext(insert: Styled, src: StyleSource, outer?: BlockContext): BlockContext {
  return {
    color: resolveColor(insert, src, outer),
    layer: effectiveLayer(insert, src, outer),
    linetype: resolveLinetype(insert, src, outer),
    lineweight: resolveLineweight(insert, src, outer),
    transparency: resolveTransparency(insert, src, outer),
  };
}

export interface LineweightDisplay {
  /** `$LWDISPLAY`. Off draws every line one pixel wide. */
  readonly show: boolean;
  /**
   * Model tab: widths are pixels that do not change with zoom. Layout: widths are real
   * paper millimetres and change with zoom.
   */
  readonly space: 'model' | 'paper';
  /** Layout only: CSS pixels per paper millimetre at the current zoom. */
  readonly pixelsPerMillimetre?: number;
  /** Model only: the Lineweight Settings "Adjust Display Scale" factor, 1 by default. */
  readonly displayScale?: number;
}

/** CSS pixels per millimetre at the CSS reference density of 96 per inch. */
const CSS_PX_PER_MM = 96 / 25.4;

/**
 * Stroke width in CSS pixels for a lineweight in hundredths of a millimetre. AutoCAD: "In
 * model space, a lineweight of 0 is displayed as one pixel wide, and other lineweights use a
 * proportional pixel width. Lineweight display in model space does not change with the zoom
 * factor." "In a paper space layout, lineweights are displayed using real-world units, and
 * lineweight display changes with the zoom factor." The help gives no pixel table for the
 * model tab; widths here are proportional at 96 px per inch, rounded, at least one pixel,
 * which shows 0.25 mm and thinner as one pixel.
 */
export function lineweightPixels(hundredths: number, d: LineweightDisplay): number {
  if (!d.show || hundredths <= 0) return 1;
  const mm = hundredths / 100;
  if (d.space === 'paper') return Math.max(1, mm * (d.pixelsPerMillimetre ?? CSS_PX_PER_MM));
  return Math.max(1, Math.round(mm * CSS_PX_PER_MM * (d.displayScale ?? 1)));
}
