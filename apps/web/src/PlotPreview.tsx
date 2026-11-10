// The plot preview in the drawing area (M2-18 part 2), with AutoCAD 2024's preview toolbar (Plot,
// Pan, Zoom, Zoom Window, Zoom Original, Close Preview Window) and its shortcut menu (Exit, Plot,
// Pan, Zoom, Zoom Window, Zoom Original). Esc or Enter leaves it, as PREVIEW's prompt says. The
// canvas is a leaf handed to `PreviewController`; React holds the toolbar only.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PreviewController, type PreviewMode } from './canvas/preview';
import { previewMode, type PreviewRequest } from './plot-preview';
import { openPdf } from './underlay/pdfjs';

const MODES: readonly { readonly mode: PreviewMode; readonly label: string }[] = [
  { mode: 'pan', label: 'Pan' },
  { mode: 'zoom', label: 'Zoom' },
  { mode: 'window', label: 'Zoom Window' },
];

/** The preview of the drawing shown, if one is open for it. */
export function PlotPreview({ active }: { readonly active: number | undefined }) {
  const request = useSyncExternalStore(previewMode.subscribe, previewMode.get);
  // Another drawing brought to the front ends the preview, as it would end PREVIEW there.
  useEffect(() => {
    if (request && request.doc !== active) previewMode.close();
  }, [request, active]);
  if (!request || request.doc !== active) return null;
  return <PreviewBody key={request.title + request.pdf.length} request={request} />;
}

function PreviewBody({ request }: { readonly request: PreviewRequest }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<PreviewController | undefined>(undefined);
  const [mode, setMode] = useState<PreviewMode>('zoom');
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [error, setError] = useState<string>();
  const [plotting, setPlotting] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctl = new PreviewController(c, {
      pdf: request.pdf,
      paper: request.paper,
      openPdf,
      onError: setError,
    });
    ctl.setMode('zoom');
    controller.current = ctl;
    c.focus();
    return () => {
      ctl.dispose();
      controller.current = undefined;
    };
  }, [request]);

  const choose = (m: PreviewMode) => {
    controller.current?.setMode(m);
    setMode(m);
    setMenu(undefined);
  };
  const zoomOriginal = () => {
    controller.current?.zoomOriginal();
    setMenu(undefined);
  };
  const plot = async () => {
    setMenu(undefined);
    if (plotting) return;
    setPlotting(true);
    setError(undefined);
    try {
      await previewMode.plot();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlotting(false);
    }
  };

  // Esc and Enter leave the preview (Esc closes the shortcut menu first), whatever has the focus:
  // the command line must not take Enter as repeating the last command.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      const t = e.target as HTMLElement | null;
      if (e.key === 'Enter' && t instanceof HTMLButtonElement) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape' && menu) setMenu(undefined);
      else previewMode.close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu]);

  return (
    <section className="plot-preview-mode" aria-label={`Plot preview - ${request.title}`}>
      <div className="plot-preview-toolbar" role="toolbar" aria-label="Preview">
        {request.plot && (
          <button type="button" disabled={plotting} onClick={() => void plot()}>
            {plotting ? 'Plotting…' : 'Plot'}
          </button>
        )}
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            aria-pressed={mode === m.mode}
            onClick={() => choose(m.mode)}
          >
            {m.label}
          </button>
        ))}
        <button type="button" onClick={zoomOriginal}>
          Zoom Original
        </button>
        <button type="button" onClick={() => previewMode.close()}>
          Close Preview Window
        </button>
        <span className="plot-preview-title">{request.title}</span>
      </div>
      {error && (
        <p className="plot-preview-error" role="alert">
          {error}
        </p>
      )}
      <canvas
        ref={canvas}
        className="plot-preview-canvas"
        data-testid="plot-preview-canvas"
        tabIndex={0}
        aria-label="Plot preview sheet"
        onContextMenu={(e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: e.clientX - r.left, y: e.clientY - r.top + 32 });
        }}
        onPointerDown={() => setMenu(undefined)}
      />
      {menu && (
        <div
          className="plot-preview-menu"
          role="menu"
          aria-label="Preview shortcut menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuItem label="Exit" onClick={() => previewMode.close()} />
          {request.plot && <MenuItem label="Plot" onClick={() => void plot()} />}
          {MODES.map((m) => (
            <MenuItem
              key={m.mode}
              label={m.label}
              checked={mode === m.mode}
              onClick={() => choose(m.mode)}
            />
          ))}
          <MenuItem label="Zoom Original" onClick={zoomOriginal} />
        </div>
      )}
    </section>
  );
}

function MenuItem({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked?: boolean;
  onClick: () => void;
}) {
  return checked === undefined ? (
    <button type="button" role="menuitem" className="plot-preview-menu-item" onClick={onClick}>
      {label}
    </button>
  ) : (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className="plot-preview-menu-item"
      onClick={onClick}
    >
      {label}
    </button>
  );
}
