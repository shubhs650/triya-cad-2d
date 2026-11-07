// Block definitions (M1-14): every BLOCK_RECORD with its base point, and what makes it part of a
// dynamic block (part 3, FR-B3). Triya draws a dynamic block in the state the file stores and
// never evaluates it (PRD non-goal 2); its parameters, actions and states stay passthrough.
//
// - A dynamic block definition has the `ACAD_ENHANCEDBLOCK` evaluation graph in its extension
//   dictionary (a record that only keeps an AcDbDynamicBlockGUID, from a block that was
//   dynamic once, is static). AutoCAD shows it by its AcDbDynamicBlockTrueName xdata, which
//   matters for R2000 files: they save dynamic blocks under anonymous `*U` names.
// - A reference whose parameters differ from the definition's names an anonymous `*U` record
//   holding that state; the record's AcDbBlockRepBTag xdata (1070 version, 1005 handle) names
//   the dynamic block it came from.
import type { BlockRecord, CadObject } from '@node-projects/acad-ts';
import type { BlockDefinition, Handle } from '@triya/engine';
import { hex } from './common';

function xdataRecords(o: CadObject, app: string) {
  for (const [id, data] of o.extendedData) if (id.name === app) return data.records;
  return undefined;
}

function dynamicName(b: BlockRecord): string | undefined {
  const graph = b.xDictionary?.entryNames.some((n) => n.toUpperCase() === 'ACAD_ENHANCEDBLOCK');
  if (!graph) return undefined;
  const trueName = xdataRecords(b, 'AcDbDynamicBlockTrueName')?.find((r) => r.code === 1000);
  return typeof trueName?.rawValue === 'string' ? trueName.rawValue : b.name;
}

function dynamicOf(b: BlockRecord): Handle | undefined {
  const h = xdataRecords(b, 'AcDbBlockRepBTag')?.find((r) => r.code === 1005)?.rawValue;
  return typeof h === 'number' || typeof h === 'bigint' ? hex(h) : undefined;
}

export function mapBlock(b: BlockRecord): BlockDefinition {
  const p = b.blockEntity?.basePoint;
  const name = dynamicName(b);
  const of = dynamicOf(b);
  return {
    handle: hex(b.handle),
    name: b.name,
    basePoint: { x: p?.x ?? 0, y: p?.y ?? 0 },
    ...(name !== undefined ? { dynamic: { name } } : {}),
    ...(of !== undefined ? { dynamicOf: of } : {}),
  };
}
