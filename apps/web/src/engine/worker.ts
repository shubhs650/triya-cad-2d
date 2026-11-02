// The engine worker entry (M1-67): imported by the app as `./engine/worker?worker`.
import type { Endpoint, EngineReply, EngineRequest } from './protocol';
import { serveEngine } from './serve';

serveEngine(self as unknown as Endpoint<EngineRequest, EngineReply>);
