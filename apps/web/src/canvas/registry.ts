// The canvas controllers alive, one per document space shown so far, so the chrome (navigation
// bar, views menu) can reach the one on screen without React state on the canvas path.
import type { CanvasController } from './controller';

const controllers = new Map<string, CanvasController>();
const key = (doc: number, block: string) => `${doc}:${block}`;

export function register(doc: number, block: string, c: CanvasController): () => void {
  controllers.set(key(doc, block), c);
  return () => {
    if (controllers.get(key(doc, block)) === c) controllers.delete(key(doc, block));
  };
}

export function controllerOf(doc: number, block: string): CanvasController | undefined {
  return controllers.get(key(doc, block));
}

/** Every live controller: for changes that reach every drawing, such as the user's patterns. */
export function allControllers(): IterableIterator<CanvasController> {
  return controllers.values();
}

/** The live controllers of one document, one per space it has shown. */
export function controllersOf(doc: number): CanvasController[] {
  const prefix = `${doc}:`;
  return [...controllers].filter(([k]) => k.startsWith(prefix)).map(([, c]) => c);
}
