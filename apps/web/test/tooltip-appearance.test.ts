// M3-06 part 8: the Drafting Tooltip Appearance (AutoCAD 2024 Help, "Tooltip Appearance Dialog
// Box"): colours in model space and on layouts, size, transparency, and what it applies to.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOLTIP, tooltipAppearanceOf, tooltipStyle } from '../src/tooltip-appearance';

describe('tooltip appearance', () => {
  it('reads a stored appearance back, the default for what is not valid', () => {
    expect(tooltipAppearanceOf(undefined)).toEqual({
      ...DEFAULT_TOOLTIP,
      modelColor: undefined,
      layoutColor: undefined,
    });
    expect(
      tooltipAppearanceOf({
        modelColor: '#102030',
        layoutColor: 'red',
        size: 4,
        transparency: 95,
        all: false,
      }),
    ).toEqual({
      modelColor: '#102030',
      layoutColor: undefined,
      size: 4,
      transparency: 0,
      all: false,
    });
  });

  it('styles a tooltip by the space’s colour, its size and its transparency', () => {
    const t = { ...DEFAULT_TOOLTIP, modelColor: '#000000', size: 5, transparency: 40 };
    expect(tooltipStyle(t, false)).toEqual({
      background: '#000000',
      color: '#ffffff',
      fontSize: '18px',
      opacity: '0.6',
    });
    // No layout colour: the theme's, at size -3.
    expect(tooltipStyle({ ...t, size: -3 }, true)).toEqual({ fontSize: '8.4px', opacity: '0.6' });
  });
});
