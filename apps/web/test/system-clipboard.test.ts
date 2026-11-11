// M2-32 part 5: the app's Clipboard on the system clipboard. COPYCLIP's objects are written
// under Triya's own clipboard format beside a PNG picture of them (what other apps paste), and a
// paste reads the system clipboard first: another Triya window's objects, another app's text or
// picture, or the window's own objects, which it keeps with the drawing they came from.
import { clipboardData, type Clipboard } from '@triya/engine';
import type { PlotPart } from '@triya/render';
import { describe, expect, it } from 'vitest';
import {
  AppClipboard,
  CLIPBOARD_FORMAT,
  clipboardPicture,
  type SystemClipboardEnv,
} from '../src/system-clipboard';

const MODEL = '1F';

/** What COPYCLIP puts on the Clipboard for one line (plain data, as `copyToClipboard` makes it). */
function sample(): Clipboard {
  return {
    base: { x: 0, y: 0 },
    entities: [
      {
        handle: '20',
        type: 'LINE',
        owner: MODEL,
        layer: '10',
        color: { kind: 'byLayer' },
        geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 10, y: 5 } },
      },
    ],
    blockEntities: [],
    tables: { layers: [] },
    blocks: [],
    extents: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
  } as unknown as Clipboard;
}

/** A system clipboard holding one item, as `navigator.clipboard` does. */
function fakeEnv(): SystemClipboardEnv & {
  item: Map<string, Blob> | undefined;
  failWrite: boolean;
  failRead: boolean;
} {
  const env = {
    item: undefined as Map<string, Blob> | undefined,
    failWrite: false,
    failRead: false,
    async write(item: Record<string, Blob>) {
      if (env.failWrite) throw new Error('Document is not focused.');
      // As Chromium: each blob under its own type.
      for (const [type, blob] of Object.entries(item)) {
        if (blob.type !== type)
          throw new Error(`Type ${type} does not match the blob's type ${blob.type}`);
      }
      env.item = new Map(Object.entries(item));
    },
    async read() {
      if (env.failRead) throw new Error('Read permission denied.');
      const item = env.item;
      if (!item) return undefined;
      return {
        types: [...item.keys()],
        get: async (type: string) => item.get(type)!,
      };
    },
  };
  return env;
}

const png = () =>
  Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));

describe('AppClipboard', () => {
  it('writes the objects in Triya’s format with their picture', async () => {
    const env = fakeEnv();
    const app = new AppClipboard(env, 'window-a');
    await app.copy(1, sample(), png);
    expect([...env.item!.keys()].sort()).toEqual([CLIPBOARD_FORMAT, 'image/png'].sort());
    expect(CLIPBOARD_FORMAT).toBe('web application/x-triya-clipboard');
    // Another window reads the same objects back.
    const other = new AppClipboard(env, 'window-b');
    const reply = await other.paste(2);
    expect(reply).toEqual({ ok: true, clipboard: sample(), sameDrawing: false });
  });

  it('keeps its own objects with the drawing they came from (PASTEORIG)', async () => {
    const env = fakeEnv();
    const app = new AppClipboard(env, 'window-a');
    await app.copy(1, sample(), png);
    expect(await app.paste(1)).toMatchObject({ ok: true, sameDrawing: true });
    expect(await app.paste(2)).toMatchObject({ ok: true, sameDrawing: false });
  });

  it('pastes what was copied last: another app’s text after the objects', async () => {
    const env = fakeEnv();
    const app = new AppClipboard(env, 'window-a');
    await app.copy(1, sample(), png);
    env.item = new Map([['text/plain', new Blob(['Hello\nworld'])]]);
    expect(await app.paste(1)).toEqual({ ok: true, text: 'Hello\nworld' });
  });

  it('says it cannot paste another app’s picture', async () => {
    const env = fakeEnv();
    const app = new AppClipboard(env, 'window-a');
    env.item = new Map([['image/png', await png()]]);
    expect(await app.paste(1)).toEqual({
      ok: false,
      message: 'The Clipboard holds a picture, which Triya does not paste.',
    });
  });

  it('says so of another version’s objects', async () => {
    const env = fakeEnv();
    const app = new AppClipboard(env, 'window-a');
    const text = clipboardData(sample(), 'w').replace('"version":1', '"version":99');
    env.item = new Map([[CLIPBOARD_FORMAT, new Blob([text])]]);
    expect(await app.paste(1)).toEqual({
      ok: false,
      message:
        'The Clipboard holds objects from another version of Triya, which this one cannot paste.',
    });
  });

  it('keeps its own Clipboard when the system clipboard cannot be written or read', async () => {
    const env = fakeEnv();
    env.item = new Map([['text/plain', new Blob(['older text'])]]);
    env.failWrite = true;
    const app = new AppClipboard(env, 'window-a');
    await app.copy(1, sample(), png);
    // The write failed, so the older text on the system clipboard is not newer than the objects.
    expect(await app.paste(1)).toMatchObject({ ok: true, sameDrawing: true });

    const reading = fakeEnv();
    const app2 = new AppClipboard(reading, 'window-c');
    await app2.copy(3, sample(), png);
    reading.failRead = true;
    expect(await app2.paste(3)).toMatchObject({ ok: true, sameDrawing: true });
  });

  it('writes the objects without a picture when the picture fails', async () => {
    const env = fakeEnv();
    const app = new AppClipboard(env, 'window-a');
    await app.copy(1, sample(), () => Promise.reject(new Error('no canvas')));
    expect([...env.item!.keys()]).toEqual([CLIPBOARD_FORMAT]);
  });

  it('works on its own without a system clipboard', async () => {
    const app = new AppClipboard(undefined, 'window-a');
    expect(await app.paste(1)).toEqual({ ok: true });
    await app.copy(1, sample(), png);
    expect(await app.paste(1)).toEqual({ ok: true, clipboard: sample(), sameDrawing: true });
  });
});

describe('clipboardPicture', () => {
  it('plots the copied objects only, fitted to their extents on white', async () => {
    const requests: unknown[] = [];
    let svg = '';
    let size: unknown;
    const blob = await clipboardPicture(
      sample(),
      (r) => {
        requests.push(r);
        return Promise.resolve([] as PlotPart[]);
      },
      async (s, o) => {
        svg = s;
        size = o;
        return {
          width: o.width,
          height: o.height,
          data: new Uint8ClampedArray(o.width * o.height * 4),
        };
      },
    );
    expect(requests).toEqual([{ block: MODEL, handles: ['20'] }]);
    expect(blob?.type).toBe('image/png');
    // The long side is 1024 pixels inside an 8-pixel margin.
    expect(size).toEqual({ width: 1040, height: 528, background: '#ffffff' });
    expect(svg).toContain('<svg');
  });

  it('makes none without the objects’ extents', async () => {
    const { extents: _, ...clip } = sample();
    expect(await clipboardPicture(clip, () => Promise.resolve([]))).toBeUndefined();
  });
});
