// Dynamic blocks (FR-B3): a reference draws the block it names, which for a dynamic block with
// changed parameters is an anonymous `*U` state AutoCAD regenerated and saved. Triya does not
// evaluate dynamic blocks (PRD non-goal 2), but shows a "Dynamic — edit in AutoCAD" badge on
// their references (M2-21 Properties palette), so it needs the dynamic block a record stands for.
import type { Handle } from './handle';
import type { BlockDefinition } from './types';

export interface DynamicBlock {
  /** BLOCK_RECORD of the dynamic block definition. */
  readonly handle: Handle;
  /** The name AutoCAD shows for it (`BlockDefinition.dynamic.name`). */
  readonly name: string;
}

/**
 * The dynamic block a block record is, or holds a state of; undefined for a static block. A
 * state whose definition is gone or no longer dynamic is static, as AutoCAD treats it.
 */
export function dynamicBlockOf(
  blocks: ReadonlyMap<Handle, BlockDefinition>,
  block: Handle,
): DynamicBlock | undefined {
  const b = blocks.get(block);
  const definition = b?.dynamicOf !== undefined ? blocks.get(b.dynamicOf) : b;
  return definition?.dynamic
    ? { handle: definition.handle, name: definition.dynamic.name }
    : undefined;
}
