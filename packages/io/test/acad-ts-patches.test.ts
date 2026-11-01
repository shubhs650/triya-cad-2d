// One test per local acad-ts patch (third_party/acad-ts/PATCHES.md). Each must fail when the
// patch is reverted, which is what proves the patch is still needed after an upstream sync.
import {
  ACadVersion,
  BlockGripExpression,
  BlockRecord,
  CadDictionary,
  CadDocument,
  Color,
  DwgReader,
  DwgWriter,
  DxfReader,
  DxfWriter,
  DxfWriterConfiguration,
  EvaluationGraph,
  EvaluationGraphNode,
  Line,
  MeasurementUnits,
  XYZ,
} from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';

function writeDxf(doc: CadDocument, config: DxfWriterConfiguration): Uint8Array {
  const chunks: Uint8Array[] = [];
  DxfWriter.writeToStream(
    { write: (b: Uint8Array) => void chunks.push(b.slice()) },
    doc,
    true,
    config,
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe('acad-ts local patches', () => {
  it('0001 createExtendedDictionary works under ESM', () => {
    const line = new Line();

    const dict = line.createExtendedDictionary();

    expect(dict).toBeInstanceOf(CadDictionary);
    expect(line.xDictionary).toBe(dict);
    expect(dict.owner).toBe(line);
    // Idempotent: a second call returns the same dictionary.
    expect(line.createExtendedDictionary()).toBe(dict);
  });

  it('0002 DXF writer saves an evaluation graph with an unresolved node', () => {
    // A dynamic block's ACAD_ENHANCEDBLOCK graph: node 0's expression is a type acad-ts does
    // not read (null after reading), node 1's is a grip expression. Unpatched, the writer
    // threw on the expression's null owner, and omitted node 0's 360 so the reader lost the graph.
    const doc = new CadDocument(ACadVersion.AC1032);
    const block = new BlockRecord('DYN');
    doc.blockRecords!.add(block);
    const graph = new EvaluationGraph();
    block.createExtendedDictionary().addByKey(EvaluationGraph.dictionaryEntryName, graph);
    const unresolved = new EvaluationGraphNode();
    const grip = new EvaluationGraphNode();
    grip.index = 1;
    grip.expression = new BlockGripExpression();
    // Expressions are not registered with the document (the reader resolves them by handle
    // only), so give this one a handle above every allocated one, as a file would.
    grip.expression.handle = doc.header!.handleSeed + 0x100;
    graph.nodes.push(unresolved, grip);
    const config = new DxfWriterConfiguration();
    config.writeDynamicBlockData = true;

    const reread = DxfReader.readFromStream(writeDxf(doc, config));

    const dict = reread.blockRecords!.tryGetValue('DYN')!.xDictionary!;
    const graphB = dict.getEntry<EvaluationGraph>(EvaluationGraph.dictionaryEntryName);
    expect(graphB).toBeInstanceOf(EvaluationGraph);
    expect(graphB!.nodes).toHaveLength(2);
    expect(graphB!.nodes[0]!.expression).toBeNull();
    expect(graphB!.nodes[1]!.expression).toBeInstanceOf(BlockGripExpression);
  });

  it.each([ACadVersion.AC1018, ACadVersion.AC1024, ACadVersion.AC1032])(
    '0003 DWG %s writer keeps true-colour channel order',
    (version) => {
      // DWG stores CMC/EnColor RGB as a little-endian 0xC2RRGGBB long; acad-ts wrote the
      // bytes as R,G,B, so every true colour came back with red and blue swapped.
      const doc = new CadDocument(version);
      const line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
      line.color = Color.fromTrueColor(0x34c918);
      doc.entities!.add(line);
      const layer = doc.layers!.tryGetValue('0')!;
      layer.color = Color.fromTrueColor(0x803dc2);

      const reread = DwgReader.readFromStream(DwgWriter.writeToBuffer(doc).slice().buffer);

      const rereadLine = [...reread.entities!].find((e) => e instanceof Line)!;
      expect(rereadLine.color.trueColor).toBe(0x34c918);
      expect(reread.layers!.tryGetValue('0')!.color.trueColor).toBe(0x803dc2);
    },
  );

  const dwgRoundTrip = (doc: CadDocument): CadDocument =>
    DwgReader.readFromStream(DwgWriter.writeToBuffer(doc).slice().buffer);

  it('0004 DWG header reader decodes the R2000+ flag word as the writer encodes it', () => {
    // $PSTYLEMODE came back as 8192 (the raw 0x2000 bit), LWDISPLAY/XEDIT were never true and
    // ENDCAPS/JOINSTYLE were not shifted (ODA spec §9.4).
    const doc = new CadDocument(ACadVersion.AC1032);
    const header = doc.header!;
    header.plotStyleMode = 1;
    header.displayLineWeight = true;
    header.xEdit = true;
    header.extendedNames = true;
    header.endCaps = 2;
    header.joinStyle = 3;

    const reread = dwgRoundTrip(doc).header!;

    expect(reread.plotStyleMode).toBe(1);
    expect(reread.displayLineWeight).toBe(true);
    expect(reread.xEdit).toBe(true);
    expect(reread.extendedNames).toBe(true);
    expect(reread.endCaps).toBe(2);
    expect(reread.joinStyle).toBe(3);
  });

  it.each([ACadVersion.AC1018, ACadVersion.AC1032])(
    '0005 DWG %s writer keeps an all-zero AcDb:Template page ($MEASUREMENT = English)',
    (version) => {
      const doc = new CadDocument(version);
      doc.header!.measurementUnits = MeasurementUnits.English;

      expect(dwgRoundTrip(doc).header!.measurementUnits).toBe(MeasurementUnits.English);
    },
  );

  // 0006 needs a drawing with paper-space layouts, which acad-ts cannot author in memory;
  // its test reads a corpus file: packages/testkit/src/spike/acad-ts-patches.corpus.test.ts.

  it('0007 DWG writer keeps block-record preview images', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const block = new BlockRecord('THUMB');
    block.preview = Uint8Array.from({ length: 64 }, (_, i) => (i * 7) & 0xff);
    doc.blockRecords!.add(block);

    const reread = dwgRoundTrip(doc).blockRecords!.tryGetValue('THUMB')!;

    expect([...(reread.preview ?? [])]).toEqual([...block.preview]);
  });
});
