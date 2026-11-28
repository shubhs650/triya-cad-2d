// M8-06: the Compare palette's state and what its list says.
import { describe, expect, it } from 'vitest';
import type { CompareMarkup, MarkedItem } from '@triya/compare';
import {
  CompareSession,
  changesText,
  compareDrawingName,
  layersOf,
  toleranceOf,
  typesOf,
} from '../src/compare';

describe('the Compare palette', () => {
  it('names the compare drawing after both drawings, numbered when the name is taken', () => {
    expect(compareDrawingName('plan.dwg', 'plan-rev-b.DXF', [])).toBe(
      'Compare_plan_plan-rev-b.dxf',
    );
    expect(compareDrawingName('a.dxf', 'b.dxf', ['compare_a_b.dxf'])).toBe('Compare_a_b (2).dxf');
    expect(compareDrawingName('a.dxf', 'b.dxf', ['Compare_a_b.dxf', 'Compare_a_b (2).dxf'])).toBe(
      'Compare_a_b (3).dxf',
    );
  });

  it('reads the tolerance typed: blank is the drawings’ own', () => {
    expect(toleranceOf('')).toBeUndefined();
    expect(toleranceOf(' 0.5 ')).toBe(0.5);
    expect(toleranceOf('0')).toBe(0);
    expect(toleranceOf('-1')).toBeNaN();
    expect(toleranceOf('abc')).toBeNaN();
  });

  it('says what changed, and lists layers and types once each', () => {
    const item = { changes: ['geometry', 'ltScale', 'color'] } as unknown as MarkedItem;
    expect(changesText(item)).toBe('Geometry, Linetype scale, Color');
    const markup = {
      marks: [
        { layer: 'Walls', type: 'LINE' },
        { layer: 'WALLS', type: 'CIRCLE' },
        { layer: '0', type: 'LINE' },
        { layer: 'doors', type: 'ARC' },
      ],
    } as unknown as CompareMarkup;
    expect(layersOf(markup)).toEqual(['0', 'doors', 'Walls']);
    expect(typesOf(markup)).toEqual(['ARC', 'CIRCLE', 'LINE']);
  });

  it('forgets a drawing that closes', () => {
    const s = new CompareSession();
    let heard = 0;
    s.subscribe(() => heard++);
    s.update({
      original: { kind: 'open', doc: 1, name: 'a.dxf' },
      revision: { kind: 'open', doc: 2, name: 'b.dxf' },
    });
    s.closed(3);
    expect(heard).toBe(1);
    s.closed(1);
    expect(s.getSnapshot().original).toBeUndefined();
    expect(s.getSnapshot().revision?.name).toBe('b.dxf');
    expect(heard).toBe(2);
  });
});
