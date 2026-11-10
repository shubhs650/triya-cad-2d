// The app shell (UI_SPEC.md §1, M1-22): title bar with the OET home button, document tabs
// (DocTabs.tsx), Report issue and Settings; the canvas area with its navigation bar; the layout
// tabs; the command line (CommandLine.tsx, M2-02); the status bar. The ribbon and the palette
// stack arrive with their own tasks.
import type {
  ChangeSet,
  Clipboard,
  CommandInput,
  EditResult,
  EngineEdit,
  EntityId,
  FileAction,
  Layout,
  PdfDefinition,
  Vec2,
  ViewReply,
} from '@triya/engine';
import { decodeRaster, type DrawnEntity, type ScreenRect } from '@triya/render';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CanvasController, type CanvasHooks, type CanvasMode } from './canvas/controller';
import { pictureOf, type PictureSize } from './canvas/picture';
import {
  allControllers,
  controllerOf,
  controllersOf,
  currentTile,
  register,
  setCurrentTile,
  tilesOf,
} from './canvas/registry';
import { answerView, type ViewContext } from './canvas/view-host';
import { modelTiles, type ModelTile } from './canvas/views';
import { CommandLine } from './CommandLine';
import { TextEditor } from './TextEditor';
import { AttributeDialogs } from './AttributeDialogs';
import { PlotDialog, plotDialog } from './PlotDialog';
import { commandLines } from './command-line';
import { DocTabs } from './DocTabs';
import { dynMode } from './dynamic-input';
import { drafting } from './drafting';
import { snapMenu } from './snap-menu';
import { SnapMenu } from './SnapMenu';
import { DraftingToggles } from './DraftingToggles';
import { DocumentStore, isDirty, layoutsOf, spacesOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import { HealthPalette } from './HealthPalette';
import { RasterImages, imageDefinitionsOf, isRasterFile } from './images';
import { LayersPalette } from './LayersPalette';
import { PropertiesPalette } from './PropertiesPalette';
import { dockedPalette, propertySheets, type PaletteName } from './properties';
import { NavBar, namedViewsOf } from './NavBar';
import { openDrawing, openError } from './open';
import { PatternStore, indexedDbPatterns, isPatFile } from './patterns';
import { Pwa, type ContainerLike, type InstallPromptLike } from './pwa';
import { InstallButton, OfflineStatus, UpdateBanner } from './PwaChrome';
import { RecentFiles, indexedDbRecent, type RecentHandle } from './recent';
import { Autosaver, RecoveryOffers } from './recovery';
import { indexedDbRecovery, webLocks } from './recovery-browser';
import { RecoveryBanner } from './RecoveryBanner';
import {
  ReferenceFiles,
  filesInEntry,
  filesInFolder,
  indexedDbHandles,
  type ReferenceHandle,
} from './reference-files';
import { ReferencesPalette } from './ReferencesPalette';
import { drawingFile, saveDrawing, type SaveEnv, type SaveHandle, type SaveMode } from './save';
import { browserSave } from './save-browser';
import { saveChanges } from './save-changes';
import { SaveChanges } from './SaveChanges';
import { Settings } from './Settings';
import { PreferencesStore, bindPreferences, indexedDbPreferences, type Theme } from './preferences';
import { browserLocalData, clearLocalData, type ClearReport } from './local-data';
import { coordinateText } from './coordinates';
import { DeviceFonts, browserFontAccess, trueTypeFontsOf } from './local-fonts';
import { FontStore, isFontFile, opfsFonts } from './user-fonts';
import { PdfPages, fileKey } from './underlay/pages';
import { openPdf } from './underlay/pdfjs';
import {
  loadXrefFiles,
  missingFileNames,
  pendingXrefs,
  referencesOf,
  type FileSource,
  type PendingXref,
  type SuppliedFiles,
} from './xrefs';

export const OET_HOME = 'https://openengtools.com/';
export const REPORT_ISSUE = 'https://github.com/shubhs650/triya-cad-2d/issues/new';

const store = new DocumentStore();

/**
 * Crash recovery (M2-14, recovery.ts): this page's session holds its lock while it lives; every
 * drawing with unsaved changes is written to IndexedDB 5 s after its last edit, and what a page
 * that is gone left behind is offered on launch.
 */
const session =
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const sessionLocks = webLocks();
sessionLocks.hold(session);
const recoveryStore = indexedDbRecovery();
const autosaver = new Autosaver({
  persistence: recoveryStore,
  session,
  changesOf: (doc) => engines.changesOf(doc),
  onError: (message) => store.fail(message),
});
store.subscribe(() => autosaver.update(store.getSnapshot().docs));
const recoveryOffers = new RecoveryOffers(recoveryStore, sessionLocks, session);
void recoveryOffers.load();

/** Recent drawings (M2-14, recent.ts): the start screen and the Ctrl+K palette list them. */
const recent = new RecentFiles(indexedDbRecent());
void recent.load();

/**
 * The service worker (M2-19, pwa.ts): offline caching and "Ready offline", the update prompt and
 * the install prompt. The dev server serves no worker, so only a production build registers one.
 * Besides the browser's own check on each page load, a long session looks for a new version
 * hourly (the update check is the one request to the origin the app makes by itself, PRD G6).
 */
const pwa = new Pwa({ reload: () => location.reload() });
const UPDATE_CHECK_MS = 60 * 60 * 1000;
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void pwa.register(navigator.serviceWorker as unknown as ContainerLike);
  setInterval(() => void pwa.checkForUpdate(), UPDATE_CHECK_MS);
}
pwa.setOnline(navigator.onLine);
addEventListener('online', () => pwa.setOnline(true));
addEventListener('offline', () => pwa.setOnline(false));
addEventListener('beforeinstallprompt', (e) => pwa.offerInstall(e as unknown as InstallPromptLike));
addEventListener('appinstalled', () => pwa.installed());

/**
 * What each drawing's command engine says (M2-02): its command line follows it, its edits are
 * already on its canvases (Engines), the palettes re-read after an edit, and its canvases learn
 * the prompt it waits at, which makes a click a pick and draws the rubber band.
 */
engines.onCommand((doc, o) => {
  commandLines.follow(doc, o);
  if (o.type === 'change') store.edited(doc);
  if (o.type === 'prompt' || o.type === 'idle') {
    const prompt = commandLines.get(doc).prompt;
    for (const c of controllersOf(doc)) c.setPrompt(prompt);
  }
  if (o.type === 'preview') for (const c of controllersOf(doc)) c.setPreview(o.geometry);
  if (o.type === 'properties') propertySheets.set(doc, o.sheet);
  if (o.type === 'selection') {
    selections.set(doc, o.ids);
    for (const c of controllersOf(doc)) c.setHighlight(o.ids);
  }
  if (o.type === 'grips') {
    grips.set(doc, o);
    for (const c of controllersOf(doc)) c.setGrips(o.ids, o.hot);
  }
  if (o.type === 'view') {
    void Promise.resolve(answerView(o.request, viewContext(doc))).then(
      (reply) => engines.command(doc, { kind: 'view', id: o.id, reply }),
      (e: unknown) =>
        engines.command(doc, {
          kind: 'view',
          id: o.id,
          reply: { ok: false, message: e instanceof Error ? e.message : String(e) },
        }),
    );
  }
});

// Every canvas applies the status bar's drafting aids as they change (M2-04).
drafting.subscribe(() => {
  for (const c of allControllers()) c.setDrafting(drafting.get());
});

/**
 * The user's settings (M2-20, preferences.ts), kept on this device: Dynamic Input and the
 * object snap settings follow them, the chrome takes the theme and every canvas its colours.
 */
const preferences = new PreferencesStore(indexedDbPreferences());
bindPreferences(preferences, drafting, dynMode);
let canvasColours = preferences.get().canvas;
function applyTheme(theme: Theme): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  // "System" follows prefers-color-scheme in the stylesheet.
  if (theme === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = theme;
  root.style.setProperty('--canvas-model', canvasColours.model);
}
applyTheme(preferences.get().theme);
preferences.subscribe(() => {
  const p = preferences.get();
  if (JSON.stringify(p.canvas) !== JSON.stringify(canvasColours)) {
    canvasColours = p.canvas;
    for (const c of allControllers()) c.setColours(canvasColours);
  }
  applyTheme(p.theme);
});
void preferences.load();

/** Set while "Clear all local data" reloads the page, so leaving it asks nothing. */
let clearing = false;

/**
 * "Clear all local data" (M2-20, local-data.ts): autosave stops first so it cannot write a
 * snapshot back, then everything on the device goes and the page starts afresh. A database
 * another Triya tab keeps open is reported instead.
 */
async function clearAllLocalData(): Promise<ClearReport> {
  clearing = true;
  autosaver.stop();
  const report = await clearLocalData(browserLocalData());
  if (report.failed.length === 0) globalThis.location.reload();
  return report;
}

/** Each drawing's selected objects (M2-03), for canvases made after the selection changed. */
const selections = new Map<number, readonly EntityId[]>();
/** Each drawing's grips as its engine last showed them (M2-06), for canvases made later. */
const grips = new Map<number, { readonly ids: readonly EntityId[]; readonly hot?: Vec2 }>();

/** The view commands' link to a drawing's canvas: the current viewport of the space shown. */
function viewContext(id: number): ViewContext {
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  const target = doc && controllerOf(doc.id, doc.block);
  return {
    target,
    all: () => (doc ? tilesOf(doc.id, doc.block).map(([, c]) => c) : []),
    views: () => (doc && target ? namedViewsOf(doc, target.size) : []),
    save: (name, view) => doc && store.saveView(doc.id, name, view),
    file: (action) => fileCommand(id, action),
    clipboard: (content) => clipboardRequest(id, content),
    // PROPERTIES and PROPERTIESCLOSE (M2-21).
    palette: (name, open) => {
      if (open) dockedPalette.set(name);
      else if (dockedPalette.get() === name) dockedPalette.set(undefined);
      return { ok: true };
    },
  };
}

/**
 * The app's Clipboard (M2-14 part 2): what COPYCLIP, CUTCLIP or COPYBASE last put there, and the
 * drawing it came from (PASTEORIG pastes only another drawing's). Every open drawing shares it;
 * it lives as long as the page, as AutoCAD's lasts the session.
 */
let clipboard: { readonly doc: number; readonly content: Clipboard } | undefined;

function clipboardRequest(id: number, content: Clipboard | undefined): ViewReply {
  if (content) {
    clipboard = { doc: id, content };
    return { ok: true };
  }
  if (!clipboard) return { ok: true };
  return { ok: true, clipboard: clipboard.content, sameDrawing: clipboard.doc === id };
}

/** The browser's save (save-browser.ts), made when first used. */
let saveEnv: SaveEnv | undefined;
/** Drawings being saved: a second Save waits for nothing and does nothing. */
const saving = new Set<number>();

/**
 * Saves a drawing (M2-13): QSAVE in place where it can, else Save As (save.ts). Resolves true
 * once the drawing is saved; a refusal shows in the error banner.
 */
async function saveDoc(id: number, mode: SaveMode): Promise<boolean> {
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  if (!doc?.file || saving.has(id)) return false;
  saving.add(id);
  try {
    // Edits made while the save runs are not in it.
    const edits = doc.edits;
    saveEnv ??= browserSave();
    const r = await saveDrawing(doc.name, doc.file, engines.changesOf(id), mode, saveEnv);
    if (r.ok) {
      store.saved(id, r.name, r.file, edits);
      if (r.file.handle) void recent.add(r.file.handle as RecentHandle);
    } else if (!r.cancelled) store.fail(r.message);
    return r.ok;
  } finally {
    saving.delete(id);
  }
}

/**
 * Closes a drawing (the tab's ×, CLOSE): one with unsaved changes asks "Save changes to …?"
 * first, as AutoCAD does; Yes closes it only once it is saved. Resolves true when it closed.
 */
async function closeDoc(id: number): Promise<boolean> {
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  if (!doc) return false;
  if (isDirty(doc)) {
    const answer = await saveChanges.ask(doc.name);
    if (answer === 'cancel') return false;
    if (answer === 'yes' && !(await saveDoc(id, 'qsave'))) return false;
  }
  store.close(id);
  engines.stop(id);
  commandLines.forget(id);
  return true;
}

/**
 * QSAVE, SAVE/SAVEAS and CLOSE typed at the command line (M2-13), DRAWINGRECOVERY (M2-14) and
 * PLOT/PRINT (M2-17).
 */
async function fileCommand(id: number, action: FileAction): Promise<ViewReply> {
  if (action === 'recover') {
    // DRAWINGRECOVERY (M2-14 part 2): the recovery banner lists them again.
    await recoveryOffers.load();
    return recoveryOffers.getSnapshot().length > 0
      ? { ok: true }
      : { ok: false, message: 'There are no drawings to recover.' };
  }
  if (action === 'plot') {
    // PLOT and PRINT (M2-17): the Plot dialog plots the space shown.
    plotDialog.open(id);
    return { ok: true };
  }
  if (action === 'close') {
    // The engine stops with the drawing, so it hears first that the request is done.
    queueMicrotask(() => void closeDoc(id));
    return { ok: true };
  }
  if (await saveDoc(id, action)) {
    const doc = store.getSnapshot().docs.find((d) => d.id === id);
    return { ok: true, ...(doc && { file: doc.name }) };
  }
  return { ok: false, message: store.getSnapshot().error ?? 'Save cancelled.' };
}

/** The last world point the cursor was at on a canvas: direct distance entry aims at it. */
let lastCursor: { x: number; y: number } | undefined;

/** The user's .pat files (M1-50), read back from this device and handed to every renderer. */
const patterns = new PatternStore(indexedDbPatterns());
void patterns.load();
let patternSources = patterns.sources();
patterns.subscribe(() => {
  if (patterns.sources() === patternSources) return;
  patternSources = patterns.sources();
  for (const c of allControllers()) c.setPatterns(patternSources);
});

function addPatterns(files: Iterable<File>): void {
  for (const f of files) void f.text().then((text) => patterns.add(f.name, text));
}

/**
 * The user's font files (M1-38 TrueType/OpenType, M1-37 SHX), read back from this device and
 * handed to every renderer with the bundled fonts.
 */
const fonts = new FontStore(opfsFonts());
void fonts.load();
let fontSources = fonts.sources();
fonts.subscribe(() => {
  if (fonts.sources() === fontSources) return;
  fontSources = fonts.sources();
  for (const c of allControllers()) c.setFonts(fontSources);
});

/**
 * Fonts installed on this computer (M1-38 part 2): used once the browser's permission is
 * granted, for the TrueType fonts open drawings name, after the user's own files.
 */
const deviceFonts = new DeviceFonts(browserFontAccess());
void deviceFonts.init();
deviceFonts.subscribe(() => fonts.setDeviceFonts(deviceFonts.files()));

/**
 * The PDF files PDF underlays show (M1-20): dropped on the window this session, matched to the
 * drawings' PDFDEFINITIONs by file name. pdf.js loads with the first page a canvas asks for.
 */
const pdfPages = new PdfPages(openPdf);

const isPdfFile = (name: string) => /\.pdf$/i.test(name);

/**
 * The image files raster IMAGEs show (M1-19 part 3): dropped on the window this session,
 * matched to the drawings' IMAGEDEFs by file name and decoded once each.
 */
const images = new RasterImages((bytes) => decodeRaster(bytes));

const pdfDefinitionsOf = (opened: OpenDocument['opened']): PdfDefinition[] =>
  (opened.init.objects ?? []).filter((o): o is PdfDefinition => o.type === 'PDFDEFINITION');

function addFonts(files: Iterable<File>): void {
  for (const f of files) {
    void f.arrayBuffer().then((b) => fonts.add(f.name, new Uint8Array(b)));
  }
}

/**
 * Which image and PDF files were supplied, for the References palette and the status bar,
 * which follow `supplied.version` (M1-21).
 */
const supplied = {
  version: 0,
  listeners: new Set<() => void>(),
  subscribe(listener: () => void): () => void {
    supplied.listeners.add(listener);
    return () => supplied.listeners.delete(listener);
  },
  changed(): void {
    supplied.version++;
    for (const l of supplied.listeners) l();
  },
};
const suppliedFiles: SuppliedFiles = {
  image: (f) => images.has(f),
  pdf: (f) => pdfPages.has(f),
};

/**
 * The files and folders the user gave for references (M1-21), kept on this device so a drawing
 * that names one of their files later is resolved without asking.
 */
const referenceFiles = new ReferenceFiles(indexedDbHandles());
void referenceFiles.load();

/** A file the user supplied, with the handle to keep it by when the browser gave one. */
type Supplied = FileSource & { readonly handle?: ReferenceHandle };

/**
 * A dropped file: a .pat joins the hatch patterns, a .shx/.ttf/.otf the fonts, a .pdf the files
 * PDF underlays show, an image file (.png, .jpg, .bmp, .tif, .gif) the files IMAGEs show, a
 * drawing an xref of an open drawing is waiting for loads as that xref (M1-21), anything else
 * opens as a drawing. A dropped folder's files answer references only.
 */
function dropped(files: Iterable<File>, folders: readonly Supplied[] = []): void {
  const pats: File[] = [];
  const fontFiles: File[] = [];
  const rest: Supplied[] = [];
  for (const f of files) {
    if (isPatFile(f.name)) pats.push(f);
    else if (isFontFile(f.name)) fontFiles.push(f);
    else rest.push(fromFile(f));
  }
  addPatterns(pats);
  addFonts(fontFiles);
  supply(rest, 'drop');
  if (folders.length) supply(folders, 'references');
}

/** The items of a drop, read while the drop event lasts (the browser empties them after). */
interface DropItem {
  readonly file: File | null;
  readonly handle: Promise<ReferenceHandle | null> | undefined;
  readonly entry: FileSystemEntry | null;
}

function dropItems(data: DataTransfer): DropItem[] {
  return [...data.items]
    .filter((i) => i.kind === 'file')
    .map((i) => ({
      file: i.getAsFile(),
      handle: (
        i as { getAsFileSystemHandle?(): Promise<ReferenceHandle | null> }
      ).getAsFileSystemHandle?.(),
      entry: i.webkitGetAsEntry?.() ?? null,
    }));
}

/** Files and folders dropped on the window: folders are kept, and their files answer references. */
async function droppedItems(items: readonly DropItem[]): Promise<void> {
  const files: File[] = [];
  const folders: Supplied[] = [];
  const kept: ReferenceHandle[] = [];
  for (const item of items) {
    const handle = await item.handle?.catch(() => null);
    if (handle?.kind === 'directory') {
      kept.push(handle);
      folders.push(...(await filesInFolder(handle).catch(() => [])));
    } else if (item.entry?.isDirectory) {
      folders.push(...(await filesInEntry(item.entry as FileSystemDirectoryEntry).catch(() => [])));
    } else if (item.file) {
      files.push(item.file);
      if (handle?.kind === 'file') droppedHandles.set(item.file, handle);
    }
  }
  if (kept.length) void referenceFiles.remember(kept);
  dropped(files, folders);
}

/** The handles of dropped files, kept when the file answers a reference. */
const droppedHandles = new WeakMap<Blob, ReferenceHandle>();

/** Reference loads run one at a time, so two drops never load an xref twice. */
let referenceQueue: Promise<void> = Promise.resolve();

/**
 * Supplied files: images and PDFs join the files their definitions show, drawings load into the
 * xrefs of open drawings waiting for them (nested ones too), and with `drop` the drawings no
 * xref waits for open as drawings; with `references` (a folder, the References palette's
 * pickers, kept handles) files no reference names are left alone.
 */
function supply(sources: readonly Supplied[], mode: 'drop' | 'references'): void {
  if (sources.length === 0) return;
  referenceQueue = referenceQueue.then(() => supplyNow(sources, mode)).catch(() => {});
}

async function supplyNow(sources: readonly Supplied[], mode: 'drop' | 'references'): Promise<void> {
  const isShown = (s: Supplied) => isPdfFile(s.name) || isRasterFile(s.name);
  const drawings = sources.filter((s) => !isShown(s));
  const keep: ReferenceHandle[] = [];
  // Xrefs first: the images and PDFs a loaded xref shows are named by what it brings in.
  const parsed = new Map<Supplied, ReturnType<typeof openDrawing>>();
  const used = await loadXrefFiles(drawings, waitingXrefs, async (doc, xrefs, file) => {
    if (!parsed.has(file)) parsed.set(file, file.getFile().then(openDrawing));
    await loadXrefs(doc, xrefs, file.name, parsed.get(file)!);
  });
  for (const f of used) if (f.handle) keep.push(f.handle);

  const named = mode === 'references' ? referencedFileKeys() : undefined;
  let added = false;
  for (const s of sources.filter(isShown)) {
    const pdf = isPdfFile(s.name);
    const key = fileKey(s.name);
    if (named && (!named.has(key) || (pdf ? pdfPages.has(key) : images.has(key)))) continue;
    try {
      const bytes = new Uint8Array(await (await s.getFile()).arrayBuffer());
      if (pdf) pdfPages.add(s.name, bytes);
      else images.add(s.name, bytes);
      added = true;
      if (s.handle) keep.push(s.handle);
    } catch {
      // A file that cannot be read now is not found.
    }
  }
  if (added) supplied.changed();
  if (keep.length) void referenceFiles.remember(keep);
  if (mode === 'drop') {
    for (const d of drawings) if (!used.has(d)) void open(d);
    // What the loads brought in may be in a kept folder.
    if (used.size) void resolveKept();
  }
}

/** The xrefs every open drawing is waiting for. */
function waitingXrefs(): { doc: number; xrefs: PendingXref[] }[] {
  return store
    .getSnapshot()
    .docs.map((d) => ({ doc: d.id, xrefs: pendingXrefs(d.opened.init, engines.changesOf(d.id)) }));
}

/** The image and PDF file names the open drawings' definitions name. */
function referencedFileKeys(): Set<string> {
  const out = new Set<string>();
  for (const d of store.getSnapshot().docs) {
    for (const r of referencesOf(d.opened.init, engines.changesOf(d.id), suppliedFiles)) {
      if (r.kind === 'image' || r.kind === 'pdf') out.add(fileKey(r.path));
    }
  }
  return out;
}

/**
 * Loads a drawing into xrefs of open drawing `doc` that name it (M1-21), as AutoCAD resolves
 * an xref found by name. An xref that is loaded already keeps its content (RELOAD is M5-04).
 */
async function loadXrefs(
  doc: number,
  xrefs: readonly PendingXref[],
  name: string,
  drawing: ReturnType<typeof openDrawing>,
): Promise<void> {
  try {
    const opened = await drawing;
    for (const x of xrefs) {
      const result = await engines.edit(doc, {
        kind: 'xref-load',
        block: x.block,
        drawing: opened.init,
      });
      if (!result.ok) throw new Error(result.message);
    }
    await Promise.all(controllersOf(doc).map((c) => c.flush()));
    // An xref shows another file: the drawing itself has no new changes to save.
    store.edited(doc, false);
  } catch (e) {
    store.failed(name, openError(name, e));
    throw e;
  }
}

/**
 * Reads the kept files and folders the browser allows without asking, for references the open
 * drawings still miss; with `ask` (Reconnect) the browser asks for the others first.
 */
async function resolveKept(ask = false): Promise<void> {
  const missing = store
    .getSnapshot()
    .docs.some(
      (d) =>
        missingFileNames(referencesOf(d.opened.init, engines.changesOf(d.id), suppliedFiles))
          .length,
    );
  if (!missing && !ask) return;
  supply(await referenceFiles.files(ask), 'references');
}

/** A drawing recovered after a crash (M2-14): its last session's change log, replayed. */
interface Recovered {
  readonly changes: readonly ChangeSet[];
  readonly edits: number;
  /** The snapshot it came from, removed once its own is written. */
  readonly from: string;
}

async function open(
  file: {
    readonly name: string;
    getFile(): Promise<Blob>;
    readonly handle?: { readonly kind: string };
  },
  recovered?: Recovered,
): Promise<void> {
  store.startOpening(file.name);
  try {
    const bytes = new Uint8Array(await (await file.getFile()).arrayBuffer());
    // The I/O worker takes its own copy: the app keeps the bytes, which every save starts from.
    const opened = await openDrawing(bytes.slice());
    if (!opened.modelSpace) throw new Error('the drawing has no model space');
    const handle = file.handle?.kind === 'file' ? (file.handle as SaveHandle) : undefined;
    const saved = drawingFile(bytes, opened.summary, handle);
    const id = store.opened(file.name, opened, opened.modelSpace, saved, recovered?.edits);
    // The drawing's authoritative document goes to its engine worker (M1-67).
    engines.start(id, opened.init, recovered?.changes);
    // The Properties palette, docked, showed the drawing before its engine started (M2-21).
    if (dockedPalette.get() === 'properties' && store.getSnapshot().active === id)
      engines.command(id, { kind: 'properties', open: true });
    if (recovered) autosaver.recovered(id, recovered.from);
    if (handle) void recent.add(handle as RecentHandle);
    void deviceFonts.need(trueTypeFontsOf(opened.init));
    void resolveKept();
  } catch (e) {
    store.failed(file.name, openError(file.name, e));
  }
}

/**
 * Opens an unsaved drawing a page that is gone left behind (the recovery banner's Recover): the
 * file as that page opened it, with its change log replayed. It has no file handle, so its
 * first Save is a Save As, and its tab shows unsaved changes.
 */
async function recover(key: string): Promise<void> {
  const entry = await recoveryOffers.take(key).catch(() => undefined);
  if (!entry) {
    store.fail('The unsaved drawing could not be read back from this device.');
    return;
  }
  const bytes = entry.bytes;
  await open(
    {
      name: entry.name,
      getFile: () => Promise.resolve(new Blob([bytes as Uint8Array<ArrayBuffer>])),
    },
    { changes: entry.changes, edits: entry.edits, from: entry.key },
  );
}

/** Opens a recent drawing through its file handle (the start screen, the Ctrl+K palette). */
async function openRecent(key: string): Promise<void> {
  const r = await recent.open(key);
  if (!r.ok) store.fail(r.message);
  else void open({ name: r.handle.name, getFile: () => Promise.resolve(r.file), handle: r.handle });
}

const fromFile = (f: File): Supplied => {
  const handle = droppedHandles.get(f);
  return { name: f.name, getFile: () => Promise.resolve(f), ...(handle ? { handle } : {}) };
};

/**
 * The browser tests' front end to the showing drawing's engine, on the dev server only (Vite
 * drops it from the production build): edits with no command or dialog yet, such as the layout
 * edits LAYOUT Rename and PAGESETUP will send (M6), go through the same `engines.edit` path a
 * palette's do (M1-97).
 */
export interface DevHooks {
  /** The showing drawing's layouts as they are now. */
  layouts(): Layout[];
  /** PDF underlay pages drawn by pdf.js so far (M1-20: the cache spares repeats). */
  pdfRenders(): number;
  edit(edit: EngineEdit): Promise<EditResult>;
  /** Every change the showing drawing's engine applied since it opened (commands', M2-02). */
  changes(): readonly ChangeSet[];
  /**
   * The entities drawn in a rectangle of the space on screen, CSS pixels from the canvas's
   * top-left corner: the fidelity harness names them where a golden image differs (M1-106).
   */
  entitiesIn(rect: ScreenRect): Promise<DrawnEntity[]>;
  /** The showing drawing's selected objects (M2-03), as its command engine last said. */
  selection(): readonly EntityId[];
}

if (import.meta.env.DEV) {
  const showing = () => {
    const s = store.getSnapshot();
    return s.docs.find((d) => d.id === s.active);
  };
  const hooks: DevHooks = {
    layouts: () => {
      const doc = showing();
      return doc ? layoutsOf(doc.opened.init, engines.changesOf(doc.id)) : [];
    },
    pdfRenders: () => pdfPages.renders,
    changes: () => {
      const doc = showing();
      return doc ? engines.changesOf(doc.id) : [];
    },
    selection: () => {
      const doc = showing();
      return (doc && selections.get(doc.id)) ?? [];
    },
    entitiesIn: async (rect) => {
      const doc = showing();
      return (doc && (await controllerOf(doc.id, doc.block)?.entitiesIn(rect))) ?? [];
    },
    edit: async (edit) => {
      const doc = showing();
      if (!doc) return { ok: false, message: 'No drawing is open.' };
      const result = await engines.edit(doc.id, edit);
      if (result.ok) {
        await Promise.all(controllersOf(doc.id).map((c) => c.flush()));
        store.edited(doc.id);
      }
      return result;
    },
  };
  (window as { triyaDev?: DevHooks }).triyaDev = hooks;
}

/** How long a save's note shows. */
const NOTICE_MS = 4000;

/** Drawings, as the open picker filters them. */
const DRAWING_TYPE = {
  description: 'Drawings (*.dwg, *.dxf)',
  accept: { 'application/acad': ['.dwg', '.dxf'] },
};

interface OpenPickerWindow {
  showOpenFilePicker?(o: {
    multiple: boolean;
    types: (typeof DRAWING_TYPE)[];
    excludeAcceptAllOption: boolean;
  }): Promise<(SaveHandle & { getFile(): Promise<File> })[]>;
}

interface LaunchParams {
  readonly files: readonly {
    readonly kind: string;
    readonly name: string;
    getFile(): Promise<File>;
  }[];
}

export function App() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const recentFiles = useSyncExternalStore(recent.subscribe, recent.getSnapshot);
  const patternState = useSyncExternalStore(patterns.subscribe, patterns.getSnapshot);
  const fontState = useSyncExternalStore(fonts.subscribe, fonts.getSnapshot);
  const [settings, setSettings] = useState(false);
  // One palette docks at a time until the palette stack (M7-03); PROPERTIES opens one too.
  const palette = useSyncExternalStore(dockedPalette.subscribe, dockedPalette.get);
  const setPalette = (p: PaletteName | undefined) => dockedPalette.set(p);
  const togglePalette = (p: PaletteName) => dockedPalette.toggle(p);
  const suppliedVersion = useSyncExternalStore(supplied.subscribe, () => supplied.version);
  const waitingHandles = useSyncExternalStore(referenceFiles.subscribe, referenceFiles.waiting);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = useCallback(() => {
    // Chromium's open picker hands back file handles, so Save can write the file in place
    // (M2-13); elsewhere the file input.
    const showOpen = (window as OpenPickerWindow).showOpenFilePicker;
    if (!showOpen) return picker.current?.click();
    showOpen
      .call(window, { multiple: true, types: [DRAWING_TYPE], excludeAcceptAllOption: false })
      .then(
        (handles) => {
          for (const h of handles)
            void open({ name: h.name, getFile: () => h.getFile(), handle: h });
        },
        () => undefined, // dismissed
      );
  }, []);

  useEffect(() => {
    // The installed app's file handler (manifest `file_handlers`): files it was launched with.
    const queue = (window as { launchQueue?: { setConsumer(c: (p: LaunchParams) => void): void } })
      .launchQueue;
    queue?.setConsumer((p) => {
      for (const h of p.files)
        if (h.kind === 'file') void open({ name: h.name, getFile: () => h.getFile(), handle: h });
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        pick();
      }
      // Ctrl+S QSAVE, Ctrl+Shift+S SAVEAS (M2-13), whatever has the focus.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const { active } = store.getSnapshot();
        if (active !== undefined) void saveDoc(active, e.shiftKey ? 'saveas' : 'qsave');
      }
      // Ctrl+P opens the Plot dialog (PLOT, M2-17), as in AutoCAD.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const { active } = store.getSnapshot();
        if (active !== undefined) plotDialog.open(active);
      }
      // Ctrl+1 opens or closes the Properties palette (PROPERTIES, M2-21), as in AutoCAD.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '1') {
        e.preventDefault();
        if (store.getSnapshot().active !== undefined) dockedPalette.toggle('properties');
      }
      // Esc ends real-time PAN and cancels ZOOM Window, as in AutoCAD.
      if (e.key === 'Escape') {
        const { docs, active } = store.getSnapshot();
        const doc = docs.find((d) => d.id === active);
        if (doc) controllerOf(doc.id, doc.block)?.setMode('none');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);

  useEffect(() => {
    // A page going away writes the snapshots still waiting for their 5 s (M2-14).
    const onHide = () => autosaver.flush();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  useEffect(() => {
    // Leaving the page with unsaved changes asks first, as closing a drawing does (M2-13).
    const onLeave = (e: BeforeUnloadEvent) => {
      if (clearing || !store.getSnapshot().docs.some(isDirty)) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  useEffect(() => {
    // A save's note goes after a while; an error stays until dismissed.
    if (!state.notice) return;
    const t = setTimeout(() => store.dismissNotice(), NOTICE_MS);
    return () => clearTimeout(t);
  }, [state.notice]);

  const active = state.docs.find((d) => d.id === state.active);
  const [mode, setMode] = useState<CanvasMode>('none');
  // The showing drawing's references as they are now: its revision moves with every load.
  const references = useMemo(
    () =>
      active ? referencesOf(active.opened.init, engines.changesOf(active.id), suppliedFiles) : [],
    [active, active?.revision, suppliedVersion],
  );
  const missingReferences = references.filter((r) => r.status === 'not-found').length;

  return (
    <div
      className={dragging ? 'app dragging' : 'app'}
      data-testid="app"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const items = dropItems(e.dataTransfer);
        // A drop with no items list (some synthetic drops) still has its files.
        if (items.length) void droppedItems(items);
        else dropped(e.dataTransfer.files);
      }}
    >
      <header className="title-bar">
        <a className="oet-home" href={OET_HOME} aria-label="Open Engineering Tools home">
          OET
        </a>
        <span className="app-name">Triya CAD 2D</span>
        <span className="badge">v{__APP_VERSION__} beta</span>
        <OfflineStatus pwa={pwa} />
        <button type="button" className="open-button" onClick={pick} aria-keyshortcuts="Control+O">
          Open
        </button>
        <button
          type="button"
          className="save-button"
          disabled={!active?.file}
          aria-keyshortcuts="Control+S"
          onClick={() => active && void saveDoc(active.id, 'qsave')}
        >
          Save
        </button>
        <button
          type="button"
          className="save-as-button"
          disabled={!active?.file}
          aria-keyshortcuts="Control+Shift+S"
          onClick={() => active && void saveDoc(active.id, 'saveas')}
        >
          Save As…
        </button>
        <button
          type="button"
          className="plot-button"
          disabled={!active}
          aria-keyshortcuts="Control+P"
          onClick={() => active && plotDialog.open(active.id)}
        >
          Plot…
        </button>
        <input
          ref={picker}
          type="file"
          accept=".dwg,.dxf"
          multiple
          hidden
          onChange={(e) => {
            for (const f of e.currentTarget.files ?? []) void open(fromFile(f));
            e.currentTarget.value = '';
          }}
        />
        <DocTabs
          store={store}
          state={state}
          picture={picture}
          onClose={(id) => void closeDoc(id)}
        />
        <a className="report" href={REPORT_ISSUE} target="_blank" rel="noreferrer">
          Report issue
        </a>
        <InstallButton pwa={pwa} />
        <button type="button" className="settings-button" onClick={() => setSettings(true)}>
          Settings
        </button>
      </header>
      <Settings
        preferences={preferences}
        onClearAll={clearAllLocalData}
        patterns={patterns}
        fonts={fonts}
        deviceFonts={deviceFonts}
        open={settings}
        onClose={() => setSettings(false)}
        onAdd={addPatterns}
        onAddFonts={addFonts}
      />

      <UpdateBanner pwa={pwa} />
      <RecoveryBanner offers={recoveryOffers} onRecover={(key) => void recover(key)} />
      {state.error && (
        <div className="banner error" role="alert">
          <span>{state.error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => store.dismissError()}>
            ×
          </button>
        </div>
      )}
      {!settings && patternState.error && (
        <div className="banner error" role="alert">
          <span>{patternState.error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => patterns.dismiss()}>
            ×
          </button>
        </div>
      )}
      {!settings && patternState.notice && (
        <div className="banner" role="status">
          <span>{patternState.notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => patterns.dismiss()}>
            ×
          </button>
        </div>
      )}
      {!settings && fontState.error && (
        <div className="banner error" role="alert">
          <span>{fontState.error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => fonts.dismiss()}>
            ×
          </button>
        </div>
      )}
      {!settings && fontState.notice && (
        <div className="banner" role="status">
          <span>{fontState.notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => fonts.dismiss()}>
            ×
          </button>
        </div>
      )}
      {state.notice && (
        <div className="banner" role="status">
          <span>{state.notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => store.dismissNotice()}>
            ×
          </button>
        </div>
      )}
      {state.opening.length > 0 && (
        <div className="banner" role="status">
          Opening {state.opening.join(', ')}…
        </div>
      )}

      <div className="workspace">
        <main className="canvas-area">
          {state.docs.map((d) => (
            <DocumentCanvas key={d.id} doc={d} active={d.id === state.active} onMode={setMode} />
          ))}
          {active && <NavBar doc={active} store={store} mode={mode} />}
          {state.docs.length === 0 && (
            <div className="start" data-testid="start">
              <h1>Triya CAD 2D</h1>
              <p>Open a DWG or DXF drawing, or drop one anywhere on this window.</p>
              <button type="button" onClick={pick}>
                Open drawing…
              </button>
              {recentFiles.length > 0 && (
                <section className="recent" aria-label="Recent drawings">
                  <h2>Recent drawings</h2>
                  <ul>
                    {recentFiles.map((r) => (
                      <li key={r.key}>
                        <button
                          type="button"
                          title={`Opened ${new Date(r.openedAt).toLocaleString()}`}
                          onClick={() => void openRecent(r.key)}
                        >
                          {r.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="privacy">Drawings never leave this device.</p>
            </div>
          )}
        </main>
        {active && palette === 'properties' && (
          <PropertiesPalette doc={active} onClose={() => setPalette(undefined)} />
        )}
        {active && palette === 'layers' && (
          <LayersPalette doc={active} store={store} onClose={() => setPalette(undefined)} />
        )}
        {active && palette === 'health' && (
          <HealthPalette
            doc={active}
            patternSources={patterns.sources()}
            fontStore={fonts}
            deviceFonts={deviceFonts}
            onClose={() => setPalette(undefined)}
          />
        )}
        {active && palette === 'references' && (
          <ReferencesPalette
            rows={references}
            waiting={waitingHandles}
            onFiles={(files) => supply(files.map(fromFile), 'references')}
            onReconnect={() => void resolveKept(true)}
            onClose={() => setPalette(undefined)}
          />
        )}
        {active && (
          <nav className="palette-rail" aria-label="Palettes">
            <button
              type="button"
              aria-expanded={palette === 'properties'}
              onClick={() => togglePalette('properties')}
            >
              Properties
            </button>
            <button
              type="button"
              aria-expanded={palette === 'layers'}
              onClick={() => togglePalette('layers')}
            >
              Layers
            </button>
            <button
              type="button"
              aria-expanded={palette === 'health'}
              onClick={() => togglePalette('health')}
            >
              Health
            </button>
            <button
              type="button"
              aria-expanded={palette === 'references'}
              onClick={() => togglePalette('references')}
            >
              References
            </button>
          </nav>
        )}
      </div>

      <LayoutTabs doc={active} />
      <TextEditor
        doc={active}
        fonts={fontState.files.map((f) => f.name)}
        sources={fonts.sources()}
      />
      <AttributeDialogs doc={active} />
      <PlotDialog doc={active} />
      <SaveChanges prompt={saveChanges} />
      <SnapMenu />
      <CommandLine
        doc={active?.id}
        lines={commandLines}
        cursor={() => lastCursor}
        onSettings={() => setSettings(true)}
        recent={recentFiles}
        onOpenRecent={(key) => void openRecent(key)}
      />
      <StatusBar
        doc={active}
        missingReferences={missingReferences}
        onReferences={() => setPalette('references')}
      />
    </div>
  );
}

/** The status bar's Dynamic Input toggle (DYNMODE; F12 toggles it too). */
function DynToggle() {
  const on = useSyncExternalStore(dynMode.subscribe, dynMode.get);
  return (
    <button
      type="button"
      className="status-toggle"
      aria-pressed={on}
      title="Dynamic Input (F12)"
      onClick={() => dynMode.toggle()}
    >
      DYN
    </button>
  );
}

/** The world point under the cursor, written straight into the status bar (no React render). */
let showCursor: (p: { x: number; y: number } | undefined) => void = () => {};

/** One container per space of the document shown so far; the space on screen is visible. */
function DocumentCanvas({
  doc,
  active,
  onMode,
}: {
  doc: OpenDocument;
  active: boolean;
  onMode: (m: CanvasMode) => void;
}) {
  const [shown, setShown] = useState<readonly string[]>([doc.block]);
  useEffect(() => {
    setShown((s) => (s.includes(doc.block) ? s : [...s, doc.block]));
    // Commands draw in the space shown, as AutoCAD's current space.
    engines.command(doc.id, { kind: 'space', block: doc.block });
  }, [doc.id, doc.block]);
  return (
    <div id={`doc-${doc.id}`} role="tabpanel" className="doc-canvas" hidden={!active}>
      {shown.map((block) => (
        <SpaceCanvas
          key={block}
          doc={doc}
          block={block}
          visible={active && block === doc.block}
          onMode={onMode}
        />
      ))}
    </div>
  );
}

/**
 * One space's canvas, or in a model space saved with tiled viewports (several `*Active`
 * VPORTs) one canvas per viewport, each in its part of the area (M1-22 part 4).
 */
function SpaceCanvas({
  doc,
  block,
  visible,
  onMode,
}: {
  doc: OpenDocument;
  block: string;
  visible: boolean;
  onMode: (m: CanvasMode) => void;
}) {
  const { id, opened } = doc;
  const tiles = useMemo(
    () => (block === opened.modelSpace ? modelTiles(opened.init.tables?.vports) : [undefined]),
    [block, opened],
  );
  const tiled = tiles.length > 1;
  // Runs after the viewports' own effects, so every controller exists by now.
  useEffect(() => {
    showCurrent(id, block, visible);
    // Leaving a space ends its PAN or ZOOM Window, so the bar never shows a stale mode.
    if (!visible) for (const [, c] of tilesOf(id, block)) c.setMode('none');
  }, [id, block, visible]);
  return (
    <div className={tiled ? 'space-canvas tiled' : 'space-canvas'} hidden={!visible}>
      {tiles.map((tile, index) => (
        <ViewportCanvas
          key={index}
          doc={doc}
          block={block}
          visible={visible}
          onMode={onMode}
          index={index}
          tile={tiled ? tile : undefined}
          count={tiles.length}
        />
      ))}
    </div>
  );
}

/**
 * What every canvas of a drawing draws with: the user's patterns and fonts, the edits made
 * since it opened, and the PDF and image files supplied.
 */
function drawingHooks(
  id: number,
  opened: OpenDocument['opened'],
): Pick<CanvasHooks, 'patterns' | 'fonts' | 'changes' | 'underlays' | 'images'> {
  return {
    patterns: () => patterns.sources(),
    fonts: () => fonts.sources(),
    changes: () => engines.changesOf(id),
    underlays: (deliver, deliverSnap) =>
      pdfPages.client(pdfDefinitionsOf(opened), deliver, deliverSnap),
    images: (deliver) =>
      images.client(() => imageDefinitionsOf(opened.init, engines.changesOf(id)), deliver),
  };
}

/**
 * A picture of a space not shown yet, for the document tab preview (M1-22 close-out): a
 * canvas made only for it, at the drawing area's size so the space is framed as it would
 * open there.
 */
function picture(
  doc: OpenDocument,
  block: string,
  max: PictureSize,
  cancelled: () => boolean,
): Promise<ImageBitmap | undefined> {
  const area = document.querySelector('.canvas-area')?.getBoundingClientRect();
  return pictureOf(
    (container) =>
      new CanvasController(container, doc.opened, block, {
        ...drawingHooks(doc.id, doc.opened),
        onCursor: () => undefined,
        // A picture that fails keeps its stand-in; the drawing itself is not at fault.
        onError: () => undefined,
      }),
    { width: Math.round(area?.width ?? 0), height: Math.round(area?.height ?? 0) },
    max,
    cancelled,
  );
}

/** Marks the canvas on screen: the current viewport of the space shown. */
function showCurrent(doc: number, block: string, visible: boolean): void {
  const current = currentTile(doc, block);
  for (const [i, c] of tilesOf(doc, block)) {
    c.canvas.dataset['active'] = String(visible && i === current);
  }
}

/**
 * Makes a tiled viewport current, as a click in it does in AutoCAD: the one it replaces ends
 * its PAN or ZOOM Window, and the navigation bar shows the new one's mode.
 */
function activateTile(
  doc: number,
  block: string,
  tile: number,
  onMode: (m: CanvasMode) => void,
): void {
  const previous = controllerOf(doc, block);
  setCurrentTile(doc, block, tile);
  previous?.setMode('none');
  showCurrent(doc, block, true);
  onMode(controllerOf(doc, block)?.mode ?? 'none');
}

function ViewportCanvas({
  doc,
  block,
  visible,
  onMode,
  index,
  tile,
  count,
}: {
  doc: OpenDocument;
  block: string;
  visible: boolean;
  onMode: (m: CanvasMode) => void;
  index: number;
  tile: ModelTile | undefined;
  count: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { id, name, opened } = doc;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    const c = new CanvasController(ref.current!, opened, block, {
      ...drawingHooks(id, opened),
      onCursor: (p) => {
        if (p) lastCursor = p;
        showCursor(p);
      },
      onError: (e) => store.failed(name, openError(name, e)),
      onPick: (point, o) => {
        const pick = (p: Vec2, missed = false): CommandInput => ({
          kind: 'pick',
          point: p,
          ...(o.shift && { shift: true }),
          ...(o.release && { release: true }),
          ...(missed && { missed: true }),
          ...(o.grip !== undefined && { grip: o.grip }),
        });
        engines.command(
          id,
          point instanceof Promise ? point.then((r) => pick(r.point, r.missed)) : pick(point),
        );
      },
      onDoubleClick: (point) => engines.command(id, { kind: 'double-click', point }),
      onSnapMenu: (at) => snapMenu.open(id, at),
      onMode: (m) => {
        if (visibleRef.current && currentTile(id, block) === index) onMode(m);
      },
      ...(tile && {
        tile: {
          vport: tile.vport,
          label: `Model viewport ${index + 1} of ${count}`,
          isCurrent: () => currentTile(id, block) === index,
          activate: () => activateTile(id, block, index, onMode),
        },
      }),
    });
    const unregister = register(id, block, c, index);
    c.setColours(canvasColours);
    c.setDrafting(drafting.get());
    c.setPrompt(commandLines.get(id).prompt);
    const selected = selections.get(id);
    if (selected?.length) c.setHighlight(selected);
    const shown = grips.get(id);
    if (shown?.ids.length) c.setGrips(shown.ids, shown.hot);
    showCurrent(id, block, visibleRef.current);
    return () => {
      unregister();
      c.dispose();
    };
  }, [id, name, opened, block, onMode, index, tile, count]);
  const r = tile?.rect;
  return (
    <div
      ref={ref}
      className="viewport-tile"
      style={
        r && {
          left: `${r.left * 100}%`,
          top: `${r.top * 100}%`,
          width: `${r.width * 100}%`,
          height: `${r.height * 100}%`,
        }
      }
    />
  );
}

/** Model, then the layouts in tab order (DXF 71). */
function LayoutTabs({ doc }: { doc: OpenDocument | undefined }) {
  if (!doc) return <nav className="layout-tabs" aria-label="Layouts" />;
  const tabs = spacesOf(doc, engines.changesOf(doc.id));
  return (
    <nav className="layout-tabs" aria-label="Layouts">
      <div role="tablist" aria-label="Model and layouts">
        {tabs.map((t) => (
          <button
            key={t.block}
            type="button"
            role="tab"
            className="layout-tab"
            aria-selected={t.block === doc.block}
            onClick={() => store.showSpace(doc.id, t.block)}
          >
            {t.name}
          </button>
        ))}
      </div>
    </nav>
  );
}

function StatusBar({
  doc,
  missingReferences,
  onReferences,
}: {
  doc: OpenDocument | undefined;
  /** References of the drawing whose files are not found (M1-21). */
  missingReferences: number;
  onReferences: () => void;
}) {
  const coords = useRef<HTMLSpanElement>(null);
  const header = useMemo(() => new Map<string, unknown>(doc?.opened.init.header ?? []), [doc]);
  const lwdisplay = header.get('$LWDISPLAY');
  // The drawing's units or decimal, as Settings has it (M2-20, coordinates.ts).
  const display = useSyncExternalStore(preferences.subscribe, preferences.get).coordinates;
  // LWT shows the drawing's LWDISPLAY until the drafter turns it (M2-04 part 2).
  useEffect(() => {
    drafting.setDrawingLineweights(lwdisplay === 1 || lwdisplay === true);
  }, [lwdisplay]);
  useEffect(() => {
    showCursor = (p) => {
      if (!coords.current) return;
      coords.current.textContent = p ? coordinateText(p, header, display) : '';
    };
    return () => {
      showCursor = () => {};
    };
  }, [header, display]);
  return (
    <footer className="status-bar">
      <span className="coords" data-testid="coords" ref={coords} />
      <span className="spacer" />
      {doc && missingReferences > 0 && (
        // AutoCAD's tray icon and balloon: "Some xrefs could not be found".
        <button type="button" className="references-alert" onClick={onReferences}>
          {missingReferences === 1
            ? '1 reference not found'
            : `${missingReferences} references not found`}
        </button>
      )}
      <DraftingToggles />
      <DynToggle />
      {doc && (
        <>
          <span className="version">{doc.opened.summary.version}</span>
          <span className="space" data-testid="space">
            {doc.block === doc.opened.modelSpace ? 'MODEL' : 'PAPER'}
          </span>
        </>
      )}
    </footer>
  );
}
