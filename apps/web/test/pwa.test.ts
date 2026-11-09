// M2-19 (PRD FR-F10, T1; ARCHITECTURE.md §14): the page's side of the service worker. It shows
// how far offline caching got ("Ready offline" once every file is cached), offers a new version
// with a prompt and reloads only when the user takes it (never a silent reload mid-session),
// and offers to install the app when the browser allows it.
import { describe, expect, it } from 'vitest';
import {
  Pwa,
  type ContainerLike,
  type InstallPromptLike,
  type RegistrationLike,
  type WorkerLike,
} from '../src/pwa';
import type { FromWorker, ToWorker } from '../src/sw/sw';

class FakeWorker implements WorkerLike {
  readonly sent: ToWorker[] = [];
  #listeners: (() => void)[] = [];
  constructor(public state: ServiceWorkerState) {}
  postMessage(m: ToWorker) {
    this.sent.push(m);
  }
  addEventListener(_type: 'statechange', l: () => void) {
    this.#listeners.push(l);
  }
  become(state: ServiceWorkerState) {
    this.state = state;
    for (const l of this.#listeners) l();
  }
}

class FakeRegistration implements RegistrationLike {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  updates = 0;
  #found: (() => void)[] = [];
  addEventListener(_type: 'updatefound', l: () => void) {
    this.#found.push(l);
  }
  update() {
    this.updates++;
    return Promise.resolve();
  }
  /** A new version starts installing. */
  found(w: FakeWorker) {
    this.installing = w;
    for (const l of this.#found) l();
  }
}

class FakeContainer implements ContainerLike {
  controller: FakeWorker | null = null;
  registered: { url: string; scope: string }[] = [];
  #listeners = new Map<string, ((e: { data?: unknown }) => void)[]>();
  readonly ready: Promise<FakeRegistration>;
  constructor(readonly reg: FakeRegistration) {
    this.ready = Promise.resolve(reg);
  }
  register(url: string, o: { scope: string }) {
    this.registered.push({ url, scope: o.scope });
    return Promise.resolve(this.reg);
  }
  addEventListener(type: 'message' | 'controllerchange', l: (e: { data?: unknown }) => void) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), l]);
  }
  emit(type: 'message' | 'controllerchange', data?: FromWorker) {
    for (const l of this.#listeners.get(type) ?? []) l({ data });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(o: { controlled?: boolean } = {}) {
  const reg = new FakeRegistration();
  const container = new FakeContainer(reg);
  const active = new FakeWorker('activated');
  reg.active = active;
  if (o.controlled) container.controller = active;
  let reloads = 0;
  const pwa = new Pwa({ reload: () => reloads++ });
  return { reg, container, active, pwa, reloads: () => reloads };
}

const progress = (cached: number, total: number): FromWorker => ({
  type: 'offline',
  version: 'v1',
  cached,
  total,
});

describe('Pwa', () => {
  it('shows nothing where there is no service worker (dev server, old browsers)', () => {
    const pwa = new Pwa({ reload: () => undefined });
    expect(pwa.getSnapshot()).toMatchObject({ offline: undefined, update: false, install: false });
  });

  it('registers /sw.js for the whole app and asks the active worker how far caching got', async () => {
    const { container, active, pwa } = setup();
    await pwa.register(container);
    expect(container.registered).toEqual([{ url: '/sw.js', scope: '/' }]);
    await tick();
    expect(active.sent).toEqual([{ type: 'status' }]);
  });

  it('counts up to "Ready offline" as the worker reports', async () => {
    const { container, pwa } = setup();
    await pwa.register(container);
    const seen: string[] = [];
    pwa.subscribe(() => seen.push(pwa.label() ?? ''));
    container.emit('message', progress(8, 11));
    container.emit('message', progress(10, 11));
    container.emit('message', progress(11, 11));
    expect(seen).toEqual(['Saving for offline… 72%', 'Saving for offline… 90%', 'Ready offline']);
    expect(pwa.getSnapshot().offline).toEqual({ cached: 11, total: 11 });
    // With the connection gone the app says it is working offline.
    pwa.setOnline(false);
    expect(pwa.label()).toBe('Working offline');
    pwa.setOnline(true);
    expect(pwa.label()).toBe('Ready offline');
  });

  it('ignores messages that are not the worker’s', async () => {
    const { container, pwa } = setup();
    await pwa.register(container);
    container.emit('message', { type: 'other' } as unknown as FromWorker);
    expect(pwa.getSnapshot().offline).toBeUndefined();
  });

  it('the first install is not an update, and taking the page over does not reload it', async () => {
    const { reg, container, pwa, reloads } = setup();
    await pwa.register(container);
    const first = new FakeWorker('installing');
    reg.found(first);
    first.become('installed');
    expect(pwa.getSnapshot().update).toBe(false);
    container.controller = first;
    container.emit('controllerchange');
    expect(reloads()).toBe(0);
  });

  it('offers a new version once it has installed, and reloads only when asked', async () => {
    const { reg, container, pwa, reloads } = setup({ controlled: true });
    await pwa.register(container);
    const next = new FakeWorker('installing');
    reg.found(next);
    expect(pwa.getSnapshot().update).toBe(false);
    next.become('installed');
    reg.installing = null;
    reg.waiting = next;
    expect(pwa.getSnapshot().update).toBe(true);
    expect(reloads()).toBe(0);
    pwa.applyUpdate();
    // The waiting worker takes over first; the page reloads when it has.
    expect(next.sent).toEqual([{ type: 'skip-waiting' }]);
    expect(reloads()).toBe(0);
    container.emit('controllerchange');
    expect(reloads()).toBe(1);
  });

  it('offers a version already waiting when the page starts', async () => {
    const { reg, container, pwa } = setup({ controlled: true });
    reg.waiting = new FakeWorker('installed');
    await pwa.register(container);
    expect(pwa.getSnapshot().update).toBe(true);
  });

  it('Later hides the offer until the next version', async () => {
    const { reg, container, pwa } = setup({ controlled: true });
    reg.waiting = new FakeWorker('installed');
    await pwa.register(container);
    pwa.dismissUpdate();
    expect(pwa.getSnapshot().update).toBe(false);
    const next = new FakeWorker('installing');
    reg.found(next);
    next.become('installed');
    expect(pwa.getSnapshot().update).toBe(true);
  });

  it('a version another tab took over is offered as a plain reload', async () => {
    const { reg, container, pwa, reloads } = setup({ controlled: true });
    reg.waiting = new FakeWorker('installed');
    await pwa.register(container);
    // The other tab's Reload activated it: this page is not reloaded behind the user's back.
    reg.waiting = null;
    container.emit('controllerchange');
    expect(reloads()).toBe(0);
    expect(pwa.getSnapshot().update).toBe(true);
    pwa.applyUpdate();
    expect(reloads()).toBe(1);
  });

  it('checks for a new version on request', async () => {
    const { reg, container, pwa } = setup({ controlled: true });
    await pwa.checkForUpdate();
    expect(reg.updates).toBe(0);
    await pwa.register(container);
    await pwa.checkForUpdate();
    expect(reg.updates).toBe(1);
  });

  it('a failed registration leaves the app as it was', async () => {
    const pwa = new Pwa({ reload: () => undefined });
    const container = new FakeContainer(new FakeRegistration());
    container.register = () => Promise.reject(new Error('SecurityError'));
    await pwa.register(container);
    expect(pwa.getSnapshot()).toMatchObject({ offline: undefined, update: false });
  });

  it('offers to install the app when the browser allows it, and stops once installed', async () => {
    const pwa = new Pwa({ reload: () => undefined });
    let prevented = false;
    let prompted = 0;
    const prompt: InstallPromptLike = {
      preventDefault: () => (prevented = true),
      prompt: () => {
        prompted++;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    };
    pwa.offerInstall(prompt);
    // The browser's own mini-infobar gives way to the app's Install button.
    expect(prevented).toBe(true);
    expect(pwa.getSnapshot().install).toBe(true);
    await pwa.install();
    expect(prompted).toBe(1);
    // A prompt can be shown once; the browser offers again with a new event.
    expect(pwa.getSnapshot().install).toBe(false);
    await pwa.install();
    expect(prompted).toBe(1);
    pwa.offerInstall({ ...prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    pwa.installed();
    expect(pwa.getSnapshot().install).toBe(false);
  });
});
