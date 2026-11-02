// The app shell (UI_SPEC.md §1, M1-22): title bar with the OET home button, document tabs and
// Report issue; the canvas area; the layout tabs; the status bar. The ribbon, palettes and
// command line arrive with their own tasks.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CanvasController } from './canvas/controller';
import { DocumentStore, type OpenDocument } from './documents';
import { openDrawing, openError } from './open';

export const OET_HOME = 'https://openengtools.com/';
export const REPORT_ISSUE = 'https://github.com/shubhs650/triya-cad-2d/issues/new';

const store = new DocumentStore();

async function open(file: { readonly name: string; getFile(): Promise<Blob> }): Promise<void> {
  store.startOpening(file.name);
  try {
    const opened = await openDrawing(await file.getFile());
    if (!opened.modelSpace) throw new Error('the drawing has no model space');
    store.opened(file.name, opened, opened.modelSpace);
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);

  const active = state.docs.find((d) => d.id === state.active);

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
        for (const f of e.dataTransfer.files) void open(fromFile(f));
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
                onClick={() => store.close(d.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <a className="report" href={REPORT_ISSUE} target="_blank" rel="noreferrer">
          Report issue
        </a>
      </header>

      {state.error && (
        <div className="banner error" role="alert">
          <span>{state.error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => store.dismissError()}>
            ×
          </button>
        </div>
      )}
      {state.opening.length > 0 && (
        <div className="banner" role="status">
          Opening {state.opening.join(', ')}…
        </div>
      )}

      <main className="canvas-area">
        {state.docs.map((d) => (
          <DocumentCanvas key={d.id} doc={d} active={d.id === state.active} />
        ))}
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

      <nav className="layout-tabs" aria-label="Layouts">
        {active && <span className="layout-tab current">Model</span>}
      </nav>
      <StatusBar doc={active} />
    </div>
  );
}

/** The world point under the cursor, written straight into the status bar (no React render). */
let showCursor: (p: { x: number; y: number } | undefined) => void = () => {};

function DocumentCanvas({ doc, active }: { doc: OpenDocument; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = new CanvasController(ref.current!, doc.opened, doc.block, {
      onCursor: (p) => showCursor(p),
      onError: (e) => store.failed(doc.name, openError(doc.name, e)),
    });
    return () => c.dispose();
  }, [doc]);
  useEffect(() => {
    const canvas = ref.current?.querySelector('canvas');
    if (canvas) canvas.dataset['active'] = String(active);
  }, [active]);
  return (
    <div ref={ref} id={`doc-${doc.id}`} role="tabpanel" className="doc-canvas" hidden={!active} />
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
            MODEL
          </span>
        </>
      )}
    </footer>
  );
}
