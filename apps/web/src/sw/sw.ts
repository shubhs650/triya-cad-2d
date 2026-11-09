// The app's service worker (M2-19, ARCHITECTURE.md §14, DEC-052), built to `/sw.js` by
// `pwa-plugin.ts`, which writes this build's file list over `__TRIYA_OFFLINE__`. It installs the
// app shell and core engine, answers the app's requests from the cache, warms pdf.js in the
// background and tells the pages how far the caching got. A new version waits until a page
// asks it to take over (the update prompt); it never reloads a page itself.
//
// It talks to nothing but the app's own origin (PRD G6).
import { OfflineCache, type OfflineAssets, type OfflineProgress } from './offline-cache';

/** The parts of the service worker global this file uses (the app's lib is DOM, not WebWorker). */
interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(r: Promise<Response>): void;
}
interface MessageEventLike extends ExtendableEvent {
  readonly data: unknown;
}
interface Client {
  postMessage(message: unknown): void;
}
interface WorkerScope {
  readonly location: Location;
  readonly caches: CacheStorage;
  readonly clients: { matchAll(o?: { type?: string }): Promise<Client[]>; claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  fetch(request: Request): Promise<Response>;
  addEventListener(type: 'install' | 'activate', l: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', l: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', l: (e: MessageEventLike) => void): void;
}

declare const __TRIYA_OFFLINE__: OfflineAssets;
const scope = self as unknown as WorkerScope;

/** Messages between the pages (`pwa.ts`) and this worker. */
export type ToWorker = { type: 'status' } | { type: 'skip-waiting' };
export type FromWorker = { type: 'offline'; version: string } & OfflineProgress;

const offline = new OfflineCache(
  __TRIYA_OFFLINE__,
  scope.caches,
  (r) => scope.fetch(r),
  scope.location.origin,
);

async function tell(p: OfflineProgress): Promise<void> {
  const message: FromWorker = { type: 'offline', version: offline.assets.version, ...p };
  for (const c of await scope.clients.matchAll({ type: 'window' })) c.postMessage(message);
}

scope.addEventListener('install', (e) => e.waitUntil(offline.install()));

scope.addEventListener('activate', (e) =>
  // The first version takes the page that installed it at once, so pdf.js loads through it;
  // a later one gets here only after a page asked it to (skip-waiting).
  e.waitUntil(offline.activate().then(() => scope.clients.claim())),
);

scope.addEventListener('fetch', (e) => {
  const answer = offline.respond({ request: e.request, navigate: e.request.mode === 'navigate' });
  if (answer) e.respondWith(answer);
});

scope.addEventListener('message', (e) => {
  const m = e.data as ToWorker;
  if (m?.type === 'skip-waiting') e.waitUntil(scope.skipWaiting());
  // A page asks how far caching got once its worker is active; the answer warms pdf.js first.
  if (m?.type === 'status')
    e.waitUntil(
      offline
        .status()
        .then(tell)
        .then(() => offline.warm((p) => void tell(p)))
        .then(tell),
    );
});
