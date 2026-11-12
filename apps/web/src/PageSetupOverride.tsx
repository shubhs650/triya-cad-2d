// The Page Setup Override dialog (M2-39 part 5), opened from Save As PDF's and Export Data's
// "Page Setup Override..." button, with AutoCAD 2024's groups and labels (UI_SPEC.md §7): Paper
// size, Drawing orientation, Plot scale and Plot style table (pen assignments). OK hands the four
// back for the export; Cancel (and Esc) keeps what was there. The page setup itself is untouched.
import { useEffect, useRef, useState } from 'react';
import { PAPER_SIZES } from '@triya/pdf';
import { Check, Group, NumberField, ownPaperLabel } from './PlotDialog';
import type { PageSetupOverride } from './export';
import { LAYOUT_PAPER, PLOT_SCALES, plotStyleTables, type PlotSpace } from './plot';

export function PageSetupOverrideDialog({
  space,
  value,
  onOk,
  onCancel,
}: {
  space: PlotSpace;
  value: PageSetupOverride;
  onOk: (v: PageSetupOverride) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [s, setS] = useState(value);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  const set = (p: Partial<PageSetupOverride>) => setS({ ...s, ...p });
  const own = ownPaperLabel(space);
  // Millimetres, or inches for a page setup in inches, as the Plot dialog shows its scale.
  const k = space.inches ? 25.4 : 1;
  const unit = space.inches ? 'inches' : 'mm';
  const scaleKey = PLOT_SCALES.find(
    ([, mm, units]) => Math.abs(mm / units - s.scale.mm / k / s.scale.units) < 1e-9,
  );
  const tables = plotStyleTables(space);
  return (
    <dialog
      ref={ref}
      className="cad-dialog page-setup-override"
      aria-label="Page Setup Override"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          onOk(s);
        }
      }}
    >
      <h2 className="cad-dialog-title">Page Setup Override</h2>
      <div className="plot-form">
        <Group label="Paper size">
          <select
            aria-label="Paper size"
            value={s.paper}
            onChange={(e) => set({ paper: e.currentTarget.value })}
          >
            {own && <option value={LAYOUT_PAPER}>{own}</option>}
            {PAPER_SIZES.map((p) => (
              <option key={p.name} value={p.name}>
                {`${p.name} (${p.width} × ${p.height} mm)`}
              </option>
            ))}
          </select>
        </Group>
        <Group label="Drawing orientation">
          <div role="radiogroup" aria-label="Drawing orientation" className="plot-orientation">
            {(['portrait', 'landscape'] as const).map((o) => (
              <label key={o} className="cad-dialog-check">
                <input
                  type="radio"
                  name="override-orientation"
                  checked={s.orientation === o}
                  onChange={() => set({ orientation: o })}
                />
                {o === 'portrait' ? 'Portrait' : 'Landscape'}
              </label>
            ))}
          </div>
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
        </Group>
        <Group label="Plot style table (pen assignments)">
          <select
            aria-label="Plot style table"
            value={s.table}
            onChange={(e) => set({ table: e.currentTarget.value })}
          >
            <option value="">None</option>
            {tables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            {s.table !== '' && !tables.includes(s.table) && (
              <option value={s.table}>{`${s.table} (not found)`}</option>
            )}
          </select>
        </Group>
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => onOk(s)}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
