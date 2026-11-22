// The app's appearance (M7-05, UI_SPEC.md §6, DEC-027): the chrome's light or dark colours, its
// high contrast colours, and whether it moves. Each is the user's choice in Options > Display or,
// left at "Same as system", the device's setting: prefers-color-scheme, prefers-contrast: more
// or forced colours (Windows' high contrast themes), and prefers-reduced-motion. The app resolves
// them here and writes the result on the root element (data-scheme, data-contrast, data-motion),
// which is all the stylesheet reads, so a choice can override the device either way.
//
// The canvas keeps its own colours (Options > Display > Canvas colors); high contrast draws the
// model space and the layout surround in black where the user left them at their defaults, so the
// drawing reads as strongly as the chrome. The plot preview is the sheet as plotted, whatever the
// theme.
import { luminance } from './canvas/colours';
import { DEFAULT_CANVAS, type CanvasColours, type Preferences } from './preferences';

/** The chrome's contrast: the device's setting, or standard or high always. */
export type Contrast = 'system' | 'standard' | 'high';
/** Whether the chrome animates: the device's setting, or reduced or standard always. */
export type Motion = 'system' | 'reduced' | 'standard';

/** What the device asks for (the media queries' answers). */
export interface MediaState {
  /** prefers-color-scheme: dark. */
  readonly dark: boolean;
  /** prefers-contrast: more. */
  readonly moreContrast: boolean;
  /** forced-colors: active (a Windows high contrast theme). */
  readonly forcedColors: boolean;
  /** prefers-reduced-motion: reduce. */
  readonly reducedMotion: boolean;
}

export type AppearanceId = 'light' | 'dark' | 'light-high-contrast' | 'dark-high-contrast';

/** The appearance the app shows. */
export interface Appearance {
  readonly id: AppearanceId;
  readonly scheme: 'light' | 'dark';
  readonly highContrast: boolean;
  readonly reducedMotion: boolean;
}

const idOf = (scheme: 'light' | 'dark', high: boolean): AppearanceId =>
  high ? `${scheme}-high-contrast` : scheme;

/** The four colour appearances, standard motion: what the theme snapshots pin. */
export const APPEARANCES: readonly Appearance[] = (['light', 'dark'] as const).flatMap((scheme) =>
  [false, true].map((highContrast) => ({
    id: idOf(scheme, highContrast),
    scheme,
    highContrast,
    reducedMotion: false,
  })),
);

/** The appearance for the user's choices on a device asking for `media`. */
export function appearanceOf(
  p: Pick<Preferences, 'theme' | 'contrast' | 'motion'>,
  media: MediaState,
): Appearance {
  const scheme = p.theme === 'system' ? (media.dark ? 'dark' : 'light') : p.theme;
  const highContrast =
    p.contrast === 'system' ? media.moreContrast || media.forcedColors : p.contrast === 'high';
  const reducedMotion = p.motion === 'system' ? media.reducedMotion : p.motion === 'reduced';
  return { id: idOf(scheme, highContrast), scheme, highContrast, reducedMotion };
}

/** The root element's attributes the stylesheet reads. */
export function rootAttributes(a: Appearance): {
  readonly scheme: 'light' | 'dark';
  readonly contrast: 'standard' | 'high';
  readonly motion: 'standard' | 'reduced';
} {
  return {
    scheme: a.scheme,
    contrast: a.highContrast ? 'high' : 'standard',
    motion: a.reducedMotion ? 'reduced' : 'standard',
  };
}

/** Writes the appearance on `root` (the document element). */
export function applyAppearance(root: HTMLElement, a: Appearance): void {
  const attrs = rootAttributes(a);
  root.dataset['scheme'] = attrs.scheme;
  root.dataset['contrast'] = attrs.contrast;
  root.dataset['motion'] = attrs.motion;
  // Form controls and scroll bars follow the scheme too.
  root.style.colorScheme = attrs.scheme;
}

/** High contrast's canvas colours where the user kept the defaults. */
export const HIGH_CONTRAST_CANVAS = { model: '#000000', surround: '#000000' } as const;

/**
 * The canvas colours as drawn: the user's, with high contrast's black model space and layout
 * surround in place of the default ones. A colour the user chose stays theirs.
 */
export function canvasColoursFor(
  c: CanvasColours,
  a: Pick<Appearance, 'highContrast'>,
): CanvasColours {
  if (!a.highContrast) return c;
  const model = c.model === DEFAULT_CANVAS.model ? HIGH_CONTRAST_CANVAS.model : c.model;
  const surround =
    c.surround === DEFAULT_CANVAS.surround ? HIGH_CONTRAST_CANVAS.surround : c.surround;
  return model === c.model && surround === c.surround ? c : { ...c, model, surround };
}

/** WCAG 2.x contrast ratio of two `#rrggbb` colours (1 … 21); undefined for other text. */
export function contrastRatio(a: string, b: string): number | undefined {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === undefined || lb === undefined) return undefined;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const QUERIES = {
  dark: '(prefers-color-scheme: dark)',
  moreContrast: '(prefers-contrast: more)',
  forcedColors: '(forced-colors: active)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
} as const;

/**
 * The device's settings now, and `onChange` called whenever one changes; a device without
 * matchMedia asks for nothing.
 */
export function watchMedia(onChange: () => void): () => MediaState {
  const mm = typeof matchMedia === 'function' ? matchMedia : undefined;
  const lists = mm
    ? (Object.fromEntries(Object.entries(QUERIES).map(([k, q]) => [k, mm(q)])) as Record<
        keyof MediaState,
        MediaQueryList
      >)
    : undefined;
  if (lists) for (const l of Object.values(lists)) l.addEventListener('change', onChange);
  return () => ({
    dark: lists?.dark.matches ?? false,
    moreContrast: lists?.moreContrast.matches ?? false,
    forcedColors: lists?.forcedColors.matches ?? false,
    reducedMotion: lists?.reducedMotion.matches ?? false,
  });
}
