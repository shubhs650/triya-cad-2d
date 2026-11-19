// M5-19: a layer's unreconciled state, as AutoCAD files it: the `ADSK_XREC_LAYER_RECONCILED`
// XRECORD of the layer's extension dictionary (280 1, 290 1 reconciled, 290 0 not), as the
// AutoCAD-saved recover02.dxf of ezdxf's corpus has it on every layer (LAYEREVAL 1).
import type { CadDictionary } from '@node-projects/acad-ts';
import {
  ACadVersion,
  CadDocument,
  DictionaryCloningFlags,
  Layer,
  XRecord,
} from '@node-projects/acad-ts';
import { ChangeSetBuilder, DocumentModel, type LayerRecord } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { documentInit, exportDocument, readCadDocument, writeCadDocument } from '../src/index';

const RECONCILED = 'ADSK_XREC_LAYER_RECONCILED';

/** The record as AutoCAD writes it on `layer`, with 290 `value`. */
function fileRecord(layer: Layer, value: boolean): void {
  const dict = layer.createExtendedDictionary();
  dict.hardOwnerFlag = true;
  dict.clonningFlags = DictionaryCloningFlags.KeepExisting;
  const x = new XRecord();
  x.cloningFlags = DictionaryCloningFlags.KeepExisting;
  x.createEntry(290, value);
  dict.addByKey(RECONCILED, x);
}

/** Layers 0, OLD (reconciled), NEW (unreconciled) and PLAIN (no record). */
function drawing(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  for (const name of ['OLD', 'NEW', 'PLAIN']) doc.layers!.add(new Layer(name));
  fileRecord(doc.layers!.get('OLD')!, true);
  fileRecord(doc.layers!.get('NEW')!, false);
  return writeCadDocument(doc, { format: 'dxf' });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

const named = (model: DocumentModel, name: string): LayerRecord =>
  [...model.tables.layers.values()].find((l) => l.name === name)!;

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const save = (bytes: Uint8Array, model: DocumentModel) =>
  exportDocument(readCadDocument(bytes), model, { format: 'dxf' });

/** The layer's ADSK_XREC_LAYER_RECONCILED record in a saved file, as acad-ts reads it. */
function record(bytes: Uint8Array, name: string) {
  const layer = readCadDocument(bytes).layers!.get(name)!;
  const x = layer.xDictionary?.getEntry(RECONCILED);
  return x instanceof XRecord ? x : undefined;
}

const unreconciledOf = (model: DocumentModel) =>
  Object.fromEntries([...model.tables.layers.values()].map((l) => [l.name, l.unreconciled]));

describe('a layer’s unreconciled state (M5-19)', () => {
  it('reads 290 0 as unreconciled, 290 1 and no record as reconciled', () => {
    expect(unreconciledOf(open(drawing()))).toEqual({
      '0': undefined,
      OLD: undefined,
      NEW: true,
      PLAIN: undefined,
    });
  });

  it('saves a reconciled layer as 290 1, and an unreconciled one as 290 0', () => {
    const bytes = drawing();
    const model = open(bytes);
    let added: LayerRecord | undefined;
    edit(model, (b) => {
      b.updateTableRecord('layers', named(model, 'NEW').handle, { unreconciled: undefined });
      b.updateTableRecord('layers', named(model, 'PLAIN').handle, { unreconciled: true });
      b.updateTableRecord('layers', named(model, 'OLD').handle, { unreconciled: true });
      const { handle: _h, raw: _raw, ...init } = named(model, 'PLAIN');
      added = b.addTableRecord('layers', { ...init, name: 'GLASS', unreconciled: true });
    });
    const out = save(bytes, model);
    expect(unreconciledOf(open(out))).toEqual({
      '0': undefined,
      OLD: true,
      NEW: undefined,
      PLAIN: true,
      GLASS: true,
    });
    // The records keep AutoCAD's form: 290 alone, the dictionary and record 280 1.
    for (const name of ['OLD', 'NEW', 'PLAIN', 'GLASS']) {
      const x = record(out, name)!;
      expect(x.entries.map((e) => [e.code, Boolean(e.value)])).toEqual([[290, name === 'NEW']]);
      expect(x.cloningFlags).toBe(DictionaryCloningFlags.KeepExisting);
      const dict = x.owner as CadDictionary;
      expect(dict.hardOwnerFlag).toBe(true);
      expect(dict.clonningFlags).toBe(DictionaryCloningFlags.KeepExisting);
    }
    // New objects take handles above the drawing's $HANDSEED.
    const seed = Number.parseInt(open(bytes).handSeed, 16);
    for (const name of ['PLAIN', 'GLASS']) {
      const x = record(out, name)!;
      expect(Number(x.handle)).toBeGreaterThanOrEqual(seed);
      expect(Number((x.owner as CadDictionary).handle)).toBeGreaterThanOrEqual(seed);
    }
    expect(added).toBeDefined();
  });

  it('writes no record for a new layer nobody flagged', () => {
    const bytes = drawing();
    const model = open(bytes);
    edit(model, (b) => {
      const { handle: _h, raw: _raw, ...init } = named(model, 'PLAIN');
      b.addTableRecord('layers', { ...init, name: 'GLASS' });
    });
    const out = save(bytes, model);
    expect(readCadDocument(out).layers!.get('GLASS')!.xDictionary).toBeNull();
    expect(unreconciledOf(open(out)).GLASS).toBeUndefined();
  });

  it('removes a layer with its record', () => {
    const bytes = drawing();
    const model = open(bytes);
    edit(model, (b) => b.removeTableRecord('layers', named(model, 'NEW').handle));
    const out = save(bytes, model);
    expect([...readCadDocument(out).layers!].map((l) => l.name)).not.toContain('NEW');
    expect(Object.keys(unreconciledOf(open(out)))).toEqual(['0', 'OLD', 'PLAIN']);
  });
});
