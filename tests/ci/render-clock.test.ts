// Every renderer a unit test builds draws with a clock the test controls (M5-24).
//
// Canvas2DRenderer times each frame (M1-44): a scene over the 16 ms budget makes the next
// view-only change move the last bitmap instead of drawing, and makes the next frame skip
// detail until the user pauses. With the real `performance.now()`, a test that pans or zooms
// after a frame and then reads the draw calls passes alone and fails on a loaded machine
// (canvas2d-style.test.ts in a full local `pnpm test`, #585). So a test that builds a
// `Canvas2DRenderer` or a `RenderSession` passes `now`: `() => 0` for drawing, or a clock of its
// own when the slow-frame behaviour is what it tests.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SKIP = new Set(['node_modules', 'dist', 'third_party', 'coverage', '.turbo']);

function testFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) testFiles(path, out);
    else if (/\.test\.tsx?$/.test(e.name)) out.push(path);
  }
  return out;
}

/** The text between the parentheses opening at `open`, nested ones included. */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

const BUILT = /new (Canvas2DRenderer|RenderSession)\(/g;
// `now: …`, or `now` passed on by shorthand.
const NOW = /(^|[{,\s])now\s*(:|,|\}|$)/m;

/** `file:line Class` for each renderer or session built without a clock. */
function withoutClock(path: string, src: string): string[] {
  const found: string[] = [];
  for (const m of src.matchAll(BUILT)) {
    const open = m.index + m[0].length - 1;
    if (NOW.test(argsAt(src, open))) continue;
    const line = src.slice(0, m.index).split('\n').length;
    found.push(`${path}:${line} ${m[1]}`);
  }
  return found;
}

describe('render tests use a fixed clock (M5-24)', () => {
  it('finds a renderer built without one, and accepts `now` given or passed on', () => {
    expect(withoutClock('a.ts', 'new Canvas2DRenderer({ model, block })')).toEqual([
      'a.ts:1 Canvas2DRenderer',
    ]);
    expect(withoutClock('a.ts', '\nnew RenderSession({ document: f(x) })')).toEqual([
      'a.ts:2 RenderSession',
    ]);
    expect(withoutClock('a.ts', 'new Canvas2DRenderer({ model, now: () => 0 })')).toEqual([]);
    expect(withoutClock('a.ts', 'new RenderSession({ surface, now })')).toEqual([]);
    expect(withoutClock('a.ts', 'new Canvas2DRenderer({\n  model,\n  now,\n})')).toEqual([]);
    // A clock named elsewhere in the call is not the renderer's.
    expect(withoutClock('a.ts', 'new Canvas2DRenderer({ index: build(now()) })')).toEqual([
      'a.ts:1 Canvas2DRenderer',
    ]);
  });

  it('every Canvas2DRenderer and RenderSession a test builds is given `now`', () => {
    const missing = testFiles(ROOT)
      .filter((f) => f !== fileURLToPath(import.meta.url))
      .flatMap((f) => withoutClock(relative(ROOT, f), readFileSync(f, 'utf8')));
    expect(missing).toEqual([]);
  });
});
