// SPATIAL_FILTER objects to Triya (M1-103): each XCLIPped block reference's clip, the `SPATIAL`
// entry of the ACAD_FILTER dictionary in the INSERT's extension dictionary. acad-ts calls DXF
// 71 `displayBoundary`; it is the clipping on/off flag (XCLIP ON/OFF, ezdxf's
// `is_clipping_enabled`), while the frame's display is the drawing's XCLIPFRAME. A filter
// reached by another path (none in the corpus) stays unmapped, kept by passthrough.

import {
  CadDictionary,
  Insert,
  SpatialFilter as AcadSpatialFilter,
  type CadDocument,
  type Matrix4,
} from '@node-projects/acad-ts';
import type { Matrix3x4, SpatialFilter } from '@triya/engine';
import { common, hex, vec3 } from './common';

/** The 3×4 a SPATIAL_FILTER stores (rows x, y, z of acad-ts's Matrix4), row-major. */
const rows = (m: Matrix4): Matrix3x4 => [
  m.m00,
  m.m01,
  m.m02,
  m.m03,
  m.m10,
  m.m11,
  m.m12,
  m.m13,
  m.m20,
  m.m21,
  m.m22,
  m.m23,
];

/** The drawing's XCLIP filters, by handle. */
export function mapSpatialFilters(doc: CadDocument): SpatialFilter[] {
  const out: SpatialFilter[] = [];
  for (const o of doc.getCadObjects()) {
    if (!(o instanceof AcadSpatialFilter)) continue;
    // filter → ACAD_FILTER dictionary → the INSERT's extension dictionary → the INSERT.
    const dict = o.owner;
    const xdict = dict instanceof CadDictionary ? dict.owner : undefined;
    const insert = xdict instanceof CadDictionary ? xdict.owner : undefined;
    if (!(dict instanceof CadDictionary) || !(insert instanceof Insert)) continue;
    if (insert.xDictionary !== xdict) continue;
    out.push({
      ...common(o),
      type: 'SPATIAL_FILTER',
      owner: hex(dict.handle),
      insert: hex(insert.handle),
      boundary: o.boundaryPoints.map((p) => ({ x: p.x, y: p.y })),
      normal: vec3(o.normal),
      origin: vec3(o.origin),
      enabled: o.displayBoundary,
      ...(o.clipFrontPlane ? { frontClip: o.frontDistance } : {}),
      ...(o.clipBackPlane ? { backClip: o.backDistance } : {}),
      inverseInsert: rows(o.inverseInsertTransform),
      boundaryTransform: rows(o.insertTransform),
    });
  }
  return out;
}
