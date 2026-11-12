// Helpers and corpus samples shared by the acad-ts patch tests that need a real drawing
// (acad-ts-patches-*.corpus.test.ts). Those tests were one file until DEC-053 (M2-58) split them
// in two, so that CI's Vitest shards are not held up by a single 9-minute file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CellStyle } from '@node-projects/acad-ts';
import {
  CellStyleMap,
  Color,
  DwgReader,
  DwgReaderConfiguration,
  DwgWriter,
  DxfReader,
  DxfReaderConfiguration,
  DxfWriter,
  DxfWriterConfiguration,
  TableEntity,
  UnknownEntity,
  UnknownNonGraphicalObject,
  VisualStyle,
  type CadDocument,
  type CadObject,
  type Layout,
} from '@node-projects/acad-ts';
import { loadManifest } from '../corpus/manifest.ts';
export const corpusBytes = (path: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../../corpus/public/${path}`, import.meta.url))),
  );
export const corpusFile = (path: string): ArrayBuffer => corpusBytes(path).buffer as ArrayBuffer;

export function dxfRoundTrip(doc: CadDocument): CadDocument {
  const chunks: Uint8Array[] = [];
  DxfWriter.writeToStream({ write: (b: Uint8Array) => void chunks.push(b.slice()) }, doc, true);
  return DxfReader.readFromStream(Buffer.concat(chunks));
}

// Reader settings that keep objects acad-ts cannot map (0014, 0016), as @triya/io reads them.
export function keepRaw<T extends DwgReaderConfiguration | DxfReaderConfiguration>(config: T): T {
  config.keepUnknownEntities = true;
  config.keepUnknownNonGraphicalObjects = true;
  config.keepRawDxfPassthroughObjects = true;
  config.keepUnreachableObjects = true;
  return config;
}
export const readDxfRaw = (bytes: Uint8Array): CadDocument =>
  DxfReader.readFromStreamWithConfig(bytes, keepRaw(new DxfReaderConfiguration()));
export const readDwgRaw = (path: string | ArrayBuffer): CadDocument =>
  DwgReader.readFromStreamWithConfig(
    typeof path === 'string' ? corpusFile(path) : path,
    keepRaw(new DwgReaderConfiguration()),
  );

export function writeDxf(
  doc: CadDocument,
  binary: boolean,
  config?: DxfWriterConfiguration,
): Uint8Array {
  if (binary) {
    const chunks: Uint8Array[] = [];
    DxfWriter.writeToStream(
      { write: (b: Uint8Array) => void chunks.push(b.slice()) },
      doc,
      true,
      config,
    );
    return Buffer.concat(chunks);
  }
  // ASCII goes into a byte buffer (code-page encoding); DXF text has no NUL, so it ends at the
  // last non-zero byte. The corpus files used here are well under the buffer size.
  const buffer = new Uint8Array(32 << 20);
  DxfWriter.writeToStream(buffer, doc, false, config);
  let end = buffer.length;
  while (end > 0 && buffer[end - 1] === 0) end--;
  return buffer.slice(0, end);
}
export const dxfRawRoundTrip = (doc: CadDocument, binary: boolean): CadDocument =>
  readDxfRaw(writeDxf(doc, binary));
// A save that writes every header variable, as @triya/io's fidelity configuration does.
export function dxfAllHeaderRoundTrip(doc: CadDocument, binary: boolean): CadDocument {
  const config = new DxfWriterConfiguration();
  config.writeAllHeaderVariables = true;
  return readDxfRaw(writeDxf(doc, binary, config));
}
export const dwgRawRoundTrip = (doc: CadDocument): CadDocument =>
  readDwgRaw(DwgWriter.writeToBuffer(doc).slice().buffer);

export type RawObject = UnknownEntity | UnknownNonGraphicalObject;
export const rawObjects = (doc: CadDocument): RawObject[] =>
  [...doc.getCadObjects()].filter(
    (o): o is RawObject => o instanceof UnknownEntity || o instanceof UnknownNonGraphicalObject,
  );
export const handleHex = (o: CadObject | null | undefined): string | undefined =>
  o?.handle.toString(16).toUpperCase();
// Bytes compare by value: a Buffer (binary DXF read from a Buffer) has a toJSON that runs before
// the replacer, so look at the holder's own value.
export const asJson = (value: unknown): string =>
  JSON.stringify(value, function (this: Record<string, unknown>, k, v: unknown) {
    const own = this[k];
    return own instanceof Uint8Array ? [...own] : typeof v === 'bigint' ? v.toString() : v;
  });

export const paperLayouts = (doc: CadDocument): Layout[] =>
  [...doc.layouts!].filter((layout) => layout.name !== 'Model');

export const dxfSamples = ['AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'].map(
  (v) => `third-party/acadsharp/sample_${v}_ascii.dxf`,
);

// Every cell of every table, with the fields a DWG save must keep.
export const tableCells = (d: CadDocument): unknown[] =>
  [...d.getCadObjects()]
    .filter((o): o is TableEntity => o instanceof TableEntity)
    .sort((a, b) => a.handle - b.handle)
    .flatMap((t) =>
      t.rows.flatMap((row, r) =>
        row.cells.map((cell, c) => {
          const o = cell.styleOverride;
          const border = (b: typeof o.topBorder): unknown => [
            b.color.index,
            b.lineWeight,
            b.isInvisible,
          ];
          return {
            at: `${handleHex(t)}:${r}:${c}`,
            style: [
              o.cellAlignment,
              o.isFillColorOn,
              o.backgroundColor.index,
              o.contentColor.index,
              o.textStyle?.name,
              o.textHeight,
            ],
            borders: [o.topBorder, o.rightBorder, o.bottomBorder, o.leftBorder].map(border),
            geometry: [cell.geometryFlags, cell.geometryWidth, cell.geometryHeight],
          };
        }),
      ),
    );

export const dwgSamples = ['AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'].map(
  (v) => `third-party/acadsharp/sample_${v}.dwg`,
);

// The acadsharp samples hold the same two tables in every version: R2000/R2004 cells carry
// their override flags in 177 and their text in 1, R2007+ cells in 91 and a CELL_VALUE block.
export const tableSamples = ['1015', '1018', '1021', '1024', '1027', '1032'].map(
  (v) => `third-party/acadsharp/sample_AC${v}_ascii.dxf`,
);
export const [tablesR2000, tablesR2018] = [tableSamples[0]!, tableSamples[5]!];
export const tables = (d: CadDocument): TableEntity[] =>
  [...d.getCadObjects()].filter((o): o is TableEntity => o instanceof TableEntity);

// R12 xdata, as read and after a save: app name and each record's code and value (a 1003 layer
// by the name it resolves to).
export const xdataOf = (d: CadDocument, handle: number): string[] => {
  const o = d.getCadObject(handle) as
    | (CadObject & {
        extendedData?: Iterable<
          [
            { name: string },
            {
              records: {
                code: number;
                value: unknown;
                resolveReference?: (doc: CadDocument) => { name?: string } | null;
              }[];
            },
          ]
        > | null;
      })
    | null;
  const out: string[] = [];
  for (const [app, data] of o?.extendedData ?? []) {
    out.push(app.name);
    for (const r of data.records) {
      out.push(
        `${r.code}=${r.code === 1003 ? (r.resolveReference?.(d)?.name ?? 'unresolved') : JSON.stringify(r.value)}`,
      );
    }
  }
  return out;
};

// A visual style's fields, colours as [index, true colour] and its extended data as text.
export const visualStyleFields = (style: VisualStyle): Record<string, unknown> => {
  const plain = (v: unknown): unknown => (v instanceof Color ? [v.index, v.trueColor] : v);
  const skip = new Set([
    'document',
    'handle',
    'owner',
    'onNameChanged',
    'rawDxfCodes',
    'rawDxfName',
    'rawDwgData',
    'rawOwnedObjects',
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(style)
        .filter(([k]) => !skip.has(k) && (!k.startsWith('_') || k === '_edgeColorValue'))
        .map(([k, v]) => [k, plain(v)]),
    ),
    dwgExtendedProperties: style.dwgExtendedProperties.map((p) => [plain(p.value), p.operation]),
    name: style.name,
    xdata: [...style.extendedData].map(([app, data]) => [app.name, data.records.map(String)]),
  };
};
export const visualStyles = (d: CadDocument): Map<number, Record<string, unknown>> =>
  new Map(
    [...d.getCadObjects()]
      .filter((o): o is VisualStyle => o instanceof VisualStyle)
      .map((o) => [o.handle, visualStyleFields(o)]),
  );
// [handle, field, DXF value, DWG value] for every field that differs.
export const visualStyleDiff = (
  dxf: Map<number, Record<string, unknown>>,
  dwg: Map<number, Record<string, unknown>>,
): unknown[][] =>
  [...dwg].flatMap(([handle, fields]) =>
    Object.entries(fields).flatMap(([k, v]) =>
      asJson(v) === asJson(dxf.get(handle)?.[k])
        ? []
        : [[handle.toString(16).toUpperCase(), k, dxf.get(handle)?.[k], v]],
    ),
  );
// The groups of every CELLSTYLEMAP in an ASCII DXF, by handle, from its subclass marker on,
// with numbers compared as numbers (the writer pads and formats them its own way).
export function cellStyleMapGroups(text: string): Map<string, string[]> {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const maps = new Map<string, string[]>();
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i] !== '0' || lines[i + 1] !== 'CELLSTYLEMAP') continue;
    let handle = '';
    const groups: string[] = [];
    for (let j = i + 2; j + 1 < lines.length && lines[j] !== '0'; j += 2) {
      const [code, value] = [lines[j]!, lines[j + 1]!];
      if (code === '5') handle = value;
      if (code === '100' || groups.length > 0)
        groups.push(
          `${code}=${/^-?\d+(\.\d*)?(e[-+]?\d+)?$/i.test(value) ? Number(value) : value}`,
        );
    }
    maps.set(handle, groups);
  }
  return maps;
}

// One test per file, as the corpus open test does, so the files share no time budget.
export const styleMapFiles = loadManifest(
  fileURLToPath(new URL('../../../../corpus/corpus.json', import.meta.url)),
)
  .files.filter((f) => f.format === 'dxf-ascii' && !f.knownIssues.some((k) => /read/i.test(k)))
  .map((f) => f.path.replace(/^public\//, ''))
  .filter((path) => cellStyleMapGroups(Buffer.from(corpusBytes(path)).toString('latin1')).size > 0);

// The fields of a cell style both formats state, with the text style and linetypes by name.
export const mapCell = (c: CellStyle): unknown => ({
  id: c.id,
  styleClass: c.styleClass,
  name: c.name,
  type: c.cellStyleType,
  hasData: c.hasData,
  overrides: c.cellPropertyOverrideFlags,
  merge: c.tableCellStylePropertyFlags,
  background: c.backgroundColor.index,
  layout: c.contentLayoutFlags,
  content: [
    c.propertyOverrideFlags,
    c.propertyFlags,
    c.valueDataType,
    c.valueUnitType,
    c.valueFormatString,
    c.rotation,
    c.scale,
    c.alignment,
    c.color.index,
    c.textStyle?.name.toUpperCase(),
    c.textHeight,
  ],
  margins: [
    c.marginOverrideFlags,
    c.verticalMargin,
    c.horizontalMargin,
    c.bottomMargin,
    c.rightMargin,
    c.marginHorizontalSpacing,
    c.marginVerticalSpacing,
  ],
  borders: [
    c.topBorder,
    c.horizontalInsideBorder,
    c.bottomBorder,
    c.leftBorder,
    c.verticalInsideBorder,
    c.rightBorder,
  ].map((b) => [
    b.propertyOverrideFlags,
    b.type,
    b.color.index,
    b.lineWeight,
    b.lineType?.name,
    b.isInvisible,
    b.doubleLineSpacing,
  ]),
});
export const styleMaps = (doc: CadDocument): CellStyleMap[] =>
  [...doc.getCadObjects()].filter((o): o is CellStyleMap => o instanceof CellStyleMap);

/** The group codes of the object with `handle` in an ASCII DXF, as `code value` pairs. */
export function objectGroups(dxf: Uint8Array, handle: number): string[] {
  const lines = new TextDecoder().decode(dxf).split(/\r?\n/);
  const out: string[] = [];
  let inside = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim();
    const value = lines[i + 1]!.trim();
    if (code === '0') {
      if (inside) break;
      const next = lines[i + 3]?.trim();
      inside = lines[i + 2]?.trim() === '5' && next === handle.toString(16).toUpperCase();
    }
    if (inside) out.push(`${code} ${value}`.trimEnd());
  }
  return out;
}
