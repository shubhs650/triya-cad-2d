// AcadToTriya for the HEADER section (M1-03).
//
// Every variable acad-ts knows is carried, including those its DXF writer skips, under its DXF name (`$LTSCALE`), with the value the
// DXF writer would emit: numbers, strings and booleans as DXF states them (angles in radians
// where acad-ts converts them, dates as Julian days), points as Vec2/Vec3, and references as
// the referenced record's name, as DXF writes them. Triya reads what it needs by name; the rest
// is carried so a later save can compare against it.

import { CadHeader, Color, type CadDocument } from '@node-projects/acad-ts';
import type { DocumentMeta, HeaderValue } from '@triya/engine';
import { hex } from './common';

export interface MappedHeader {
  readonly header: Map<string, HeaderValue>;
  readonly meta: DocumentMeta;
  readonly handSeed: string;
}

function scalar(v: unknown): HeaderValue | undefined {
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return Number(v);
  // Colour variables ($CECOLOR, $DIMTFILLCLR) are DXF 62 colour numbers.
  if (v instanceof Color) return v.isTrueColor ? v.getApproxIndex() : v.index;
  return undefined;
}

/** A point variable is written as 10/20[/30] groups. */
const isPoint = (codes: readonly number[]): boolean =>
  codes.length >= 2 && codes.every((c) => c >= 10 && c < 40);

export function mapHeader(doc: CadDocument): MappedHeader {
  const h = doc.header ?? new CadHeader();
  const header = new Map<string, HeaderValue>();
  for (const [name, variable] of CadHeader.getHeaderMap()) {
    if (name === '$HANDSEED') {
      header.set(name, hex(h.handleSeed));
      continue;
    }
    // acad-ts writes a true colour's 62 as −1; Triya keeps the nearest ACI number instead.
    const property = variable.getValue(h);
    if (property instanceof Color) {
      header.set(name, scalar(property)!);
      continue;
    }
    const values = variable.dxfCodes.map((code) => variable.getSystemValue(code, h));
    if (values.every((v) => v === null || v === undefined)) continue;
    if (isPoint(variable.dxfCodes)) {
      const [x, y, z] = values.map((v) => Number(v ?? 0));
      header.set(name, values.length > 2 ? { x: x!, y: y!, z: z! } : { x: x!, y: y! });
      continue;
    }
    const value = scalar(values[0]);
    if (value !== undefined) header.set(name, value);
  }
  return {
    header,
    handSeed: hex(h.handleSeed),
    meta: {
      sourceVersion: h.versionString,
      codePage: h.codePage,
      insUnits: h.insUnits as number,
      measurement: (h.measurementUnits as number) === 0 ? 'imperial' : 'metric',
    },
  };
}
