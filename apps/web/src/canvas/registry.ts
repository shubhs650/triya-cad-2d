// The canvas controllers alive, one per document space shown so far (one per viewport when
// model space is tiled, M1-22 part 4), so the chrome (navigation bar, views menu) can reach the
// current one without React state on the canvas path.
import type { CanvasController } from './controller';

/** Each space's controllers by tile index; a space that is not tiled has tile 0 only. */
const controllers = new Map<string, Map<number, CanvasController>>();
/** The current tile of each tiled space; AutoCAD's current viewport is the first saved. */
const current = new Map<string, number>();
const key = (doc: number, block: string) => `${doc}:${block}`;

export function register(doc: number, block: string, c: CanvasController, tile = 0): () => void {
  const k = key(doc, block);
  let tiles = controllers.get(k);
  if (!tiles) controllers.set(k, (tiles = new Map()));
  tiles.set(tile, c);
  return () => {
    if (tiles.get(tile) !== c) return;
    tiles.delete(tile);
    if (tiles.size === 0 && controllers.get(k) === tiles) {
      controllers.delete(k);
      current.delete(k);
    }
  };
}

/** The controller of a space's current viewport: what the navigation bar and Esc act on. */
export function controllerOf(doc: number, block: string): CanvasController | undefined {
  return controllers.get(key(doc, block))?.get(currentTile(doc, block));
}

export function currentTile(doc: number, block: string): number {
  return current.get(key(doc, block)) ?? 0;
}

/** Makes `tile` the space's current viewport. */
export function setCurrentTile(doc: number, block: string, tile: number): void {
  current.set(key(doc, block), tile);
}

/** The controllers of one space by tile index. */
export function tilesOf(doc: number, block: string): [number, CanvasController][] {
  return [...(controllers.get(key(doc, block)) ?? [])];
}

/** Every live controller: for changes that reach every drawing, such as the user's patterns. */
export function allControllers(): CanvasController[] {
  return [...controllers.values()].flatMap((tiles) => [...tiles.values()]);
}

/** The live controllers of one document: every viewport of every space it has shown. */
export function controllersOf(doc: number): CanvasController[] {
  const prefix = `${doc}:`;
  return [...controllers]
    .filter(([k]) => k.startsWith(prefix))
    .flatMap(([, tiles]) => [...tiles.values()]);
}

/**
 * Tab over a canvas at a point prompt (M2-04 part 2): steps AutoSnap to its next snap point;
 * false when no canvas has another to step to, so Tab does what it otherwise would.
 */
export function cycleSnap(): boolean {
  return allControllers().some((c) => c.cycleSnap());
}
