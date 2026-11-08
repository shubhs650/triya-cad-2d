// The app shell (UI_SPEC.md §1, M1-22): title bar with the OET home button, document tabs
// (DocTabs.tsx), Report issue and Settings; the canvas area with its navigation bar; the layout
// tabs; the status bar. The ribbon, palettes and command line arrive with their own tasks.
import type { EditResult, EngineEdit, Layout, PdfDefinition } from '@triya/engine';
import { decodeRaster, type DrawnEntity, type ScreenRect } from '@triya/render';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CanvasController, type CanvasMode } from './canvas/controller';
import {
  allControllers,
  controllerOf,
  controllersOf,
  currentTile,
  register,
  setCurrentTile,
  tilesOf,
} from './canvas/registry';
import { modelTiles, type ModelTile } from './canvas/views';
import { DocTabs } from './DocTabs';
import { DocumentStore, layoutsOf, spacesOf, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import { HealthPalette } from './HealthPalette';
import { RasterImages, imageDefinitionsOf, isRasterFile } from './images';
import { LayersPalette } from './LayersPalette';
import { NavBar } from './NavBar';
import { openDrawing, openError } from './open';
import { PatternStore, indexedDbPatterns, isPatFile } from './patterns';
import { Settings } from './Settings';
import { DeviceFonts, browserFontAccess, trueTypeFontsOf } from './local-fonts';
import { FontStore, isFontFile, opfsFonts } from './user-fonts';
import { PdfPages } from './underlay/pages';
import { openPdf } from './underlay/pdfjs';
import { pendingXrefs, xrefsAnsweredBy } from './xrefs';

export const OET_HOME = 'https://openengtools.com/';
export const REPORT_ISSUE = 'https://github.com/shubhs650/triya-cad-2d/issues/new';

const store = new DocumentStore();

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
 * A dropped file: a .pat joins the hatch patterns, a .shx/.ttf/.otf the fonts, a .pdf the files
 * PDF underlays show, an image file (.png, .jpg, .bmp, .tif, .gif) the files IMAGEs show, a drawing an xref of the drawing showing is waiting for loads as that
 * xref (M1-21), anything else opens as a drawing.
 */
function dropped(files: Iterable<File>): void {
  const pats: File[] = [];
  const fontFiles: File[] = [];
  for (const f of files) {
    if (isPatFile(f.name)) pats.push(f);
    else if (isFontFile(f.name)) fontFiles.push(f);
    else if (isPdfFile(f.name))
      void f.arrayBuffer().then((b) => pdfPages.add(f.name, new Uint8Array(b)));
    else if (isRasterFile(f.name))
      void f.arrayBuffer().then((b) => images.add(f.name, new Uint8Array(b)));
    else if (!loadXref(f)) void open(fromFile(f));
  }
  addPatterns(pats);
  addFonts(fontFiles);
}

async function open(file: { readonly name: string; getFile(): Promise<Blob> }): Promise<void> {
  store.startOpening(file.name);
  try {
    const opened = await openDrawing(await file.getFile());
    if (!opened.modelSpace) throw new Error('the drawing has no model space');
    // The drawing's authoritative document goes to its engine worker (M1-67).
    engines.start(store.opened(file.name, opened, opened.modelSpace), opened.init);
    void deviceFonts.need(trueTypeFontsOf(opened.init));
  } catch (e) {
    store.failed(file.name, openError(file.name, e));
  }
}

const fromFile = (f: File) => ({ name: f.name, getFile: () => Promise.resolve(f) });

/**
 * Loads `file` into every xref of the drawing showing whose saved path names it (M1-21), as
 * AutoCAD resolves an xref found by name; false when none does, and the file opens as a drawing
 * of its own. An xref that is loaded already keeps its content (RELOAD is M5-04).
 */
function loadXref(file: File): boolean {
  const s = store.getSnapshot();
  const doc = s.docs.find((d) => d.id === s.active);
  if (!doc) return false;
  const answered = xrefsAnsweredBy(
    pendingXrefs(doc.opened.init, engines.changesOf(doc.id)),
    file.name,
  );
  if (answered.length === 0) return false;
  void (async () => {
    try {
      const opened = await openDrawing(file);
      for (const x of answered) {
        const result = await engines.edit(doc.id, {
          kind: 'xref-load',
          block: x.block,
          drawing: opened.init,
        });
        if (!result.ok) throw new Error(result.message);
      }
      await Promise.all(controllersOf(doc.id).map((c) => c.flush()));
      store.edited(doc.id);
    } catch (e) {
      store.failed(file.name, openError(file.name, e));
    }
  })();
  return true;
}

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
  /**
   * The entities drawn in a rectangle of the space on screen, CSS pixels from the canvas's
   * top-left corner: the fidelity harness names them where a golden image differs (M1-106).
   */
  entitiesIn(rect: ScreenRect): Promise<DrawnEntity[]>;
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

interface LaunchParams {
  readonly files: readonly {
    readonly kind: string;
    readonly name: string;
    getFile(): Promise<File>;
  }[];
}

export function App() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const patternState = useSyncExternalStore(patterns.subscribe, patterns.getSnapshot);
  const fontState = useSyncExternalStore(fonts.subscribe, fonts.getSnapshot);
  const [settings, setSettings] = useState(false);
  // One palette docks at a time until the palette stack (M7-03).
  const [palette, setPalette] = useState<'layers' | 'health' | undefined>();
  const togglePalette = (p: 'layers' | 'health') => setPalette((o) => (o === p ? undefined : p));
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = useCallback(() => picker.current?.click(), []);

  useEffect(() => {
    // The installed app's file handler (manifest `file_handlers`): files it was launched with.
    const queue = (window as { launchQueue?: { setConsumer(c: (p: LaunchParams) => void): void } })
      .launchQueue;
    queue?.setConsumer((p) => {
      for (const h of p.files) if (h.kind === 'file') void open(h);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        pick();
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

  const active = state.docs.find((d) => d.id === state.active);
  const [mode, setMode] = useState<CanvasMode>('none');

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
        dropped(e.dataTransfer.files);
      }}
    >
      <header className="title-bar">
        <a className="oet-home" href={OET_HOME} aria-label="Open Engineering Tools home">
          OET
        </a>
        <span className="app-name">Triya CAD 2D</span>
        <span className="badge">v{__APP_VERSION__} beta</span>
        <button type="button" className="open-button" onClick={pick}>
          Open
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
        <DocTabs store={store} state={state} />
        <a className="report" href={REPORT_ISSUE} target="_blank" rel="noreferrer">
          Report issue
        </a>
        <button type="button" className="settings-button" onClick={() => setSettings(true)}>
          Settings
        </button>
      </header>
      <Settings
        patterns={patterns}
        fonts={fonts}
        deviceFonts={deviceFonts}
        open={settings}
        onClose={() => setSettings(false)}
        onAdd={addPatterns}
        onAddFonts={addFonts}
      />

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
              <p className="privacy">Drawings never leave this device.</p>
            </div>
          )}
        </main>
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
        {active && (
          <nav className="palette-rail" aria-label="Palettes">
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
          </nav>
        )}
      </div>

      <LayoutTabs doc={active} />
      <StatusBar doc={active} />
    </div>
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
  }, [doc.block]);
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
      onCursor: (p) => showCursor(p),
      onError: (e) => store.failed(name, openError(name, e)),
      onMode: (m) => {
        if (visibleRef.current && currentTile(id, block) === index) onMode(m);
      },
      patterns: () => patterns.sources(),
      fonts: () => fonts.sources(),
      changes: () => engines.changesOf(id),
      underlays: (deliver) => pdfPages.client(pdfDefinitionsOf(opened), deliver),
      images: (deliver) =>
        images.client(() => imageDefinitionsOf(opened.init, engines.changesOf(id)), deliver),
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

function StatusBar({ doc }: { doc: OpenDocument | undefined }) {
  const coords = useRef<HTMLSpanElement>(null);
  const header = doc && new Map(doc.opened.init.header ?? []);
  const luprec = header?.get('$LUPREC');
  const digits = typeof luprec === 'number' ? Math.min(Math.max(luprec, 0), 8) : 4;
  useEffect(() => {
    showCursor = (p) => {
      if (!coords.current) return;
      coords.current.textContent = p
        ? `${p.x.toFixed(digits)}, ${p.y.toFixed(digits)}, ${(0).toFixed(digits)}`
        : '';
    };
    return () => {
      showCursor = () => {};
    };
  }, [digits]);
  return (
    <footer className="status-bar">
      <span className="coords" data-testid="coords" ref={coords} />
      <span className="spacer" />
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
