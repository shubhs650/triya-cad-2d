// M5-18 part 3: -LAYER stAte Import's file named at the command line (`layerStateFile`), found by
// name among the places the app holds files, a .las before a drawing; EXport's file
// (`writeLayerState`) written with io's writeLas, downloaded and kept.
import { parseLas } from '@triya/io';
import type { DocumentInit, LayerStateInit } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { layerStateFileReply, writeLayerStateFile } from '../src/layer-state-files';
import type { FileSource } from '../src/xrefs';

const STATE: LayerStateInit = {
  name: 'PLAN',
  description: 'Ground floor',
  mask: 2047,
  paperSpace: false,
  currentLayer: 'WALLS',
  layers: [
    {
      name: 'WALLS',
      on: true,
      frozen: false,
      locked: false,
      plot: true,
      newVpFrozen: false,
      vpFrozen: false,
      color: { kind: 'aci', index: 1 },
      linetypeName: 'DASHED',
      lineweight: 35,
      plotStyle: 'Color_1',
      transparency: { alpha: 255 },
    },
  ],
};
const INIT = { handSeed: '60' } as unknown as DocumentInit;

/** The .las text writeLayerStateFile writes for STATE. */
async function lasText(): Promise<string> {
  let text = '';
  await writeLayerStateFile(
    { op: 'writeLayerState', file: 'x.las', state: STATE },
    {
      download: () => {},
      keep: (_n, b) => Promise.resolve(void (text = new TextDecoder().decode(b))),
    },
  );
  return text;
}

const source = (name: string, body: string): FileSource => ({
  name,
  getFile: () => Promise.resolve(new Blob([body])),
});
const env = () => {
  const opened: string[] = [];
  return {
    opened,
    open: async (b: Blob) => {
      opened.push(await b.text());
      return { init: INIT };
    },
  };
};

describe('layerStateFileReply', () => {
  it('finds a .las by name, folders, quotes, case and the extension aside', async () => {
    const las = await lasText();
    const places = [() => [source('other.las', las)], () => [source('Plan.las', las)]];
    for (const typed of ['plan.las', '"C:\\states\\PLAN"', 'plan']) {
      const r = await layerStateFileReply(typed, places, env());
      expect(r).toMatchObject({ ok: true, layerStateFile: { name: 'Plan.las' } });
      if (!r.ok) throw new Error(r.message);
      expect(r.layerStateFile!.states!.map((s) => s.name)).toEqual(['PLAN']);
    }
  });

  it('takes a .las before a drawing of the same name, then a drawing, else none', async () => {
    const e = env();
    const las = await lasText();
    const drawing = [() => Promise.resolve([source('plan.dwg', 'dwg'), source('site.dxf', 'dxf')])];
    const r = await layerStateFileReply('plan', [...drawing, () => [source('plan.las', las)]], e);
    expect(r).toMatchObject({ ok: true, layerStateFile: { name: 'plan.las' } });
    const d = await layerStateFileReply('site', drawing, e);
    expect(d).toEqual({ ok: true, layerStateFile: { name: 'site.dxf', drawing: INIT } });
    expect(e.opened).toEqual(['dxf']);
    expect(await layerStateFileReply('site.dws', drawing, e)).toEqual({ ok: true });
    expect(await layerStateFileReply('plan.lin', [() => [source('plan.lin', '')]], e)).toEqual({
      ok: true,
    });
  });

  it('says why a file found cannot be read', async () => {
    const bad = await layerStateFileReply('bad', [() => [source('bad.las', 'hello')]], env());
    expect(bad).toEqual({
      ok: false,
      message: 'bad.las could not be read: Not a layer state file.',
    });
    const broken = await layerStateFileReply('site', [() => [source('site.dwg', 'x')]], {
      open: () => Promise.reject(new Error('not a drawing')),
    });
    expect(broken).toEqual({ ok: false, message: 'site.dwg could not be read: not a drawing' });
    const odd = await layerStateFileReply('site', [() => [source('site.dwg', 'x')]], {
      open: () => Promise.reject('gone'),
    });
    expect(odd).toEqual({ ok: false, message: 'site.dwg could not be read: gone' });
  });
});

describe('writeLayerStateFile', () => {
  it('writes the state as a .las under the typed file name, downloads it and keeps it', async () => {
    const downloads: string[] = [];
    const kept: [string, string][] = [];
    const r = await writeLayerStateFile(
      { op: 'writeLayerState', file: 'C:\\states\\plan.las', state: STATE },
      {
        download: (name) => downloads.push(name),
        keep: (name, bytes) =>
          Promise.resolve(void kept.push([name, new TextDecoder().decode(bytes)])),
      },
    );
    expect(r).toEqual({ ok: true, file: 'plan.las' });
    expect(downloads).toEqual(['plan.las']);
    expect(kept.map(([n]) => n)).toEqual(['plan.las']);
    // Read back, the state and its layers and linetypes by name.
    const [back] = parseLas(kept[0]![1]);
    expect(back).toMatchObject({
      name: 'PLAN',
      description: 'Ground floor',
      currentLayer: 'WALLS',
    });
    expect(back!.layers.map((e) => [e.name, e.linetypeName, e.lineweight])).toEqual([
      ['WALLS', 'DASHED', 35],
    ]);
  });
});
