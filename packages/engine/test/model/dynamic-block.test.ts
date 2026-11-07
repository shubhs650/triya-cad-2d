// FR-B3 (M1-14 part 3): a reference to a dynamic block draws its stored state and carries a
// "Dynamic — edit in AutoCAD" badge. `dynamicBlockOf` finds the dynamic block a block record
// stands for: the definition itself, or the definition an anonymous `*U` state names.
import { describe, expect, it } from 'vitest';
import { dynamicBlockOf, type BlockDefinition, type Handle } from '../../src/index';

const block = (handle: Handle, name: string, extra: Partial<BlockDefinition> = {}) =>
  [handle, { handle, name, basePoint: { x: 0, y: 0 }, ...extra }] as const;

const blocks = new Map<Handle, BlockDefinition>([
  block('250', 'LINEAR_PARAM', { dynamic: { name: 'LINEAR_PARAM' } }),
  block('285', '*U2', { dynamicOf: '250' }),
  // R2000 saves a dynamic block under an anonymous name; AutoCAD shows its true name.
  block('A7E', '*U17', { dynamic: { name: 'my-dynamic-block' } }),
  block('A91', '*U18', { dynamicOf: 'A7E' }),
  block('300', 'PLAIN'),
  // A state whose dynamic block is gone (purged) or is no longer dynamic draws as a plain block.
  block('301', '*U9', { dynamicOf: '300' }),
  block('302', '*U10', { dynamicOf: '999' }),
]);

describe('dynamicBlockOf', () => {
  it('gives a dynamic block definition itself, by the name AutoCAD shows', () => {
    expect(dynamicBlockOf(blocks, '250')).toEqual({ handle: '250', name: 'LINEAR_PARAM' });
    expect(dynamicBlockOf(blocks, 'A7E')).toEqual({ handle: 'A7E', name: 'my-dynamic-block' });
  });

  it('gives the dynamic block an anonymous state stands for', () => {
    expect(dynamicBlockOf(blocks, '285')).toEqual({ handle: '250', name: 'LINEAR_PARAM' });
    expect(dynamicBlockOf(blocks, 'A91')).toEqual({ handle: 'A7E', name: 'my-dynamic-block' });
  });

  it('gives nothing for a plain block, a missing one or a state of no dynamic block', () => {
    expect(dynamicBlockOf(blocks, '300')).toBeUndefined();
    expect(dynamicBlockOf(blocks, '301')).toBeUndefined();
    expect(dynamicBlockOf(blocks, '302')).toBeUndefined();
    expect(dynamicBlockOf(blocks, '404')).toBeUndefined();
  });
});
