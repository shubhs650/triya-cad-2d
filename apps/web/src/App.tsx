// The app shell (UI_SPEC.md §1, M1-22): title bar with the OET home button, document tabs,
// Report issue and Settings; the canvas area with its navigation bar; the layout tabs; the status bar. The
// ribbon, palettes and command line arrive with their own tasks.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CanvasController, type CanvasMode } from './canvas/controller';
import { allControllers, controllerOf, register } from './canvas/registry';
import { DocumentStore, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import { LayersPalette } from './LayersPalette';
import { NavBar } from './NavBar';
import { openDrawing, openError } from './open';
import { PatternStore, indexedDbPatterns, isPatFile } from './patterns';
import { Settings } from './Settings';
import { FontStore, isFontFile, opfsFonts } from './user-fonts';

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

function addFonts(files: Iterable<File>): void {
  for (const f of files) {
    void f.arrayBuffer().then((b) => fonts.add(f.name, new Uint8Array(b)));
  }
}

/**
 * A dropped file: a .pat joins the hatch patterns, a .shx/.ttf/.otf the fonts, anything else
 * opens as a drawing.
 */
function dropped(files: Iterable<File>): void {
  const pats: File[] = [];
  const fontFiles: File[] = [];
  for (const f of files) {
    if (isPatFile(f.name)) pats.push(f);
    else if (isFontFile(f.name)) fontFiles.push(f);
    else void open(fromFile(f));
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
  } catch (e) {
    store.failed(file.name, openError(file.name, e));
  }
}

const fromFile = (f: File) => ({ name: f.name, getFile: () => Promise.resolve(f) });

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
  const [layersOpen, setLayersOpen] = useState(false);
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
        <div className="doc-tabs" role="tablist" aria-label="Open drawings">
          {state.docs.map((d) => (
            <div key={d.id} className="doc-tab" data-active={d.id === state.active}>
              <button
                type="button"
                role="tab"
                aria-selected={d.id === state.active}
                aria-controls={`doc-${d.id}`}
                onClick={() => store.activate(d.id)}
              >
                {d.name}
              </button>
              <button
                type="button"
                className="close"
                aria-label={`Close ${d.name}`}
                onClick={() => {
                  store.close(d.id);
                  engines.stop(d.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
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
        {active && layersOpen && (
          <LayersPalette doc={active} store={store} onClose={() => setLayersOpen(false)} />
        )}
        {active && (
          <nav className="palette-rail" aria-label="Palettes">
            <button
              type="button"
              aria-expanded={layersOpen}
              onClick={() => setLayersOpen((o) => !o)}
            >
              Layers
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
  const ref = useRef<HTMLDivElement>(null);
  const { id, name, opened } = doc;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    const c = new CanvasController(ref.current!, opened, block, {
      onCursor: (p) => showCursor(p),
      onError: (e) => store.failed(name, openError(name, e)),
      onMode: (m) => {
        if (visibleRef.current) onMode(m);
      },
      patterns: () => patterns.sources(),
      fonts: () => fonts.sources(),
      changes: () => engines.changesOf(id),
    });
    const unregister = register(id, block, c);
    return () => {
      unregister();
      c.dispose();
    };
  }, [id, name, opened, block, onMode]);
  useEffect(() => {
    const c = controllerOf(id, block);
    if (!c) return;
    c.canvas.dataset['active'] = String(visible);
    // Leaving a space ends its PAN or ZOOM Window, so the bar never shows a stale mode.
    if (!visible) c.setMode('none');
  }, [id, block, visible]);
  return <div ref={ref} className="space-canvas" hidden={!visible} />;
}

/** Model, then the layouts in tab order (DXF 71). */
function LayoutTabs({ doc }: { doc: OpenDocument | undefined }) {
  if (!doc) return <nav className="layout-tabs" aria-label="Layouts" />;
  const model = doc.opened.modelSpace!;
  const layouts = [...(doc.opened.init.layouts ?? [])]
    .filter((l) => l.blockRecord !== model)
    .sort((a, b) => a.tabOrder - b.tabOrder);
  const tabs = [
    { name: 'Model', block: model },
    ...layouts.map((l) => ({ name: l.name, block: l.blockRecord })),
  ];
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
