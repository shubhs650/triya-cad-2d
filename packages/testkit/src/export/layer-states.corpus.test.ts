// Named layer states (M5-07 part 1): read from and saved to the `ACAD_LAYERSTATES` dictionary of
// the LAYER table's extension dictionary, as AutoCAD keeps them. sample_AC1032_ascii.dxf holds
// AutoCAD's own: `ACAD_VIEWS_view_custom`, the layer snapshot of the view `view_custom`.
//
// On every readable public corpus file: a layer is changed and a new state saved (the Layer
// States Manager's New), the drawing saved as AC1032 DXF (DEC-047) and read back. The new state
// reads back as saved, filed in the drawing's ACAD_LAYERSTATES, or in a new one the save makes
// when the drawing had none; the states the drawing had keep every group as read. Then, on the
// sample, its state is edited, renamed and deleted through the same round trip, and its layers
// changed, removed and added as Edit Layer State does (M5-07 part 3).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CadObject, XRecord, type CadDocument } from '@node-projects/acad-ts';
import {
  DocumentModel,
  LAYER_STATE_MASK,
  deleteLayerStateChange,
  editLayerStateChange,
  layerStateEntry,
  layerStateNamed,
  layerStates,
  restoreLayerStateChange,
  saveLayerStateChange,
  type ChangeSet,
  type LayerState,
} from '@triya/engine';
import { ACAD_LAYERSTATES, documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const SAMPLE = `${corpusDir}public/third-party/acadsharp/sample_AC1032_ascii.dxf`;

const PER_FILE_BUDGET_MS = 30_000;
const NEW_STATE = 'Triya plan';

/** Each state's groups as the file holds them, pointers as handles. */
function rawStates(doc: CadDocument): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const dict = doc.layers?.xDictionary?.getEntry(ACAD_LAYERSTATES);
  if (!dict || !('entryNames' in dict)) return out;
  for (const name of (dict as { entryNames: string[] }).entryNames) {
    const x = (dict as unknown as { getEntry(k: string): unknown }).getEntry(name);
    if (!(x instanceof XRecord)) continue;
    out.set(
      name,
      x.entries.map((e) => {
        const v = e.value instanceof CadObject ? e.value.handle.toString(16) : String(e.value);
        return `${e.code}=${v}`;
      }),
    );
  }
  return out;
}

const apply = (model: DocumentModel, change: ChangeSet | string): void => {
  if (typeof change === 'string') throw new Error(change);
  model.apply(change);
};

/** A state as the Layer States Manager shows it: no handle, owner or raw read data. */
const shown = (s: LayerState | undefined) =>
  s && {
    name: s.name,
    description: s.description,
    mask: s.mask,
    paperSpace: s.paperSpace,
    currentLayer: s.currentLayer,
    layers: s.layers,
  };

function reopen(bytes: Uint8Array, model: DocumentModel) {
  const saved = saveAc1032Dxf(readCadDocument(bytes), model);
  const doc = readCadDocument(saved);
  return { doc, model: DocumentModel.create(documentInit(doc)) };
}

describe('sample_AC1032_ascii.dxf', () => {
  it('reads AutoCAD’s view layer snapshot as a hidden layer state', () => {
    const model = DocumentModel.create(documentInit(readCadDocument(readFileSync(SAMPLE))));
    expect(model.meta.layerStateDictionary).toBe('18F');
    expect(layerStates(model)).toEqual([]);
    const s = layerStateNamed(model, 'ACAD_VIEWS_view_custom')!;
    expect(s).toMatchObject({
      type: 'LAYER_STATE',
      owner: '18F',
      handle: '306',
      extDict: '307',
      mask: LAYER_STATE_MASK.hidden | LAYER_STATE_MASK.vpFrozen,
      description: '',
      paperSpace: false,
      currentLayer: '0',
    });
    expect(s.layers).toHaveLength(14);
    expect(s.layers[0]).toEqual({
      layer: '286',
      name: model.tables.layers.get('286')!.name,
      on: true,
      frozen: false,
      locked: false,
      plot: true,
      newVpFrozen: false,
      vpFrozen: false,
      color: {
        kind: 'rgb',
        r: 0xfc,
        g: 0xc1,
        b: 0x87,
        bookName: 'DIC COLOR GUIDE(R)',
        colorName: 'DIC 7',
      },
      linetype: '16',
      linetypeName: model.tables.linetypes.get('16')!.name,
      lineweight: 'Default',
      plotStyle: 'Color_31',
      transparency: { alpha: 255 },
    });
    const byHandle = new Map(s.layers.map((l) => [l.layer, l]));
    expect(byHandle.get('283')).toMatchObject({ newVpFrozen: true });
    expect(byHandle.get('282')!.transparency).toEqual({ alpha: 0x4c });
    expect(byHandle.get('281')!.lineweight).toBe(35);
    expect(byHandle.get('27D')!.linetype).toBe('280');
    expect(byHandle.get('27B')).toMatchObject({ plot: false });
    expect(byHandle.get('27A')).toMatchObject({ locked: true });
    expect(byHandle.get('279')).toMatchObject({ frozen: true });
    expect(byHandle.get('278')).toMatchObject({ on: false });
  });

  it('saves a state edited, renamed and deleted, keeping the others as read', () => {
    const bytes = new Uint8Array(readFileSync(SAMPLE));
    const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
    apply(model, saveLayerStateChange(model, 'A', { description: 'First' }));
    apply(model, saveLayerStateChange(model, 'B'));
    let back = reopen(bytes, model);
    const a = layerStateNamed(back.model, 'A')!;
    expect(shown(a)).toEqual(shown(layerStateNamed(model, 'A')));
    // Edit and rename A, delete B, restore nothing: the snapshot stays as AutoCAD wrote it.
    const m2 = back.model;
    const before = rawStates(back.doc);
    const saved2 = saveAc1032Dxf(back.doc, m2);
    const edited = DocumentModel.create(documentInit(readCadDocument(saved2)));
    apply(edited, editLayerStateChange(edited, a.handle, { name: 'Site', description: 'Moved' }));
    apply(edited, deleteLayerStateChange(edited, layerStateNamed(edited, 'B')!.handle));
    back = reopen(saved2, edited);
    expect(layerStates(back.model).map((s) => [s.name, s.description, s.handle])).toEqual([
      ['Site', 'Moved', a.handle],
    ]);
    expect(rawStates(back.doc).get('ACAD_VIEWS_view_custom')).toEqual(
      before.get('ACAD_VIEWS_view_custom'),
    );
  });
  it('saves the layers Edit Layer State changed, removed and added', () => {
    const bytes = new Uint8Array(readFileSync(SAMPLE));
    const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
    apply(model, saveLayerStateChange(model, 'Plan'));
    const saved = saveAc1032Dxf(readCadDocument(bytes), model);
    const doc = readCadDocument(saved);
    const m = DocumentModel.create(documentInit(doc));
    const before = rawStates(doc);
    const st = layerStateNamed(m, 'Plan')!;
    const [first, second, ...rest] = st.layers;
    const other = [...m.tables.linetypes.values()].find(
      (l) => l.handle !== second!.linetype && !/^by/i.test(l.name),
    )!;
    // The first layer removed, then added back (at the end, with its settings now), the
    // second changed in every setting the dialog edits.
    const layers = [
      {
        ...second!,
        on: !second!.on,
        frozen: !second!.frozen,
        locked: !second!.locked,
        plot: !second!.plot,
        newVpFrozen: !second!.newVpFrozen,
        color: { kind: 'rgb' as const, r: 10, g: 20, b: 30 },
        linetype: other.handle,
        lineweight: 50,
        transparency: { alpha: 128 },
      },
      ...rest,
      layerStateEntry(m, m.tables.layers.get(first!.layer!)!),
    ];
    apply(m, editLayerStateChange(m, st.handle, { layers }));
    const back = reopen(saved, m);
    const plan = layerStateNamed(back.model, 'Plan')!;
    expect(plan.handle).toBe(st.handle);
    expect(shown(plan)).toEqual(shown(layerStateNamed(m, 'Plan')));
    expect(plan.layers[0]).toMatchObject({
      linetype: other.handle,
      linetypeName: other.name,
      lineweight: 50,
    });
    expect(plan.layers.at(-1)!.layer).toBe(first!.layer);
    expect(rawStates(back.doc).get('ACAD_VIEWS_view_custom')).toEqual(
      before.get('ACAD_VIEWS_view_custom'),
    );
  });
});

describe('a new layer state saves and reads back on every corpus file', () => {
  let made = 0;
  let kept = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      await withPinnedClock(async () => {
        const original = readCadDocument(bytes);
        const had = rawStates(original);
        const model = DocumentModel.create(documentInit(original));
        const first = [...model.tables.layers.values()][0]!;
        // A layer turned off and coloured before the save, so the state is not all defaults.
        const b = model.tables.layers.get(first.handle)!;
        apply(model, {
          tables: {
            layers: {
              updated: [
                {
                  before: b,
                  after: { ...b, on: false, color: { kind: 'rgb', r: 12, g: 34, b: 56 } },
                },
              ],
            },
          },
        } as ChangeSet);
        apply(model, saveLayerStateChange(model, NEW_STATE, { description: 'Saved by Triya' }));
        // A restore of the state just saved changes no layer: it only marks the state restored
        // last (M5-07 part 2).
        const saved = layerStateNamed(model, NEW_STATE)!;
        const restored = restoreLayerStateChange(model, saved.handle) as ChangeSet;
        expect(restored.tables, f.path).toBeUndefined();
        expect(restored.header, f.path).toBeUndefined();
        expect(
          restored.objects?.updated?.map((u) => u.after.handle),
          f.path,
        ).toEqual([saved.handle]);
        const back = reopen(bytes, model);
        const want = layerStateNamed(model, NEW_STATE)!;
        const got = layerStateNamed(back.model, NEW_STATE);
        expect(shown(got), f.path).toEqual(shown(want));
        expect(got!.handle, f.path).toBe(want.handle);
        expect(back.model.meta.layerStateDictionary, f.path).toBe(got!.owner);
        if (model.meta.layerStateDictionary === undefined) made++;
        // The states the drawing had keep every group.
        const raw = rawStates(back.doc);
        for (const [name, groups] of had) {
          expect(raw.get(name), `${f.path} ${name}`).toEqual(groups);
          kept++;
        }
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('covered drawings with and without ACAD_LAYERSTATES', () => {
    // Floors at the time of writing (M5-07): a corpus file added later only raises them.
    expect(made).toBeGreaterThanOrEqual(10);
    expect(kept).toBeGreaterThanOrEqual(10);
  });
});
