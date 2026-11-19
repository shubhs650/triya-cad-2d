// A named view's layer snapshot (M5-07 part 7): a layer state hidden from the Layer States
// Manager, `ACAD_VIEWS_<view>`, which the view names in DXF 302 of its `ADSK_XREC_VTRVIEWINFO`
// XRECORD. sample_AC1032_ascii.dxf (AutoCAD 2018) has one: `view_custom` names
// `ACAD_VIEWS_view_custom`, mask 0x8200, and its record reads 300 `<None>`, 302, 330 (the Model
// layout) and 294 0 (a boolean, false as acad-ts reads it).
//
// On the sample: the snapshot is read and restored with the view; Update Layers overwrites it, a
// rename renames it with the view, New View saves another, and the Layer snapshot row's No takes
// one off, each saved as AC1032 DXF (DEC-047) and read back, the record's other groups kept. On
// every readable public corpus file: a new view saved with a snapshot saves and reads back. The
// ezdxf audit checks the sample's save and colors.dxf's (audit.py `FIXTURE_SAVES`, `view-layers`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CadObject, XRecord, type CadDocument } from '@node-projects/acad-ts';
import {
  DocumentModel,
  EngineSession,
  LAYER_STATE_MASK,
  isLayerState,
  layerStates,
  type LayerState,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { eachCorpusFile } from '../corpus/each-file.ts';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const SAMPLE_PATH = 'third-party/acadsharp/sample_AC1032_ascii.dxf';
const SAMPLE = `${corpusDir}public/${SAMPLE_PATH}`;
/** A drawing without views whose save the ezdxf audit checks (audit.py). */
const NO_VIEWS = 'third-party/ezdxf/examples_dxf/colors.dxf';
const INFO = 'ADSK_XREC_VTRVIEWINFO';
const VIEW = { center: { x: 10, y: 5 }, width: 40, height: 20, paper: false };
const NEW_VIEW = 'Triya section A';

/** Each view's `ADSK_XREC_VTRVIEWINFO` groups as text, pointers as handles. */
function rawInfo(doc: CadDocument): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const v of doc.views ?? []) {
    const x = v.xDictionary?.getEntry(INFO);
    if (!(x instanceof XRecord)) continue;
    out.set(
      v.name,
      x.entries.map((e) => {
        const value = e.value instanceof CadObject ? e.value.handle.toString(16) : String(e.value);
        return `${e.code}=${value}`;
      }),
    );
  }
  return out;
}

const statesOf = (model: DocumentModel): LayerState[] =>
  [...model.objects.values()].filter(isLayerState);
const snapshots = (model: DocumentModel) =>
  statesOf(model)
    .filter((s) => (s.mask & LAYER_STATE_MASK.hidden) !== 0)
    .map((s) => [s.name, s.mask, s.paperSpace, s.layers.length]);
const layerStateOf = (model: DocumentModel, name: string) =>
  [...model.tables.views.values()].find((v) => v.name === name)?.layerState;

function open(bytes: Uint8Array): EngineSession {
  return new EngineSession(documentInit(readCadDocument(bytes)));
}

function reopen(bytes: Uint8Array, model: DocumentModel) {
  const saved = saveAc1032Dxf(readCadDocument(bytes), model);
  const doc = readCadDocument(saved);
  return { saved, doc, model: DocumentModel.create(documentInit(doc)) };
}

const ok = (r: { ok: boolean; message?: string }): void => {
  if (!r.ok) throw new Error(r.message);
};

describe('sample_AC1032_ascii.dxf', () => {
  const bytes = new Uint8Array(readFileSync(SAMPLE));

  it('reads view_custom’s snapshot, hidden from the manager, and restores it with the view', () => {
    const session = open(bytes);
    expect(layerStateOf(session.model, 'view_custom')).toBe('ACAD_VIEWS_view_custom');
    expect(snapshots(session.model).map((s) => s.slice(0, 3))).toEqual([
      ['ACAD_VIEWS_view_custom', 0x8200, false],
    ]);
    expect(layerStates(session.model).some((s) => s.name.startsWith('ACAD_VIEWS_'))).toBe(false);
    // Every layer the snapshot names turned off, then the view restored: they are on again.
    const named = new Set(statesOf(session.model)[0]!.layers.map((e) => e.layer));
    const layers = [...session.model.tables.layers.values()].filter(
      (l) => named.has(l.handle) && l.on,
    );
    expect(layers.length).toBeGreaterThan(0);
    ok(session.edit({ kind: 'layer', layer: layers.map((l) => l.handle), on: false }));
    ok(session.edit({ kind: 'view-restore', name: 'view_custom' }));
    expect(layers.map((l) => session.model.tables.layers.get(l.handle)!.on)).toEqual(
      layers.map(() => true),
    );
  });

  it('saves Update Layers, a rename and a new view’s snapshot, keeping the record’s groups', () => {
    withPinnedClock(() => {
      const session = open(bytes);
      const own = statesOf(session.model)[0]!;
      ok(session.edit({ kind: 'view-layers', name: 'view_custom', save: true }));
      ok(session.edit({ kind: 'view-rename', name: 'view_custom', newName: 'view_renamed' }));
      ok(session.edit({ kind: 'view', name: NEW_VIEW, view: VIEW, layers: true }));
      const back = reopen(bytes, session.model);
      writeAuditSave(SAMPLE_PATH, 'view-layers', () => back.saved);

      expect(layerStateOf(back.model, 'view_renamed')).toBe('ACAD_VIEWS_view_renamed');
      expect(layerStateOf(back.model, NEW_VIEW)).toBe(`ACAD_VIEWS_${NEW_VIEW}`);
      const count = session.model.tables.layers.size;
      expect(snapshots(back.model)).toEqual([
        ['ACAD_VIEWS_view_renamed', 0x8200, false, count],
        [`ACAD_VIEWS_${NEW_VIEW}`, 0x8200, false, count],
      ]);
      // Update Layers overwrote AutoCAD's state in place.
      expect(statesOf(back.model)[0]!.handle).toBe(own.handle);
      expect(layerStates(back.model).some((s) => s.name.startsWith('ACAD_VIEWS_'))).toBe(false);
      const raw = rawInfo(back.doc);
      expect(raw.get('view_renamed')).toEqual([
        '300=<None>',
        '302=ACAD_VIEWS_view_renamed',
        '330=22',
        '294=false',
      ]);
      expect(raw.get(NEW_VIEW)).toEqual(['300=<None>', `302=ACAD_VIEWS_${NEW_VIEW}`]);
    });
  });

  it('saves the Layer snapshot row’s No: the 302 and the state go, the rest stays', () => {
    withPinnedClock(() => {
      const session = open(bytes);
      ok(session.edit({ kind: 'view-layers', name: 'view_custom', save: false }));
      const back = reopen(bytes, session.model);
      expect(layerStateOf(back.model, 'view_custom')).toBeUndefined();
      expect(snapshots(back.model)).toEqual([]);
      expect(rawInfo(back.doc).get('view_custom')).toEqual(['300=<None>', '330=22', '294=false']);
    });
  });
});

describe('a new view’s layer snapshot saves and reads back on every corpus file', () => {
  let saved = 0;
  eachCorpusFile(
    readable,
    (f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      withPinnedClock(() => {
        const session = open(bytes);
        if (session.model.tables.layers.size === 0) return;
        const before = snapshots(session.model);
        ok(session.edit({ kind: 'view', name: NEW_VIEW, view: VIEW, layers: true }));
        const back = reopen(bytes, session.model);
        if (f.path === `public/${NO_VIEWS}`)
          writeAuditSave(NO_VIEWS, 'view-layers', () => back.saved);
        expect(layerStateOf(back.model, NEW_VIEW), f.path).toBe(`ACAD_VIEWS_${NEW_VIEW}`);
        expect(snapshots(back.model), f.path).toEqual([
          ...before,
          [`ACAD_VIEWS_${NEW_VIEW}`, 0x8200, false, session.model.tables.layers.size],
        ]);
        expect(rawInfo(back.doc).get(NEW_VIEW), f.path).toEqual([
          '300=<None>',
          `302=ACAD_VIEWS_${NEW_VIEW}`,
        ]);
        saved++;
      });
    },
    () => {
      // A floor at the time of writing (M5-07 part 7): a corpus file added later only raises it.
      expect(saved).toBeGreaterThanOrEqual(20);
    },
  );
});
