// A flange as a block definition (M8-01): the parts draw.ts makes, at the drawing's units, on
// layer 0 ByBlock so an insert takes its layer's colour, linetype and lineweight; hidden edges
// and centre lines take the drawing's HIDDEN and CENTER linetypes when it has them.
import type { ChangeSetBuilder, DocumentModel, Handle } from '@triya/engine';
import { addPartsBlock, drawingScale } from '../block';
import { FLANGE_TYPE_NAMES, b165Flange, type B165Spec, type FlangeDimensions } from './b16-5';
import { flangeParts, type FlangeView } from './draw';

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
  return addPartsBlock(b, model, flangeBlockName(spec, view), flangeDescription(d, view), () =>
    flangeParts(d, view, drawingScale(model)),
  );
}
