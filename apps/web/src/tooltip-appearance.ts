// The Drafting Settings dialog's Drafting Tooltip Appearance (M3-06 part 8; AutoCAD 2024 Help,
// "Tooltip Appearance Dialog Box"): the drafting tooltips' background colour in model space and
// on layouts (AutoCAD's Drawing Window Colors, "Drafting tool tip background"), their size and
// transparency, and whether these apply to every drafting tooltip (Dynamic Input's, AutoSnap's
// and tracking's) or to Dynamic Input's only. AutoCAD keeps them in the registry: per user.
import { isDarkColor } from './canvas/colours';

export interface TooltipAppearance {
  /** The background in model space and on layouts as `#rrggbb`; undefined follows the theme. */
  readonly modelColor?: string | undefined;
  readonly layoutColor?: string | undefined;
  /** Size: steps from the default, −3 to 6, each a tenth of the text's size. */
  readonly size: number;
  /** Transparency, 0 (opaque) to 100 percent; AutoCAD's slider stops at 90. */
  readonly transparency: number;
  /** Override OS settings for all drafting tooltips (true) or for Dynamic Input's only. */
  readonly all: boolean;
}

export const TOOLTIP_SIZES = { min: -3, max: 6 } as const;
export const TOOLTIP_TRANSPARENCY = { min: 0, max: 90 } as const;

/** AutoCAD's initial appearance: the theme's colours, size 0, opaque, all tooltips. */
export const DEFAULT_TOOLTIP: TooltipAppearance = { size: 0, transparency: 0, all: true };

const HEX = /^#[0-9a-f]{6}$/i;
const within = (v: unknown, r: { min: number; max: number }, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= r.min && v <= r.max ? v : fallback;

/** A stored appearance read back, each field checked, the default for any not valid. */
export function tooltipAppearanceOf(raw: unknown): TooltipAppearance {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const color = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v : undefined);
  return {
    modelColor: color(r['modelColor']),
    layoutColor: color(r['layoutColor']),
    size: within(r['size'], TOOLTIP_SIZES, DEFAULT_TOOLTIP.size),
    transparency: within(r['transparency'], TOOLTIP_TRANSPARENCY, DEFAULT_TOOLTIP.transparency),
    all: typeof r['all'] === 'boolean' ? r['all'] : DEFAULT_TOOLTIP.all,
  };
}

/**
 * The inline style a drafting tooltip takes over a model or layout canvas: its background (and
 * text that reads on it) when one is set, its font size, and its opacity.
 */
export function tooltipStyle(
  t: TooltipAppearance,
  layout: boolean,
  baseFontSize = 12,
): { background?: string; color?: string; fontSize: string; opacity: string } {
  const bg = layout ? t.layoutColor : t.modelColor;
  return {
    ...(bg && { background: bg, color: isDarkColor(bg) ? '#ffffff' : '#000000' }),
    fontSize: `${Math.round(baseFontSize * (1 + t.size / 10) * 10) / 10}px`,
    opacity: String((100 - t.transparency) / 100),
  };
}
