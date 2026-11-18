// The engine worker's message loop (M1-67), apart from the worker entry so tests can drive it
// in-process. Messages are handled in order, so replies come back in the order asked.
import { EngineSession, type ChangeSet } from '@triya/engine';
import type { ChangeMessage } from '@triya/render';
import type { Endpoint, EngineReply, EngineRequest } from './protocol';
import { ENGINE_SERVICES } from './services';

export function serveEngine(port: Endpoint<EngineRequest, EngineReply>): void {
  let session: EngineSession | undefined;
  /** The drawing's render workers linked to this engine (M2-62), by link id. */
  const renderers = new Map<number, MessagePort>();
  /** The number of the last change applied: its place in the app's change log. */
  let seq = 0;
  /**
   * A change applied goes straight to every linked render worker, before the main thread hears
   * of it. Numbered as `Engines` logs it: an empty change set is neither logged nor sent.
   */
  const share = (change: ChangeSet): void => {
    if (Object.keys(change).length === 0) return;
    seq++;
    const m: ChangeMessage = { seq, change };
    for (const r of renderers.values()) r.postMessage(m);
  };
  port.addEventListener('message', ({ data }) => {
    try {
      if (data.type === 'init') {
        session = new EngineSession(data.init, ENGINE_SERVICES, data.changes);
        // A recovered drawing's log (M2-14) is the change log's start.
        seq = data.changes?.length ?? 0;
        session.onCommand((output) => {
          if (output.type === 'change') share(output.change);
          port.postMessage({ type: 'command', output });
        });
        return;
      }
      if (data.type === 'renderer') {
        renderers.set(data.id, data.port);
        return;
      }
      if (data.type === 'renderer-closed') {
        renderers.get(data.id)?.close();
        renderers.delete(data.id);
        return;
      }
      if (!session) throw new Error(`engine worker got '${data.type}' before 'init'`);
      if (data.type === 'command') {
        // The bus reports a command's own failure itself; anything else lands here.
        session.command(data.input).catch((e: unknown) => {
          const line = `; error: ${e instanceof Error ? e.message : String(e)}`;
          port.postMessage({ type: 'command', output: { type: 'log', line } });
        });
        return;
      }
      if (data.type === 'save-blocks') {
        // Asynchronous: the texts are measured by the canvas, through command output.
        const id = data.id;
        session.blocklessDimensionBlocks().then(
          (change) =>
            port.postMessage(
              change ? { type: 'save-blocks', id, change } : { type: 'save-blocks', id },
            ),
          (e: unknown) =>
            port.postMessage({
              type: 'error',
              message: e instanceof Error ? e.message : String(e),
              id,
            }),
        );
        return;
      }
      if (data.type === 'save-views') {
        const change = session.paperViews(data.layouts);
        port.postMessage(
          change
            ? { type: 'save-views', id: data.id, change }
            : { type: 'save-views', id: data.id },
        );
        return;
      }
      if (data.type === 'purge-health') {
        port.postMessage({ type: 'purge-health', id: data.id, health: session.purgeHealth() });
        return;
      }
      const result = session.edit(data.edit);
      if (result.ok) share(result.change);
      port.postMessage({ type: 'result', id: data.id, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      port.postMessage(
        'id' in data ? { type: 'error', message, id: data.id } : { type: 'error', message },
      );
    }
  });
}
