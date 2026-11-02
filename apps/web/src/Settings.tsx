// Settings (UI_SPEC.md §1 title bar), for now the user's files the app draws with: hatch
// pattern files (M1-50), as AutoCAD's OPTIONS > Files lists its support files. A modal
// <dialog>, so focus stays inside it and Esc closes it.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { PatternStore } from './patterns';

export function Settings({
  patterns,
  open,
  onClose,
  onAdd,
}: {
  patterns: PatternStore;
  open: boolean;
  onClose: () => void;
  onAdd: (files: Iterable<File>) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { files, notice, error } = useSyncExternalStore(patterns.subscribe, patterns.getSnapshot);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="settings" aria-labelledby="settings-title" onClose={onClose}>
      <h2 id="settings-title">Settings</h2>
      <section aria-labelledby="patterns-title">
        <h3 id="patterns-title">Hatch patterns</h3>
        <p>
          Your .pat files draw hatches saved without their pattern lines, ahead of the bundled
          patterns. They stay on this device. You can also drop them on the window.
        </p>
        {files.length === 0 ? (
          <p className="empty">No pattern files added.</p>
        ) : (
          <ul aria-label="Pattern files">
            {files.map((f) => (
              <li key={f.name}>
                <span className="file-name">{f.name}</span>
                <span className="pattern-names">{f.patterns.join(', ')}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => void patterns.remove(f.name)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* The shell's banners sit behind the modal, so the outcome of adding shows here. */}
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="message" role="status">
            {notice}
          </p>
        )}
        <button type="button" onClick={() => picker.current?.click()}>
          Add pattern files…
        </button>
        <input
          ref={picker}
          type="file"
          accept=".pat"
          multiple
          hidden
          data-testid="pattern-picker"
          onChange={(e) => {
            onAdd(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
          }}
        />
      </section>
      <form method="dialog">
        <button type="submit">Close</button>
      </form>
    </dialog>
  );
}
