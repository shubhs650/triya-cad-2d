// M7-05's acceptance: theme snapshot tests. Each file under theme-snapshots/ pins one appearance
// of the app (light or dark chrome, standard or high contrast) as a drafter sees it: the chrome's
// colour tokens as the stylesheet sets them, the WCAG contrast of the pairs the chrome draws text
// and edges in, the canvas colours the drawing area takes by default (with what ACI 7, the
// crosshairs, AutoSnap and AutoTrack draw in on them) and the plot preview, which is the sheet
// whatever the theme. `themes.spec.ts` checks the running app draws these tokens. Rewrite with
// `pnpm vitest run apps/web/test/theme.test.ts -u` and review the diff.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { foregroundOn, interfaceColours } from '../src/canvas/colours';
import { DEFAULT_CANVAS, DEFAULT_PREFERENCES, normalizePreferences } from '../src/preferences';
import {
  APPEARANCES,
  HIGH_CONTRAST_CANVAS,
  appearanceOf,
  canvasColoursFor,
  contrastRatio,
  rootAttributes,
  type Appearance,
  type MediaState,
} from '../src/theme';

// The stylesheet without its comments, which may name what the rules no longer use.
const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The custom properties a rule whose selector is exactly `selector` sets, in order. */
function tokensOf(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of CSS.matchAll(rule)) {
    if (m[1]!.trim() !== selector) continue;
    for (const d of m[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(d[1]!, d[2]!.trim());
  }
  return out;
}

/** The selector that sets an appearance's tokens, from the root attributes the app writes. */
function selectorOf(a: Appearance): string {
  const attrs = rootAttributes(a);
  const parts = [
    attrs.scheme === 'dark' ? "[data-scheme='dark']" : '',
    attrs.contrast === 'high' ? "[data-contrast='high']" : '',
  ];
  return `:root${parts.join('')}`;
}

/** The tokens in force for an appearance: the light standard ones under its own overrides. */
function resolvedTokens(a: Appearance): Map<string, string> {
  const t = new Map(tokensOf(':root'));
  if (a.scheme === 'dark') for (const [k, v] of tokensOf(":root[data-scheme='dark']")) t.set(k, v);
  if (a.highContrast) for (const [k, v] of tokensOf(selectorOf(a))) t.set(k, v);
  return t;
}

/** The colour tokens every appearance must set itself (the rest, like --motion, are shared). */
const COLOUR_TOKENS = [
  '--chrome-bg',
  '--chrome-bg-raised',
  '--chrome-border',
  '--chrome-text',
  '--chrome-text-muted',
  '--chrome-hover',
  '--accent',
  '--on-accent',
  '--focus-ring',
  '--danger-bg',
  '--danger-text',
  '--ok-text',
  '--selected-bg',
  '--tip-bg',
  '--tip-text',
  '--tip-border',
  '--ruler-bg',
  '--ruler-line',
  '--ruler-mark',
] as const;

/** The pairs the chrome draws text (and, in high contrast, edges) in, foreground on background. */
const TEXT_PAIRS = [
  ['--chrome-text', '--chrome-bg'],
  ['--chrome-text', '--chrome-bg-raised'],
  ['--chrome-text-muted', '--chrome-bg'],
  ['--chrome-text-muted', '--chrome-bg-raised'],
  ['--chrome-text', '--selected-bg'],
  ['--accent', '--chrome-bg-raised'],
  ['--on-accent', '--accent'],
  ['--danger-text', '--chrome-bg-raised'],
  ['--danger-text', '--danger-bg'],
  ['--ok-text', '--chrome-bg-raised'],
  ['--tip-text', '--tip-bg'],
] as const;
const EDGE_PAIRS = [
  ['--chrome-border', '--chrome-bg'],
  ['--chrome-border', '--chrome-bg-raised'],
  ['--focus-ring', '--chrome-bg'],
  ['--focus-ring', '--chrome-bg-raised'],
] as const;

const hexOf = (v: string): string | undefined =>
  /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;

describe('theme snapshots', () => {
  for (const a of APPEARANCES)
    it(`pins the ${a.id} appearance`, async () => {
      const t = resolvedTokens(a);
      const attrs = rootAttributes(a);
      const out = [
        `# ${a.id}`,
        '',
        `root: data-scheme=${attrs.scheme} data-contrast=${attrs.contrast}`,
        '',
        '## chrome tokens',
      ];
      for (const k of COLOUR_TOKENS) out.push(`${k}: ${t.get(k)}`);
      out.push('', '## contrast (WCAG 2.x)');
      for (const [fg, bg] of [...TEXT_PAIRS, ...EDGE_PAIRS]) {
        const r = contrastRatio(t.get(fg)!, t.get(bg)!);
        out.push(`${fg} on ${bg}: ${r === undefined ? 'n/a' : r.toFixed(2)}`);
      }
      const canvas = canvasColoursFor(DEFAULT_CANVAS, a);
      out.push('', '## canvas (default colours)');
      for (const [k, v] of Object.entries(canvas)) out.push(`${k}: ${v ?? 'automatic'}`);
      for (const [where, bg] of [
        ['model', canvas.model],
        ['paper', canvas.paper],
      ] as const) {
        const ui = interfaceColours({ background: bg });
        out.push(
          `${where}: ACI 7 ${foregroundOn(bg)}, crosshairs ${ui.crosshair}, AutoSnap ${ui.autosnap}, AutoTrack ${ui.autotrack}`,
        );
      }
      out.push(
        '',
        '## plot preview',
        'sheet: #ffffff, ACI 7 #000000 (the plot, whatever the theme)',
      );
      await expect(out.join('\n') + '\n').toMatchFileSnapshot(`theme-snapshots/${a.id}.txt`);
    });
});

describe('theme tokens', () => {
  for (const a of APPEARANCES) {
    it(`${a.id} sets every colour token as #rrggbb or rgb()`, () => {
      const own = a.id === 'light' ? tokensOf(':root') : tokensOf(selectorOf(a));
      for (const k of COLOUR_TOKENS) {
        expect(own.get(k), `${a.id} ${k}`).toMatch(/^(#[0-9a-f]{6}|rgb\([^)]*\))$/i);
      }
    });

    it(`${a.id} draws text at WCAG ${a.highContrast ? 'AAA (7:1)' : 'AA (4.5:1)'}`, () => {
      const t = resolvedTokens(a);
      const min = a.highContrast ? 7 : 4.5;
      for (const [fg, bg] of TEXT_PAIRS) {
        const r = contrastRatio(t.get(fg)!, t.get(bg)!);
        expect(r, `${a.id}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
      }
    });
  }

  it('high contrast edges and focus rings stand out at 3:1 or more (WCAG 1.4.11), 7:1 in high contrast', () => {
    for (const a of APPEARANCES) {
      const t = resolvedTokens(a);
      for (const [fg, bg] of EDGE_PAIRS) {
        if (!a.highContrast && fg === '--chrome-border') continue; // the standard chrome's hairlines
        const r = contrastRatio(t.get(fg)!, t.get(bg)!)!;
        expect(r, `${a.id}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(a.highContrast ? 7 : 3);
      }
    }
  });

  it('keeps no media query for the colour scheme, contrast or motion: the app resolves them', () => {
    expect(CSS).not.toMatch(/prefers-color-scheme/);
    expect(CSS).not.toMatch(/prefers-contrast/);
    expect(CSS).not.toMatch(/prefers-reduced-motion/);
    expect(CSS).not.toMatch(/data-theme/);
  });

  it('writes no white or chrome background colour on the accent: --on-accent is', () => {
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    for (const m of CSS.matchAll(rule)) {
      const body = m[2]!;
      if (!/background(-color)?:\s*var\(--accent/.test(body)) continue;
      const color = /(?:^|[;\s])color:\s*([^;]+);/.exec(body)?.[1]?.trim();
      if (color !== undefined)
        expect(color, m[1]!.trim()).toMatch(
          /^var\(--on-accent\)$|^inherit$|^var\(--chrome-text\)$/,
        );
    }
  });
});

describe('reduced motion', () => {
  it('keeps every transition and animation on --motion or --motion-panel, within 160 ms', () => {
    const decl = /(?:^|[;{\s])(transition|animation)(?:-duration)?\s*:\s*([^;]+);/g;
    for (const m of CSS.matchAll(decl)) {
      const value = m[2]!;
      if (/^none$/.test(value.trim())) continue;
      const durations = value.match(/\b\d+(\.\d+)?m?s\b/g) ?? [];
      expect(durations, `${m[1]}: ${value}`).toEqual([]);
      expect(value, `${m[1]}: ${value}`).toMatch(/var\(--motion(-panel)?\)/);
    }
    const ms = (k: string) => Number(/^(\d+)ms$/.exec(tokensOf(':root').get(k)!)![1]);
    expect(ms('--motion')).toBeLessThanOrEqual(160);
    expect(ms('--motion-panel')).toBeLessThanOrEqual(160);
    const reduced = tokensOf(":root[data-motion='reduced']");
    expect(reduced.get('--motion')).toBe('0ms');
    expect(reduced.get('--motion-panel')).toBe('0ms');
  });
});

describe('appearanceOf', () => {
  const media = (m: Partial<MediaState> = {}): MediaState => ({
    dark: false,
    moreContrast: false,
    forcedColors: false,
    reducedMotion: false,
    ...m,
  });
  const p = DEFAULT_PREFERENCES;

  it('follows the system for each of theme, contrast and motion by default', () => {
    expect(appearanceOf(p, media())).toMatchObject({
      scheme: 'light',
      highContrast: false,
      reducedMotion: false,
    });
    expect(
      appearanceOf(p, media({ dark: true, moreContrast: true, reducedMotion: true })),
    ).toMatchObject({
      scheme: 'dark',
      highContrast: true,
      reducedMotion: true,
      id: 'dark-high-contrast',
    });
    // Windows' high contrast themes (forced colours) ask for high contrast too.
    expect(appearanceOf(p, media({ forcedColors: true })).highContrast).toBe(true);
  });

  it("lets the user's choice win over the system's", () => {
    const chosen = { ...p, theme: 'light', contrast: 'standard', motion: 'standard' } as const;
    expect(
      appearanceOf(chosen, media({ dark: true, moreContrast: true, reducedMotion: true })),
    ).toMatchObject({ scheme: 'light', highContrast: false, reducedMotion: false, id: 'light' });
    const high = { ...p, theme: 'dark', contrast: 'high', motion: 'reduced' } as const;
    expect(appearanceOf(high, media())).toMatchObject({
      scheme: 'dark',
      highContrast: true,
      reducedMotion: true,
    });
  });

  it('writes the root attributes the stylesheet reads', () => {
    const a = appearanceOf({ ...p, theme: 'dark', contrast: 'high', motion: 'reduced' }, media());
    expect(rootAttributes(a)).toEqual({ scheme: 'dark', contrast: 'high', motion: 'reduced' });
    expect(rootAttributes(appearanceOf(p, media()))).toEqual({
      scheme: 'light',
      contrast: 'standard',
      motion: 'standard',
    });
  });
});

describe('canvasColoursFor', () => {
  const high = APPEARANCES.find((a) => a.id === 'dark-high-contrast')!;
  const light = APPEARANCES.find((a) => a.id === 'light')!;

  it('draws the model space and the layout surround in black in high contrast', () => {
    const c = canvasColoursFor(DEFAULT_CANVAS, high);
    expect(c.model).toBe(HIGH_CONTRAST_CANVAS.model);
    expect(c.surround).toBe(HIGH_CONTRAST_CANVAS.surround);
    expect(c.paper).toBe(DEFAULT_CANVAS.paper);
    expect(canvasColoursFor(DEFAULT_CANVAS, light)).toBe(DEFAULT_CANVAS);
  });

  it("keeps a colour the user chose, as AutoCAD's Drawing Window Colors keep theirs", () => {
    const mine = { ...DEFAULT_CANVAS, model: '#ffffff' };
    expect(canvasColoursFor(mine, high).model).toBe('#ffffff');
    expect(canvasColoursFor(mine, high).surround).toBe(HIGH_CONTRAST_CANVAS.surround);
  });
});

describe('contrast and motion preferences', () => {
  it('start following the system and survive a reload', () => {
    expect(DEFAULT_PREFERENCES.contrast).toBe('system');
    expect(DEFAULT_PREFERENCES.motion).toBe('system');
    const p = normalizePreferences({ contrast: 'high', motion: 'reduced' });
    expect(p.contrast).toBe('high');
    expect(p.motion).toBe('reduced');
    const bad = normalizePreferences({ contrast: 'loud', motion: 1 });
    expect(bad.contrast).toBe('system');
    expect(bad.motion).toBe('system');
  });

  it('measures contrast as WCAG does', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('rgb(0 0 0 / 6%)', '#ffffff')).toBeUndefined();
    expect(hexOf('#ABCDEF')).toBe('#abcdef');
  });
});
