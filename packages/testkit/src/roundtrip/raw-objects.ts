/**
 * Objects acad-ts cannot map are kept raw (DXF group codes, DWG object record) and written back
 * unchanged (M1-30, ARCHITECTURE.md §6.2 rule 1). This checks that promise across one save: every
 * raw object of the original is in the reopened document under its handle, with the same payload.
 */
import type { CadDocument } from '@node-projects/acad-ts';
import { UnknownEntity, UnknownNonGraphicalObject } from '@node-projects/acad-ts';

export interface RawObjectSurvival {
  /** Raw (unknown) objects in the original document. */
  kept: number;
  /** `HANDLE NAME` of raw objects the reopened document lacks or holds with a different payload. */
  lost: string[];
}

type RawObject = UnknownEntity | UnknownNonGraphicalObject;

const isRaw = (o: unknown): o is RawObject =>
  o instanceof UnknownEntity || o instanceof UnknownNonGraphicalObject;

/** The payload a writer must preserve, as a comparable string. */
export function rawPayload(o: RawObject): string {
  if (o.rawDwgData) return `dwg:${hexBytes(o.rawDwgData.data)}:${o.rawDwgData.handleStreamBits}`;
  return `dxf:${JSON.stringify(o.rawDxfCodes ?? null, (_k, v: unknown) =>
    v instanceof Uint8Array ? hexBytes(v) : typeof v === 'bigint' ? v.toString() : v,
  )}`;
}

export function rawObjectSurvival(original: CadDocument, reopened: CadDocument): RawObjectSurvival {
  const after = new Map<number, RawObject>();
  for (const o of reopened.getCadObjects()) if (isRaw(o)) after.set(o.handle, o);
  const out: RawObjectSurvival = { kept: 0, lost: [] };
  for (const o of original.getCadObjects()) {
    if (!isRaw(o)) continue;
    out.kept++;
    const b = after.get(o.handle);
    if (!b || rawPayload(b) !== rawPayload(o))
      out.lost.push(`${o.handle.toString(16).toUpperCase()} ${o.objectName}`);
  }
  return out;
}

function hexBytes(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
