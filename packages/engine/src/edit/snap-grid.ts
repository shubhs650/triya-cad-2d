// The drawing's snap and grid settings (M3-06 part 2). AutoCAD keeps SNAPUNIT, GRIDUNIT,
// GRIDMAJOR, SNAPSTYL and SNAPISOPAIR in the current viewport (AutoCAD 2024 Help, each variable:
// "Saved in: Drawing"; DXF reference, VPORT codes 14/24, 15/25, 61, 76 and 78): Triya's is the
// model-space `*Active` VPORT, the first one when tiles share the name (the DXF reference: the
// first is the current viewport). The Snap and Grid tab and ISOPLANE edit it; a drawing without
// one keeps the canvas's 10 × 10 spacing and has no isometric snap.
import { isoplaneOf, nextIsoplane, type Isoplane } from '../input/isometric';
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { VportRecord } from '../model/types';
import type { SnapGridSettings } from '../commands/prompt';

const isActive = (v: VportRecord) => v.name.toUpperCase() === '*ACTIVE';

/** The model-space `*Active` VPORT, the current one of several. */
export function currentVport(model: DocumentModel): VportRecord | undefined {
  for (const v of model.tables.vports.values()) if (isActive(v)) return v;
  return undefined;
}

/** The Snap and Grid tab's settings as `v` holds them. */
export function snapGridOf(v: VportRecord): SnapGridSettings {
  return {
    snapSpacing: v.snapSpacing,
    gridSpacing: v.gridSpacing,
    gridMajor: v.gridMajor,
    isometric: v.isometricSnap,
  };
}

/**
 * Why the settings cannot be kept, or undefined: snap spacing above 0, grid spacing 0 (follow
 * the snap spacing) or more, and a major line every 1 to 100 grid lines (GRIDMAJOR's range).
 */
export function snapGridProblem(s: SnapGridSettings): string | undefined {
  const finite = (n: number) => Number.isFinite(n);
  if (!(s.snapSpacing.x > 0 && s.snapSpacing.y > 0 && finite(s.snapSpacing.x + s.snapSpacing.y)))
    return 'Snap spacing must be more than 0.';
  if (!(s.gridSpacing.x >= 0 && s.gridSpacing.y >= 0 && finite(s.gridSpacing.x + s.gridSpacing.y)))
    return 'Grid spacing must be 0 or more.';
  if (!(Number.isInteger(s.gridMajor) && s.gridMajor >= 1 && s.gridMajor <= 100))
    return 'Major line every must be a whole number from 1 to 100.';
  return undefined;
}

/** What setting `s` in `v` changes in it; undefined when nothing. */
export function snapGridPatch(
  v: VportRecord,
  s: SnapGridSettings,
): Partial<VportRecord> | undefined {
  const same = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    p.x === q.x && p.y === q.y;
  const patch = {
    ...(!same(v.snapSpacing, s.snapSpacing) && { snapSpacing: { ...s.snapSpacing } }),
    ...(!same(v.gridSpacing, s.gridSpacing) && { gridSpacing: { ...s.gridSpacing } }),
    ...(v.gridMajor !== s.gridMajor && { gridMajor: s.gridMajor }),
    ...(v.isometricSnap !== s.isometric && { isometricSnap: s.isometric }),
  };
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/** The current isoplane (SNAPISOPAIR), Left when the drawing has no `*Active` VPORT. */
export function currentIsoplane(model: DocumentModel): Isoplane {
  return isoplaneOf(currentVport(model)?.isometricPlane);
}

/**
 * Sets the isoplane (ISOPLANE, F5): `plane`, or the next after the current one. Returns the
 * plane set, or undefined when the drawing has no `*Active` VPORT to keep it in.
 */
export function setIsoplane(
  b: ChangeSetBuilder,
  model: DocumentModel,
  plane?: Isoplane,
): Isoplane | undefined {
  const v = currentVport(model);
  if (!v) return undefined;
  const now = isoplaneOf(v.isometricPlane);
  const next = plane ?? nextIsoplane(now);
  if (next !== v.isometricPlane) b.updateTableRecord('vports', v.handle, { isometricPlane: next });
  return next;
}
