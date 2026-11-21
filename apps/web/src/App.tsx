// The app shell (UI_SPEC.md §1, M1-22): title bar with the OET home button, document tabs
// (DocTabs.tsx), Report issue and Settings; the canvas area with its navigation bar; the layout
// tabs; the command line (CommandLine.tsx, M2-02); the status bar. The ribbon and the palette
// stack arrive with their own tasks.
import type {
  ChangeSet,
  Clipboard,
  CommandInput,
  CommandOutput,
  EditResult,
  EngineEdit,
  EntityId,
  ExportScript,
  FileAction,
  Layout,
  PdfDefinition,
  GroupGrip,
  Vec2,
  ViewReply,
  ViewState,
} from '@triya/engine';
import {
  GRIP_CYCLE,
  GROUPDISPLAYMODE,
  PICKADD,
  PICKAUTO,
  PICKFIRST,
  PICKSTYLE,
  LAYEREVALCTL,
  REVCLOUDGRIPS,
  lassoPrompt,
  layerNotifyEventOf,
  type FieldEvent,
  type LayerNotifyEvent,
} from '@triya/engine';
import {
  decodeRaster,
  type DrawnEntity,
  type RefEditDisplay,
  type ScreenRect,
} from '@triya/render';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  CanvasController,
  type CanvasHooks,
  type CanvasMode,
  type PickedPoint,
} from './canvas/controller';
import { pictureOf, pngOf, type PictureSize } from './canvas/picture';
import {
  allControllers,
  controllerOf,
  controllersOf,
  currentTile,
  register,
  setCurrentTile,
  tilesOf,
  whenRegistered,
} from './canvas/registry';
import {
  answerView,
  NO_CANVAS,
  type PlotScriptRequest,
  type ViewContext,
} from './canvas/view-host';
import { selectionList } from './selection-list';
import { SelectionList } from './SelectionList';
import { CyclingBadge } from './CyclingBadge';
import { cyclingBadge } from './cycling-badge';
import { modelTiles, type ModelTile } from './canvas/views';
import { CommandLine } from './CommandLine';
import { TextEditor } from './TextEditor';
import { AnnotationScaleControls } from './AnnotationScale';
import { AttributeDialogs } from './AttributeDialogs';
import type { XrefFiles } from './XrefAttachDialog';
import type { PdfAttachFiles } from './PdfAttachDialog';
import { PlotDialog, download, plotDialog } from './PlotDialog';
import { PublishDialog, publishDialog, type BackgroundDrawings } from './PublishDialog';
import {
  appliedPageSetup,
  withPageSetup,
  defaultPlotSettings,
  plotFile,
  plotFileName,
  plotPage,
  missingUnderlaysNote,
  setPlotTransparencyOverride,
  windowBox,
  type UnderlayPageSource,
} from './plot';
import { scriptSettings, scriptSetup } from './plot-script';
import { plotSpaceOf } from './plot-spaces';
import { ExportDialog, exportDialog } from './ExportDialog';
import { ViewManager } from './ViewManager';
import { viewManager } from './view-manager';
import { layerStatesManager } from './layer-states';
import { PageSetupManager, pageSetupManager } from './PageSetupManager';
import { LayerStatesManager } from './LayerStatesManager';
import { SelectTemplateDialog } from './SelectTemplateDialog';
import {
  BUNDLED_TEMPLATES,
  newDrawingName,
  selectTemplate,
  templateById,
  templateFiles,
  userTemplates,
  type DrawingTemplate,
} from './templates';
import { underlayLayersDialog } from './underlay-layers';
import { insertLayoutsDialog, layoutFileReply } from './layout-template-files';
import { InsertLayoutsDialog } from './InsertLayoutsDialog';
import { UnderlayLayers } from './UnderlayLayers';
import { exportFile } from './export-file';
import { commandLines, variableNames } from './command-line';
import { DocTabs } from './DocTabs';
import { dynMode } from './dynamic-input';
import { drafting, type DraftingState } from './drafting';
import { selectionFilters } from './selection-filters';
import { drawingVariableReply, systemVariableReply } from './system-variables';
import { snapMenu } from './snap-menu';
import { shortcutMenu } from './shortcut-menu';
import { AppClipboard, browserClipboardEnv, clipboardPicture } from './system-clipboard';
import { SnapMenu } from './SnapMenu';
import { ShortcutMenu } from './ShortcutMenu';
import { LayoutTabs } from './LayoutTabs';
import { DraftingToggles } from './DraftingToggles';
import {
  DocumentStore,
  inLayout,
  inPaperSpace,
  isDirty,
  layoutsOf,
  spacesOf,
  tabBlock,
  viewportMaximized,
  type OpenDocument,
} from './documents';
import { engines, nextEngineWorker } from './engine/registry';
import { shownPaperViews, shownViewsChange } from './saved-views';
import { HealthPalette } from './HealthPalette';
import type { ImageAdjustPreview } from './ImageAdjustDialog';
import { RasterImages, imageDefinitionsOf, isRasterFile, objectsOf } from './images';
import {
  isPastedPictureName,
  keepPicture as keepPastedPicture,
  opfsPictures,
} from './pasted-pictures';
import { LayersPalette } from './LayersPalette';
import { PropertiesPalette } from './PropertiesPalette';
import { QuickProperties } from './QuickProperties';
import { quickRequests, selectionKey } from './quick-properties';
import { RolloverTooltip } from './RolloverTooltip';
import { hoverRollover, rollovers } from './rollover';
import { gripMenus } from './grip-menu';
import { GripMenu } from './GripMenu';
import { hatchPatternListReply, hatchPatternNames, hatchPatternReply } from './hatch-patterns';
import {
  createLinetype,
  linetypeFileReply,
  linetypeFileSources,
  type LinetypeFiles,
} from './linetype-files';
import { dockedPalette, propertySheets, type PaletteName } from './properties';
import { NavBar, namedViewsOf } from './NavBar';
import { openDrawing, openError } from './open';
import { drawingFileReply, type HeldDrawing } from './block-files';
import { pdfFileReply } from './pdf-files';
import { writeXrefFile, xrefDrawingReply, xrefFileReply } from './xref-files';
import { layerStateFileReply, writeLayerStateFile } from './layer-state-files';
import { DesignCenterPalette } from './DesignCenterPalette';
import { DESIGN_CENTER_DRAG, designCenterDrop, takeDesignCenterDrag } from './design-center';
import { writeBlockFile } from './block-file-io';
import { drawingFileModel, openDrawingModel } from './dimstyle-import';
import { EXPORT_MEDIA } from './export';
import { PatternStore, indexedDbPatterns, isPatFile } from './patterns';
import { Pwa, type ContainerLike, type InstallPromptLike } from './pwa';
import { InstallButton, OfflineStatus, UpdateBanner } from './PwaChrome';
import { RecentFiles, indexedDbRecent, type RecentHandle } from './recent';
import { RECENT_THUMBNAIL, RecentDrawings } from './RecentDrawings';
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
import { browserPictureFiles, browserSave } from './save-browser';
import { PictureFiles, pastedPicturesOf } from './picture-files';
import { PictureOfferNotice } from './PictureOffer';
import { saveChanges } from './save-changes';
import { SaveChanges } from './SaveChanges';
import { Settings } from './Settings';
import { PreferencesStore, bindPreferences, indexedDbPreferences, type Theme } from './preferences';
import { customDictionary } from './custom-dictionary';
import { editorSpelling } from './spell-check';
import { browserLocalData, clearLocalData, type ClearReport } from './local-data';
import { coordinateText, editedHeader } from './coordinates';
import { DeviceFonts, browserFontAccess, trueTypeFontsOf } from './local-fonts';
import { FontStore, isFontFile, opfsFonts } from './user-fonts';
import {
  LAYER_STATE_FILES,
  LINETYPE_FILES,
  PLOT_STYLE_FILES,
  plotStyleTablesIn,
  SupportFileStore,
  opfsSupportFiles,
} from './support-files';
import { undoStates } from './undo';
import { UndoButtons } from './UndoButtons';
import { UndoToast } from './UndoToast';
import { PdfPages, fileKey, pageSizesOf } from './underlay/pages';
import { openPdf } from './underlay/pdfjs';
import { PlotPreview } from './PlotPreview';
import { AliasEditor } from './AliasEditor';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { LayerNoticeTray, PlotNoticeDialog } from './LayerNotice';
import { alertLayers, layerNotices, plotNotice, unreconciledView } from './layer-notice';
import { aliasesOf, applyAliasFile } from './user-aliases';
import { applyKeyOverrides, onShortcuts } from './shortcuts';
import {
  lastPlotSettings,
  plotRequest,
  previewMode,
  previewOf,
  previewSettings,
} from './plot-preview';
import {
  fileNameOf,
  loadXrefFiles,
  missingFileNames,
  pathChangeLines,
  pendingXrefs,
  rasterMimeType,
  referencesOf,
  reloadAllTargets,
  type FileSource,
  type FoundFile,
  type PendingXref,
  type ReferencePathChange,
  type ReferenceRow,
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
  onWritten: (doc) => void pictureForRecent(doc.id),
});
store.subscribe(() => autosaver.update(store.getSnapshot().docs));
const recoveryOffers = new RecoveryOffers(recoveryStore, sessionLocks, session);
void recoveryOffers.load();

/** Recent drawings (M2-14, recent.ts): the start screen and the Ctrl+K palette list them. */
const recent = new RecentFiles(indexedDbRecent());
void recent.load();

/**
 * Canvases whose picture is being copied (M2-32): the copy comes from the render worker, so a
 * canvas closed meanwhile is disposed once the copy is in, or after PICTURE_WAIT_MS at most,
 * and closing a drawing never waits for its picture.
 */
const picturing = new Map<CanvasController, Promise<unknown>>();
const PICTURE_WAIT_MS = 10_000;

/** Disposes `c` now, or once the picture being copied from it is in. */
function disposeCanvas(c: CanvasController): void {
  const busy = picturing.get(c);
  if (busy) void busy.finally(() => c.dispose());
  else c.dispose();
}

/**
 * A copy of drawing `id`'s canvas as last drawn and the file handle it is listed by, for the
 * start screen (M2-32, UI_SPEC §10); undefined for a drawing with no file handle (not listed).
 */
async function takePicture(
  id: number,
): Promise<{ handle: RecentHandle; bitmap: ImageBitmap } | undefined> {
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  const handle = doc?.file?.handle;
  const controller = doc && controllerOf(doc.id, doc.block);
  if (!handle || !controller) return undefined;
  // Asked for before this returns its promise, so a drawing closing right after is copied too.
  const copy = controller.thumbnail(RECENT_THUMBNAIL).catch(() => undefined);
  const settled = Promise.race([
    copy,
    new Promise<undefined>((resolve) => setTimeout(resolve, PICTURE_WAIT_MS)),
  ]);
  picturing.set(controller, settled);
  const bitmap = await settled;
  if (picturing.get(controller) === settled) picturing.delete(controller);
  return bitmap ? { handle: handle as RecentHandle, bitmap } : undefined;
}

/** Keeps a picture taken by `takePicture` with its recent entry. */
async function keepPicture(
  picture: { handle: RecentHandle; bitmap: ImageBitmap } | undefined,
): Promise<void> {
  if (!picture) return;
  try {
    await recent.setThumbnail(picture.handle, await pngOf(picture.bitmap));
  } catch {
    // A picture is a nicety: the list works without one.
  }
}

/** Takes and keeps the start screen's picture of drawing `id` (autosave, save). */
async function pictureForRecent(id: number): Promise<void> {
  await keepPicture(await takePicture(id));
}

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
 * The Unreconciled New Layers alert (M5-19 part 4) after `event` in drawing `doc`, when its
 * LAYERNOTIFY asks for one and a layer is unreconciled: the status bar's icon and balloon.
 */
function layerNotice(doc: number, event: LayerNotifyEvent): void {
  const d = store.getSnapshot().docs.find((x) => x.id === doc);
  if (d) layerNotices.raise(doc, alertLayers(d.opened.init, engines.changesOf(doc), event));
}

/** View Unreconciled New Layers: the Layer Properties Manager on the Unreconciled New Layers node. */
function viewUnreconciled(doc: number): void {
  layerNotices.closeBalloon(doc);
  unreconciledView.request(doc);
  dockedPalette.set('layers');
}

/**
 * The layout shown is gone (LAYOUT Delete, or LAYOUT New undone; M6-01): the Model tab shows, as
 * LAYOUT Delete shows it for the layout it deletes.
 */
function showSpaceLeft(id: number): void {
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  if (!doc || doc.blockEditor || doc.refEdit !== undefined) return;
  const spaces = spacesOf(doc, engines.changesOf(id));
  if (!spaces.some((s) => s.block === doc.block)) store.showSpace(id, doc.opened.modelSpace!);
}

/** The drawing waits at `Command:`: no command runs and no prompt or dialog is up. */
function atCommand(doc: number): boolean {
  const line = commandLines.get(doc);
  return line.prompt === undefined && line.promptText === 'Command:';
}

/**
 * What each drawing's command engine says (M2-02): its command line follows it, its edits are
 * already on its canvases (Engines), the palettes re-read after an edit, and its canvases learn
 * the prompt it waits at, which makes a click a pick and draws the rubber band.
 */
engines.onCommand((doc, o) => {
  commandLines.follow(doc, o);
  if (o.type === 'change') {
    store.edited(doc);
    showSpaceLeft(doc);
  }
  // An insert alerts for unreconciled new layers (LAYERNOTIFY 32, M5-19 part 4), and -LAYER's
  // stAte Restore as it restores (LAYERNOTIFY 8, M5-25).
  if (o.type === 'commit') {
    const event = layerNotifyEventOf(o.command);
    if (event) layerNotice(doc, event);
  }
  if (o.type === 'layerNotify') layerNotice(doc, o.event);
  if (o.type === 'prompt' || o.type === 'idle' || o.type === 'waiting') {
    const prompt = commandLines.get(doc).prompt;
    for (const c of controllersOf(doc)) c.setPrompt(prompt);
  }
  if (o.type === 'preview') for (const c of controllersOf(doc)) c.setPreview(o.geometry);
  if (o.type === 'properties') propertySheets.set(doc, o.sheet);
  // A rollover tooltip's answer shows; a command starting takes it away (M2-35 part 21).
  if (o.type === 'rollover') rollovers.answer(doc, o.id, o.sheet);
  if (o.type === 'command-preview') {
    for (const c of controllersOf(doc)) c.commandPreviewed(o.seq, o.preview);
  }
  if (o.type === 'start') rollovers.clear(doc);
  // A grip's hover menu (M3-05 part 2): shown from the engine's answer, gone as a command
  // starts or the grips change.
  if (o.type === 'grip-menu') gripMenus.answer(doc, o.point, o.grip, o.items);
  if (o.type === 'cell-lock') for (const c of controllersOf(doc)) c.cellLocked(o.seq, o.lock);
  if (o.type === 'start' || o.type === 'grips') gripMenus.close(doc);
  // The Quick Access Undo and Redo buttons and the undo toast follow the history (M2-23).
  if (o.type === 'undo') undoStates.set(doc, o.state, o.action);
  // REFEDIT (M5-02 part 3): the Edit Reference bar shows while a reference is edited in place.
  if (o.type === 'refEdit') {
    store.setRefEdit(doc, o.name);
    const display = refEditDisplay(refEdits.get(doc), o);
    if (display) refEdits.set(doc, display);
    else refEdits.delete(doc);
    for (const c of controllersOf(doc)) c.setRefEdit(display);
  }
  if (o.type === 'selection') {
    selections.set(doc, o.ids);
    for (const c of controllersOf(doc)) c.setHighlight(o.ids);
  }
  if (o.type === 'grips') {
    grips.set(doc, o);
    for (const c of controllersOf(doc)) c.setGrips(o.ids, o.hot, o.groups);
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
// PLOTTRANSPARENCYOVERRIDE (M6-04 part 2): every plot follows the drafter's setting.
setPlotTransparencyOverride(drafting.get().plotTransparencyOverride);
drafting.subscribe(() => {
  setPlotTransparencyOverride(drafting.get().plotTransparencyOverride);
  for (const c of allControllers()) c.setDrafting(drafting.get());
});

/**
 * REVCLOUDGRIPS (M2-42), LAYEREVALCTL (M5-19 part 3), PICKFIRST (M2-59), PICKADD and PICKAUTO (M3-04 part 4), PICKSTYLE and
 * GROUPDISPLAYMODE (M3-13: the grips a selected group shows), per-user
 * settings each drawing's engine follows (its grips, its command line's selection): each is told
 * them when the drawing opens and whenever SETVAR or the stored settings change them.
 */
const sessionVariablesOf = (s: DraftingState) => ({
  revcloudGrips: s.revcloudGrips,
  layerEvalCtl: s.layerEvalCtl,
  pickfirst: s.pickfirst,
  pickadd: s.pickadd,
  pickauto: s.pickauto,
  pickStyle: s.pickStyle,
  groupDisplayMode: s.groupDisplayMode,
});
let sessionVariables = sessionVariablesOf(drafting.get());
function tellSessionVariables(doc: number): void {
  const { revcloudGrips, layerEvalCtl, pickfirst, pickadd, pickauto, pickStyle, groupDisplayMode } =
    sessionVariables;
  void engines.edit(doc, { kind: 'sysvar', name: REVCLOUDGRIPS, value: revcloudGrips ? 1 : 0 });
  void engines.edit(doc, { kind: 'sysvar', name: LAYEREVALCTL, value: layerEvalCtl ? 1 : 0 });
  void engines.edit(doc, { kind: 'sysvar', name: PICKFIRST, value: pickfirst ? 1 : 0 });
  void engines.edit(doc, { kind: 'sysvar', name: PICKADD, value: pickadd });
  void engines.edit(doc, { kind: 'sysvar', name: PICKAUTO, value: pickauto });
  void engines.edit(doc, { kind: 'sysvar', name: PICKSTYLE, value: pickStyle });
  void engines.edit(doc, { kind: 'sysvar', name: GROUPDISPLAYMODE, value: groupDisplayMode });
}
drafting.subscribe(() => {
  const next = sessionVariablesOf(drafting.get());
  if (JSON.stringify(next) === JSON.stringify(sessionVariables)) return;
  sessionVariables = next;
  for (const d of store.getSnapshot().docs) tellSessionVariables(d.id);
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
  selectionFilters.bind(p.filters, (filters) => preferences.update({ filters }));
  customDictionary.bind(p.customDictionary, (words) =>
    preferences.update({ customDictionary: words }),
  );
  editorSpelling.bind(p.spellCheck, (spellCheck) => preferences.update({ spellCheck }));
  if (applyAliasFile(p.aliasFile)) for (const d of store.getSnapshot().docs) tellAliases(d.id);
  applyKeyOverrides(p.keys);
});
applyAliasFile(preferences.get().aliasFile);
applyKeyOverrides(preferences.get().keys);
editorSpelling.bind(preferences.get().spellCheck, (spellCheck) =>
  preferences.update({ spellCheck }),
);

/** The user alias file's aliases (M3-10), which a drawing's command line runs over the defaults. */
function tellAliases(doc: number): void {
  void engines.edit(doc, { kind: 'aliases', aliases: aliasesOf(preferences.get().aliasFile) });
}
selectionFilters.bind(preferences.get().filters, (filters) => preferences.update({ filters }));
customDictionary.bind(preferences.get().customDictionary, (words) =>
  preferences.update({ customDictionary: words }),
);
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
/** Each drawing's reference edited in place (M5-02 part 5), for canvases made during the edit. */
const refEdits = new Map<number, RefEditDisplay>();

/**
 * The canvases' display of a reference edited in place (M5-02 part 5) after the engine's
 * `refEdit` event: the block as it was comes with an edit's first event, the working set with
 * every one; none once the edit ends.
 */
function refEditDisplay(
  was: RefEditDisplay | undefined,
  o: Extract<CommandOutput, { type: 'refEdit' }>,
): RefEditDisplay | undefined {
  if (o.name === undefined) return undefined;
  if (o.held) {
    const { block, path, order, entities } = o.held;
    return { block, path, order, held: entities, working: o.working };
  }
  return was && { ...was, working: o.working };
}
/** Each drawing's grips as its engine last showed them (M2-06), for canvases made later. */
const grips = new Map<
  number,
  {
    readonly ids: readonly EntityId[];
    readonly hot?: Vec2;
    readonly groups?: readonly GroupGrip[];
  }
>();

/** The view commands' link to a drawing's canvas: the current viewport of the space shown. */
/** A canvas's name in the drawing's view undo steps (M2-47 part 4): its space and tile. */
const viewportKey = (block: string, tile: number) => `${block}:${tile}`;

function viewContext(id: number): ViewContext {
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  const target = doc && controllerOf(doc.id, doc.block);
  return {
    target,
    all: () => (doc ? tilesOf(doc.id, doc.block).map(([, c]) => c) : []),
    views: () => (doc && target ? namedViewsOf(doc, engines.changesOf(doc.id), target.size) : []),
    viewport: (key) => {
      const at = key.lastIndexOf(':');
      const tile = Number(key.slice(at + 1));
      return tilesOf(id, key.slice(0, at)).find(([i]) => i === tile)?.[1];
    },
    file: (action, window, resume) => fileCommand(id, action, window, resume),
    plot: (r) => plotScript(id, r),
    // Properties' Pattern name (M2-35 part 3), from the library the canvases draw with.
    hatchPattern: (name, placements) => hatchPatternReply(patterns.sources(), name, placements),
    hatchPatternList: () => hatchPatternListReply(patterns.sources()),
    // -LINETYPE's files (M5-08): the bundled set and the user's .lin files.
    linetypeFile: (file) => linetypeFileReply(linetypeFiles.list(), file),
    // -LINETYPE Create (M5-08 part 4): written to the user's .lin files.
    linetypeCreate: (r) => createLinetype(linetypeFiles, r),
    // SETVAR's variables the app keeps (M2-42), and those of the drawing it tells (M2-59).
    sysvar: (name, value) =>
      (doc && drawingVariableReply(doc, name)) ?? systemVariableReply(drafting, name, value),
    // SETVAR CTAB and TILEMODE (M2-59 part 5): a tab shown, as when clicked.
    tab: (name) => {
      const block = doc && tabBlock(doc, engines.changesOf(doc.id), name);
      if (!doc || block === undefined) {
        return {
          ok: false,
          message: name === undefined ? 'The drawing has no layout.' : `No layout named "${name}".`,
        };
      }
      store.showSpace(doc.id, block);
      return { ok: true };
    },
    // BEDIT and BCLOSE (M5-02): the Block Editor shows the block, or closes.
    blockEditor: (block, name) => {
      if (block === undefined) store.closeBlockEditor(id);
      else store.openBlockEditor(id, block, name ?? '');
      return { ok: true };
    },
    clipboard: (content) => clipboardRequest(id, content),
    // Selection cycling's list (M3-04 part 3), opened by the pick in the canvas shown.
    cycle: (r) => {
      const at = target?.clientOf(r.point);
      if (!at) return Promise.resolve({ ok: false, message: NO_CANVAS });
      return selectionList.show(id, { candidates: r.candidates, at });
    },
    // ULAYERS (M2-56 part 1): the Underlay Layers dialog, waited for as VIEW waits for its own.
    underlayLayers: (r) =>
      underlayLayersDialog.show(id, {
        underlays: r.underlays,
        ...(r.current !== undefined && { current: r.current }),
      }),
    // -INSERT name=file (M5-01 part 4): a drawing open, or a file given for xrefs.
    drawingFile: (file) => drawingFileReply(file, heldDrawings()),
    // LAYOUT Template (M6-01 part 4): the Insert Layout(s) dialog, or a drawing named.
    layoutFile: (file) =>
      file === undefined ? insertLayoutsDialog.show(id) : layoutFileReply(file, heldDrawings()),
    // -XREF Attach and Overlay (M5-04 part 12): a drawing named at the command line.
    xrefFile: (file) => xrefFileByName(id, file),
    // -PDFATTACH (M5-04 part 13): a PDF named at the command line.
    pdfFile: pdfFileByName,
    // -LAYER stAte Import and EXport (M5-18 part 3): a layer state file named at the command
    // line, and the one written (layer-state-files.ts).
    layerStateFile: (file) => layerStateFileByName(id, file),
    writeLayerState: (r) =>
      writeLayerStateFile(r, {
        download: (name, bytes) => download(name, bytes, 'text/plain'),
        keep: (name, bytes) => layerStateFiles.add(name, bytes),
      }),
    // WBLOCK (M5-01 part 4): its new drawing, or the whole drawing as EXPORT's DXF, downloaded.
    writeBlock: async (r) => {
      try {
        const bytes = r.drawing ? await writeBlockFile(r.drawing) : await exportDxf(id);
        download(r.file, bytes, EXPORT_MEDIA.dxf);
        return { ok: true, file: r.file };
      } catch (e) {
        return {
          ok: false,
          message: `${r.file} was not written: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
    // REFCLOSE Save of an xref edited in place (M5-02 part 6): its file read again, and written
    // with the edits as Save writes a drawing, in place or downloaded (xref-files.ts).
    xrefDrawing: (block) => xrefDrawingReply(xrefSourceOf(id, block), openDrawing),
    writeXref: async (r) => {
      const source = xrefSourceOf(id, r.block);
      if (!source)
        return { ok: false, message: `${fileNameOf(r.file)} was not written: it is not at hand.` };
      saveEnv ??= browserSave();
      const env = saveEnv;
      const w = await writeXrefFile(source, r.changes, {
        write: (bytes, changes) => env.write(bytes, changes),
        download: (name, bytes) => download(name, bytes, EXPORT_MEDIA.dxf),
      });
      xrefSources.set(fileKey(source.name), w.source);
      // The other xrefs of the same file show what was written, as AutoCAD reloads them; the one
      // edited shows it already (its content is the edit's, in the command's undo step).
      if (w.reply.ok) void Promise.resolve().then(() => reloadOthers(id, r.block, source.name));
      return w.reply;
    },
    // -XREF Unload and Reload (M5-04), as the References palette's buttons; XATTACH's load of
    // the xref it attached (M5-04 part 6).
    xref: async (action, blocks) => ({
      ok: true,
      messages: await (action === 'unload'
        ? unloadXrefs(id, blocks)
        : action === 'attach'
          ? attachXrefs(id, blocks)
          : reloadXrefs(id, blocks)),
    }),
    // PROPERTIES and PROPERTIESCLOSE (M2-21); QUICKPROPERTIES (M2-35 part 21) shows Quick
    // Properties for the objects it left selected, whatever QPMODE says.
    palette: (name, open) => {
      if (name === 'quick') {
        if (open) quickRequests.request(id, selectionKey(selections.get(id) ?? []));
        return { ok: true };
      }
      if (open) dockedPalette.set(name);
      else if (dockedPalette.get() === name) dockedPalette.set(undefined);
      return { ok: true };
    },
  };
}

/**
 * The app's Clipboard (M2-14 part 2): what COPYCLIP, CUTCLIP or COPYBASE last put there, and the
 * drawing it came from (PASTEORIG pastes only another drawing's). Every open drawing shares it;
 * it lives as long as the page, as AutoCAD's lasts the session. It goes on the system clipboard
 * too, with a picture of the objects (M2-32 part 5), and a paste reads that first: another Triya
 * window's objects, another app's text, or another app's picture, which is kept on this device
 * and shown at once (M2-54).
 */
/** Pictures pasted from other apps, kept in this origin's private file system (M2-54). */
const pastedPictures = opfsPictures();

const appClipboard = new AppClipboard(
  browserClipboardEnv(),
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
  (bytes) =>
    keepPastedPicture(bytes, pastedPictures, (name, png) => {
      images.add(name, png);
      supplied.changed();
    }),
);

function clipboardRequest(
  id: number,
  content: Clipboard | undefined,
): ViewReply | Promise<ViewReply> {
  if (!content) return appClipboard.paste(id);
  void appClipboard.copy(id, content, () => {
    const doc = store.getSnapshot().docs.find((d) => d.id === id);
    const controller = doc && controllerOf(doc.id, doc.block);
    return controller
      ? clipboardPicture(content, (r) => controller.plot(r))
      : Promise.resolve(undefined);
  });
  return { ok: true };
}

/** The browser's save (save-browser.ts), made when first used. */
let saveEnv: SaveEnv | undefined;
/** Drawings being saved: a second Save waits for nothing and does nothing. */
const saving = new Set<number>();

/**
 * What a save writes: the drawing's change log, then the view each Model tile shows written into
 * its `*Active` VPORT (M2-29) and the view each layout shown shows into its paper-space viewport
 * (M2-47 part 1), so the drawing and each layout reopen where they were left. The views are the
 * save's only: looking around is not an edit.
 */
async function savedChanges(doc: OpenDocument): Promise<readonly ChangeSet[]> {
  // The blocks of dimensions that have none (M2-30 part 2) are the saved file's only, as the
  // views: the drawing keeps drawing them from the dimension engine. Without them the
  // dimensions are saved without a block, as they were opened.
  const blocks = await engines.blocklessDimensionBlocks(doc.id).catch(() => undefined);
  const papers = await engines
    .paperViews(doc.id, shownPaperViews(controllersOf(doc.id)))
    .catch(() => undefined);
  const log = engines.changesOf(doc.id);
  const changes = [...log, ...(blocks ? [blocks] : [])];
  const model = doc.opened.modelSpace;
  if (model !== undefined) {
    const shown = new Map(
      tilesOf(doc.id, model).map(([i, c]) => [i, { view: c.view, size: c.size }]),
    );
    const views = shownViewsChange(doc.opened.init, changes, shown);
    if (Object.keys(views).length > 0) changes.push(views);
  }
  if (papers) changes.push(papers);
  return changes;
}

/** DWGNAME of a drawing named `name`: an unsaved one is Drawing1.dxf. */
const dwgName = (name: string): string => (name === '' ? 'Drawing1.dxf' : name);

/**
 * The drawing's fields evaluated for an event (M4-10 part 3; AutoCAD 2024 Help, "FIELDEVAL"): on
 * open, under its file's name; on save, under the name it is saved as; on plot, where PlotDate
 * takes the plot's time. Not an undo step; the canvases show the new values before a plot reads
 * them, and a plot that changed a field leaves the drawing with unsaved changes.
 */
async function fieldEvent(id: number, event: FieldEvent, fileName?: string): Promise<void> {
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  if (!doc) return;
  const r = await engines
    .edit(id, { kind: 'fields', event, now: Date.now(), fileName: fileName ?? dwgName(doc.name) })
    .catch(() => undefined);
  if (!r?.ok || Object.keys(r.change).length === 0) return;
  await Promise.all(controllersOf(id).map((c) => c.flush()));
  if (event === 'plot') store.edited(id);
}

/** The navigation bar's Save view (M2-29): the view kept in the drawing, a VIEW undo step. */
async function saveView(id: number, name: string, view: ViewState): Promise<void> {
  const r = await engines.edit(id, { kind: 'view', name, view });
  if (r.ok) store.edited(id);
  else store.fail(r.message);
}

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
    const r = await saveDrawing(
      doc.name,
      doc.file,
      // The fields update for the save first (FIELDEVAL), under the name it is saved as.
      (saved) => fieldEvent(id, 'save', saved).then(() => savedChanges(doc)),
      mode,
      saveEnv,
    );
    if (r.ok) {
      store.saved(id, r.name, r.file, edits);
      layerNotice(id, 'save');
      const handle = r.file.handle;
      if (handle) void recent.add(handle as RecentHandle).then(() => pictureForRecent(id));
      // The pictures pasted from other apps go beside it, or are offered to (M2-72).
      const rows = referencesOf(doc.opened.init, engines.changesOf(id), suppliedFiles);
      void pictureFiles
        .saved(id, r.name, handle, pastedPicturesOf(rows))
        .then((note) => note && store.notify(note));
    } else if (!r.cancelled) store.fail(r.message);
    return r.ok;
  } finally {
    saving.delete(id);
  }
}

/**
 * EXPORT's DXF (M2-39 part 2): the drawing with its changes as Save writes it, handed over as a
 * file of its own; the drawing keeps its file and its unsaved changes.
 */
async function exportDxf(id: number): Promise<Uint8Array> {
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  if (!doc?.file) throw new Error('There is nothing to export.');
  saveEnv ??= browserSave();
  return saveEnv.write(doc.file.bytes, savedChanges(doc));
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
  // Closed with nothing unsaved, the start screen pictures it as it is now; closed with its
  // changes thrown away, it keeps the picture of its last autosave or save (M2-32).
  const now = store.getSnapshot().docs.find((d) => d.id === id);
  if (now && !isDirty(now)) void takePicture(id).then(keepPicture);
  if (previewMode.get()?.doc === id) previewMode.close();
  lastPlotSettings.forget(id);
  pictureFiles.forget(id);
  layerNotices.forget(id);
  store.close(id);
  engines.stop(id);
  commandLines.forget(id);
  undoStates.forget(id);
  return true;
}

/**
 * Drawings PUBLISH's Add Sheets lists that are not open (M2-45 part 2): read by the I/O worker as
 * opening one is, then opened for the publish with no tab (their engine and a hidden canvas to plot
 * from) and closed after, as AutoCAD loads the drawings it publishes and closes them. Nothing is
 * saved or remembered of them: they never show, so they have no recent entry, picture or recovery.
 */
const publishDrawings: BackgroundDrawings = {
  read: async (file) => openDrawing(new Uint8Array(await file.arrayBuffer())),
  async open(name, opened) {
    if (!opened.modelSpace) return undefined;
    const id = store.openedInBackground(name, opened, opened.modelSpace);
    engines.start(id, opened.init);
    void deviceFonts.need(trueTypeFontsOf(opened.init));
    if (!(await whenRegistered(id, opened.modelSpace))) {
      publishDrawings.close(id);
      return undefined;
    }
    return store.getSnapshot().background.find((d) => d.id === id);
  },
  close(id) {
    store.close(id);
    engines.stop(id);
    commandLines.forget(id);
    undoStates.forget(id);
  },
};

/**
 * CLOSEALL (M2-29): closes every open drawing in tab order, each asking to save its changes as
 * CLOSE does; Cancel keeps that drawing and the ones after it open, as AutoCAD's does.
 */
async function closeAll(): Promise<void> {
  for (const { id } of store.getSnapshot().docs) {
    if (!(await closeDoc(id))) return;
  }
}

/**
 * QSAVE, SAVE/SAVEAS and CLOSE typed at the command line (M2-13), DRAWINGRECOVERY (M2-14) and
 * PLOT/PRINT (M2-17), EXPORT/EXPORTPDF (M2-39 part 2).
 */
async function fileCommand(
  id: number,
  action: FileAction,
  window?: { readonly a: Vec2; readonly b: Vec2 },
  resume?: boolean,
): Promise<ViewReply> {
  if (action === 'recover') {
    // DRAWINGRECOVERY (M2-14 part 2): the recovery banner lists them again.
    await recoveryOffers.load();
    return recoveryOffers.getSnapshot().length > 0
      ? { ok: true }
      : { ok: false, message: 'There are no drawings to recover.' };
  }
  if (action === 'plot') {
    // With unreconciled new layers PLOT asks first (LAYERNOTIFY 1, M5-19 part 4): Yes shows them
    // in the Layer Properties Manager instead of plotting.
    const d = store.getSnapshot().docs.find((x) => x.id === id);
    const layers = d && !resume ? alertLayers(d.opened.init, engines.changesOf(id), 'plot') : [];
    if (layers.length > 0 && (await plotNotice.ask(layers))) {
      viewUnreconciled(id);
      return { ok: true };
    }
    // PLOT and PRINT (M2-17): the Plot dialog plots the space shown; PLOT waits for it, and
    // asks for a window's corners when it closes on Window< (part 2), then shows it again as it
    // closed, with the window when one was picked (part 3).
    const pickWindow = await plotDialog.show(id, {
      window: window && windowBox(window.a, window.b),
      resume: resume === true,
    });
    return pickWindow ? { ok: true, pickWindow: true } : { ok: true };
  }
  if (action === 'preview') return previewSpace(id);
  if (action === 'export' || action === 'exportpdf') {
    // EXPORT and EXPORTPDF (M2-39 part 2): Export Data or Save As PDF, waited for as PLOT waits
    // for its dialog, with a window's corners asked for when its Export is Window.
    const pickWindow = await exportDialog.show(id, action, {
      window: window && windowBox(window.a, window.b),
      resume: resume === true,
    });
    return pickWindow ? { ok: true, pickWindow: true } : { ok: true };
  }
  if (action === 'views') {
    // VIEW (M2-47 part 2): the View Manager, waited for as PLOT waits for its dialog, with the
    // corners asked for when the New View dialog's Define window wants them.
    // Its Edit Boundaries... (part 5) hands VIEW the selected view's window to show meanwhile.
    const pick = await viewManager.show(id, { window, resume: resume === true });
    return pick
      ? { ok: true, pickWindow: true, ...(pick.boundary && { boundary: pick.boundary }) }
      : { ok: true };
  }
  if (action === 'pagesetup') {
    // PAGESETUP (M6-01 part 3): the Page Setup Manager, waited for as PLOT waits for its dialog,
    // with the corners asked for when its Page Setup dialog's Window< wants them.
    const pickWindow = await pageSetupManager.show(id, {
      window: window && windowBox(window.a, window.b),
      resume: resume === true,
    });
    return pickWindow ? { ok: true, pickWindow: true } : { ok: true };
  }
  if (action === 'layerstates') {
    // LAYERSTATE (M5-07 part 2): the Layer States Manager, waited for until it closes.
    await layerStatesManager.show(id);
    return { ok: true };
  }
  if (action === 'publish') {
    // PUBLISH (M2-17 part 2): the Publish dialog lists the drawing's sheets.
    publishDialog.open(id);
    return { ok: true };
  }
  if (action === 'close') {
    // The engine stops with the drawing, so it hears first that the request is done.
    queueMicrotask(() => void closeDoc(id));
    return { ok: true };
  }
  if (action === 'closeall') {
    queueMicrotask(() => void closeAll());
    return { ok: true };
  }
  if (action === 'new' || action === 'qnew') {
    // NEW and QNEW (M5-10): the new drawing opens in a tab of its own, so the command ends here.
    queueMicrotask(() => (action === 'new' ? void selectNewDrawing() : quickNewDrawing()));
    return { ok: true };
  }
  if (await saveDoc(id, action)) {
    const doc = store.getSnapshot().docs.find((d) => d.id === id);
    return { ok: true, ...(doc && { file: doc.name }) };
  }
  return { ok: false, message: store.getSnapshot().error ?? 'Save cancelled.' };
}

/**
 * -PLOT (M2-17 part 5): the settings a space plots with, as the Plot dialog opens on it, and the
 * plot the command line's answers make, written as the dialog's OK writes it. "Save changes to
 * page setup" applies them to the space's page setup first, as Apply to Layout does, and the
 * plot is then what the page setup says (the plotter as answered).
 */
async function plotScript(id: number, r: PlotScriptRequest): Promise<ViewReply> {
  if (r.op === 'exportScript') return exportScript(id, r.script);
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  const active = doc && controllerOf(doc.id, doc.block);
  if (!doc || !active) return { ok: false, message: 'There is nothing to plot.' };
  const spaces = spacesOf(doc, engines.changesOf(doc.id));
  const shown = spaces.find((s) => s.block === doc.block);
  const named = r.op === 'plotSetup' ? (r.layout ?? shown?.name) : r.script.layout;
  const target = spaces.find((s) => s.name.toUpperCase() === named?.toUpperCase());
  if (!target) return { ok: false, message: `Layout "${named ?? ''}" not found.` };
  const tables = userPlotStyleTables();
  // Part 6: the named page setup -PLOT was given, if any, in place of the space's own.
  const pageSetup = r.op === 'plotSetup' ? r.pageSetup : r.script.pageSetup;
  const spaceOf = async () => {
    const own = await plotSpaceOf(doc, target.block, target.name, tables);
    // Without one, the space's own page setup, under the name its layout has applied (M2-45).
    return own && (pageSetup === undefined ? own : withPageSetup(own, pageSetup));
  };
  let space;
  try {
    space = await spaceOf();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (!space) return { ok: false, message: 'There is nothing to plot.' };
  if (r.op === 'plotSetup') {
    const names = spaces.map((s) => s.name);
    return { ok: true, plotSetup: scriptSetup(space, doc.name, names) };
  }
  try {
    let settings = scriptSettings(space, r.script.settings);
    plotPage(settings, space);
    const layout = space.pageSetup?.layout;
    if (r.script.save && layout) {
      const result = await engines.edit(id, {
        kind: 'layout',
        layout,
        plot: appliedPageSetup(settings, space),
      });
      if (!result.ok) throw new Error(result.message);
      if (Object.keys(result.change).length > 0) {
        await Promise.all(controllersOf(id).map((c) => c.flush()));
        store.edited(id);
      }
      // The layout's page setup now holds the named one's settings as answered.
      space = (await plotSpaceOf(doc, target.block, target.name, tables)) ?? space;
      settings = { ...defaultPlotSettings(space), device: settings.device };
    }
    if (!r.script.plot) return { ok: true };
    await fieldEvent(id, 'plot');
    const page = plotPage(settings, space);
    const parts = await active.plot({ block: target.block, ...plotRequest(settings, space) });
    const title = `${doc.name} - ${space.name}`;
    const underlayFile = (f: string) => pdfPages.bytes(f);
    const file = await plotFile(parts, page, settings, space, title, underlayFile, underlayPage);
    download(r.script.file, file.bytes, file.type);
    lastPlotSettings.set(id, target.block, settings);
    return { ok: true, file: r.script.file };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * -EXPORT (M2-39 part 5): the export the command line's answers make, written as the Export
 * Data dialog's Save writes it (export-file.ts), of the space shown.
 */
async function exportScript(id: number, script: ExportScript): Promise<ViewReply> {
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  const controller = doc && controllerOf(doc.id, doc.block);
  if (!doc || !controller) return { ok: false, message: 'There is nothing to export.' };
  try {
    const userTables = userPlotStyleTables();
    const space = { ...(await controller.plotSpace()), userTables };
    const { type, file, area, window, settings } = script;
    await exportFile(
      doc,
      space,
      {
        type,
        file,
        area,
        window,
        ...(settings && type !== 'dxf' && { settings: scriptSettings(space, settings) }),
        // The PDF Options chosen in Save As PDF this session (M2-60).
        pdf: exportDialog.pdfOptions(),
      },
      { underlayFile: (f) => pdfPages.bytes(f), underlayPage, userTables, exportDxf },
    );
    return { ok: true, file };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** A supplied PDF's page, for an SVG or PNG plot to draw (M2-39). */
const underlayPage: UnderlayPageSource = (f, page) => pdfPages.plotPage(f, page);

/**
 * PREVIEW (M2-18 part 2): the space shown as it would plot with the settings it last plotted or
 * previewed with, until the preview closes (its Plot button plots with those settings).
 */
async function previewSpace(id: number): Promise<ViewReply> {
  const doc = store.getSnapshot().docs.find((d) => d.id === id);
  const controller = doc && controllerOf(doc.id, doc.block);
  if (!doc || !controller) return { ok: false, message: 'There is nothing to preview.' };
  const space = { ...(await controller.plotSpace()), userTables: userPlotStyleTables() };
  const settings = previewSettings(id, doc.block, space);
  const title = `${doc.name} - ${space.name}`;
  const underlayFile = (f: string) => pdfPages.bytes(f);
  let p;
  try {
    p = await previewOf((r) => controller.plot(r), space, settings, title, underlayFile);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  lastPlotSettings.set(id, doc.block, settings);
  const { parts, page } = p;
  await previewMode.show({
    doc: id,
    title,
    pdf: p.pdf,
    paper: p.paper,
    plot: async () => {
      const file = await plotFile(parts, page, settings, space, title, underlayFile, underlayPage);
      download(plotFileName(doc.name, space, settings.device), file.bytes, file.type);
    },
  });
  return { ok: true };
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
 * matched to the drawings' IMAGEDEFs by file name and decoded once each, and the pictures pasted
 * from other apps, kept on this device (M2-54).
 */
const images = new RasterImages((bytes) => decodeRaster(bytes), {
  kept: (name) => pastedPictures.get(name),
  found: () => supplied.changed(),
});

/** What IMAGEADJUST's Image Adjust dialog previews with (M5-04 part 10). */
const imageAdjustPreview: ImageAdjustPreview = {
  pixels: (fileName) => images.pixels(fileName),
  background: () => canvasColours.model,
};

/**
 * The pasted pictures' files written beside a saved drawing, or offered to be (M2-72): the bytes
 * the images were served, else the ones kept on this device.
 */
const pictureFiles = new PictureFiles(
  async (name) => images.bytes(name) ?? (await pastedPictures.get(name)),
  () => (pictureFilesEnv ??= browserPictureFiles()),
);
let pictureFilesEnv: ReturnType<typeof browserPictureFiles> | undefined;

/**
 * The user's plot style tables and linetype files (M2-20 part 2), kept on this device for the
 * Plot dialog (M2-17 part 3) and the linetype loader (M5-08).
 */
const plotStyles = new SupportFileStore(PLOT_STYLE_FILES, opfsSupportFiles(PLOT_STYLE_FILES));
void plotStyles.load();
const linetypes = new SupportFileStore(LINETYPE_FILES, opfsSupportFiles(LINETYPE_FILES));
void linetypes.load();
/**
 * The linetype loader's files (M5-08): the bundled set and the user's; a .lin file picked in the
 * Load or Reload Linetypes dialog is kept with the user's, as Settings > Linetypes keeps one.
 */
const linetypeFiles: LinetypeFiles = {
  list: () => linetypeFileSources(linetypes),
  add: async (name, bytes) => {
    await linetypes.add(name, bytes);
    const s = linetypes.getSnapshot();
    if (s.error && !s.files.some((f) => f.name.toLowerCase() === name.toLowerCase()))
      return { error: s.error };
    return { name };
  },
};
/**
 * The user's layer state files (M5-18 part 3), which -LAYER stAte Import finds by name and
 * EXport keeps what it writes in.
 */
const layerStateFiles = new SupportFileStore(
  LAYER_STATE_FILES,
  opfsSupportFiles(LAYER_STATE_FILES),
);
void layerStateFiles.load();
const supportStores = [plotStyles, linetypes, layerStateFiles] as const;
/**
 * The user's own templates (M5-10 part 2, Settings > Templates): .dxf files kept on this device,
 * each opened by an I/O worker as it is added. Not among `supportStores`: a .dxf dropped on the
 * window opens as a drawing.
 */
const TEMPLATE_FILES = templateFiles(openDrawing);
const templates = new SupportFileStore(TEMPLATE_FILES, opfsSupportFiles(TEMPLATE_FILES));
void templates.load();
/** The user's templates as the Select Template dialog lists them, made once per store state. */
const userTemplateList = (() => {
  let state: ReturnType<SupportFileStore['getSnapshot']> | undefined;
  let list: readonly DrawingTemplate[] = [];
  return (): readonly DrawingTemplate[] => {
    const now = templates.getSnapshot();
    if (now.files !== state?.files) list = userTemplates(now.files, (n) => templates.file(n));
    state = now;
    return list;
  };
})();
/** The Select Template dialog's list: the bundled templates, then the user's. */
const templateList = (() => {
  let user: readonly DrawingTemplate[] | undefined;
  let all: readonly DrawingTemplate[] = BUNDLED_TEMPLATES;
  return (): readonly DrawingTemplate[] => {
    const now = userTemplateList();
    if (now !== user) all = [...BUNDLED_TEMPLATES, ...now];
    user = now;
    return all;
  };
})();

function addTemplates(files: Iterable<File>): void {
  for (const f of files) {
    if (!TEMPLATE_FILES.accepts(f.name)) continue;
    void f.arrayBuffer().then((b) => templates.add(f.name, new Uint8Array(b)));
  }
}
/** The plot style tables added in Settings, which the Plot dialog lists (M2-17 part 3). */
const userPlotStyleTables = () => plotStyleTablesIn(plotStyles);

/** Files for the support stores; true when one of them takes `f`. */
function addSupportFile(f: File): boolean {
  const store = supportStores.find((s) => s.kind.accepts(f.name));
  if (!store) return false;
  void f.arrayBuffer().then((b) => store.add(f.name, new Uint8Array(b)));
  return true;
}

function addSupportFiles(files: Iterable<File>): void {
  for (const f of files) addSupportFile(f);
}

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
 * A dropped file: a .pat joins the hatch patterns, a .shx/.ttf/.otf/.ttc the fonts, a .ctb/.stb
 * the plot style tables and a .lin the linetype files (M2-20 part 2), a .pdf the files
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
    else if (!addSupportFile(f)) rest.push(fromFile(f));
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
  for (const f of used) {
    if (f.handle) keep.push(f.handle);
    xrefSources.set(fileKey(f.name), f);
  }

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
      shownSources.set(key, s);
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

/**
 * An item DesignCenter dragged, dropped at window pixels `client` (M5-11): added to the drawing
 * shown, a block inserted at the point dropped on its canvas (off the canvas, only added).
 */
function designCenterDropped(client: Vec2): void {
  const drag = takeDesignCenterDrag();
  const { docs, active } = store.getSnapshot();
  const doc = docs.find((d) => d.id === active);
  if (!drag || !doc) return;
  const at = controllerOf(doc.id, doc.block)?.worldOfClient(client);
  void designCenterDrop(doc.id, drag.source, drag.category, drag.names, at && { at });
}

/**
 * The drawings -INSERT `name=file` finds by name (M5-01 part 4): those open, as their engines hold
 * them now, then the files that answered xrefs this session.
 */
function heldDrawings(): HeldDrawing[] {
  return [
    ...store.getSnapshot().docs.map((d) => ({
      name: d.name,
      model: () => openDrawingModel(d, engines.changesOf(d.id)),
    })),
    ...[...xrefSources.values()].map((f) => ({
      name: f.name,
      model: async () => drawingFileModel(await f.getFile()),
    })),
  ];
}

/**
 * The image and PDF files supplied this session, by name (M5-04 part 14): the References
 * palette's Found At, and Reload All References reads them again.
 */
const shownSources = new Map<string, Supplied>();

/**
 * The drawing files that answered xrefs this session, by name: XREF Reload reads them again (a
 * kept file handle reads the file as saved now). Kept folders are read again as well.
 */
const xrefSources = new Map<string, Supplied>();

/**
 * The drawings XATTACH's dialog picks (M5-04 part 6): Block Unit shows the file's INSUNITS, and
 * the file attached joins `xrefSources`, so the xref loads from it (and Reload reads it again).
 */
/**
 * The PDF files PDFATTACH's Attach PDF Underlay dialog lists and picks (M5-04 part 8): the pages
 * of those supplied this session, a picked one read with pdf.js, and on OK supplied as a dropped
 * one is, so its underlays draw at once.
 */
const pdfFiles: PdfAttachFiles = {
  pages: (fileName) => pdfPages.pages(fileName),
  read: async (bytes) => {
    try {
      return await pageSizesOf(await openPdf(bytes));
    } catch {
      return undefined;
    }
  },
  add: (fileName, bytes) => {
    pdfPages.add(fileName, bytes);
    supplied.changed();
  },
};

/**
 * -PDFATTACH's file named at the command line (M5-04 part 13): found among the PDFs supplied this
 * session, then the kept folders; one found in a folder is supplied as a dropped one is, so its
 * underlays draw at once.
 */
function pdfFileByName(file: string): Promise<ViewReply> {
  return pdfFileReply(file, [() => pdfPages.files(), () => referenceFiles.files()], {
    pages: pdfFiles.read,
    found: (name, bytes) => {
      if (pdfPages.has(name)) return;
      pdfPages.add(name, bytes);
      supplied.changed();
    },
  });
}

/** A drawing file's INSUNITS, unitless when it states none. */
async function drawingUnits(file: Blob): Promise<number> {
  const opened = await openDrawing(file);
  const units = new Map(opened.init.header ?? []).get('$INSUNITS');
  return typeof units === 'number' && Number.isInteger(units) && units >= 0 ? units : 0;
}

const xrefFiles: XrefFiles = {
  units: drawingUnits,
  attach: (file) => xrefSources.set(fileKey(file.name), fromFile(file)),
};

/**
 * -XREF Attach and Overlay's file named at the command line (M5-04 part 12), for drawing `doc`:
 * found among the files that answered xrefs, the other drawings open (their files as opened, as
 * AutoCAD reads an xref's saved file, so not an untitled one) and the kept folders. The one found
 * joins `xrefSources`, so the attach loads the xref from it, and Reload reads it again.
 */
function xrefFileByName(doc: number, file: string): Promise<ViewReply> {
  const docs = () => store.getSnapshot().docs;
  const self = docs().find((d) => d.id === doc);
  return xrefFileReply(
    file,
    [
      () => [...xrefSources.values()],
      () =>
        docs().flatMap((d) => {
          const bytes = d.file?.bytes;
          if (d.id === doc || d.untitled === true || !bytes) return [];
          return [{ name: d.name, getFile: () => Promise.resolve(new Blob([bytes.slice()])) }];
        }),
      () => referenceFiles.files(),
    ],
    {
      units: drawingUnits,
      found: (s) => xrefSources.set(fileKey(s.name), s),
      ...(self && self.untitled !== true && { self: self.name }),
    },
  );
}

/**
 * -LAYER stAte Import's file named at the command line (M5-18 part 3), for drawing `doc`: found
 * among the layer state files kept, the kept folders, the other drawings open (as saved) and the
 * files that answered xrefs.
 */
function layerStateFileByName(doc: number, file: string): Promise<ViewReply> {
  return layerStateFileReply(
    file,
    [
      () =>
        layerStateFiles.getSnapshot().files.flatMap((f) => {
          const bytes = layerStateFiles.file(f.name);
          return bytes
            ? [{ name: f.name, getFile: () => Promise.resolve(new Blob([bytes.slice()])) }]
            : [];
        }),
      () => referenceFiles.files(),
      () =>
        store.getSnapshot().docs.flatMap((d) => {
          const bytes = d.file?.bytes;
          if (d.id === doc || d.untitled === true || !bytes) return [];
          return [{ name: d.name, getFile: () => Promise.resolve(new Blob([bytes.slice()])) }];
        }),
      () => [...xrefSources.values()],
    ],
    { open: openDrawing },
  );
}

/** The file that answered xref `block` of drawing `doc` this session, by its path's file name. */
function xrefSourceOf(doc: number, block: string): Supplied | undefined {
  const d = store.getSnapshot().docs.find((x) => x.id === doc);
  const row = d && referencesOf(d.opened.init, engines.changesOf(doc), suppliedFiles);
  const path = row?.find((r) => r.handle === block)?.path;
  return path === undefined ? undefined : xrefSources.get(fileKey(fileNameOf(path)));
}

/**
 * After REFCLOSE wrote the file `name` for xref `block` of drawing `doc` (M5-02 part 6): every
 * other loaded xref of that file, in any open drawing, reloaded from it.
 */
async function reloadOthers(doc: number, block: string, name: string): Promise<void> {
  for (const d of store.getSnapshot().docs) {
    const blocks = referencesOf(d.opened.init, engines.changesOf(d.id), suppliedFiles)
      .filter(
        (r) =>
          (r.kind === 'attach' || r.kind === 'overlay') &&
          r.status === 'loaded' &&
          fileKey(fileNameOf(r.path)) === fileKey(name) &&
          !(d.id === doc && r.handle === block),
      )
      .map((r) => r.handle);
    if (blocks.length > 0) await reloadXrefs(d.id, blocks).catch(() => []);
  }
}

/** The name of xref `block` of drawing `doc`, for messages. */
function xrefName(doc: number, block: string): string {
  const d = store.getSnapshot().docs.find((x) => x.id === doc);
  const row = d && referencesOf(d.opened.init, engines.changesOf(doc), suppliedFiles);
  return row?.find((r) => r.handle === block)?.name ?? block;
}

/**
 * XREF Unload (M5-04): each xref's content taken out until it is reloaded. Like a load, it
 * changes what the drawing shows, not the drawing: nothing new to save. One line each.
 */
async function unloadXrefs(doc: number, blocks: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const block of blocks) {
    const name = xrefName(doc, block);
    const r = await engines.edit(doc, { kind: 'xref-unload', block });
    out.push(r.ok ? `Xref "${name}" has been unloaded.` : r.message);
  }
  await Promise.all(controllersOf(doc).map((c) => c.flush()));
  store.edited(doc, false);
  return out;
}

/**
 * XREF Reload (M5-04): each xref emptied, then loaded from the file of its name this session
 * found (dropped, picked, or in a kept folder), read again. One line each: reloaded, or not
 * found (its file is matched by name again when dropped).
 */
async function reloadXrefs(doc: number, blocks: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  const names = new Map<string, string>();
  for (const block of blocks) {
    const name = xrefName(doc, block);
    const r = await engines.edit(doc, { kind: 'xref-unload', block, reload: true });
    if (r.ok) names.set(block, name);
    else out.push(r.message);
  }
  await Promise.all(controllersOf(doc).map((c) => c.flush()));
  store.edited(doc, false);
  out.push(...(await loadFromSources(doc, names, (name) => `Xref "${name}" has been reloaded.`)));
  return out;
}

/**
 * XATTACH (M5-04 part 6): the xrefs it just made loaded from the file its dialog picked (kept in
 * `xrefSources`), with the xrefs they bring in; their loads join the command's undo step. One
 * line each, as AutoCAD's: loaded, or not found.
 */
async function attachXrefs(doc: number, blocks: readonly string[]): Promise<string[]> {
  const names = new Map(blocks.map((b) => [b, xrefName(doc, b)]));
  return loadFromSources(doc, names, (name) => `"${name}" loaded.`);
}

/**
 * Loads the waiting xrefs of drawing `doc` from the files this session found for them (dropped,
 * picked, or in a kept folder), and says for each of `names` whether it loaded.
 */
async function loadFromSources(
  doc: number,
  names: ReadonlyMap<string, string>,
  loaded: (name: string) => string,
): Promise<string[]> {
  const out: string[] = [];
  // Every file that answered an xref: the nested xrefs a load brings in wait for theirs only
  // once it is done (a grandchild that only the reloaded xref brings, M5-04 part 14). A file
  // is read only when an xref waits for it.
  supply([...xrefSources.values()], 'references');
  await referenceQueue;
  await resolveKept();
  await referenceQueue;
  const still = new Set(
    (waitingXrefs().find((w) => w.doc === doc)?.xrefs ?? []).map((x) => x.block),
  );
  for (const [block, name] of names) {
    out.push(
      still.has(block)
        ? `Xref "${name}" not found: drop its file, or the folder that holds it, on the window.`
        : loaded(name),
    );
  }
  return out;
}

/**
 * The References palette's Found At, Size and Date of `row` of drawing `doc` (M5-04 part 14):
 * the file this session found it in, or for a picture pasted from another app the copy this
 * device keeps. Undefined while the reference is not found.
 */
async function referenceFound(doc: number, row: ReferenceRow): Promise<FoundFile | undefined> {
  if (row.status === 'not-found') return undefined;
  const xref = row.kind === 'attach' || row.kind === 'overlay';
  const source = xref ? xrefSourceOf(doc, row.handle) : shownSources.get(fileKey(row.path));
  if (source) {
    const file = await source.getFile();
    return {
      foundAt: source.foundAt ?? source.name,
      size: file.size,
      ...(file instanceof File ? { modified: file.lastModified } : {}),
    };
  }
  // Read by an attach dialog (no folder the browser tells of), or a pasted picture's copy.
  const held = row.kind === 'image' ? images.bytes(row.path) : pdfPages.bytes(row.path);
  if (!held) return undefined;
  const name = fileNameOf(row.path);
  return {
    foundAt: isPastedPictureName(row.path) ? 'Kept on this device' : name,
    size: held.byteLength,
  };
}

/**
 * Reload All References (M5-04 part 14): the drawing's own xrefs reloaded from their files (and
 * with them the xrefs they bring in), and every image and PDF file read again; the references
 * still not found looked for in the kept folders. Unloaded ones stay unloaded
 * (`reloadAllTargets`). One line each.
 */
async function reloadAllReferences(doc: number): Promise<string[]> {
  const d = store.getSnapshot().docs.find((x) => x.id === doc);
  if (!d) return [];
  const rows = referencesOf(d.opened.init, engines.changesOf(doc), suppliedFiles);
  const targets = reloadAllTargets(rows);
  const out = targets.xrefs.length > 0 ? await reloadXrefs(doc, targets.xrefs) : [];
  let read = false;
  const missing: string[] = [];
  for (const path of targets.files) {
    const name = fileNameOf(path);
    const what = isPdfFile(name) ? `PDF "${name}"` : `Image "${name}"`;
    const source = shownSources.get(fileKey(path));
    if (!source) {
      // A file an attach dialog read, or a pasted picture's this device keeps, has nowhere to be
      // read again from; one not found is looked for.
      if (!(isPdfFile(name) ? pdfPages.has(path) : images.has(path))) missing.push(name);
      continue;
    }
    try {
      const bytes = new Uint8Array(await (await source.getFile()).arrayBuffer());
      if (isPdfFile(name)) pdfPages.add(source.name, bytes);
      else images.add(source.name, bytes);
      read = true;
      out.push(`${what} has been reloaded.`);
    } catch {
      out.push(`${what} could not be read again: drop its file on the window.`);
    }
  }
  if (read) supplied.changed();
  if (missing.length > 0) {
    await resolveKept();
    await referenceQueue;
    for (const name of missing) {
      const what = isPdfFile(name) ? `PDF "${name}"` : `Image "${name}"`;
      out.push(
        shownSources.has(fileKey(name))
          ? `${what} has been reloaded.`
          : `${what} not found: drop its file, or the folder that holds it, on the window.`,
      );
    }
  }
  return out;
}

/**
 * The References palette's Open (M5-04 part 14), as AutoCAD's opens a reference's file in the
 * application of its type: an xref's drawing in a tab of its own (the tab it has, when open
 * already), an image or PDF in a browser tab. Why not, or undefined.
 */
async function openReference(doc: number, row: ReferenceRow): Promise<string | undefined> {
  const name = fileNameOf(row.path);
  if (row.kind === 'image' || row.kind === 'pdf') {
    const bytes = row.kind === 'image' ? images.bytes(row.path) : pdfPages.bytes(row.path);
    if (!bytes) return `"${name}" not found: drop its file on the window.`;
    const type = row.kind === 'pdf' ? 'application/pdf' : rasterMimeType(name);
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
    // Synchronously within the click, so the browser lets the tab open.
    const tab = window.open(url, '_blank');
    // The new tab has read it by then; a blocked one never will.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return tab ? undefined : `The browser did not open "${name}": allow pop-ups for Triya.`;
  }
  const source = xrefSourceOf(doc, row.handle);
  if (!source) return `"${name}" not found: drop its file on the window.`;
  const already = store.getSnapshot().docs.find((d) => fileKey(d.name) === fileKey(source.name));
  if (already) store.activate(already.id);
  else await open(source);
  return undefined;
}

/** XREF Detach (M5-04) from the References palette: one XREF undo step. */
async function detachXrefs(doc: number, blocks: readonly string[]): Promise<string | undefined> {
  const r = await engines.edit(doc, { kind: 'xref-detach', blocks });
  if (!r.ok) return r.message;
  store.edited(doc);
  return undefined;
}

/**
 * The References palette's Saved Path, Browse... and Remove Path (M5-04 part 15): one XREF undo
 * step in the engine (`reference-path`), with the loads of the xrefs given a new path. A file
 * Browse... picked joins the files found first, so the xref loads from it (its `xref` attach
 * request) and an image or PDF draws from it. One line each.
 */
function changeReferencePaths(
  doc: number,
  changes: readonly ReferencePathChange[],
  file?: File,
): Promise<string[]> {
  const d = store.getSnapshot().docs.find((x) => x.id === doc);
  if (!d || changes.length === 0) return Promise.resolve([]);
  const rows = referencesOf(d.opened.init, engines.changesOf(doc), suppliedFiles);
  if (file) {
    const source = fromFile(file);
    if (isPdfFile(file.name) || isRasterFile(file.name)) supply([source], 'drop');
    else xrefSources.set(fileKey(file.name), source);
  }
  engines.command(doc, { kind: 'reference-path', edits: changes });
  return Promise.resolve(pathChangeLines(changes, rows));
}

/** XREF Bind (M5-04 part 2) from the References palette: one XREF undo step. */
async function bindXrefs(
  doc: number,
  blocks: readonly string[],
  insert: boolean,
): Promise<string | undefined> {
  const r = await engines.edit(doc, { kind: 'xref-bind', blocks, insert });
  if (!r.ok) return r.message;
  store.edited(doc);
  return undefined;
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
 * an xref found by name. An xref that is loaded already keeps its content (XREF Reload empties
 * it first, M5-04).
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
    // An xref attached or reloaded alerts for unreconciled new layers (LAYERNOTIFY 4).
    layerNotice(doc, 'xref');
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
  options: { readonly untitled?: boolean } = {},
): Promise<void> {
  store.startOpening(file.name);
  // Its engine worker loads while the file is read (M4-22).
  nextEngineWorker.start();
  try {
    const bytes = new Uint8Array(await (await file.getFile()).arrayBuffer());
    // The I/O worker takes its own copy: the app keeps the bytes, which every save starts from.
    const opened = await openDrawing(bytes.slice());
    if (!opened.modelSpace) throw new Error('the drawing has no model space');
    const handle = file.handle?.kind === 'file' ? (file.handle as SaveHandle) : undefined;
    const saved = drawingFile(bytes, opened.summary, handle);
    const id = store.opened(file.name, opened, opened.modelSpace, saved, recovered?.edits, options);
    // The drawing's authoritative document goes to its engine worker (M1-67).
    engines.start(id, opened.init, recovered?.changes);
    tellSessionVariables(id);
    tellAliases(id);
    void fieldEvent(id, 'open', dwgName(file.name));
    // A drawing opened with unreconciled new layers alerts for them (LAYERNOTIFY 2).
    layerNotice(id, 'open');
    // The Properties palette, docked, showed the drawing before its engine started (M2-21).
    if (dockedPalette.get() === 'properties' && store.getSnapshot().active === id)
      engines.command(id, { kind: 'properties', open: true });
    // Quick Properties too (M2-35 part 16), in the Properties palette's place.
    else if (drafting.isOn('qp') && store.getSnapshot().active === id)
      engines.command(id, { kind: 'properties', open: true, quick: true });
    if (recovered) autosaver.recovered(id, recovered.from);
    if (handle) void recent.add(handle as RecentHandle);
    void deviceFonts.need(trueTypeFontsOf(opened.init));
    void resolveKept();
  } catch (e) {
    nextEngineWorker.discard();
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

/**
 * A new drawing from `template` (NEW, QNEW; M5-10): the template's file opened as a drawing of
 * its own, Drawing<n>.dxf, untitled, so its first save is a Save As and never touches the
 * template.
 */
async function newDrawing(template: DrawingTemplate): Promise<void> {
  const { docs, opening } = store.getSnapshot();
  const name = newDrawingName([...docs.map((d) => d.name), ...opening]);
  await open(
    { name, getFile: async () => new Blob([(await template.load()) as Uint8Array<ArrayBuffer>]) },
    undefined,
    { untitled: true },
  );
}

/** NEW: the Select Template dialog, then a new drawing from the template chosen. */
async function selectNewDrawing(): Promise<void> {
  const chosen = await selectTemplate.show();
  if (chosen) await newDrawing(chosen);
}

/** QNEW: a new drawing from the default template, or NEW's dialog when none is set. */
function quickNewDrawing(): void {
  const t = templateById(preferences.get().defaultTemplate, userTemplateList());
  void (t ? newDrawing(t) : selectNewDrawing());
}

const fromFile = (f: File): Supplied => {
  const handle = droppedHandles.get(f);
  return {
    name: f.name,
    getFile: () => Promise.resolve(f),
    // A file of a folder picked in the References palette knows its path in the folder.
    foundAt: f.webkitRelativePath || f.name,
    ...(handle ? { handle } : {}),
  };
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

/**
 * The outcome of dropping plot style tables, linetype files or layer state files, while Settings
 * is closed (one state per `supportStores` entry, in its order).
 */
function SupportBanners() {
  const states = [
    useSyncExternalStore(plotStyles.subscribe, plotStyles.getSnapshot),
    useSyncExternalStore(linetypes.subscribe, linetypes.getSnapshot),
    useSyncExternalStore(layerStateFiles.subscribe, layerStateFiles.getSnapshot),
  ];
  return supportStores.map((store, i) => {
    const { error, notice } = states[i]!;
    const text = error ?? notice;
    if (!text) return null;
    return (
      <div
        key={store.kind.folder}
        className={error ? 'banner error' : 'banner'}
        role={error ? 'alert' : 'status'}
      >
        <span>{text}</span>
        <button type="button" aria-label="Dismiss" onClick={() => store.dismiss()}>
          ×
        </button>
      </div>
    );
  });
}

export function App() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const recentFiles = useSyncExternalStore(recent.subscribe, recent.getSnapshot);
  const layerColumns = useSyncExternalStore(preferences.subscribe, preferences.get).layerColumns;
  const patternState = useSyncExternalStore(patterns.subscribe, patterns.getSnapshot);
  // Properties' Pattern name offers the library the canvases draw with (M2-35 part 3).
  const patternNames = useMemo(() => hatchPatternNames(patterns.sources()), [patternState]);
  const fontState = useSyncExternalStore(fonts.subscribe, fonts.getSnapshot);
  const [settings, setSettings] = useState(false);
  const [aliasEditor, setAliasEditor] = useState(false);
  const [shortcutEditor, setShortcutEditor] = useState(false);
  const { aliasFile, keys: keyOverrides } = useSyncExternalStore(
    preferences.subscribe,
    preferences.get,
  );
  // One palette docks at a time until the palette stack (M7-03); PROPERTIES opens one too.
  const palette = useSyncExternalStore(dockedPalette.subscribe, dockedPalette.get);
  const quickOn = useSyncExternalStore(drafting.subscribe, () => drafting.isOn('qp'));
  // QUICKPROPERTIES shows Quick Properties with QPMODE off too (M2-35 part 21).
  const quickAsked = useSyncExternalStore(quickRequests.subscribe, () =>
    state.active === undefined ? false : quickRequests.get(state.active) !== undefined,
  );
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

  // The title bar's shortcut keys (M3-10 part 2, keymap.ts): Ctrl+O, Ctrl+S QSAVE and
  // Ctrl+Shift+S SAVEAS (M2-13), Ctrl+1 the Properties palette (M2-21), whatever has the focus.
  useEffect(
    () =>
      onShortcuts({
        'file:new': () => {
          void selectNewDrawing();
          return true;
        },
        'file:open': () => {
          pick();
          return true;
        },
        'file:save': () => {
          const { active } = store.getSnapshot();
          if (active !== undefined) void saveDoc(active, 'qsave');
          return true;
        },
        'file:saveas': () => {
          const { active } = store.getSnapshot();
          if (active !== undefined) void saveDoc(active, 'saveas');
          return true;
        },
        properties: () => {
          if (store.getSnapshot().active !== undefined) dockedPalette.toggle('properties');
          return true;
        },
        // Ctrl+2: DesignCenter (M5-11), as AutoCAD's ADCENTER.
        designcenter: () => {
          if (store.getSnapshot().active !== undefined) dockedPalette.toggle('designcenter');
          return true;
        },
      }),
    [pick],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc ends real-time PAN and cancels ZOOM Window, as in AutoCAD.
      if (e.key === 'Escape') {
        const { docs, active } = store.getSnapshot();
        const doc = docs.find((d) => d.id === active);
        if (doc) controllerOf(doc.id, doc.block)?.setMode('none');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  // The system variables the command line completes (M2-59 part 5): the header as edited.
  const variables = useMemo(
    () =>
      active
        ? variableNames(editedHeader(active.opened.init.header, engines.changesOf(active.id)))
        : [],
    [active, active?.revision],
  );

  return (
    <div
      className={dragging ? 'app dragging' : 'app'}
      data-testid="app"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(e) => {
        const item = e.dataTransfer.types.includes(DESIGN_CENTER_DRAG);
        if (!item && !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        // An item dragged out of DesignCenter (M5-11): added to the drawing shown, a block
        // inserted where it was dropped on the canvas.
        if (e.dataTransfer.types.includes(DESIGN_CENTER_DRAG)) {
          designCenterDropped({ x: e.clientX, y: e.clientY });
          return;
        }
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
        <button
          type="button"
          className="open-button"
          title="New drawing from the default template (QNEW)"
          onClick={quickNewDrawing}
        >
          New
        </button>
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
          onClick={() => active && engines.command(active.id, { kind: 'invoke', name: 'PLOT' })}
        >
          Plot…
        </button>
        <UndoButtons doc={active?.id} />
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
        plotStyles={plotStyles}
        linetypes={linetypes}
        layerStates={layerStateFiles}
        templates={templates}
        deviceFonts={deviceFonts}
        open={settings}
        onClose={() => setSettings(false)}
        onAdd={addPatterns}
        onAddFonts={addFonts}
        onAddFiles={addSupportFiles}
        onAddTemplates={addTemplates}
        onEditAliases={() => setAliasEditor(true)}
        onEditShortcuts={() => setShortcutEditor(true)}
      />
      {shortcutEditor && (
        <KeyboardShortcuts
          overrides={keyOverrides}
          onOk={(keys) => {
            preferences.update({ keys });
            setShortcutEditor(false);
          }}
          onCancel={() => setShortcutEditor(false)}
        />
      )}
      {aliasEditor && (
        <AliasEditor
          file={aliasFile}
          onOk={(file) => {
            preferences.update({ aliasFile: file });
            setAliasEditor(false);
          }}
          onCancel={() => setAliasEditor(false)}
        />
      )}

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
      {!settings && <SupportBanners />}
      <UndoToast states={undoStates} active={state.active} />

      <div className="workspace">
        <main className="canvas-area">
          {/* Notices that go by themselves float over the drawing: a banner in the page's flow
              made the canvas shorter while it showed, so a view set then showed more of the
              drawing once it went (M2-57). */}
          <div className="notice-region">
            {state.notice && (
              <div className="notice" role="status">
                <span>{state.notice}</span>
                <button type="button" aria-label="Dismiss" onClick={() => store.dismissNotice()}>
                  ×
                </button>
              </div>
            )}
            <PictureOfferNotice pictures={pictureFiles} onNote={(m) => store.notify(m)} />
            {state.opening.length > 0 && (
              <div className="notice" role="status">
                Opening {state.opening.join(', ')}…
              </div>
            )}
          </div>
          {state.docs.map((d) => (
            <DocumentCanvas key={d.id} doc={d} active={d.id === state.active} onMode={setMode} />
          ))}
          {state.background.map((d) => (
            <DocumentCanvas key={d.id} doc={d} active={false} onMode={setMode} />
          ))}
          {active && (
            <NavBar
              doc={active}
              changes={engines.changesOf(active.id)}
              mode={mode}
              onSaveView={(name, view) => void saveView(active.id, name, view)}
            />
          )}
          {active && palette !== 'properties' && (quickOn || quickAsked) && (
            <QuickProperties
              key={active.id}
              doc={active}
              selected={() => selections.get(active.id) ?? []}
              patternNames={patternNames}
            />
          )}
          {active && <RolloverTooltip key={active.id} doc={active.id} />}
          {active && (
            <SelectionList
              key={`cycle-${active.id}`}
              doc={active.id}
              onHover={(id) => {
                // The row's object shows highlighted with the selection, as AutoCAD's list does.
                const selected = selections.get(active.id) ?? [];
                const shown = id === undefined ? selected : [...selected, id];
                for (const c of controllersOf(active.id)) c.setHighlight(shown);
              }}
            />
          )}
          {active && <CyclingBadge doc={active.id} />}
          <PlotPreview active={state.active} />
          {state.docs.length === 0 && (
            <div className="start" data-testid="start">
              <h1>Triya CAD 2D</h1>
              <p>Start a new drawing, or open a DWG or DXF one (or drop it anywhere here).</p>
              <div className="start-actions">
                <button type="button" onClick={quickNewDrawing}>
                  New drawing
                </button>
                <button type="button" onClick={() => void selectNewDrawing()}>
                  Templates…
                </button>
                <button type="button" onClick={pick}>
                  Open drawing…
                </button>
              </div>
              <RecentDrawings entries={recentFiles} onOpen={(key) => void openRecent(key)} />
              <p className="privacy">Drawings never leave this device.</p>
            </div>
          )}
        </main>
        {active && palette === 'properties' && (
          <PropertiesPalette
            doc={active}
            onClose={() => setPalette(undefined)}
            patternNames={patternNames}
          />
        )}
        {active && palette === 'layers' && (
          <LayersPalette
            doc={active}
            store={store}
            columns={layerColumns}
            onColumns={(c) => preferences.update({ layerColumns: c })}
            onClose={() => setPalette(undefined)}
            linetypeFiles={linetypeFiles}
          />
        )}
        {active && palette === 'health' && (
          <HealthPalette
            doc={active}
            store={store}
            patternSources={patterns.sources()}
            fontStore={fonts}
            deviceFonts={deviceFonts}
            onClose={() => setPalette(undefined)}
          />
        )}
        {active && palette === 'designcenter' && (
          <DesignCenterPalette
            doc={active}
            docs={state.docs}
            onClose={() => setPalette(undefined)}
          />
        )}
        {active && palette === 'references' && (
          <ReferencesPalette
            rows={references}
            savable={(r) =>
              r.kind === 'image' && r.status === 'loaded' && isPastedPictureName(r.path)
            }
            onSaveFile={(r) =>
              void pictureFiles
                .saveOne(fileNameOf(r.path), active.file?.handle)
                .then((note) => note && store.notify(note))
            }
            waiting={waitingHandles}
            onFiles={(files) => supply(files.map(fromFile), 'references')}
            onReconnect={() => void resolveKept(true)}
            onUnload={(rows) =>
              unloadXrefs(
                active.id,
                rows.map((r) => r.handle),
              )
            }
            onReload={(rows) =>
              reloadXrefs(
                active.id,
                rows.map((r) => r.handle),
              )
            }
            onDetach={(rows) =>
              detachXrefs(
                active.id,
                rows.map((r) => r.handle),
              )
            }
            onAttachImage={() =>
              engines.command(active.id, { kind: 'invoke', name: 'IMAGEATTACH' })
            }
            onAttachDrawing={() => engines.command(active.id, { kind: 'invoke', name: 'XATTACH' })}
            onAttachPdf={() => engines.command(active.id, { kind: 'invoke', name: 'PDFATTACH' })}
            onReloadAll={() => reloadAllReferences(active.id)}
            onOpen={(row) => openReference(active.id, row)}
            onPaths={(changes, file) => changeReferencePaths(active.id, changes, file)}
            found={(row) => referenceFound(active.id, row)}
            onBind={(rows, insert) =>
              bindXrefs(
                active.id,
                rows.map((r) => r.handle),
                insert,
              )
            }
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
            <button
              type="button"
              aria-expanded={palette === 'designcenter'}
              onClick={() => togglePalette('designcenter')}
            >
              DesignCenter
            </button>
          </nav>
        )}
      </div>

      <LayoutTabs
        doc={active}
        onShow={(block) => active && store.showSpace(active.id, block)}
        onFail={(message) => store.fail(message)}
        onEdited={() => active && store.edited(active.id)}
      />
      <TextEditor
        doc={active}
        fonts={fontState.files.map((f) => f.name)}
        sources={fonts.sources()}
      />
      <AttributeDialogs
        doc={active}
        docs={state.docs}
        fonts={fontState.files.map((f) => f.name)}
        patternSources={patterns.sources()}
        onImageFile={(name, bytes) => {
          images.add(name, bytes);
          supplied.changed();
        }}
        imageAdjust={imageAdjustPreview}
        xrefFiles={xrefFiles}
        linetypeFiles={linetypeFiles}
        pdfFiles={pdfFiles}
      />
      <PlotDialog
        doc={active}
        missingUnderlays={missingUnderlaysNote(references)}
        underlayFile={(f) => pdfPages.bytes(f)}
        underlayPage={underlayPage}
        userTables={userPlotStyleTables}
        edited={(id) => store.edited(id)}
        beforePlot={(id) => fieldEvent(id, 'plot')}
      />
      <PublishDialog
        doc={active}
        docs={state.docs}
        underlayFile={(f) => pdfPages.bytes(f)}
        underlayPage={underlayPage}
        userTables={userPlotStyleTables}
        background={publishDrawings}
      />
      <ExportDialog
        doc={active}
        underlayFile={(f) => pdfPages.bytes(f)}
        underlayPage={underlayPage}
        userTables={userPlotStyleTables}
        exportDxf={exportDxf}
      />
      <ViewManager
        doc={active}
        changes={active ? engines.changesOf(active.id) : []}
        edited={(id) => store.edited(id)}
      />
      <LayerStatesManager doc={active} edited={(id) => store.edited(id)} />
      <PageSetupManager
        doc={active}
        userTables={userPlotStyleTables}
        underlayFile={(f) => pdfPages.bytes(f)}
        edited={(id) => store.edited(id)}
      />
      <TemplateChooser />
      <UnderlayLayers doc={active?.id} pdfLayers={(f) => pdfPages.layers(f)} />
      <InsertLayoutsDialog doc={active?.id} />
      <SaveChanges prompt={saveChanges} />
      <PlotNoticeDialog />
      <SnapMenu />
      <ShortcutMenu />
      <GripMenu />
      <CommandLine
        doc={active?.id}
        variables={variables}
        lines={commandLines}
        cursor={() => lastCursor}
        onSettings={() => setSettings(true)}
        onEditAliases={() => setAliasEditor(true)}
        onEditShortcuts={() => setShortcutEditor(true)}
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

/**
 * The status bar's plot preview toggle (UI_SPEC.md §6, M2-18 part 2): PREVIEW on the drawing
 * shown, or back to the drawing when the preview is showing.
 */
function PreviewToggle({ doc }: { readonly doc: number | undefined }) {
  const shown = useSyncExternalStore(previewMode.subscribe, previewMode.get);
  const on = shown !== undefined && shown.doc === doc;
  return (
    <button
      type="button"
      className="status-toggle"
      aria-pressed={on}
      disabled={doc === undefined}
      title="Plot preview (PREVIEW)"
      onClick={() => {
        if (on) previewMode.close();
        else if (doc !== undefined) engines.command(doc, { kind: 'invoke', name: 'PREVIEW' });
      }}
    >
      PREVIEW
    </button>
  );
}

/**
 * The status bar's Maximize Viewport button on a layout (AutoCAD's, M6-02 part 7): VPMAX, and
 * VPMIN while the viewport is maximized.
 */
function MaximizeViewportToggle({ doc }: { readonly doc: OpenDocument }) {
  const on = viewportMaximized(doc);
  return (
    <button
      type="button"
      className="status-toggle"
      aria-pressed={on}
      title={on ? 'Minimize Viewport (VPMIN)' : 'Maximize Viewport (VPMAX)'}
      onClick={() => engines.command(doc.id, { kind: 'invoke', name: on ? 'VPMIN' : 'VPMAX' })}
    >
      VPMAX
    </button>
  );
}

/** The world point under the cursor, written straight into the status bar (no React render). */
let showCursor: (p: { x: number; y: number } | undefined) => void = () => {};

/** The block definitions a Block Editor showed (M5-02): not spaces whose canvas is kept. */
const editorCanvases = new Set<string>();

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
  // <Current Drawing> (M5-02 part 4) is model space: its canvas, and its view, stay.
  const editing =
    doc.blockEditor?.block === doc.opened.modelSpace ? undefined : doc.blockEditor?.block;
  useEffect(() => {
    // A Block Editor's canvas goes when it closes (M5-02) or another block replaces it (part 4):
    // the next BEDIT draws the block anew.
    const spaces = (s: readonly string[]) =>
      s.filter((b) => b === editing || !editorCanvases.has(b));
    if (editing !== undefined) editorCanvases.add(editing);
    setShown((s) => (s.includes(doc.block) ? spaces(s) : [...spaces(s), doc.block]));
    // Commands draw in the space shown, as AutoCAD's current space.
    engines.command(doc.id, { kind: 'space', block: doc.block });
  }, [doc.id, doc.block, editing]);
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
 * The drawing's PDFDEFINITIONs as they are now (a pasted underlay's too, M2-32), read again only
 * when its engine has applied another change.
 */
function pdfDefinitions(
  id: number,
  opened: OpenDocument['opened'],
): () => readonly PdfDefinition[] {
  let seen: readonly unknown[] | undefined;
  let count = -1;
  let defs: readonly PdfDefinition[] = [];
  return () => {
    const changes = engines.changesOf(id);
    if (changes !== seen || changes.length !== count) {
      defs = objectsOf<PdfDefinition>(opened.init, changes, 'PDFDEFINITION');
      seen = changes;
      count = changes.length;
    }
    return defs;
  };
}

/**
 * What every canvas of a drawing draws with: the user's patterns and fonts, the edits made
 * since it opened, and the PDF and image files supplied.
 */
function drawingHooks(
  id: number,
  opened: OpenDocument['opened'],
): Pick<CanvasHooks, 'patterns' | 'fonts' | 'changes' | 'connect' | 'underlays' | 'images'> {
  return {
    patterns: () => patterns.sources(),
    fonts: () => fonts.sources(),
    changes: () => engines.changesOf(id),
    connect: () => engines.connect(id),
    underlays: (deliver, deliverSnap) =>
      pdfPages.client(pdfDefinitions(id, opened), deliver, deliverSnap),
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
        // A point prompt's click is numbered as typed input is, so the keys typed after it wait
        // for the prompt it leads to: Dynamic Input then reads them for that prompt, whose
        // rubber band starts at the point clicked (M5-22), not for the one the click answered.
        const seq = o.answer ? commandLines.send(id) : undefined;
        const pick = (p: Vec2, r?: Omit<PickedPoint, 'point'>): CommandInput => ({
          kind: 'pick',
          point: p,
          ...(o.shift && { shift: true }),
          ...(o.release && { release: true }),
          ...(r?.missed && { missed: true }),
          ...(r?.deferred && { deferred: r.deferred }),
          ...(o.grip !== undefined && { grip: o.grip }),
          ...(o.ctrl && { ctrl: true }),
          ...(o.lasso && { lasso: o.lasso }),
          ...(o.dragged && { dragged: true }),
          ...(o.freehand && { freehand: o.freehand }),
          ...(seq !== undefined && { seq }),
        });
        engines.command(
          id,
          point instanceof Promise ? point.then((r) => pick(r.point, r)) : pick(point),
        );
      },
      onDoubleClick: (point) => engines.command(id, { kind: 'double-click', point }),
      onViewport: (viewport, maximized) => store.setViewport(id, block, viewport, maximized),
      // COMMANDPREVIEW (M3-12 part 6): the engine works out what a pick here would do.
      onCommandPreview: (q) =>
        engines.command(id, {
          kind: 'command-preview',
          seq: q.seq,
          cursor: q.cursor,
          hits: q.hits,
          ...(q.shift && { shift: true }),
        }),
      // Ctrl tapped at a hot multi-functional grip (M3-05): its next function. Every canvas of
      // the drawing hears the key; the current one answers.
      onCtrlCycle: () => {
        if (visibleRef.current && currentTile(id, block) === index) {
          engines.command(id, { kind: 'answer', answer: { kind: 'keyword', keyword: GRIP_CYCLE } });
        }
      },
      onLasso: (kind) => commandLines.lasso(id, kind && lassoPrompt(kind)),
      // Selection cycling's badge by the cursor over overlapping objects (M3-04 part 7).
      onOverlap: (at) => cyclingBadge.set(id, at),
      // The lock by the cursor over a locked table cell (M4-16 part 11).
      onCellLock: (q) => engines.command(id, { kind: 'cell-lock', seq: q.seq, point: q.point }),
      // A view changed is an undo step of the drawing's (M2-47 part 4); U finds this canvas
      // again by the name given here (`viewContext`'s `viewport`).
      onViewStep: (label, view) =>
        engines.command(id, {
          kind: 'view-step',
          label,
          viewport: viewportKey(block, index),
          view,
        }),
      // ZOOM and PAN in a layout viewport made current change its own view, a drawing edit and
      // an undo step (M6-02 part 4).
      onViewportView: (viewport, view, label, join) =>
        engines.edit(id, { kind: 'viewport-view', viewport, view, label, ...(join && { join }) }),
      onSnapMenu: (at) => snapMenu.open(id, at),
      // A plain right-click (M3-05 part 5): the prompt's shortcut menu, the grip modes' options.
      onShortcutMenu: (at) => {
        const prompt = commandLines.get(id).prompt;
        const items = prompt?.shortcutMenu;
        if (!items?.length) return false;
        shortcutMenu.open(id, at, items, prompt?.shortcutMenuTitle);
        return true;
      },
      // SELECTIONPREVIEW's bit 1 (M3-04 part 5) previews at `Command:` only.
      atCommand: () => atCommand(id),
      // Rollover tooltips (M2-35 part 21): the object under a resting cursor at `Command:`.
      onRest: (at) => {
        void hoverRollover(rollovers, id, at, {
          enabled: () => drafting.get().rolloverTips,
          idle: () => atCommand(id),
          pick: (world) => c.pick(world),
          ask: (entity) => engines.command(id, { kind: 'rollover', id: entity }),
        });
        // A grip's hover menu (M3-05 part 2): the grip of the selection under the cursor.
        gripMenus.rest(id, at, {
          idle: () => atCommand(id) && (grips.get(id)?.ids.length ?? 0) > 0,
          reach: () => c.gripReach(),
          ask: (point, within) => engines.command(id, { kind: 'grip-menu', point, within }),
        });
      },
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
    const editing = refEdits.get(id);
    if (editing) c.setRefEdit(editing);
    const shown = grips.get(id);
    if (shown?.ids.length || shown?.groups?.length) c.setGrips(shown.ids, shown.hot, shown.groups);
    showCurrent(id, block, visibleRef.current);
    return () => {
      unregister();
      disposeCanvas(c);
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
  // The cursor's last point over a canvas, shown again when the units change under it.
  const cursor = useRef<{ x: number; y: number } | undefined>(undefined);
  // The header as the drawing's edits left it (M2-73): units set by SETVAR or UNITS, or undone,
  // show at once. `doc` is a new object, its `revision` one on, with every edit the log takes.
  const header = useMemo(
    () =>
      doc
        ? editedHeader(doc.opened.init.header, engines.changesOf(doc.id))
        : new Map<string, unknown>(),
    [doc],
  );
  const lwdisplay = header.get('$LWDISPLAY');
  // A layout's coordinates are in its paper space's UCS (M3-06 part 7).
  const paper = doc !== undefined && inPaperSpace(doc);
  // The drawing's units or decimal, as Settings has it (M2-20, coordinates.ts).
  const display = useSyncExternalStore(preferences.subscribe, preferences.get).coordinates;
  // LWT shows the drawing's LWDISPLAY until the drafter turns it (M2-04 part 2).
  useEffect(() => {
    drafting.setDrawingLineweights(lwdisplay === 1 || lwdisplay === true);
  }, [lwdisplay]);
  useEffect(() => {
    showCursor = (p) => {
      cursor.current = p;
      if (!coords.current) return;
      coords.current.textContent = p ? coordinateText(p, header, display, paper) : '';
    };
    showCursor(cursor.current);
    return () => {
      showCursor = () => {};
    };
  }, [header, display, paper]);
  return (
    <footer className="status-bar">
      <span className="coords" data-testid="coords" ref={coords} />
      <span className="spacer" />
      {doc && <LayerNoticeTray doc={doc} onView={() => viewUnreconciled(doc.id)} />}
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
      <PreviewToggle doc={doc?.id} />
      {doc && (
        <>
          <span className="version">{doc.opened.summary.version}</span>
          <span className="space" data-testid="space">
            {inPaperSpace(doc) ? 'PAPER' : 'MODEL'}
          </span>
          {inLayout(doc) && <MaximizeViewportToggle doc={doc} />}
          <AnnotationScaleControls doc={doc} header={header} />
        </>
      )}
    </footer>
  );
}

/** NEW's Select Template dialog (M5-10), while NEW waits for it. */
function TemplateChooser() {
  const open = useSyncExternalStore(selectTemplate.subscribe, selectTemplate.isOpen);
  const defaultId = useSyncExternalStore(
    preferences.subscribe,
    () => preferences.get().defaultTemplate,
  );
  const list = useSyncExternalStore(templates.subscribe, templateList);
  if (!open) return null;
  return (
    <SelectTemplateDialog
      templates={list}
      defaultId={defaultId}
      onDefault={(id) => preferences.update({ defaultTemplate: id })}
      onOpen={(t) => selectTemplate.close(t)}
      onCancel={() => selectTemplate.close()}
    />
  );
}
