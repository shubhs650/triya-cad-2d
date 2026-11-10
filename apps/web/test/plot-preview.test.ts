// The plot preview (M2-18 part 2): what PREVIEW, the Plot dialog's Preview and the status bar's
// toggle show is the PDF the plot would write, with the settings the space last plotted or
// previewed with (the dialog's defaults before that). The preview stays until it is closed or its
// Plot button plots; whoever opened it hears when it closes.
import { describe, expect, it, vi } from 'vitest';
import { defaultPlotSettings, type PlotSpace } from '../src/plot';
import {
  lastPlotSettings,
  previewMode,
  previewOf,
  previewSettings,
  regionInches,
} from '../src/plot-preview';

const model: PlotSpace = {
  name: 'Model',
  extents: { minX: 0, minY: 0, maxX: 400, maxY: 200 },
  display: { minX: -50, minY: -50, maxX: 450, maxY: 250 },
};

const request = (doc = 1) => ({
  doc,
  title: 'a - Model',
  pdf: new Uint8Array([1]),
  paper: { width: 297, height: 210 },
});

describe('the plot preview store', () => {
  it('shows a preview until it is closed, and answers then', async () => {
    const seen: (number | undefined)[] = [];
    const off = previewMode.subscribe(() => seen.push(previewMode.get()?.doc));
    const shown = previewMode.show(request());
    expect(previewMode.get()?.doc).toBe(1);
    let done = false;
    void shown.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    previewMode.close();
    await shown;
    expect(previewMode.get()).toBeUndefined();
    expect(seen).toEqual([1, undefined]);
    off();
  });

  it('a second preview takes the place of the first, which answers', async () => {
    const first = previewMode.show(request(1));
    const second = previewMode.show(request(2));
    await first;
    expect(previewMode.get()?.doc).toBe(2);
    previewMode.close();
    await second;
  });

  it('Plot plots with the preview’s settings and closes it', async () => {
    const plot = vi.fn(() => Promise.resolve());
    const shown = previewMode.show({ ...request(), plot });
    await previewMode.plot();
    await shown;
    expect(plot).toHaveBeenCalledTimes(1);
    expect(previewMode.get()).toBeUndefined();
  });

  it('a preview that cannot plot stays open when Plot fails', async () => {
    const shown = previewMode.show({ ...request(), plot: () => Promise.reject(new Error('no')) });
    await expect(previewMode.plot()).rejects.toThrow('no');
    expect(previewMode.get()).toBeDefined();
    previewMode.close();
    await shown;
  });
});

describe('previewSettings', () => {
  it('are the dialog’s defaults until the space plots, then what it plotted with', () => {
    expect(previewSettings(7, '*Model_Space', model)).toEqual(defaultPlotSettings(model));
    const mono = { ...defaultPlotSettings(model), table: 'triya-monochrome.ctb' };
    lastPlotSettings.set(7, '*Model_Space', mono);
    expect(previewSettings(7, '*Model_Space', model)).toBe(mono);
    expect(previewSettings(7, '*Paper_Space', model)).toEqual(defaultPlotSettings(model));
    lastPlotSettings.forget(7);
    expect(previewSettings(7, '*Model_Space', model)).toEqual(defaultPlotSettings(model));
  });
});

describe('previewOf', () => {
  it('is the PDF the plot writes, on the paper as turned', async () => {
    const settings = { ...defaultPlotSettings(model), paper: 'ISO A3' };
    const plot = vi.fn(() => Promise.resolve([]));
    const p = await previewOf(plot, model, settings, 'a - Model');
    expect(plot).toHaveBeenCalledWith({});
    expect(new TextDecoder().decode(p.pdf.subarray(0, 8))).toBe('%PDF-1.7');
    expect(p.paper.width).toBeCloseTo(420, 9);
    expect(p.paper.height).toBeCloseTo(297, 9);
  });

  it('plots through the settings’ plot style table', async () => {
    const plot = vi.fn((_r: object) => Promise.resolve([]));
    await previewOf(
      plot,
      model,
      { ...defaultPlotSettings(model), table: 'triya-monochrome.ctb' },
      't',
    );
    expect(plot.mock.calls[0]![0]).toHaveProperty('table');
  });
});

describe('regionInches', () => {
  it('turns millimetres from the paper’s top-left corner into inches from its bottom-left', () => {
    const r = regionInches(
      { x: 25.4, y: 0, width: 50.8, height: 25.4 },
      { width: 297, height: 254 },
    );
    expect(r.minX).toBeCloseTo(1, 12);
    expect(r.maxX).toBeCloseTo(3, 12);
    expect(r.maxY).toBeCloseTo(10, 12);
    expect(r.minY).toBeCloseTo(9, 12);
  });
});
