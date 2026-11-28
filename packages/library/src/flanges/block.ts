// A flange as a block definition (M8-01): the parts draw.ts makes, at the drawing's units, on
// layer 0 ByBlock so an insert takes its layer's colour, linetype and lineweight; hidden edges
// and centre lines take the drawing's HIDDEN and CENTER linetypes when it has them.
import {
  insUnitsOf,
  metresPerUnit,
  type ChangeSetBuilder,
  type DocumentModel,
  type Handle,
  type LinetypeRef,
} from '@triya/engine';
import { FLANGE_TYPE_NAMES, b165Flange, type B165Spec, type FlangeDimensions } from './b16-5';
import { flangeParts, type FlangeView, type PartRole } from './draw';

/** INSUNITS 1, inches: the tables' unit. */
const INCHES = 1;

/**
 * What the tables' inches are multiplied by to draw in `model`'s units: by its INSUNITS when
 * it has one, else 25.4 for a metric drawing ($MEASUREMENT 1) and 1 for an imperial one.
 */
export function drawingScale(model: DocumentModel): number {
  const metres = metresPerUnit(insUnitsOf(model));
  if (metres !== undefined) return metresPerUnit(INCHES)! / metres;
  const m = model.header.get('$MEASUREMENT');
  const metric = typeof m === 'number' ? m === 1 : model.meta.measurement === 'metric';
  return metric ? 25.4 : 1;
}

const VIEW_NAMES: Readonly<Record<FlangeView, string>> = {
  front: 'FRONT',
  side: 'SIDE',
  section: 'SECTION',
};

/**
 * The block's name: `ASME_B16.5_WN_CL150_NPS4_FRONT`, with the schedule when a weld neck or
 * socket welding flange is bored to other than standard wall (`…_NPS4_SCH80_FRONT`).
 */
export function flangeBlockName(spec: B165Spec, view: FlangeView): string {
  const bored = spec.type === 'WN' || spec.type === 'SW';
  const schedule = bored && spec.schedule && spec.schedule !== 'STD' ? `_SCH${spec.schedule}` : '';
  return `ASME_B16.5_${spec.type}_CL${spec.flangeClass}_NPS${spec.nps}${schedule}_${VIEW_NAMES[view]}`;
}

/** "ASME B16.5 Class 150 NPS 4 weld neck flange, front view (standard wall bore)". */
export function flangeDescription(d: FlangeDimensions, view: FlangeView): string {
  const { flangeClass, nps, type, schedule } = d.spec;
  const bore =
    type === 'WN' || type === 'SW'
      ? ` (${schedule === 'STD' ? 'standard wall' : `schedule ${schedule}`} bore)`
      : '';
  return `ASME B16.5 Class ${flangeClass} NPS ${nps} ${FLANGE_TYPE_NAMES[type]} flange, ${view} view${bore}`;
}

function linetypeNamed(model: DocumentModel, name: string): Handle | undefined {
  for (const lt of model.tables.linetypes.values()) {
    if (lt.name.toUpperCase() === name) return lt.handle;
  }
  return undefined;
}

/**
 * The handle of the drawing's block for flange `spec` drawn as `view`, adding it (based at the
 * centre of the gasket face, in the drawing's units) when the drawing lacks it. Undefined when
 * B16.5 has no such flange.
 */
export function addFlangeBlock(
  b: ChangeSetBuilder,
  model: DocumentModel,
  spec: B165Spec,
  view: FlangeView,
): Handle | undefined {
  const d = b165Flange(spec);
  if (!d) return undefined;
  const name = flangeBlockName(spec, view);
  for (const block of model.blocks.values()) {
    if (block.name.toUpperCase() === name.toUpperCase()) return block.handle;
  }
  const zero = [...model.tables.layers.values()].find((l) => l.name === '0')!.handle;
  const linetypes: Readonly<Record<PartRole, LinetypeRef>> = {
    visible: 'ByBlock',
    hatch: 'ByBlock',
    hidden: linetypeNamed(model, 'HIDDEN') ?? 'ByBlock',
    center: linetypeNamed(model, 'CENTER') ?? 'ByBlock',
  };
  const block = b.addBlock({
    name,
    basePoint: { x: 0, y: 0 },
    units: insUnitsOf(model),
    description: flangeDescription(d, view),
  }).handle;
  for (const part of flangeParts(d, view, drawingScale(model))) {
    b.addEntity({
      owner: block,
      layer: zero,
      geom: part.geom,
      color: { kind: 'byBlock' },
      linetype: linetypes[part.role],
      lineweight: 'ByBlock',
    });
  }
  return block;
}
