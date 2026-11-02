// Settings (UI_SPEC.md §1 title bar), for now the user's files the app draws with: hatch
// pattern files (M1-50) and font files (M1-38, M1-37), as AutoCAD's OPTIONS > Files lists its
// support files. A modal <dialog>, so focus stays inside it and Esc closes it.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { PatternStore } from './patterns';
import type { DeviceFonts, DeviceFontsState } from './local-fonts';
import type { FontStore } from './user-fonts';

export function Settings({
  patterns,
  fonts,
  deviceFonts,
  open,
  onClose,
  onAdd,
  onAddFonts,
}: {
  patterns: PatternStore;
  fonts: FontStore;
  deviceFonts: DeviceFonts;
  open: boolean;
  onClose: () => void;
  onAdd: (files: Iterable<File>) => void;
  onAddFonts: (files: Iterable<File>) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const fontPicker = useRef<HTMLInputElement>(null);
  const { files, notice, error } = useSyncExternalStore(patterns.subscribe, patterns.getSnapshot);
  const fontState = useSyncExternalStore(fonts.subscribe, fonts.getSnapshot);
  const device = useSyncExternalStore(deviceFonts.subscribe, deviceFonts.getSnapshot);

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
      <section aria-labelledby="fonts-title">
        <h3 id="fonts-title">Fonts</h3>
        <p>
          Your SHX, TrueType and OpenType files draw the text styles that name them, instead of the
          bundled stand-in. They stay on this device. You can also drop them on the window.
        </p>
        {fontState.files.length === 0 ? (
          <p className="empty">No font files added.</p>
        ) : (
          <ul aria-label="Font files">
            {fontState.files.map((f) => (
              <li key={f.name}>
                <span className="file-name">{f.name}</span>
                <span className="pattern-names">{f.kind}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => void fonts.remove(f.name)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {fontState.error && (
          <p className="message error" role="alert">
            {fontState.error}
          </p>
        )}
        {fontState.notice && (
          <p className="message" role="status">
            {fontState.notice}
          </p>
        )}
        <button type="button" onClick={() => fontPicker.current?.click()}>
          Add font files…
        </button>
        <input
          ref={fontPicker}
          type="file"
          accept=".shx,.ttf,.otf"
          multiple
          hidden
          data-testid="font-picker"
          onChange={(e) => {
            onAddFonts(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
          }}
        />
        <InstalledFonts state={device} onAllow={() => void deviceFonts.allow()} />
      </section>
      <form method="dialog">
        <button type="submit">Close</button>
      </form>
    </dialog>
  );
}

/**
 * Fonts installed on this computer (M1-38 part 2). The browser asks the user when the button
 * is pressed; the app never asks by itself, and a refusal only leaves the bundled fonts.
 */
function InstalledFonts({ state, onAllow }: { state: DeviceFontsState; onAllow: () => void }) {
  return (
    <section className="installed-fonts" aria-labelledby="installed-fonts-title">
      <h4 id="installed-fonts-title">Fonts installed on this computer</h4>
      {state.permission === 'unsupported' && (
        <p>This browser cannot share the fonts installed on this computer.</p>
      )}
      {state.permission === 'prompt' && (
        <>
          <p>
            Text can draw with the fonts installed on this computer. Your browser asks you first.
            The fonts are read on this device and never uploaded.
          </p>
          <button type="button" onClick={onAllow}>
            Use installed fonts…
          </button>
        </>
      )}
      {state.permission === 'denied' && (
        <p role="status">
          Access to installed fonts is blocked, so the bundled fonts stand in. You can allow it in
          your browser&apos;s site settings.
        </p>
      )}
      {state.permission === 'granted' &&
        (state.used.length === 0 ? (
          <p className="empty">No open drawing uses an installed font.</p>
        ) : (
          <ul aria-label="Installed fonts in use">
            {state.used.map((u) => (
              <li key={u.requested}>
                <span className="file-name">{u.requested}</span>
                <span className="pattern-names">{u.face}</span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
