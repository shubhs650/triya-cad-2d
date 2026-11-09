// The page's side of the service worker (M2-19, PRD FR-F10 and T1, ARCHITECTURE.md §14): it
// registers `/sw.js`, shows how far offline caching got (the title bar's "Ready offline"),
// offers a new version with a prompt and reloads only when the user takes it, never by itself
// in the middle of a session, and offers to install the app when the browser allows it.
//
// The browser objects come in through the small interfaces below, so Vitest drives this with
// fakes; `App.tsx` hands it `navigator.serviceWorker` in production builds only (the dev server
// serves no worker).
import type { OfflineProgress } from './sw/offline-cache';
import type { FromWorker, ToWorker } from './sw/sw';

export interface WorkerLike {
  readonly state: ServiceWorkerState;
  postMessage(m: ToWorker): void;
  addEventListener(type: 'statechange', l: () => void): void;
}

export interface RegistrationLike {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  readonly active: WorkerLike | null;
  addEventListener(type: 'updatefound', l: () => void): void;
  update(): Promise<unknown>;
}

export interface ContainerLike {
  readonly controller: WorkerLike | null;
  readonly ready: Promise<RegistrationLike>;
  register(url: string, o: { scope: string }): Promise<RegistrationLike>;
  addEventListener(type: 'message' | 'controllerchange', l: (e: { data?: unknown }) => void): void;
}

/** The browser's `beforeinstallprompt` event (Chromium). */
export interface InstallPromptLike {
  preventDefault(): void;
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  /** How many of the build's files are cached; undefined with no worker. */
  readonly offline: OfflineProgress | undefined;
  readonly online: boolean;
  /** A new version is waiting for the user to take it. */
  readonly update: boolean;
  /** The browser would install the app now. */
  readonly install: boolean;
}

export class Pwa {
  #state: PwaState = { offline: undefined, online: true, update: false, install: false };
  #listeners = new Set<() => void>();
  #reg: RegistrationLike | undefined;
  #updating = false;
  #prompt: InstallPromptLike | undefined;

  constructor(private readonly env: { reload(): void }) {}

  subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  getSnapshot = (): PwaState => this.#state;

  #set(patch: Partial<PwaState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const l of this.#listeners) l();
  }

  /** The title bar's offline status, or undefined to show none. */
  label(): string | undefined {
    const { offline, online } = this.#state;
    if (!offline) return undefined;
    const ready = offline.total > 0 && offline.cached >= offline.total;
    if (!online) return ready ? 'Working offline' : 'Offline';
    if (ready) return 'Ready offline';
    return `Saving for offline… ${Math.floor((100 * offline.cached) / offline.total)}%`;
  }

  setOnline(online: boolean): void {
    if (online !== this.#state.online) this.#set({ online });
  }

  async register(container: ContainerLike): Promise<void> {
    container.addEventListener('message', ({ data }) => {
      const m = data as FromWorker | undefined;
      if (m?.type !== 'offline') return;
      this.#set({ offline: { cached: m.cached, total: m.total } });
    });
    container.addEventListener('controllerchange', () => {
      // The page reloads only when its own user took the update. A version that took over
      // from another tab (or the first one, claiming the page that installed it) does not
      // reload this page; the prompt already showing stays.
      if (this.#updating) this.env.reload();
    });
    let reg: RegistrationLike;
    try {
      reg = await container.register('/sw.js', { scope: '/' });
    } catch {
      return; // no worker (private mode, blocked storage): the app works online as before
    }
    this.#reg = reg;
    if (reg.waiting && container.controller) this.#set({ update: true });
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      next?.addEventListener('statechange', () => {
        // Installed with a page already controlled: a new version, not the first one.
        if (next.state === 'installed' && container.controller) this.#set({ update: true });
      });
    });
    void container.ready.then((r) => r.active?.postMessage({ type: 'status' }));
  }

  /** Asks the browser to look for a new version (it also looks on every page load). */
  async checkForUpdate(): Promise<void> {
    await this.#reg?.update().catch(() => undefined);
  }

  /** Takes the new version: it takes over, then the page reloads (asking first if unsaved). */
  applyUpdate(): void {
    const waiting = this.#reg?.waiting;
    if (!waiting) return this.env.reload(); // already active (another tab took it)
    this.#updating = true;
    waiting.postMessage({ type: 'skip-waiting' });
  }

  dismissUpdate(): void {
    this.#set({ update: false });
  }

  offerInstall(e: InstallPromptLike): void {
    e.preventDefault();
    this.#prompt = e;
    this.#set({ install: true });
  }

  async install(): Promise<void> {
    const p = this.#prompt;
    if (!p) return;
    this.#prompt = undefined;
    this.#set({ install: false });
    await p.prompt();
    await p.userChoice;
  }

  installed(): void {
    this.#prompt = undefined;
    this.#set({ install: false });
  }
}
