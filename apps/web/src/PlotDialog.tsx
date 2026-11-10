// The Plot dialog (M2-17; PLOT, PRINT, Ctrl+P), with AutoCAD's groups and labels (UI_SPEC.md §7):
// Printer/plotter (Triya's PDF writer), Paper size, Plot area, Plot offset, Plot scale, Plot
// style table, Plot options and Drawing orientation; OK plots the space shown to a PDF that
// downloads, Cancel (and Esc) closes. Enter is OK. The settings are the dialog's own: a layout
// opens with its page setup, model space with its display fitted to A4 landscape (plot.ts).
import { PAPER_SIZES } from '@triya/pdf';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { CanvasController } from './canvas/controller';
import { controllerOf } from './canvas/registry';
import {
  LAYOUT_PAPER,
  PLOT_SCALES,
  defaultPlotSettings,
  paperMm,
  plotAreas,
  plotFileName,
  plotPage,
  plotPdf,
  plotStyleTables,
  plotTable,
  type PlotArea,
  type PlotSettings,
  type PlotSpace,
} from './plot';

/** Which drawing the dialog is open for, if any. */
export const plotDialog = (() => {
  let open: number | undefined;
  const listeners = new Set<() => void>();
  const set = (v: number | undefined) => {
    open = v;
    for (const l of listeners) l();
  };
  return {
    get: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    open: (doc: number) => set(doc),
    close: () => set(undefined),
  };
})();

const AREA_LABELS: Record<PlotArea, string> = {
  layout: 'Layout',
  extents: 'Extents',
  display: 'Display',
  limits: 'Limits',
};

/** Downloads the plot (a PDF printer's "Plot to file"). */
function download(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
      name={doc.name}
      controller={controller}
      {...(underlayFile && { underlayFile })}
    />
  );
}

function PlotBody({
  name,
  controller,
  underlayFile,
}: {
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
      setSettings(defaultPlotSettings(sp));
    });
    return () => {
      live = false;
      d?.close();
    };
  }, [controller]);

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
      const table = plotTable(s);
      const parts = await controller.plot({
        ...(table && { table }),
        ...(s.paperspaceLast && space.sheet && { paperspaceLast: true }),
      });
      const bytes = plotPdf(parts, page, s, space, `${name} - ${space.name}`, underlayFile);
      download(plotFileName(name, space), bytes);
      plotDialog.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
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
        <PlotForm s={s} space={space} set={set} />
      ) : (
        <p className="plot-loading">Reading the drawing…</p>
      )}
      {error && (
        <p className="plot-error" role="alert">
          {error}
        </p>
      )}
      <div className="cad-dialog-buttons">
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

function PlotForm({
  s,
  space,
  set,
}: {
  s: PlotSettings;
  space: PlotSpace;
  set: (patch: Partial<PlotSettings>) => void;
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
          <input type="text" value="Triya PDF (vector, to file)" readOnly aria-label="Name" />
        </label>
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
            onChange={(e) => set({ area: e.currentTarget.value as PlotArea })}
          >
            {plotAreas(space).map((a) => (
              <option key={a} value={a}>
                {AREA_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
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
