// A whole drawing as a Triya document (M1-22): header, tables, every block definition with its
// base point, the mapped entities in block order and the SORTENTSTABLEs, which is what the app
// builds its engine and renderer from. Layouts, and the objects M1-05's passthrough store keeps,
// are left out: nothing that reads this needs them yet (layouts come with M1-18).
import type { CadDocument } from '@node-projects/acad-ts';
import {
  DocumentModel,
  EMPTY_BOX,
  SpatialIndex,
  toleranceFromExtents,
  unionBox,
  type Box,
  type DocumentInit,
  type Handle,
  type HeaderValue,
} from '@triya/engine';
import { hex } from './common';
import { mapEntities } from './entities';
import { mapHeader } from './header';
import { mapSortEnts } from './sortents';
import { mapTables } from './tables';

export function documentInit(doc: CadDocument): DocumentInit {
  const { header, meta, handSeed } = mapHeader(doc);
  return {
    meta,
    handSeed,
    header,
    tables: mapTables(doc),
    blocks: [...(doc.blockRecords ?? [])].map((b) => {
      const p = b.blockEntity?.basePoint;
      return { handle: hex(b.handle), name: b.name, basePoint: { x: p?.x ?? 0, y: p?.y ?? 0 } };
    }),
    objects: mapSortEnts(doc),
    entities: mapEntities(doc).entities,
  };
}

/** What opening a drawing hands the app, besides the document itself. */
export interface OpenedDocument {
  readonly init: DocumentInit;
  /** The `*Model_Space` block record, which the Model tab shows. */
  readonly modelSpace: Handle | undefined;
  /** Model-space extents for Zoom Extents, undefined when nothing has a known extent. */
  readonly extents: Box | undefined;
}

const point = (v: HeaderValue | undefined): { x: number; y: number } | undefined =>
  typeof v === 'object' ? v : undefined;

export function openDocument(doc: CadDocument): OpenedDocument {
  const init = documentInit(doc);
  const modelSpace = init.blocks?.find((b) => b.name.toUpperCase() === '*MODEL_SPACE')?.handle;
  const extents = modelSpace === undefined ? undefined : modelExtents(init, modelSpace);
  return { init, modelSpace, extents };
}

/**
 * The union of what model space draws whose extent the engine knows. AutoCAD's extents leave
 * out XLINE and RAY; text has no extent until the text engine supplies bounds (M1-35), so a
 * drawing of text alone falls back to the header's `$EXTMIN`/`$EXTMAX`.
 */
function modelExtents(init: DocumentInit, block: Handle): Box | undefined {
  const model = DocumentModel.create(init);
  const header = model.header;
  const min = point(header.get('$EXTMIN'));
  const max = point(header.get('$EXTMAX'));
  const tol = toleranceFromExtents(min ?? { x: 1, y: 1 }, max ?? { x: 0, y: 0 });
  const index = SpatialIndex.build(model, { tol });
  let box: Box = EMPTY_BOX;
  for (const id of model.blockEntities(block)) {
    const b = index.bounds(id);
    if (b?.kind === 'box') box = unionBox(box, b.box);
  }
  if (box.minX <= box.maxX && box.minY <= box.maxY) return box;
  if (min && max && min.x <= max.x && min.y <= max.y) {
    return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
  }
  return undefined;
}
