// A whole drawing as a Triya document (M1-22): header, tables, every block definition with its
// base point, the mapped entities in block order, the SORTENTSTABLEs, the image definitions and
// settings (M1-19) and the layouts with their page setups (M1-18), which is what the app builds
// its engine and renderer from. The objects Triya keeps without mapping are listed by handle
// only (`passthrough`, M1-05), so the engine never allocates one of their handles again.
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
import { PassthroughStore } from '../export/passthrough';
import { drawingFacts, type DrawingFacts } from '../health/facts';
import { mapEntities, type UnmappedEntity } from './entities';
import { mapHeader } from './header';
import { mapImageObjects } from './images';
import { mapLayouts } from './layouts';
import { mapSortEnts } from './sortents';
import { mapTables } from './tables';

export function documentInit(doc: CadDocument): DocumentInit {
  return mapDocument(doc).init;
}

function mapDocument(doc: CadDocument): { init: DocumentInit; unmapped: UnmappedEntity[] } {
  const { header, meta, handSeed } = mapHeader(doc);
  const { entities, unmapped } = mapEntities(doc);
  const init: DocumentInit = {
    meta,
    handSeed,
    header,
    tables: mapTables(doc),
    blocks: [...(doc.blockRecords ?? [])].map((b) => {
      const p = b.blockEntity?.basePoint;
      return { handle: hex(b.handle), name: b.name, basePoint: { x: p?.x ?? 0, y: p?.y ?? 0 } };
    }),
    objects: [...mapSortEnts(doc), ...mapImageObjects(doc)],
    layouts: mapLayouts(doc),
    entities,
  };
  return { init: { ...init, passthrough: PassthroughStore.of(doc, init).handles }, unmapped };
}

/** What opening a drawing hands the app, besides the document itself. */
export interface OpenedDocument {
  readonly init: DocumentInit;
  /** The `*Model_Space` block record, which the Model tab shows. */
  readonly modelSpace: Handle | undefined;
  /**
   * Zoom Extents per space, keyed by block record: model space and each layout's paper space.
   * A space whose contents have no known extent has no entry.
   */
  readonly extents: Readonly<Record<Handle, Box>>;
  /** What the drawing health report needs from the file (M1-25). */
  readonly facts: DrawingFacts;
}

const point = (v: HeaderValue | undefined): { x: number; y: number } | undefined =>
  typeof v === 'object' ? v : undefined;

export function openDocument(doc: CadDocument): OpenedDocument {
  const { init, unmapped } = mapDocument(doc);
  const modelSpace = init.blocks?.find((b) => b.name.toUpperCase() === '*MODEL_SPACE')?.handle;
  return {
    init,
    modelSpace,
    extents: spaceExtents(init, modelSpace),
    facts: drawingFacts(doc, init, unmapped),
  };
}

/**
 * The union of what each space draws whose extent the engine knows. AutoCAD's extents leave
 * out XLINE and RAY; text has no extent until the text engine supplies bounds (M1-35), so a
 * model space of text alone falls back to the header's `$EXTMIN`/`$EXTMAX`.
 */
function spaceExtents(init: DocumentInit, modelSpace: Handle | undefined): Record<Handle, Box> {
  const model = DocumentModel.create(init);
  const header = model.header;
  const min = point(header.get('$EXTMIN'));
  const max = point(header.get('$EXTMAX'));
  const tol = toleranceFromExtents(min ?? { x: 1, y: 1 }, max ?? { x: 0, y: 0 });
  const index = SpatialIndex.build(model, { tol });
  const out: Record<Handle, Box> = {};
  const spaces = new Set(model.layouts.map((l) => l.blockRecord));
  if (modelSpace !== undefined) spaces.add(modelSpace);
  for (const block of spaces) {
    if (!model.hasBlock(block)) continue;
    let box: Box = EMPTY_BOX;
    for (const id of model.blockEntities(block)) {
      const b = index.bounds(id);
      if (b?.kind === 'box') box = unionBox(box, b.box);
    }
    if (box.minX <= box.maxX && box.minY <= box.maxY) out[block] = box;
  }
  if (
    modelSpace !== undefined &&
    !out[modelSpace] &&
    min &&
    max &&
    min.x <= max.x &&
    min.y <= max.y
  ) {
    out[modelSpace] = { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
  }
  return out;
}
