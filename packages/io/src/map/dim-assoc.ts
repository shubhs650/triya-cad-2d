// DIMASSOC objects to Triya (M1-75 part 35): each associative dimension's point references, as
// the dimension's extension dictionary holds them (`ACAD_DIMASSOC`). The dimension and the
// geometry list the DIMASSOC in their reactors (`common`).

import {
  DimensionAssociationObject,
  type CadDocument,
  type CadObject,
  type OsnapPointRef,
} from '@node-projects/acad-ts';
import type { DimAssoc, DimAssocPoint, Handle } from '@triya/engine';
import { common, hex, ref, vec3 } from './common';

const handles = (objects: readonly CadObject[]): Handle[] => objects.map((o) => hex(o.handle));

/** A point reference as Triya keeps it; its geometry path as the DWG writer takes it. */
export function mapDimAssocPoint(p: OsnapPointRef, depth = 0): DimAssocPoint {
  const geometry = p.geometryPath.length > 0 ? p.geometryPath : p.geometry ? [p.geometry] : [];
  // AutoCAD's intersection and apparent intersection snaps (ObjectOsnapType 6 and 11).
  const intersection = p.objectOsnapType === 6 || p.objectOsnapType === 11;
  const last = p.hasLastPointRef && p.lastPointRef && depth < 16 ? p.lastPointRef : undefined;
  return {
    osnap: p.objectOsnapType,
    geometry: handles(geometry),
    subentType: p.subentType,
    gsMarker: p.gsMarker,
    xrefPaths: [...p.xrefPaths],
    parameter: p.geometryParameter,
    point: vec3(p.osnapPoint),
    ...(intersection
      ? {
          intersection: {
            geometry: handles(p.intersectionGeometry),
            subentType: p.intersectionSubType,
            gsMarker: p.intersectionGsMarker,
            xrefPaths: [...p.intersectionXrefPaths],
          },
        }
      : {}),
    ...(last ? { last: mapDimAssocPoint(last, depth + 1) } : {}),
  };
}

/** The bits of DXF 90, first to fourth point. */
const BITS = [1, 2, 4, 8] as const;

/** The drawing's DIMASSOC objects, by handle. */
export function mapDimAssocs(doc: CadDocument): DimAssoc[] {
  const out: DimAssoc[] = [];
  for (const o of doc.getCadObjects()) {
    if (!(o instanceof DimensionAssociationObject)) continue;
    const refs = [o.firstPointRef, o.secondPointRef, o.thirdPointRef, o.fourthPointRef];
    const points = BITS.map((bit, i) => {
      const p = refs[i];
      return (o.associativityFlags & bit) !== 0 && p ? mapDimAssocPoint(p) : null;
    }) as unknown as DimAssoc['points'];
    out.push({
      ...common(o),
      type: 'DIMASSOC',
      owner: ref(o.owner) ?? '0',
      dimension: ref(o.dimension) ?? '0',
      transSpace: o.isTransSpace,
      rotatedType: o.rotatedDimensionType,
      points,
    });
  }
  return out.sort((a, b) => parseInt(a.handle, 16) - parseInt(b.handle, 16));
}
