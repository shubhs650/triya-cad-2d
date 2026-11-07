// Dynamic blocks to Triya (M1-14 part 3, FR-B3), on drawings authored in memory with acad-ts.
// A block record is a dynamic block definition when its extension dictionary holds the
// ACAD_ENHANCEDBLOCK evaluation graph; AutoCAD shows it by its AcDbDynamicBlockTrueName xdata
// (R2000 saves it under an anonymous `*U` name). An anonymous `*U` record holding one state of
// it names it in its AcDbBlockRepBTag xdata (1070 version, 1005 handle).
import {
  ACadVersion,
  AppId,
  BlockRecord,
  CadDictionary,
  CadDocument,
  ExtendedData,
  ExtendedDataHandle,
  ExtendedDataInteger16,
  ExtendedDataString,
  type CadObject,
} from '@node-projects/acad-ts';
import { describe, expect, it } from 'vitest';
import { documentInit } from '../src/index';

const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

function xdata(doc: CadDocument, o: CadObject, app: string, records: ExtendedData['records']) {
  let id = doc.appIds!.tryGetValue(app);
  if (!id) {
    id = new AppId(app);
    doc.appIds!.add(id);
  }
  o.extendedData.add(id, new ExtendedData(records));
}

function record(doc: CadDocument, name: string): BlockRecord {
  const r = new BlockRecord(name);
  doc.blockRecords!.add(r);
  return r;
}

function drawing() {
  const doc = new CadDocument(ACadVersion.AC1032);
  const dynamic = record(doc, 'LINEAR_PARAM');
  dynamic.createExtendedDictionary().addByKey('ACAD_ENHANCEDBLOCK', new CadDictionary());
  xdata(doc, dynamic, 'AcDbDynamicBlockGUID', [new ExtendedDataString('{BEFA52EB}')]);
  const state = record(doc, '*U2');
  xdata(doc, state, 'AcDbBlockRepBTag', [
    new ExtendedDataInteger16(1),
    new ExtendedDataHandle(dynamic.handle),
  ]);
  const anonymous = record(doc, '*U17');
  anonymous.createExtendedDictionary().addByKey('ACAD_ENHANCEDBLOCK', new CadDictionary());
  xdata(doc, anonymous, 'AcDbDynamicBlockTrueName', [new ExtendedDataString('my-block')]);
  // A block that was dynamic once keeps its GUID but has no evaluation graph: it is static.
  const once = record(doc, 'MyBlock');
  xdata(doc, once, 'AcDbDynamicBlockGUID', [new ExtendedDataString('{AF4CD1DE}')]);
  const plain = record(doc, 'PLAIN');
  return { doc, dynamic, state, anonymous, once, plain };
}

describe('AcadToTriya dynamic blocks', () => {
  it('marks a dynamic block definition with the name AutoCAD shows', () => {
    const { doc, dynamic, anonymous } = drawing();
    const blocks = new Map(documentInit(doc).blocks?.map((b) => [b.handle, b]));
    expect(blocks.get(H(dynamic))?.dynamic).toEqual({ name: 'LINEAR_PARAM' });
    expect(blocks.get(H(anonymous))?.dynamic).toEqual({ name: 'my-block' });
  });

  it('links an anonymous state to its dynamic block', () => {
    const { doc, dynamic, state } = drawing();
    const blocks = new Map(documentInit(doc).blocks?.map((b) => [b.handle, b]));
    expect(blocks.get(H(state))).toMatchObject({ name: '*U2', dynamicOf: H(dynamic) });
    expect(blocks.get(H(state))?.dynamic).toBeUndefined();
  });

  it('leaves plain blocks and blocks without an evaluation graph alone', () => {
    const { doc, once, plain } = drawing();
    const blocks = new Map(documentInit(doc).blocks?.map((b) => [b.handle, b]));
    for (const r of [once, plain, doc.modelSpace!]) {
      expect(blocks.get(H(r))).not.toHaveProperty('dynamic');
      expect(blocks.get(H(r))).not.toHaveProperty('dynamicOf');
    }
  });
});
