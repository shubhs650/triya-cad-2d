// The PDF Options dialog (M2-60), opened from Save As PDF's and Export Data's "Options..." for a
// PDF, with AutoCAD 2024's groups and labels (UI_SPEC.md §7; AutoCAD 2024 Help, "PDF Options
// Dialog Box"): Data (Include layer information, Create bookmarks) and Font Handling (Convert all
// text to geometry). AutoCAD's Quality group, its presets and its other Data and Font Handling
// choices change nothing Triya writes, so the dialog says why they are absent (export.ts). OK
// hands the choices back for the export; Cancel (and Esc) keeps what was there.
import { useEffect, useRef, useState } from 'react';
import { Check, Group } from './PlotDialog';
import type { PdfOptions } from './plot';

export function PdfOptionsDialog({
  value,
  onOk,
  onCancel,
}: {
  value: PdfOptions;
  onOk: (v: PdfOptions) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [s, setS] = useState(value);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  const set = (p: Partial<PdfOptions>) => setS({ ...s, ...p });
  return (
    <dialog
      ref={ref}
      className="cad-dialog pdf-options"
      aria-label="PDF Options"
      onCancel={(e) => {
        // Esc closes this dialog only: React hands the event on to the export dialog round it.
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 className="cad-dialog-title">PDF Options</h2>
      <div className="plot-form">
        <Group label="Data">
          <Check
            label="Include layer information"
            checked={s.layers}
            onChange={(layers) => set({ layers })}
          />
          <Check
            label="Create bookmarks"
            checked={s.bookmarks}
            onChange={(bookmarks) => set({ bookmarks })}
          />
        </Group>
        <Group label="Font Handling">
          <Check
            label="Convert all text to geometry"
            checked={s.textAsGeometry}
            onChange={(textAsGeometry) => set({ textAsGeometry })}
          />
        </Group>
        <p className="export-note">
          Vector and raster quality, merge control and the presets that set them are not offered:
          Triya&rsquo;s PDF keeps vectors at full precision and images at their own pixels, and
          lines plot in draw order. TrueType text is embedded as a subset unless it is converted to
          geometry. Hyperlinks are not written.
        </p>
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
