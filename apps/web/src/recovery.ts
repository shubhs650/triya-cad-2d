// Crash recovery (M2-14, PRD FR-F5, ARCHITECTURE.md §13). A drawing with unsaved changes is
// written to this device's store AUTOSAVE_DELAY_MS after its last edit, never to its own file
// (AutoCAD's SAVETIME autosave writes a separate .sv$ file too): the bytes it was opened from,
// once, and its engine's change log, each time. That is everything a save starts from
// (ARCHITECTURE.md §6.1), so the drawing comes back exactly. A save that holds every edit, or
// closing the drawing, removes the snapshot. Each page holds a lock named after its session
// while it lives, so on the next launch a snapshot whose session nobody holds is one a crash,
// a killed tab or a closed window left behind: it is offered for recovery ("Recover unsaved
// drawing?"). The browser's side (IndexedDB, Web Locks) is recovery-browser.ts.
import type { ChangeSet } from '@triya/engine';
import { isDirty, type OpenDocument } from './documents';

/** PRD T5: autosave within 5 s of the last edit. */
export const AUTOSAVE_DELAY_MS = 5_000;

/** A snapshot as listed: which drawing, from which page, when. */
export interface RecoveryInfo {
  /** `<session>-<document id>`. */
  readonly key: string;
  /** The page that wrote it. */
  readonly session: string;
  /** The drawing's name as its tab showed it. */
  readonly name: string;
  /** When it was written (ms since 1970). */
  readonly savedAt: number;
  /** Its unsaved edits, which the recovered drawing starts with. */
  readonly edits: number;
}

/** A snapshot with what recovering it needs. */
export interface RecoveryEntry extends RecoveryInfo {
  /** The file as the drawing was opened. */
  readonly bytes: Uint8Array;
  /** Every change its engine applied since, in order. */
  readonly changes: readonly ChangeSet[];
}

/** Where snapshots are kept (IndexedDB in the app). */
export interface RecoveryPersistence {
  list(): Promise<RecoveryInfo[]>;
  /**
   * Writes a snapshot. `bytes` come with the first write of a drawing only: later writes keep
   * the ones written then.
   */
  put(info: RecoveryInfo, changes: readonly ChangeSet[], bytes?: Uint8Array): Promise<void>;
  get(key: string): Promise<RecoveryEntry | undefined>;
  remove(key: string): Promise<void>;
}

/** Which pages are alive (Web Locks in the app). */
export interface SessionLocks {
  /** Holds this page's lock for as long as the page lives. */
  hold(session: string): void;
  /** The sessions a live page holds; undefined where the browser cannot tell. */
  held(): Promise<ReadonlySet<string> | undefined>;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(timer: unknown): void;
}

const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface Tracked {
  doc: OpenDocument;
  /** The edits count the pending timer was set for. */
  seen: number;
  timer?: unknown;
  /** The store holds this drawing's source bytes. */
  sourceWritten: boolean;
  /** A snapshot of it may be in the store. */
  written: boolean;
  /** A recovered drawing's old snapshot, removed once this one is written. */
  replaces?: string;
  failed?: boolean;
}

export interface AutosaverOptions {
  readonly persistence: RecoveryPersistence;
  /** This page's session: snapshot keys start with it. */
  readonly session: string;
  /** A drawing's change log (`Engines.changesOf`). */
  readonly changesOf: (doc: number) => readonly ChangeSet[];
  readonly delayMs?: number;
  readonly timers?: Timers;
  readonly now?: () => number;
  /** A write failed; said once per drawing until a write succeeds. */
  readonly onError?: (message: string) => void;
}

export class Autosaver {
  readonly #o: AutosaverOptions;
  readonly #timers: Timers;
  readonly #tracked = new Map<number, Tracked>();
  /** Store operations run one at a time, in order: a removal never overtakes a write. */
  #queue: Promise<void> = Promise.resolve();
  #stopped = false;

  constructor(options: AutosaverOptions) {
    this.#o = options;
    this.#timers = options.timers ?? browserTimers;
  }

  /** "Clear all local data" (M2-20) runs: nothing is written or removed from now on. */
  stop(): void {
    this.#stopped = true;
    for (const t of this.#tracked.values()) this.#cancel(t);
    this.#tracked.clear();
  }

  /** The open documents as they are now (`DocumentStore` snapshots). */
  update(docs: readonly OpenDocument[]): void {
    if (this.#stopped) return;
    const open = new Set<number>();
    for (const doc of docs) {
      if (!doc.file) continue;
      open.add(doc.id);
      let t = this.#tracked.get(doc.id);
      if (!t) {
        t = { doc, seen: 0, sourceWritten: false, written: false };
        this.#tracked.set(doc.id, t);
      }
      t.doc = doc;
      if (!isDirty(doc)) {
        this.#cancel(t);
        t.seen = doc.edits;
        if (t.written) this.#remove(t);
      } else if (doc.edits !== t.seen) {
        t.seen = doc.edits;
        this.#schedule(t, this.#o.delayMs ?? AUTOSAVE_DELAY_MS);
      }
    }
    for (const [id, t] of this.#tracked) {
      if (open.has(id)) continue;
      this.#cancel(t);
      if (t.written) this.#remove(t);
      this.#tracked.delete(id);
    }
  }

  /**
   * Drawing `doc` was recovered from the snapshot `from`: it is written at once, under this
   * page's session, and `from` goes once it is.
   */
  recovered(doc: number, from: string): void {
    const t = this.#tracked.get(doc);
    if (!t) return;
    t.replaces = from;
    this.#schedule(t, 0);
  }

  /** Writes every pending snapshot now (the page is going away). */
  flush(): void {
    for (const t of this.#tracked.values()) {
      if (t.timer === undefined) continue;
      this.#cancel(t);
      this.#write(t);
    }
  }

  /** Resolves once every store operation started so far has ended. */
  async idle(): Promise<void> {
    let q: Promise<void>;
    do {
      q = this.#queue;
      await q;
    } while (q !== this.#queue);
  }

  #schedule(t: Tracked, ms: number): void {
    this.#cancel(t);
    t.timer = this.#timers.set(() => {
      t.timer = undefined;
      this.#write(t);
    }, ms);
  }

  #cancel(t: Tracked): void {
    if (t.timer === undefined) return;
    this.#timers.clear(t.timer);
    t.timer = undefined;
  }

  #key(t: Tracked): string {
    return `${this.#o.session}-${t.doc.id}`;
  }

  #write(t: Tracked): void {
    const { doc } = t;
    if (!isDirty(doc) || !doc.file || !this.#tracked.has(doc.id)) return;
    const info: RecoveryInfo = {
      key: this.#key(t),
      session: this.#o.session,
      name: doc.name,
      savedAt: (this.#o.now ?? Date.now)(),
      edits: doc.edits,
    };
    // The log is read now, when the write is due, not when the edit came.
    const changes = this.#o.changesOf(doc.id);
    const bytes = doc.file.bytes;
    this.#enqueue(async () => {
      t.written = true;
      try {
        await this.#o.persistence.put(info, changes, t.sourceWritten ? undefined : bytes);
        t.sourceWritten = true;
        t.failed = false;
      } catch (e) {
        if (!t.failed) this.#o.onError?.(`Autosave of ${info.name} failed: ${reason(e)}`);
        t.failed = true;
        return;
      }
      if (t.replaces) {
        const old = t.replaces;
        delete t.replaces;
        await this.#o.persistence.remove(old).catch(() => undefined);
      }
    });
  }

  #remove(t: Tracked): void {
    const key = this.#key(t);
    t.written = false;
    t.sourceWritten = false;
    this.#enqueue(() => this.#o.persistence.remove(key).catch(() => undefined));
  }

  #enqueue(op: () => Promise<void>): void {
    this.#queue = this.#queue.then(op, op);
  }
}

/**
 * The snapshots offered for recovery on launch: those no live page holds, newest first. A
 * subscribable store for the recovery banner.
 */
export class RecoveryOffers {
  readonly #persistence: RecoveryPersistence;
  readonly #locks: SessionLocks;
  readonly #session: string;
  #offers: readonly RecoveryInfo[] = [];
  /** Snapshots recovered on this page: they stay stored a moment (`take`), never offered again. */
  readonly #taken = new Set<string>();
  readonly #listeners = new Set<() => void>();

  constructor(persistence: RecoveryPersistence, locks: SessionLocks, session: string) {
    this.#persistence = persistence;
    this.#locks = locks;
    this.#session = session;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly RecoveryInfo[] => this.#offers;

  /**
   * Lists what a page that is gone left behind; a store that cannot be read offers nothing. On
   * launch, and again for DRAWINGRECOVERY (M2-14 part 2), which shows the banner again.
   */
  async load(): Promise<void> {
    let all: RecoveryInfo[];
    let held: ReadonlySet<string> | undefined;
    try {
      [all, held] = await Promise.all([this.#persistence.list(), this.#locks.held()]);
    } catch {
      return;
    }
    this.#set(
      all
        .filter(
          (i) => i.session !== this.#session && !held?.has(i.session) && !this.#taken.has(i.key),
        )
        .sort((a, b) => b.savedAt - a.savedAt),
    );
  }

  /**
   * The snapshot `key` with its file and change log, no longer offered. It stays in the store
   * until the recovered drawing's own snapshot replaces it (`Autosaver.recovered`).
   */
  async take(key: string): Promise<RecoveryEntry | undefined> {
    this.#taken.add(key);
    this.#set(this.#offers.filter((i) => i.key !== key));
    return this.#persistence.get(key);
  }

  /** Throws the snapshot `key` away. */
  async discard(key: string): Promise<void> {
    this.#set(this.#offers.filter((i) => i.key !== key));
    await this.#persistence.remove(key);
  }

  #set(offers: readonly RecoveryInfo[]): void {
    this.#offers = offers;
    for (const l of this.#listeners) l();
  }
}
