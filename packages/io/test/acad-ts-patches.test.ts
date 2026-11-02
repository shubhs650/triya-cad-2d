// One test per local acad-ts patch (third_party/acad-ts/PATCHES.md). Each must fail when the
// patch is reverted, which is what proves the patch is still needed after an upstream sync.
import {
  ACadVersion,
  BlockGripExpression,
  BlockRecord,
  BookColor,
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
  DimensionStyle,
  DxfClass,
  DxfClassCollection,
  ExtendedDataDisplacement,
  ExtendedDataHandle,
  ExtendedDataInteger16,
  ExtendedDataLayer,
  ExtendedDataString,
  Hatch,
  HatchBoundaryPath,
  HatchBoundaryPathEllipse,
  HatchPattern,
  HatchPatternLine,
  HatchStyleType,
  Layer,
  Leader,
  Line,
  LineType,
  LineTypeSegment,
  LineTypeShapeFlags,
  LineWeightType,
  MeasurementUnits,
  TextStyle,
  ViewModeType,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { readCadDocument, writeCadDocument } from '../src/index';

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

  const dxfRoundTrip = (doc: CadDocument): CadDocument =>
    DxfReader.readFromStream(writeDxf(doc, new DxfWriterConfiguration()));

  it('0008 DXF writer writes the whole VPORT record', () => {
    // Upstream wrote 12 of ~40 VPORT codes, so view mode, twist, lens, zoom percent, UCS and
    // grid settings reset on every save (viewMode came back as FrontClippingZ = 16).
    const doc = new CadDocument(ACadVersion.AC1032);
    const active = doc.vPorts!.tryGetValue('*Active')!;
    active.viewMode = ViewModeType.Off;
    active.twistAngle = 0.5;
    active.lensLength = 35;
    active.circleZoomPercent = 500;
    active.minorGridLinesPerMajorGridLine = 4;
    active.elevation = 12.5;
    active.xAxis = new XYZ(0, 1, 0);
    active.yAxis = new XYZ(-1, 0, 0);

    const back = dxfRoundTrip(doc).vPorts!.tryGetValue('*Active')!;

    expect(back.viewMode).toBe(ViewModeType.Off);
    expect(back.twistAngle).toBeCloseTo(0.5, 12);
    expect(back.lensLength).toBe(35);
    expect(back.circleZoomPercent).toBe(500);
    expect(back.minorGridLinesPerMajorGridLine).toBe(4);
    expect(back.elevation).toBe(12.5);
    expect([back.xAxis.x, back.xAxis.y, back.yAxis.x, back.yAxis.y]).toEqual([0, 1, -1, 0]);
  });

  it("0009 DXF writer keeps a layer's plot-style handle (group 390)", () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const layer = new Layer('PLOTTED');
    layer.plotStyleName = 0x4d2;
    doc.layers!.add(layer);

    expect(dxfRoundTrip(doc).layers!.tryGetValue('PLOTTED')!.plotStyleName).toBe(0x4d2);
  });

  // 0010 (LAYOUT flags) and 0011 (empty dictionaries) need real paper-space layouts and a full
  // named-object dictionary: packages/testkit/src/spike/acad-ts-patches.corpus.test.ts.

  it('0012 DXF reader reads 16-bit group codes as signed (ByBlock lineweights)', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const style = new DimensionStyle('LW');
    style.dimensionLineWeight = LineWeightType.ByBlock;
    style.extensionLineWeight = LineWeightType.ByLayer;
    doc.dimensionStyles!.add(style);

    const back = dxfRoundTrip(doc).dimensionStyles!.tryGetValue('LW')!;

    expect(back.dimensionLineWeight).toBe(LineWeightType.ByBlock);
    expect(back.extensionLineWeight).toBe(LineWeightType.ByLayer);
  });

  it('0013 DWG writer saves a large block in linear time', { timeout: 120_000 }, () => {
    // Block headers deduplicated owned handles with Array.includes and looked entities up with
    // Array.find: O(n²). 60k lines took ~18 s unpatched (100k: ~84 s); patched it is < 1 s.
    const doc = new CadDocument(ACadVersion.AC1032);
    for (let i = 0; i < 60_000; i++) {
      doc.entities!.add(new Line(new XYZ(i, 0, 0), new XYZ(i, 1, 0)));
    }

    const t0 = Date.now();
    const bytes = DwgWriter.writeToBuffer(doc);
    const ms = Date.now() - t0;

    expect(bytes.length).toBeGreaterThan(0);
    // Generous bound for slow CI runners; the quadratic writer is an order of magnitude over it.
    expect(ms).toBeLessThan(8_000);
  });

  it('0015 class numbers a drawing was read with survive resetClassNumbers', () => {
    // Objects kept raw (0016) name their class by number, so a save must not renumber classes.
    const make = (dxfName: string, classNumber: number): DxfClass =>
      Object.assign(new DxfClass(), { dxfName, classNumber });
    const read809 = make('AEC_LIST_DEF', 809);
    const read808 = make('AEC_LIST_DEF', 808);
    const added = make('NEW_CLASS', 0);
    const classes = new DxfClassCollection();
    classes.tryAdd(read809);
    classes.addSameName(read808);
    classes.tryAdd(added);

    classes.resetClassNumbers();

    expect(classes.count).toBe(3);
    expect([...classes].map((c) => c.classNumber).sort()).toEqual([500, 808, 809]);
    expect([read809.classNumber, read808.classNumber, added.classNumber]).toEqual([809, 808, 500]);
  });

  it('0020 DWG header stores $CELWEIGHT as a lineweight index and reads it back as a value', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    doc.header!.currentEntityLineWeight = LineWeightType.W50;

    expect(dwgRoundTrip(doc).header!.currentEntityLineWeight).toBe(LineWeightType.W50);
  });

  it('0022 ASCII DXF writer keeps the sign of xdata 1070 integers', () => {
    // Unpatched, 1070 was written masked to 16 bits, so -1 came back as 65535 (AutoCAD writes
    // and reads 1070 as a signed 16-bit integer). Binary DXF stored the bits and was unaffected.
    const doc = new CadDocument(ACadVersion.AC1032);
    const line = new Line(new XYZ(0, 0, 0), new XYZ(1, 1, 0));
    doc.entities!.add(line);
    line.extendedData.addByName('TRIYA_TEST', undefined);
    const values = [-1, -32768, 0, 32767];
    line.extendedData
      .getByName('TRIYA_TEST')
      .records.push(...values.map((v) => new ExtendedDataInteger16(v)));

    const bytes = writeCadDocument(doc, { format: 'dxf' });

    // ASCII DXF of an in-memory drawing is plain ASCII.
    const lines = Array.from(bytes, (b) => String.fromCharCode(b))
      .join('')
      .split(/\r?\n/);
    const written = lines.flatMap((l: string, i: number) =>
      i % 2 === 0 && l.trim() === '1070' ? [lines[i + 1]!.trim()] : [],
    );
    expect(written).toEqual(values.map(String));
    const back = readCadDocument(bytes)
      .getCadObject(line.handle)!
      .extendedData.getByName('TRIYA_TEST');
    expect(back.records.map((r) => r.rawValue)).toEqual(values);
  });

  it('0024 Julian dates read back to the millisecond they were written', () => {
    // The fraction of a day was floored field by field, so 3.000 s came back as 2.999 s.
    for (const ms of [0, 1, 500, 999]) {
      const doc = new CadDocument(ACadVersion.AC1032);
      const created = new Date(2024, 4, 17, 13, 45, 3, ms);
      doc.header!.createDateTime = created;

      const back = readCadDocument(writeCadDocument(doc, { format: 'dxf' }));

      expect(back.header!.createDateTime.getTime(), `ms ${ms}`).toBe(created.getTime());
    }
  });

  it('0026 DXF writer writes xdata on dictionaries', () => {
    // writeObject returned right after DICTIONARY (and DBCOLOR, IMAGEDEF, IMAGEDEF_REACTOR,
    // ACDBPLACEHOLDER) bodies, before the xdata every other object gets.
    const doc = new CadDocument(ACadVersion.AC1032);
    const dict = new CadDictionary('TRIYA_TEST');
    doc.rootDictionary!.addByKey('TRIYA_TEST', dict);
    dict.extendedData.addByName('TRIYA_TEST', undefined);
    dict.extendedData.getByName('TRIYA_TEST').records.push(new ExtendedDataString('kept'));

    for (const binary of [false, true]) {
      const back = readCadDocument(writeCadDocument(doc, { format: 'dxf', binary }));

      const xdata = back.getCadObject(dict.handle)!.extendedData;
      expect(xdata.containsKeyName('TRIYA_TEST'), `binary ${binary}`).toBe(true);
      expect(xdata.getByName('TRIYA_TEST').records.map((r) => r.rawValue)).toEqual(['kept']);
    }
  });

  it('0027 DXF writer writes DBCOLOR names as BOOK$COLOR once', () => {
    // writeBookColor wrote `${name}$${bookName}`, and name already is BOOK$COLOR, so a read
    // back took the trailing book name as the colour name.
    const doc = new CadDocument(ACadVersion.AC1032);
    const colors = new CadDictionary('ACAD_COLOR');
    doc.rootDictionary!.addByKey('ACAD_COLOR', colors);
    const color = new BookColor();
    color.name = 'PANTONE+ Solid Coated$PANTONE 123 C';
    color.color = Color.fromTrueColor(0xffc72c);
    colors.addByKey(color.name, color);

    for (const binary of [false, true]) {
      const back = readCadDocument(writeCadDocument(doc, { format: 'dxf', binary }));

      const read = back.getCadObject(color.handle) as BookColor;
      expect(read.bookName, `binary ${binary}`).toBe('PANTONE+ Solid Coated');
      expect(read.colorName, `binary ${binary}`).toBe('PANTONE 123 C');
    }
  });

  it('0029 DXF writer writes xdata displacements, layer names and dangling handles as read', () => {
    // 1012 went out as one group holding an XYZ, which broke the record and moved the next
    // object's xdata onto the previous one; a 1003 layer went out as a 1005 handle; and a 1005
    // to an object not in the drawing went out as 0. AutoCAD keeps 1005 values on save.
    const doc = new CadDocument(ACadVersion.AC1032);
    const layer = new Layer('APP_LAYER');
    doc.layers!.add(layer);
    const line = new Line(new XYZ(0, 0, 0), new XYZ(1, 0, 0));
    doc.modelSpace!.entities.add(line);
    line.extendedData.addByName('TRIYA_TEST', undefined);
    line.extendedData
      .getByName('TRIYA_TEST')
      .records.push(
        new ExtendedDataDisplacement(new XYZ(1, 2, 3)),
        new ExtendedDataLayer(layer.handle),
        new ExtendedDataHandle(0xfeed),
      );

    for (const binary of [false, true]) {
      const back = readCadDocument(writeCadDocument(doc, { format: 'dxf', binary }));

      const records = back.getCadObject(line.handle)!.extendedData.getByName('TRIYA_TEST').records;
      expect(
        records.map((r) => r.constructor.name),
        `binary ${binary}`,
      ).toEqual(['ExtendedDataDisplacement', 'ExtendedDataLayer', 'ExtendedDataHandle']);
      const [disp, lay, handle] = records as [
        ExtendedDataDisplacement,
        ExtendedDataLayer,
        ExtendedDataHandle,
      ];
      expect([disp.value.x, disp.value.y, disp.value.z]).toEqual([1, 2, 3]);
      expect(back.getCadObject(lay.value)?.handle).toBe(layer.handle);
      expect(handle.value).toBe(0xfeed);
    }
  });

  it('0030 DXF writer writes xdata on symbol tables', () => {
    // _writeTable wrote the table header without its xdata (AutoCAD puts ACAD DbSaveVer on the
    // VPORT table).
    const doc = new CadDocument(ACadVersion.AC1032);
    doc.vPorts!.extendedData.addByName('TRIYA_TEST', undefined);
    doc.vPorts!.extendedData.getByName('TRIYA_TEST').records.push(new ExtendedDataString('kept'));

    for (const binary of [false, true]) {
      const back = readCadDocument(writeCadDocument(doc, { format: 'dxf', binary }));

      const xdata = back.vPorts!.extendedData;
      expect(xdata.containsKeyName('TRIYA_TEST'), `binary ${binary}`).toBe(true);
      expect(xdata.getByName('TRIYA_TEST').records.map((r) => r.rawValue)).toEqual(['kept']);
    }
  });

  it('0074 a DXF LEADER without group 71 has its arrowhead on', () => {
    const doc = new CadDocument();
    const leader = new Leader();
    leader.arrowHeadEnabled = false;
    leader.vertices.push(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
    doc.entities!.add(leader);
    // The writer's output is ASCII here, so a char per byte is exact.
    const text = String.fromCharCode(...writeCadDocument(doc, { format: 'dxf' }));
    const bytes = (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0));
    // ezdxf and AutoCAD-written DXFs omit 71 when the arrowhead is on; drop the group the
    // writer emits after the AcDbLeader subclass marker and its style name.
    const without = text.replace(/(AcDbLeader\r?\n *3\r?\n[^\r\n]*\r?\n) *71\r?\n *0\r?\n/, '$1');
    expect(without).not.toBe(text);

    const omitted = DxfReader.readFromStream(bytes(without));
    const kept = DxfReader.readFromStream(bytes(text));

    const first = (d: CadDocument) => [...d.entities!].find((e) => e instanceof Leader) as Leader;
    expect(first(omitted).arrowHeadEnabled).toBe(true);
    expect(first(kept).arrowHeadEnabled).toBe(false);
    // Leaders made in code keep the class default.
    expect(new Leader().arrowHeadEnabled).toBe(false);
  });

  it('0075 a DXF DIMSTYLE without a group reads it as the AutoCAD default', () => {
    const doc = new CadDocument();
    const style = new DimensionStyle('GAPLESS');
    style.dimensionLineGap = 0.3;
    style.extensionLineOffset = 0.4;
    doc.dimensionStyles!.add(style);
    const text = String.fromCharCode(...writeCadDocument(doc, { format: 'dxf' }));
    const bytes = (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0));
    // AutoCAD leaves every DIMVAR at its default out of a DIMSTYLE record: drop DIMGAP (147)
    // and DIMEXO (42) from this one, as AutoCAD would write them at 0.09 and 0.0625.
    const without = text
      .replace(/\r?\n *147\r?\n *0\.3\r?\n/, '\n')
      .replace(/\r?\n *42\r?\n *0\.4\r?\n/, '\n');
    expect(without).not.toBe(text);
    expect(without.length).toBeLessThan(text.length - 10);

    const read = DxfReader.readFromStream(bytes(without));
    const gapless = read.dimensionStyles!.tryGetValue('GAPLESS')!;
    expect(gapless.dimensionLineGap).toBeCloseTo(0.09);
    expect(gapless.extensionLineOffset).toBeCloseTo(0.0625);
    // The groups the file has still win.
    const kept = DxfReader.readFromStream(bytes(text)).dimensionStyles!.tryGetValue('GAPLESS')!;
    expect(kept.dimensionLineGap).toBeCloseTo(0.3);
    // Styles made in code keep the class defaults.
    expect(new DimensionStyle('X').dimensionLineGap).toBeCloseTo(0.625);
  });

  it('0105 a DXF linetype segment keeps the text style it names (340)', () => {
    const doc = new CadDocument();
    const style = new TextStyle('GASFONT');
    style.filename = 'romans.shx';
    doc.textStyles!.add(style);
    const gas = new LineType('GAS_LINE');
    const dash = new LineTypeSegment();
    dash.length = 0.5;
    gas.addSegment(dash);
    const text = new LineTypeSegment();
    text.length = -0.2;
    text.shapeFlags = LineTypeShapeFlags.Text;
    text.text = 'GAS';
    text.scale = 0.1;
    text.style = style;
    gas.addSegment(text);
    doc.lineTypes!.add(gas);

    const bytes = writeCadDocument(doc, { format: 'dxf' });
    // The writer stores the style's handle with the segment.
    expect(String.fromCharCode(...bytes)).toMatch(/\r?\n 75\r?\n *0\r?\n340\r?\n[0-9A-F]+\r?\n/);
    const read = DxfReader.readFromStream(bytes).lineTypes!.tryGetValue('GAS_LINE')!;
    const segment = read.segments.find((s) => s.text === 'GAS')!;
    expect(segment.style?.name).toBe('GASFONT');
  });

  it('0108 a DXF hatch keeps its style, seed points and ellipse-edge major axes', () => {
    const doc = new CadDocument();
    const hatch = new Hatch();
    hatch.style = HatchStyleType.Outer;
    hatch.pattern = new HatchPattern('ANSI31');
    const line = new HatchPatternLine();
    line.angle = Math.PI / 4;
    line.offset = new XY(-0.0884, 0.0884);
    hatch.pattern.lines.push(line); // no dashes: the line ends on 79 0, then 98 follows
    hatch.seedPoints.push(new XY(12, 21));
    const edge = new HatchBoundaryPathEllipse();
    edge.center = new XY(10, 20);
    edge.majorAxisEndPoint = new XY(3, 4);
    edge.minorToMajorRatio = 0.5;
    edge.endAngle = 2 * Math.PI;
    edge.counterClockWise = true;
    hatch.paths.push(new HatchBoundaryPath([edge]));
    doc.entities!.add(hatch);

    const read = [
      ...DxfReader.readFromStream(writeCadDocument(doc, { format: 'dxf' })).entities!,
    ].filter((e): e is Hatch => e instanceof Hatch)[0]!;
    expect(read.style).toBe(HatchStyleType.Outer);
    expect(read.seedPoints.map((p) => [p.x, p.y])).toEqual([[12, 21]]);
    const axis = (read.paths[0]!.edges[0] as HatchBoundaryPathEllipse).majorAxisEndPoint;
    expect([axis.x, axis.y]).toEqual([3, 4]);
  });
  it('0111 header variables the acad-ts header map left out are read, written and kept in DWG', () => {
    // The M1-03 oracle found 32 variables AutoCAD writes that DXF read dropped (roadmap M1-32).
    const vars: [string, ...[number, string][]][] = [
      ['$ATTDIA', [70, '1']],
      ['$ATTREQ', [70, '0']],
      ['$COORDS', [70, '2']],
      ['$DELOBJ', [70, '0']],
      ['$DRAGMODE', [70, '1']],
      ['$HANDLING', [70, '1']],
      ['$PICKSTYLE', [70, '3']],
      ['$SAVEIMAGES', [70, '1']],
      ['$SKPOLY', [70, '2']],
      ['$SURFTAB1', [70, '11']],
      ['$SURFTAB2', [70, '12']],
      ['$SURFU', [70, '13']],
      ['$SURFV', [70, '14']],
      ['$HIDETEXT', [280, '0']],
      ['$INTERSECTIONDISPLAY', [280, '1']],
      ['$INTERSECTIONCOLOR', [70, '5']],
      ['$OBSCOLOR', [70, '3']],
      ['$OBSLTYPE', [280, '2']],
      ['$TILEMODELIGHTSYNCH', [280, '0']],
      ['$REALWORLDSCALE', [290, '0']],
      ['$UCSORTHOREF', [2, 'TOPUCS']],
      ['$UCSORTHOVIEW', [70, '1']],
      ['$PUCSORTHOREF', [2, 'SHEETUCS']],
      ['$PUCSORTHOVIEW', [70, '2']],
      ['$PUCSORG', [10, '1'], [20, '2'], [30, '3']],
      ['$PUCSXDIR', [10, '0'], [20, '1'], [30, '0']],
      ['$PUCSYDIR', [10, '-1'], [20, '0'], [30, '0']],
      ['$CMATERIAL', [347, 'A1']],
      ['$INTERFEREOBJVS', [345, 'A2']],
      ['$INTERFEREVPVS', [346, 'A3']],
    ];
    const text = String.fromCharCode(...writeCadDocument(new CadDocument(), { format: 'dxf' }));
    const groups = vars
      .map(
        ([name, ...gs]) => `  9\r\n${name}\r\n${gs.map(([c, v]) => `${c}\r\n${v}\r\n`).join('')}`,
      )
      .join('');
    // At the end of HEADER, so they win over what the writer wrote for them (once it knows them).
    const withVars = text.replace(/( *0\r?\nENDSEC\r?\n)/, `${groups}$1`);
    expect(withVars).not.toBe(text);
    const bytes = (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0));

    // As the DXF writer would write them back: handles in hex, everything else as stated.
    const stated = (d: CadDocument) =>
      vars.map(([name]) => [
        name,
        [...d.header!.getValues(name)].map(([c, v]) =>
          c >= 320 && c < 370 ? (v as number).toString(16).toUpperCase() : String(Number(v) || v),
        ),
      ]);
    const want = vars.map(([name, ...gs]) => [
      name,
      gs.map(([, v]) => (v === '0' ? '0' : String(Number(v) || v))),
    ]);
    const read = DxfReader.readFromStream(bytes(withVars));
    // Booleans read back as true/false.
    const asText = (rows: ReturnType<typeof stated>) =>
      rows.map(([n, vs]) => [
        n,
        (vs as string[]).map((v) => (v === 'false' ? '0' : v === 'true' ? '1' : v)),
      ]);
    expect(asText(stated(read))).toEqual(want);
    // and written back by the DXF writer.
    expect(
      asText(stated(DxfReader.readFromStream(writeCadDocument(read, { format: 'dxf' })))),
    ).toEqual(want);

    // DWG: the values its header holds, which the reader skipped or put in the wrong field.
    const doc = new CadDocument(ACadVersion.AC1032);
    const h = doc.header!;
    h.surfaceDensityM = 13;
    h.surfaceDensityN = 14;
    h.intersectionColor = new Color(5);
    h.interfereColor = new Color(3);
    h.tileModeLightSynch = 0;
    h.ucsOrthographicView = 1;
    h.paperSpaceUcsOrthographicView = 2;
    const dwg = dwgRoundTrip(doc).header!;
    expect([dwg.surfaceDensityM, dwg.surfaceDensityN]).toEqual([13, 14]);
    expect([dwg.intersectionColor.index, dwg.interfereColor.index]).toEqual([5, 3]);
    expect(dwg.tileModeLightSynch).toBe(0);
    expect([dwg.ucsOrthographicView, dwg.paperSpaceUcsOrthographicView]).toEqual([1, 2]);

    // R13/R14 DWG keeps the variables later releases moved to the registry.
    const r14 = new CadDocument(ACadVersion.AC1014);
    Object.assign(r14.header!, {
      attributeDialog: 1,
      attributeRequest: 0,
      deleteObjects: 0,
      dragMode: 1,
      coordinateDisplay: 2,
      pickStyle: 3,
    });
    const back = dwgRoundTrip(r14).header!;
    expect([
      back.attributeDialog,
      back.attributeRequest,
      back.deleteObjects,
      back.dragMode,
      back.coordinateDisplay,
      back.pickStyle,
    ]).toEqual([1, 0, 0, 1, 2, 3]);
  });
});
