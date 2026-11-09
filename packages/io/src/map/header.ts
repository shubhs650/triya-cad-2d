// AcadToTriya for the HEADER section (M1-03).
//
// Every variable acad-ts knows is carried, including those its DXF writer skips, under its DXF name (`$LTSCALE`), with the value the
// DXF writer would emit: numbers, strings and booleans as DXF states them (angles in radians
// where acad-ts converts them, dates as Julian days), points as Vec2/Vec3, and references as
// the referenced record's name, as DXF writes them. Triya reads what it needs by name; the rest
// is carried so a later save can compare against it.
//
// AutoCAD saves some system variables outside the HEADER section, as DICTIONARYVAR entries of
// the AcDbVariableDictionary (MSLTSCALE, CANNOSCALE, CMLEADERSTYLE, …). Those are carried
// under their bare names (`MSLTSCALE`), with the string the entry holds, so no name can be
// taken for a header variable; CANNOSCALEVALUE (M1-63) is added from the ACAD_SCALELIST SCALE
// that CANNOSCALE names, as AutoCAD computes it.

import type { CadSystemVariable } from '@node-projects/acad-ts';
import {
  CadDictionary,
  CadHeader,
  Color,
  DictionaryVariable,
  Scale,
  type CadDocument,
} from '@node-projects/acad-ts';
import type { DocumentMeta, HeaderValue } from '@triya/engine';
import { colorNumber, hex } from './common';

export interface MappedHeader {
  readonly header: Map<string, HeaderValue>;
  readonly meta: DocumentMeta;
  readonly handSeed: string;
}

function scalar(v: unknown): HeaderValue | undefined {
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return Number(v);
  // Colour variables ($CECOLOR, $DIMTFILLCLR) are DXF 62 colour numbers.
  if (v instanceof Color) return colorNumber(v);
  return undefined;
}

/** A point variable is written as 10/20[/30] groups. */
const isPoint = (codes: readonly number[]): boolean =>
  codes.length >= 2 && codes.every((c) => c >= 10 && c < 40);

/** Group codes 320–369 are object handles (soft/hard pointer and owner ids). */
export const isHandleCode = (code: number): boolean => code >= 320 && code < 370;

/**
 * A header variable's value as Triya carries it, or undefined when the header does not state it
 * (the inverse of what `TriyaToAcad` writes, export/header.ts).
 */
export function headerVariableValue(
  name: string,
  variable: CadSystemVariable,
  h: CadHeader,
): HeaderValue | undefined {
  if (name === '$HANDSEED') return hex(h.handleSeed);
  // acad-ts writes a true colour's 62 as −1; Triya keeps the ACI AutoCAD writes instead.
  const property = variable.getValue(h);
  if (property instanceof Color) return scalar(property)!;
  const values = variable.dxfCodes.map((code) => variable.getSystemValue(code, h));
  if (values.every((v) => v === null || v === undefined)) return undefined;
  if (isPoint(variable.dxfCodes)) {
    const [x, y, z] = values.map((v) => Number(v ?? 0));
    return values.length > 2 ? { x: x!, y: y!, z: z! } : { x: x!, y: y! };
  }
  // A handle variable ($CMATERIAL 347) is a hex string, as DXF writes it.
  if (variable.dxfCodes.length === 1 && isHandleCode(variable.dxfCodes[0]!)) {
    return hex(Number(values[0]));
  }
  return scalar(values[0]);
}

export function mapHeader(doc: CadDocument): MappedHeader {
  const h = doc.header ?? new CadHeader();
  const header = new Map<string, HeaderValue>();
  for (const [name, variable] of CadHeader.getHeaderMap()) {
    const value = headerVariableValue(name, variable, h);
    if (value !== undefined) header.set(name, value);
  }
  mapVariableDictionary(doc, header);
  return {
    header,
    handSeed: hex(h.handleSeed),
    meta: {
      sourceVersion: h.versionString,
      codePage: h.codePage,
      insUnits: h.insUnits as number,
      measurement: (h.measurementUnits as number) === 0 ? 'imperial' : 'metric',
      ...(doc.rootDictionary && { rootDictionary: hex(doc.rootDictionary.handle) }),
    },
  };
}

/** The named-object dictionary's entry `key`, when it is a dictionary. */
export function namedDictionary(doc: CadDocument, key: string): CadDictionary | undefined {
  const d = doc.rootDictionary?.get(key);
  return d instanceof CadDictionary ? d : undefined;
}

/**
 * The AcDbVariableDictionary's DICTIONARYVARs under their names, and CANNOSCALEVALUE: the
 * paper units per drawing unit of the ACAD_SCALELIST scale CANNOSCALE names ("Returns the
 * value of the current annotation scale", 0.02 for 1:50). A CANNOSCALE naming no scale of
 * the list has no value.
 */
function mapVariableDictionary(doc: CadDocument, header: Map<string, HeaderValue>): void {
  for (const v of namedDictionary(doc, CadDictionary.variableDictionary) ?? [])
    if (v instanceof DictionaryVariable && v.name) header.set(v.name, v.value);
  const current = header.get(DictionaryVariable.currentAnnotationScale);
  if (current === undefined) return;
  const value = annotationScaleValue(doc, current);
  if (value !== undefined) header.set('CANNOSCALEVALUE', value);
}

/** CANNOSCALEVALUE for a CANNOSCALE of `scale`: undefined when no list scale has that name. */
export function annotationScaleValue(doc: CadDocument, scale: HeaderValue): number | undefined {
  for (const s of namedDictionary(doc, CadDictionary.acadScaleList) ?? []) {
    if (!(s instanceof Scale) || s.name !== scale) continue;
    return s.paperUnits > 0 && s.drawingUnits > 0 ? s.paperUnits / s.drawingUnits : undefined;
  }
  return undefined;
}
