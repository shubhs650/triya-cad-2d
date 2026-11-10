// The Plot dialog (M2-17; PLOT, PRINT, Ctrl+P), with AutoCAD's groups and labels (UI_SPEC.md §7):
// Printer/plotter (Triya's PDF, SVG or PNG writer, M2-18; the PNG's resolution and the SVG's and
// PNG's background beside it, as a PNG plotter's custom properties hold them), Paper size, Plot area, Plot offset, Plot scale, Plot
// style table, Plot options and Drawing orientation; OK plots the space shown to a PDF that
// downloads, Cancel (and Esc) closes. Enter is OK. The settings are the dialog's own: a layout
// opens with its page setup, model space with its display fitted to A4 landscape (plot.ts).
//
// Part 2: the partial preview (the paper and the plot area on it, a red edge where the plot runs
// off the paper) and the Window plot area. Window< (or choosing Window before one is picked) hides
// the dialog and hands back to PLOT, which asks for the corners at the command line and opens the
// dialog again with the window and the rest of the settings as they were, as AutoCAD does.
//
// M2-18 part 2: Preview… (bottom left, as AutoCAD's) shows the full plot preview with these
// settings; closing it brings the dialog back, its Plot button plots as OK does.
import type { Box } from '@triya/engine';
import { PAPER_SIZES } from '@triya/pdf';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CanvasController } from './canvas/controller';
import { controllerOf } from './canvas/registry';
import { rasterSize } from '@triya/render';
import { lastPlotSettings, previewMode, plotRequest, previewOf } from './plot-preview';
import {
  LAYOUT_PAPER,
  PLOT_DEVICES,
  PLOT_SCALES,
  PNG_RESOLUTIONS,
  defaultPlotSettings,
  paperMm,
  plotAreas,
  plotPreview,
  plotFileName,
  plotFile,
  plotPage,
  plotStyleTables,
  type PlotArea,
  type PlotSettings,
  type PlotSpace,
} from './plot';

/**
 * Which drawing the dialog is open for, if any. PLOT opens it (`show`) and waits until it closes:
 * true when it closed on Window<, whose settings are kept for the space it was open on until PLOT
 * shows the dialog again with the window picked.
 */
export const plotDialog = (() => {
  let open: number | undefined;
  let kept: { doc: number; block: string; settings: PlotSettings } | undefined;
  let done: ((pickWindow: boolean) => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: number | undefined) => {
    open = v;
    for (const l of listeners) l();
  };
  const finish = (pickWindow: boolean) => {
    const d = done;
    done = undefined;
    d?.(pickWindow);
  };
  return {
    get: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Opens the dialog for a drawing; `window` is the one PLOT just had picked. */
    show(doc: number, window?: Box): Promise<boolean> {
      finish(false);
      if (window && kept?.doc === doc) {
        kept = { ...kept, settings: { ...kept.settings, area: 'window', window } };
      } else kept = undefined;
      set(doc);
      return new Promise((resolve) => (done = resolve));
    },
    /** The settings to reopen a space's dialog with, after a window was picked in it. */
    resume: (doc: number, block: string): PlotSettings | undefined =>
      kept?.doc === doc && kept.block === block ? kept.settings : undefined,
    /** Window<: hides the dialog, keeping its settings, for PLOT to ask for the corners. */
    pickWindow(doc: number, block: string, settings: PlotSettings) {
      kept = { doc, block, settings };
      set(undefined);
      finish(true);
    },
    close() {
      kept = undefined;
      set(undefined);
      finish(false);
    },
  };
})();

const AREA_LABELS: Record<PlotArea, string> = {
  layout: 'Layout',
  extents: 'Extents',
  display: 'Display',
  limits: 'Limits',
  window: 'Window',
};

/** Downloads the plot (a file plotter's "Plot to file"). */
export function download(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Downloads a PDF (PUBLISH's). */
export function downloadPdf(name: string, bytes: Uint8Array): void {
  download(name, bytes, 'application/pdf');
}

export function PlotDialog({
  doc,
  underlayFile,
}: {
  doc: { readonly id: number; readonly block: string; readonly name: string } | undefined;
  /** The PDF file a PDF underlay names, as supplied this session (M2-16 part 5). */
  underlayFile?: (fileName: string) => Uint8Array | undefined;
}) {
  const open = useSyncExternalStore(plotDialog.subscribe, plotDialog.get);
  if (!doc || open !== doc.id) return null;
  const controller = controllerOf(doc.id, doc.block);
  if (!controller) return null;
  return (
    <PlotBody
      key={`${doc.id}:${doc.block}`}
      doc={doc.id}
      block={doc.block}
      name={doc.name}
      controller={controller}
      {...(underlayFile && { underlayFile })}
    />
  );
}

function PlotBody({
  doc,
  block,
  name,
  controller,
  underlayFile,
}: {
  doc: number;
  block: string;
  name: string;
  controller: CanvasController;
  underlayFile?: (fileName: string) => Uint8Array | undefined;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [space, setSpace] = useState<PlotSpace>();
  const [s, setSettings] = useState<PlotSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    let live = true;
    void controller.plotSpace().then((sp) => {
      if (!live) return;
      setSpace(sp);
      setSettings(plotDialog.resume(doc, block) ?? defaultPlotSettings(sp));
    });
    return () => {
      live = false;
      d?.close();
    };
  }, [controller, doc, block]);

  const set = (patch: Partial<PlotSettings>) => s && setSettings({ ...s, ...patch });

  const ok = async () => {
    if (!s || !space || busy) return;
    setError(undefined);
    let page;
    try {
      page = plotPage(s, space);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setBusy(true);
    try {
      const parts = await controller.plot(plotRequest(s, space));
      const file = await plotFile(parts, page, s, space, `${name} - ${space.name}`, underlayFile);
      download(plotFileName(name, space, s.device), file.bytes, file.type);
      lastPlotSettings.set(doc, block, s);
      plotDialog.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // Preview… (M2-18 part 2): the plot these settings make, in the drawing area; the dialog comes
  // back when the preview closes, unless its Plot button plotted.
  const preview = async () => {
    if (!s || !space || busy) return;
    setError(undefined);
    setBusy(true);
    const plotTitle = `${name} - ${space.name}`;
    let p;
    try {
      p = await previewOf((r) => controller.plot(r), space, s, plotTitle, underlayFile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    lastPlotSettings.set(doc, block, s);
    ref.current?.close();
    const { parts, page } = p;
    await previewMode.show({
      doc,
      title: plotTitle,
      pdf: p.pdf,
      paper: p.paper,
      plot: async () => {
        const file = await plotFile(parts, page, s, space, plotTitle, underlayFile);
        download(plotFileName(name, space, s.device), file.bytes, file.type);
        plotDialog.close();
      },
    });
    const d = ref.current;
    if (plotDialog.get() === doc && d && !d.open) d.showModal();
    setBusy(false);
  };

  const title = `Plot - ${space?.name ?? ''}`;
  return (
    <dialog
      ref={ref}
      className="cad-dialog plot-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        plotDialog.close();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        const t = e.target as HTMLElement;
        if (e.key === 'Enter' && !(t instanceof HTMLButtonElement)) {
          e.preventDefault();
          void ok();
        }
      }}
    >
      <h2 className="cad-dialog-title">{title}</h2>
      {s && space ? (
        <PlotForm
          s={s}
          space={space}
          set={set}
          pickWindow={() => plotDialog.pickWindow(doc, block, { ...s, area: 'window' })}
        />
      ) : (
        <p className="plot-loading">Reading the drawing…</p>
      )}
      {error && (
        <p className="plot-error" role="alert">
          {error}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button
          type="button"
          className="plot-preview-button"
          disabled={!s || busy}
          onClick={() => void preview()}
        >
          Preview…
        </button>
        <button type="button" disabled={!s || busy} onClick={() => void ok()}>
          {busy ? 'Plotting…' : 'OK'}
        </button>
        <button type="button" onClick={() => plotDialog.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="plot-group">
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="cad-dialog-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

/** A number field that keeps what is typed until it parses. */
function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="cad-dialog-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const t = e.currentTarget.value;
          setText(t);
          const v = Number(t);
          if (t.trim() !== '' && Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

/**
 * The partial preview: the paper (white), the plot area on it (blue), and a red edge where the
 * plot area runs off the paper, as AutoCAD draws it.
 */
function PartialPreview({ s, space }: { s: PlotSettings; space: PlotSpace }) {
  const p = plotPreview(s, space);
  if (!p) return <p className="plot-preview-none">No plot area</p>;
  const mm = (v: number) => Math.round(v * 10) / 10;
  const label =
    `Plot area ${mm(p.area.width)} × ${mm(p.area.height)} mm on paper ` +
    `${mm(p.width)} × ${mm(p.height)} mm` +
    (p.offPaper ? '; the plot area runs off the paper' : '');
  // The page with a margin around it, y up as on paper; the plot area cut to that margin.
  const pad = 0.06 * Math.max(p.width, p.height);
  const x0 = Math.max(-pad, p.area.x);
  const y0 = Math.max(-pad, p.area.y);
  const x1 = Math.min(p.width + pad, p.area.x + p.area.width);
  const y1 = Math.min(p.height + pad, p.area.y + p.area.height);
  return (
    <svg
      className="plot-preview"
      role="img"
      aria-label={label}
      data-off-paper={p.offPaper}
      viewBox={`${-pad} ${-pad} ${p.width + 2 * pad} ${p.height + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{label}</title>
      <g transform={`matrix(1 0 0 -1 0 ${p.height})`}>
        <rect className="plot-preview-paper" x={0} y={0} width={p.width} height={p.height} />
        {x1 > x0 && y1 > y0 && (
          <rect
            className={p.offPaper ? 'plot-preview-area off-paper' : 'plot-preview-area'}
            x={x0}
            y={y0}
            width={x1 - x0}
            height={y1 - y0}
          />
        )}
      </g>
    </svg>
  );
}

function PlotForm({
  s,
  space,
  set,
  pickWindow,
}: {
  s: PlotSettings;
  space: PlotSpace;
  set: (patch: Partial<PlotSettings>) => void;
  pickWindow: () => void;
}) {
  const layout = space.sheet !== undefined;
  const paper = paperMm(s, space);
  // The scale in the paper's units: inches for a layout set up in inches, as AutoCAD shows it.
  const k = space.inches ? 25.4 : 1;
  const unit = space.inches ? 'inches' : 'mm';
  const scaleKey = PLOT_SCALES.find(
    ([, mm, units]) => Math.abs(mm / units - s.scale.mm / k / s.scale.units) < 1e-9,
  );
  const layoutPaper = space.sheet
    ? `Layout paper (${Math.round(paper.width * 10) / 10} × ${Math.round(paper.height * 10) / 10} mm)`
    : undefined;
  return (
    <div className="plot-form">
      <Group label="Printer/plotter">
        <label className="cad-dialog-field">
          <span>Name:</span>
          <select
            aria-label="Name"
            value={s.device}
            onChange={(e) => {
              const device = e.currentTarget.value as PlotSettings['device'];
              // A PNG lies on white, as a raster plotter's background; an SVG on nothing.
              set({ device, background: device === 'svg' ? 'none' : 'white' });
            }}
          >
            {PLOT_DEVICES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {s.device === 'png' && (
          <label className="cad-dialog-field">
            <span>Resolution:</span>
            <select
              aria-label="Resolution"
              value={s.dpi}
              onChange={(e) => set({ dpi: Number(e.currentTarget.value) })}
            >
              {PNG_RESOLUTIONS.map((dpi) => (
                <option key={dpi} value={dpi}>
                  {`${dpi} dpi`}
                </option>
              ))}
            </select>
          </label>
        )}
        {s.device !== 'pdf' && (
          <label className="cad-dialog-field">
            <span>Background:</span>
            <select
              aria-label="Background"
              value={s.background}
              onChange={(e) =>
                set({ background: e.currentTarget.value as PlotSettings['background'] })
              }
            >
              <option value="white">White</option>
              <option value="none">None (transparent)</option>
            </select>
          </label>
        )}
        {s.device === 'png' && (
          <p className="plot-note" aria-label="Image size">
            {(({ width, height }) => `${width} × ${height} pixels`)(
              rasterSize(
                s.orientation === 'landscape'
                  ? {
                      width: Math.max(paper.width, paper.height),
                      height: Math.min(paper.width, paper.height),
                    }
                  : {
                      width: Math.min(paper.width, paper.height),
                      height: Math.max(paper.width, paper.height),
                    },
                s.dpi,
              ),
            )}
          </p>
        )}
      </Group>
      <Group label="Paper size">
        <select
          aria-label="Paper size"
          value={s.paper}
          onChange={(e) => set({ paper: e.currentTarget.value })}
        >
          {layoutPaper && <option value={LAYOUT_PAPER}>{layoutPaper}</option>}
          {PAPER_SIZES.map((p) => (
            <option key={p.name} value={p.name}>
              {`${p.name} (${p.width} × ${p.height} mm)`}
            </option>
          ))}
        </select>
      </Group>
      <Group label="Plot area">
        <label className="cad-dialog-field">
          <span>What to plot:</span>
          <select
            aria-label="What to plot"
            value={s.area}
            onChange={(e) => {
              const area = e.currentTarget.value as PlotArea;
              // Window before one is picked goes straight to picking it, as in AutoCAD.
              if (area === 'window' && !s.window) pickWindow();
              else set({ area });
            }}
          >
            {plotAreas(space).map((a) => (
              <option key={a} value={a}>
                {AREA_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
        {s.area === 'window' && (
          <button type="button" className="plot-window-button" onClick={pickWindow}>
            Window&lt;
          </button>
        )}
      </Group>
      <Group label="Preview">
        <PartialPreview s={s} space={space} />
      </Group>
      <Group label="Plot offset (origin set to the paper's corner)">
        <NumberField
          label="X (mm):"
          value={s.offset.x}
          disabled={s.center}
          onChange={(x) => set({ offset: { ...s.offset, x } })}
        />
        <NumberField
          label="Y (mm):"
          value={s.offset.y}
          disabled={s.center}
          onChange={(y) => set({ offset: { ...s.offset, y } })}
        />
        <Check label="Center the plot" checked={s.center} onChange={(center) => set({ center })} />
      </Group>
      <Group label="Plot scale">
        <Check label="Fit to paper" checked={s.fit} onChange={(fit) => set({ fit })} />
        <label className="cad-dialog-field">
          <span>Scale:</span>
          <select
            aria-label="Scale"
            disabled={s.fit}
            value={scaleKey?.[0] ?? 'custom'}
            onChange={(e) => {
              const found = PLOT_SCALES.find(([l]) => l === e.currentTarget.value);
              if (found) set({ scale: { mm: found[1] * k, units: found[2] } });
            }}
          >
            {!scaleKey && <option value="custom">Custom</option>}
            {PLOT_SCALES.map(([l]) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label={`${unit} =`}
          value={Math.round((s.scale.mm / k) * 1e9) / 1e9}
          disabled={s.fit}
          onChange={(v) => set({ scale: { ...s.scale, mm: v * k } })}
        />
        <NumberField
          label="units"
          value={s.scale.units}
          disabled={s.fit}
          onChange={(units) => set({ scale: { ...s.scale, units } })}
        />
        {layout && (
          <Check
            label="Scale lineweights"
            checked={s.scaleLineweights}
            onChange={(scaleLineweights) => set({ scaleLineweights })}
          />
        )}
      </Group>
      <Group label="Plot style table (pen assignments)">
        <select
          aria-label="Plot style table"
          value={s.table}
          onChange={(e) => set({ table: e.currentTarget.value })}
        >
          <option value="">None</option>
          {plotStyleTables(space).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Group>
      <Group label="Plot options">
        <Check
          label="Plot object lineweights"
          checked={s.lineweights || s.plotStyles}
          disabled={s.plotStyles}
          onChange={(lineweights) => set({ lineweights })}
        />
        <Check
          label="Plot with plot styles"
          checked={s.plotStyles}
          onChange={(plotStyles) => set({ plotStyles, ...(plotStyles && { lineweights: true }) })}
        />
        {layout && (
          <Check
            label="Plot paperspace last"
            checked={s.paperspaceLast}
            onChange={(paperspaceLast) => set({ paperspaceLast })}
          />
        )}
      </Group>
      <Group label="Drawing orientation">
        <div role="radiogroup" aria-label="Drawing orientation" className="plot-orientation">
          {(['portrait', 'landscape'] as const).map((o) => (
            <label key={o} className="cad-dialog-check">
              <input
                type="radio"
                name="plot-orientation"
                checked={s.orientation === o}
                onChange={() => set({ orientation: o })}
              />
              {o === 'portrait' ? 'Portrait' : 'Landscape'}
            </label>
          ))}
        </div>
        <Check
          label="Plot upside-down"
          checked={s.upsideDown}
          onChange={(upsideDown) => set({ upsideDown })}
        />
      </Group>
    </div>
  );
}
