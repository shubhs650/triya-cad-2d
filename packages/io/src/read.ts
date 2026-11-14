import {
  ACadVersion,
  DwgReader,
  DwgReaderConfiguration,
  DxfReader,
  DxfReaderConfiguration,
  Layout,
  type BlockRecord,
  type CadDocument,
} from '@node-projects/acad-ts';

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

/**
 * Reader settings for a document that may be saved again (ARCHITECTURE.md §6.2 rule 1, M1-30).
 * Objects acad-ts cannot map are kept as `UnknownEntity` / `UnknownNonGraphicalObject` with their
 * raw payload, which the writers emit unchanged; acad-ts' default discards them. DXF reads also
 * keep the group codes of MATERIAL and VISUALSTYLE, which the DXF reader does not read into
 * fields, so DXF saves write them back as read (M1-28, patch 0021).
 */
export function fidelityDwgReaderConfiguration(): DwgReaderConfiguration {
  const config = new DwgReaderConfiguration();
  config.keepUnknownEntities = true;
  config.keepUnknownNonGraphicalObjects = true;
  // Objects no reference reaches are still in the file, and AutoCAD keeps them (M1-33).
  config.keepUnreachableObjects = true;
  return config;
}

export function fidelityDxfReaderConfiguration(): DxfReaderConfiguration {
  const config = new DxfReaderConfiguration();
  config.keepUnknownEntities = true;
  config.keepUnknownNonGraphicalObjects = true;
  config.keepRawDxfPassthroughObjects = true;
  // Blocks with no name and no record: nothing can reference them, but they are in the file.
  config.keepUnreachableObjects = true;
  return config;
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
    return repairLayoutLinks(
      DwgReader.readFromStreamWithConfig(exact as ArrayBuffer, fidelityDwgReaderConfiguration()),
    );
  }
  return repairLayoutLinks(
    DxfReader.readFromStreamWithConfig(bytes, fidelityDxfReaderConfiguration()),
  );
}

/** A paper tab's block: `*Paper_Space`, then `*Paper_Space0`, `*Paper_Space1`, …. */
const PAPER_BLOCK = /^\*Paper_Space(\d*)$/i;

/**
 * Links each layout whose block record link is broken (M2-69, malformed input; ezdxf's
 * layout_broken_links*.dxf and layout_missing_block_record.dxf) to its block record, so its tab
 * and sheet show and a save writes the link back. First the record whose 340 still names the
 * layout; otherwise by name among the layout blocks no layout has: Model takes `*Model_Space`,
 * and the paper tabs, in tab order, `*Paper_Space`, `*Paper_Space0`, `*Paper_Space1`, …, the
 * order AutoCAD names them in (the current tab's is `*Paper_Space`, which a file that lost
 * every link no longer says). A layout with no such record left stays unlinked: it has no
 * space to show, and is kept as read.
 */
export function repairLayoutLinks(doc: CadDocument): CadDocument {
  const broken = [...(doc.layouts ?? [])].filter((l) => !l.associatedBlock);
  if (broken.length === 0) return doc;
  const records = [...(doc.blockRecords ?? [])];
  const unlinked: Layout[] = [];
  for (const l of broken) {
    const named = records.find((r) => r.layout === l);
    if (named) l.associatedBlock = named;
    else unlinked.push(l);
  }
  const layouts = new Set(doc.layouts ?? []);
  const free = records.filter((r) => !r.layout || !layouts.has(r.layout));
  const isModel = (l: Layout) => l.name.toUpperCase() === Layout.modelLayoutName.toUpperCase();
  const model = free.find((r) => r.name.toUpperCase() === '*MODEL_SPACE');
  const paper = free
    .map((r) => ({ r, m: PAPER_BLOCK.exec(r.name) }))
    .filter((x): x is { r: BlockRecord; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => (a.m[1] === '' ? -1 : Number(a.m[1])) - (b.m[1] === '' ? -1 : Number(b.m[1])))
    .map((x) => x.r);
  const modelTab = unlinked.find(isModel);
  if (modelTab && model) modelTab.associatedBlock = model;
  const sheets = unlinked.filter((l) => !isModel(l)).sort((a, b) => a.tabOrder - b.tabOrder);
  for (const [i, l] of sheets.entries()) {
    const r = paper[i];
    if (r) l.associatedBlock = r;
  }
  return doc;
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
