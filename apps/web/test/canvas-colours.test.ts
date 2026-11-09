// M2-20: configurable canvas colours keep ACI 7 and the AutoSnap colours readable: white on a
// dark background, black on a light one (UI_SPEC.md §6).
import { describe, expect, it } from 'vitest';
import { foregroundOn, isDarkColor, luminance } from '../src/canvas/colours';

describe('canvas colours', () => {
  it('ACI 7 is white on the default model canvas and black on the paper', () => {
    expect(foregroundOn('#212830')).toBe('#ffffff');
    expect(foregroundOn('#ffffff')).toBe('#000000');
  });

  it('a mid grey reads as light, a deep blue as dark', () => {
    expect(isDarkColor('#8a8f98')).toBe(false);
    expect(isDarkColor('#003366')).toBe(true);
    expect(isDarkColor('#33393f')).toBe(true);
    expect(isDarkColor('#c0c0c0')).toBe(false);
  });

  it('luminance runs from black to white', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#FFFFFF')).toBeCloseTo(1);
    expect(luminance('red')).toBeUndefined();
  });
});
