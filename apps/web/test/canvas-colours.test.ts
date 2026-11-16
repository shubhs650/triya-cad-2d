// M2-20: configurable canvas colours keep ACI 7 and the AutoSnap colours readable: white on a
// dark background, black on a light one (UI_SPEC.md §6).
import { describe, expect, it } from 'vitest';
import {
  crosshairCursor,
  foregroundOn,
  interfaceColours,
  isDarkColor,
  luminance,
} from '../src/canvas/colours';

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

// M2-20 part 2: the crosshairs' colour (OPTIONS > Display > Colors > Crosshairs), drawn as the
// canvas's cursor, and the AutoSnap marker and AutoTrack vector colours.
describe('crosshairs, AutoSnap and AutoTrack colours', () => {
  it('Automatic follows the background; a chosen colour is used as it is', () => {
    expect(interfaceColours({ background: '#212830' })).toEqual({
      crosshair: '#ffffff',
      autosnap: '#ffd400',
      autotrack: '#7fd7ff',
    });
    expect(interfaceColours({ background: '#ffffff' })).toEqual({
      crosshair: '#000000',
      autosnap: '#b06d00',
      autotrack: '#1060c0',
    });
    expect(
      interfaceColours({
        background: '#ffffff',
        crosshair: '#ff0000',
        autosnap: '#00ff00',
        autotrack: '#0000ff',
      }),
    ).toEqual({ crosshair: '#ff0000', autosnap: '#00ff00', autotrack: '#0000ff' });
  });

  it('the crosshair cursor is an SVG in the chosen colour, hot spot at its centre, crosshair as fallback', () => {
    const css = crosshairCursor('#ff0000');
    expect(css).toMatch(/^url\("data:image\/svg\+xml,.*"\) 15 15, crosshair$/);
    const svg = decodeURIComponent(/data:image\/svg\+xml,(.*)"\)/.exec(css)![1]!);
    expect(svg).toContain('width="31" height="31"');
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('M0 15.5H31M15.5 0V31');
    expect(svg).not.toContain('rotate(');
  });

  it('turns the crosshairs with the UCS and SNAPANG (M3-06 part 8), not by whole quarter turns', () => {
    const svg = (angle: number) =>
      decodeURIComponent(/data:image\/svg\+xml,(.*)"\)/.exec(crosshairCursor('#fff', angle))![1]!);
    expect(svg(Math.PI / 6)).toContain('transform="rotate(-30 15.5 15.5)"');
    expect(svg(Math.PI / 2)).not.toContain('rotate(');
  });

  it('adds MATCHPROP’s paintbrush above and right of the crosshairs, upright (M3-16)', () => {
    const svg = (badge?: 'paintbrush') =>
      decodeURIComponent(
        /data:image\/svg\+xml,(.*)"\)/.exec(crosshairCursor('#ff0000', Math.PI / 6, badge))![1]!,
      );
    expect(svg()).not.toContain('class="paintbrush"');
    const brush = svg('paintbrush');
    expect(brush).toContain('<g class="paintbrush"');
    // Drawn after the turned crosshairs, outside their group: it stays upright.
    expect(brush.indexOf('class="paintbrush"')).toBeGreaterThan(brush.lastIndexOf('</g></g>'));
    expect(brush).toContain('fill="#ff0000"');
  });
});
