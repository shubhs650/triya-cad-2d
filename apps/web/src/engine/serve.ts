// The engine worker's message loop (M1-67), apart from the worker entry so tests can drive it
// in-process. Messages are handled in order, so replies come back in the order asked.
import { EngineSession } from '@triya/engine';
import type { Endpoint, EngineReply, EngineRequest } from './protocol';
import { ENGINE_SERVICES } from './services';

export function serveEngine(port: Endpoint<EngineRequest, EngineReply>): void {
  let session: EngineSession | undefined;
  port.addEventListener('message', ({ data }) => {
    try {
      if (data.type === 'init') {
        session = new EngineSession(data.init, ENGINE_SERVICES);
        session.onCommand((output) => port.postMessage({ type: 'command', output }));
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
      port.postMessage({ type: 'result', id: data.id, result: session.edit(data.edit) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      port.postMessage(
        'id' in data ? { type: 'error', message, id: data.id } : { type: 'error', message },
      );
    }
  });
}
