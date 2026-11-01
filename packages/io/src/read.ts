import { ACadVersion, DwgReader, DxfReader, type CadDocument } from '@node-projects/acad-ts';

export type CadFormat = 'dwg' | 'dxf';

/** What a read produced, small enough to post across a worker boundary. */
export interface ReadSummary {
  format: CadFormat;
  /** AutoCAD version code from the header, e.g. `AC1032`. */
  version: string;
  /** `$HANDSEED` as upper-case hex: new objects must be allocated at or above it. */
  handSeed: string;
  /** Model-space entity counts by DXF type name, e.g. `{ LINE: 2, CIRCLE: 1 }`. */
  modelSpaceEntities: Record<string, number>;
  layers: string[];
}

/**
 * DWG files start with their version magic (`AC1032`, `AC1009`, … or `MC0.0` for R1.x).
 * Anything else is handed to the DXF reader, which detects ASCII vs binary itself.
 */
export function detectFormat(bytes: Uint8Array): CadFormat {
  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  return /^(AC\d{4}|AC\d\.\d\d|MC0\.0)/.test(magic) ? 'dwg' : 'dxf';
}

/** Parse a DWG or DXF file into an acad-ts `CadDocument`. Throws on unreadable input. */
export function readCadDocument(
  bytes: Uint8Array,
  format: CadFormat = detectFormat(bytes),
): CadDocument {
  if (format === 'dwg') {
    // DwgReader takes an ArrayBuffer and reads from offset 0, so pass exactly this view's bytes.
    const exact =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.slice().buffer;
    return DwgReader.readFromStream(exact as ArrayBuffer);
  }
  return DxfReader.readFromStream(bytes);
}

export function summarizeDocument(doc: CadDocument, format: CadFormat): ReadSummary {
  const modelSpaceEntities: Record<string, number> = {};
  for (const entity of doc.entities ?? []) {
    modelSpaceEntities[entity.objectName] = (modelSpaceEntities[entity.objectName] ?? 0) + 1;
  }
  const version = doc.header?.version ?? ACadVersion.Unknown;
  return {
    format,
    version: ACadVersion[version] ?? String(version),
    handSeed: (doc.header?.handleSeed ?? 0).toString(16).toUpperCase(),
    modelSpaceEntities,
    layers: [...(doc.layers ?? [])].map((layer) => layer.name),
  };
}
