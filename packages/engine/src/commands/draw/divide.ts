// DIVIDE and MEASURE (M3-01 part 5), on AutoCAD 2024's prompts (AutoCAD 2024 Help, "DIVIDE
// (Command)", "MEASURE (Command)"):
//   Select object to divide:                     Select object to measure:
//   Enter the number of segments or [Block]:     Specify length of segment or [Block]:
//     Block:  Enter name of block to insert:
//             Align block with object? [Yes/No] <Y>:
//             Enter the number of segments:      Specify length of segment:
// Marks are POINTs (shown as PDMODE draws them) or references of the block, on the current
// layer with the current properties, turned with the object's direction where aligned. Lines,
// arcs, circles, ellipses, polylines and splines can be marked; the distance is along the
// object (`arcLengthTable`, as ARRAYPATH spaces its items).
//
// DIVIDE: n segments of equal length, from the object's start: n − 1 marks on an open object,
// n on a closed one (whose start is a division too). A circle starts at angle 0 (SNAPANG's
// default), a closed polyline at its first vertex.
// MEASURE: a mark every segment length from the end nearer the point the object was picked
// at (a closed object from its start). AutoCAD's documentation does not say whether a mark
// falls on the far end when the length divides the object exactly; as DIVIDE never marks an
// end, MEASURE does not either (marks stop short of the end by more than the tolerance).
// Attributes are not added to the blocks, as AutoCAD's DIVIDE and MEASURE leave them out. The
// marks become the Previous selection set (AutoCAD: select them with Previous).
import { arrayPath, pathCurveOf, pathFrame, pathLength, type ArrayPath } from '../../edit/array';
import { endPoint, startPoint } from '../../geom/eval';
import type { Vec2 } from '../../geom/types';
import { angleOf, distance } from '../../geom/vec';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import { currentProps } from '../../properties/current';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** AutoCAD's limit on DIVIDE's segments, which MEASURE's mark count keeps to as well. */
const MAX_MARKS = 32767;

/** The block DIVIDE or MEASURE places, and whether it turns with the object. */
interface Marker {
  readonly block: Handle;
  readonly align: boolean;
}

/** DIVIDE: marks splitting an object into equal segments. */
export function divideCommand(): CommandDef {
  return {
    name: 'DIVIDE',
    async *run(ctx) {
      const path = yield* pickObject(ctx, 'divide', false);
      if (!path) return;
      let marker: Marker | undefined;
      for (;;) {
        const a = yield ctx.prompt.integer({
          message: marker ? 'Enter the number of segments' : 'Enter the number of segments or',
          ...(!marker && { options: ['Block'] }),
        });
        if (a.kind === 'keyword') {
          marker = yield* pickBlock(ctx);
          if (!marker) return;
          continue;
        }
        if (a.kind !== 'number') return;
        if (a.value < 2 || a.value > MAX_MARKS) {
          ctx.message(`Requires an integer between 2 and ${MAX_MARKS}.`);
          continue;
        }
        const step = pathLength(path) / a.value;
        const from = path.closed ? 0 : 1;
        const stations = Array.from({ length: a.value - from }, (_, k) => (k + from) * step);
        return place(ctx, path, stations, marker);
      }
    },
  };
}

/** MEASURE: marks a given length apart along an object. */
export function measureCommand(): CommandDef {
  return {
    name: 'MEASURE',
    async *run(ctx) {
      const path = yield* pickObject(ctx, 'measure', true);
      if (!path) return;
      let marker: Marker | undefined;
      for (;;) {
        const a = yield ctx.prompt.distance({
          message: marker ? 'Specify length of segment' : 'Specify length of segment or',
          ...(!marker && { options: ['Block'] }),
        });
        if (a.kind === 'keyword') {
          marker = yield* pickBlock(ctx);
          if (!marker) return;
          continue;
        }
        if (a.kind !== 'distance') return;
        const length = pathLength(path);
        if (!(a.value > 0)) {
          ctx.message('Value must be positive and nonzero.');
          continue;
        }
        // Marks stop short of the end: one landing on it within the tolerance is left out.
        const count = Math.ceil(length / a.value - 1e-9) - 1;
        if (count > MAX_MARKS) {
          ctx.message(`Requires fewer than ${MAX_MARKS + 1} segments.`);
          continue;
        }
        const stations = Array.from({ length: Math.max(count, 0) }, (_, k) => (k + 1) * a.value);
        return place(ctx, path, stations, marker);
      }
    },
  };
}

/**
 * "Select object to divide" (or measure) until a markable object is picked: its path, which
 * MEASURE (`nearerEnd`) runs from the end nearer the pick.
 */
async function* pickObject(
  ctx: CommandContext,
  verb: 'divide' | 'measure',
  nearerEnd: boolean,
): Sub<ArrayPath | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({ message: `Select object to ${verb}`, single: true });
    const id = a.kind === 'selection' ? a.ids[0] : undefined;
    if (id === undefined) return undefined;
    const e = ctx.model.entity(id);
    const found = e && pathCurveOf(e.geom);
    if (found) {
      const pick = a.kind === 'selection' ? a.pick : undefined;
      const reversed =
        nearerEnd &&
        !found.closed &&
        pick !== undefined &&
        distance(pick, endPoint(found.curve)) < distance(pick, startPoint(found.curve));
      const path = arrayPath(found.curve, found.closed, reversed);
      if (pathLength(path) > 0) return path;
    }
    ctx.message(`Cannot ${verb} that object.`);
  }
}

/** Block: the block's name, until one the drawing defines, and whether to align it. */
async function* pickBlock(ctx: CommandContext): Sub<Marker | undefined> {
  for (;;) {
    const a = yield ctx.prompt.string({ message: 'Enter name of block to insert' });
    if (a.kind !== 'string' || a.value.trim() === '') return undefined;
    const name = a.value.trim();
    const block = blockNamed(ctx, name);
    if (!block) {
      ctx.message(`Block "${name}" cannot be found.`);
      continue;
    }
    const y = yield ctx.prompt.keyword({
      message: 'Align block with object?',
      options: ['Yes', 'No'],
      defaultLabel: 'Y',
    });
    if (y.kind === 'enter') return { block, align: true };
    if (y.kind !== 'keyword') return undefined;
    return { block, align: y.keyword === 'Yes' };
  }
}

/** A named (not anonymous, not a layout's) block of the drawing, by name in any case. */
function blockNamed(ctx: CommandContext, name: string): Handle | undefined {
  const wanted = name.toUpperCase();
  for (const r of ctx.model.tables.blockRecords.values()) {
    if (r.name.startsWith('*')) continue;
    if (r.name.toUpperCase() === wanted) return r.handle;
  }
  return undefined;
}

/** The marks at `stations` along the path, in one edit. */
function place(
  ctx: CommandContext,
  path: ArrayPath,
  stations: readonly number[],
  marker: Marker | undefined,
): void {
  if (stations.length === 0) return;
  const props = currentProps(ctx.model);
  const ids: EntityId[] = [];
  ctx.edit((b) => {
    for (const s of stations) {
      const f = pathFrame(path, s);
      const position: Vec2 = f.point;
      const e = b.addEntity({
        owner: ctx.space,
        ...props,
        geom: marker
          ? {
              kind: 'INSERT',
              block: marker.block,
              position,
              scale: { x: 1, y: 1, z: 1 },
              rotation: marker.align ? angleOf(f.direction) : 0,
              attributes: [],
            }
          : { kind: 'POINT', position },
      });
      ids.push(e.id);
    }
  });
  // The marks are the Previous selection set, to be picked again together.
  ctx.setPrevious(ids);
}
