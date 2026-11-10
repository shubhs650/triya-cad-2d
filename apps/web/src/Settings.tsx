// Settings (UI_SPEC.md §1 title bar, M2-20): the chrome's theme, the canvas colours and the
// coordinate display (AutoCAD's OPTIONS > Display), the object snap settings (DRAFTINGSETTINGS
// and OPTIONS > Drafting), the user's files the app draws with, hatch pattern files (M1-50) and
// font files (M1-38, M1-37), as OPTIONS > Files lists its support files, and "Clear all local
// data" (PRD FR-F11). One scrolling modal <dialog>, so focus stays inside it and Esc closes it.
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { OSNAP, OSNAP_MODES } from '@triya/engine';
import { drafting } from './drafting';
import { dynMode } from './dynamic-input';
import type { ClearReport } from './local-data';
import {
  APERTURES,
  DEFAULT_CANVAS,
  MARKER_SIZES,
  POLAR_ANGLES,
  type CanvasColours,
  type CoordinateDisplay,
  type PreferencesStore,
  type Theme,
} from './preferences';
import type { PatternStore } from './patterns';
import type { DeviceFonts, DeviceFontsState } from './local-fonts';
import type { FontStore } from './user-fonts';
import type { SupportFileStore } from './support-files';
import { interfaceColours } from './canvas/colours';

export function Settings({
  preferences,
  onClearAll,
  patterns,
  fonts,
  plotStyles,
  linetypes,
  deviceFonts,
  open,
  onClose,
  onAdd,
  onAddFonts,
  onAddFiles,
}: {
  preferences: PreferencesStore;
  /** Deletes everything on the device; the page reloads unless something could not go. */
  onClearAll: () => Promise<ClearReport>;
  patterns: PatternStore;
  fonts: FontStore;
  plotStyles: SupportFileStore;
  linetypes: SupportFileStore;
  deviceFonts: DeviceFonts;
  open: boolean;
  onClose: () => void;
  onAdd: (files: Iterable<File>) => void;
  onAddFonts: (files: Iterable<File>) => void;
  /** Plot style tables and linetype files, each to its store. */
  onAddFiles: (files: Iterable<File>) => void;
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
      <DisplaySettings preferences={preferences} />
      <DraftingSettings />
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
          accept=".shx,.ttf,.otf,.ttc"
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
      <SupportFiles
        title="Plot style tables"
        about="Your .ctb and .stb files, for plotting beside the bundled tables. They stay on this device. You can also drop them on the window."
        empty="No plot style tables added."
        listLabel="Plot style tables"
        button="Add plot style tables…"
        accept=".ctb,.stb"
        testId="plot-style-picker"
        store={plotStyles}
        onAdd={onAddFiles}
      />
      <SupportFiles
        title="Linetypes"
        about="Your .lin files, for loading linetypes beside the bundled ISO set. They stay on this device. You can also drop them on the window."
        empty="No linetype files added."
        listLabel="Linetype files"
        button="Add linetype files…"
        accept=".lin"
        testId="linetype-picker"
        store={linetypes}
        onAdd={onAddFiles}
      />
      <LocalData onClearAll={onClearAll} />
      <form method="dialog">
        <button type="submit">Close</button>
      </form>
    </dialog>
  );
}

/**
 * One kind of support file (M2-20 part 2), as OPTIONS > Files lists AutoCAD's: the files kept on
 * this device with what each holds, the ones that could not be read back, Add and Remove.
 */
function SupportFiles(props: {
  title: string;
  about: string;
  empty: string;
  listLabel: string;
  button: string;
  accept: string;
  testId: string;
  store: SupportFileStore;
  onAdd: (files: Iterable<File>) => void;
}) {
  const { store } = props;
  const { files, unreadable, notice, error } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  );
  const picker = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3 id={id}>{props.title}</h3>
      <p>{props.about}</p>
      {files.length === 0 ? (
        <p className="empty">{props.empty}</p>
      ) : (
        <ul aria-label={props.listLabel}>
          {files.map((f) => (
            <li key={f.name}>
              <span className="file-name">{f.name}</span>
              <span className="pattern-names">{f.summary}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => void store.remove(f.name)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {unreadable.length > 0 && (
        <ul aria-label={`${props.listLabel} that could not be read`}>
          {unreadable.map((u) => (
            <li key={u.name}>
              <span className="file-name">{u.name}</span>
              <span className="pattern-names">{u.problem}</span>
            </li>
          ))}
        </ul>
      )}
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
        {props.button}
      </button>
      <input
        ref={picker}
        type="file"
        accept={props.accept}
        multiple
        hidden
        data-testid={props.testId}
        onChange={(e) => {
          props.onAdd(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
        }}
      />
    </section>
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

const COLOURS: readonly {
  key: Exclude<keyof CanvasColours, 'grid' | 'crosshair' | 'autosnap' | 'autotrack'>;
  label: string;
}[] = [
  { key: 'model', label: 'Model space background' },
  { key: 'paper', label: 'Layout paper' },
  { key: 'surround', label: 'Layout background' },
  { key: 'selection', label: 'Selection highlight' },
];

/** OPTIONS > Display: the colour theme, the canvas colours and how coordinates show. */
function DisplaySettings({ preferences }: { preferences: PreferencesStore }) {
  const p = useSyncExternalStore(preferences.subscribe, preferences.get);
  const id = useId();
  const setCanvas = (patch: Partial<CanvasColours>) =>
    preferences.update({ canvas: { ...p.canvas, ...patch } });
  return (
    <section aria-labelledby={`${id}-display`}>
      <h3 id={`${id}-display`}>Display</h3>
      <div className="setting-row">
        <label htmlFor={`${id}-theme`}>Color theme</label>
        <select
          id={`${id}-theme`}
          value={p.theme}
          onChange={(e) => preferences.update({ theme: e.currentTarget.value as Theme })}
        >
          <option value="system">Same as system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <fieldset className="canvas-colours">
        <legend>Canvas colors</legend>
        {COLOURS.map(({ key, label }) => (
          <div className="setting-row" key={key}>
            <label htmlFor={`${id}-${key}`}>{label}</label>
            <input
              id={`${id}-${key}`}
              type="color"
              value={p.canvas[key]}
              onChange={(e) => setCanvas({ [key]: e.currentTarget.value })}
            />
          </div>
        ))}
        {AUTO_COLOURS.map(({ key, label }) => (
          <AutoColour
            key={key}
            id={`${id}-${key}`}
            label={label}
            value={p.canvas[key]}
            automatic={automaticColour(p.canvas, key)}
            onChange={(v) => setCanvas({ [key]: v })}
          />
        ))}
        <button type="button" onClick={() => preferences.update({ canvas: DEFAULT_CANVAS })}>
          Restore default colors
        </button>
      </fieldset>
      <div className="setting-row">
        <label htmlFor={`${id}-coords`}>Coordinates</label>
        <select
          id={`${id}-coords`}
          value={p.coordinates}
          onChange={(e) =>
            preferences.update({ coordinates: e.currentTarget.value as CoordinateDisplay })
          }
        >
          <option value="drawing">Drawing units (UNITS)</option>
          <option value="decimal">Decimal</option>
        </select>
      </div>
    </section>
  );
}

type AutoKey = 'grid' | 'crosshair' | 'autosnap' | 'autotrack';

/** The colours that can be Automatic, following the background (AutoCAD's Drawing Window Colors). */
const AUTO_COLOURS: readonly { key: AutoKey; label: string }[] = [
  { key: 'grid', label: 'Grid lines' },
  { key: 'crosshair', label: 'Crosshairs' },
  { key: 'autosnap', label: 'AutoSnap marker' },
  { key: 'autotrack', label: 'AutoTrack vector' },
];

/**
 * The colour an Automatic setting shows on the model canvas, where unchecking Automatic starts:
 * UI_SPEC.md §6's grid, or what the drafting aids draw in there now.
 */
function automaticColour(c: CanvasColours, key: AutoKey): string {
  if (key === 'grid') return '#2b3340';
  return interfaceColours({ background: c.model })[key];
}

/** A colour that is Automatic or chosen: the checkbox, and the swatch once unchecked. */
function AutoColour(props: {
  id: string;
  label: string;
  value: string | undefined;
  automatic: string;
  onChange: (value: string | undefined) => void;
}) {
  const { id, value } = props;
  return (
    <div className="setting-row">
      <label htmlFor={id}>{props.label}</label>
      <span>
        <input
          id={`${id}-auto`}
          type="checkbox"
          aria-label={`${props.label}: Automatic`}
          checked={value === undefined}
          onChange={(e) => props.onChange(e.currentTarget.checked ? undefined : props.automatic)}
        />
        <label htmlFor={`${id}-auto`}>Automatic</label>
        <input
          id={id}
          type="color"
          disabled={value === undefined}
          value={value ?? props.automatic}
          onChange={(e) => props.onChange(e.currentTarget.value)}
        />
      </span>
    </div>
  );
}

/**
 * DRAFTINGSETTINGS' object snap modes and polar increment, OPTIONS > Drafting's AutoSnap
 * marker and aperture sizes, and Dynamic Input. They act on the status bar's drafting aids,
 * which keep them between sessions (preferences.ts).
 */
function DraftingSettings() {
  const d = useSyncExternalStore(drafting.subscribe, drafting.get);
  const dyn = useSyncExternalStore(dynMode.subscribe, dynMode.get);
  const id = useId();
  return (
    <section aria-labelledby={`${id}-drafting`}>
      <h3 id={`${id}-drafting`}>Drafting</h3>
      <fieldset>
        <legend>Object Snap modes</legend>
        <div className="osnap-modes">
          {OSNAP_MODES.map(({ mode, label }) => (
            <label key={mode}>
              <input
                type="checkbox"
                checked={(d.osmode & OSNAP[mode]) !== 0}
                onChange={(e) => drafting.setMode(mode, e.currentTarget.checked)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="setting-row">
        <label htmlFor={`${id}-polar`}>Polar increment angle</label>
        <select
          id={`${id}-polar`}
          value={String(d.polarAngle)}
          onChange={(e) => drafting.configure({ polarAngle: Number(e.currentTarget.value) })}
        >
          {POLAR_ANGLES.map((a) => (
            <option key={a} value={String(a)}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <div className="setting-row">
        <label htmlFor={`${id}-marker`}>AutoSnap marker size</label>
        <span>
          <input
            id={`${id}-marker`}
            type="range"
            min={MARKER_SIZES.min}
            max={MARKER_SIZES.max}
            value={d.markerSize}
            onChange={(e) => drafting.configure({ markerSize: Number(e.currentTarget.value) })}
          />
          <span className="range-value">{d.markerSize}</span>
        </span>
      </div>
      <div className="setting-row">
        <label htmlFor={`${id}-aperture`}>Aperture size</label>
        <span>
          <input
            id={`${id}-aperture`}
            type="range"
            min={APERTURES.min}
            max={APERTURES.max}
            value={d.aperture}
            onChange={(e) => drafting.configure({ aperture: Number(e.currentTarget.value) })}
          />
          <span className="range-value">{d.aperture}</span>
        </span>
      </div>
      <label className="setting-check">
        <input
          type="checkbox"
          checked={d.pdfOsnap}
          onChange={(e) => drafting.configure({ pdfOsnap: e.currentTarget.checked })}
        />
        Snap to PDF underlays (PDFOSNAP)
      </label>
      <label className="setting-check">
        <input
          type="checkbox"
          checked={dyn}
          onChange={(e) => dynMode.set(e.currentTarget.checked)}
        />
        Dynamic Input (F12)
      </label>
    </section>
  );
}

/**
 * "Clear all local data" (PRD FR-F11): asks once, in place, then deletes everything the app
 * keeps on this device and starts afresh.
 */
function LocalData({ onClearAll }: { onClearAll: () => Promise<ClearReport> }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'clearing'>('idle');
  const [failed, setFailed] = useState<readonly string[]>([]);
  const id = useId();
  const clear = () => {
    setStep('clearing');
    void onClearAll().then((r) => {
      setFailed(r.failed);
      setStep('idle');
    });
  };
  return (
    <section aria-labelledby={`${id}-local`}>
      <h3 id={`${id}-local`}>Local data</h3>
      <p>
        Settings, hatch patterns, fonts, plot style tables, linetypes, recent drawings, autosaves
        and the offline copy of the app are kept only in this browser on this device.
      </p>
      {step === 'idle' && (
        <button type="button" className="danger" onClick={() => setStep('confirm')}>
          Clear all local data…
        </button>
      )}
      {step !== 'idle' && (
        <div className="confirm-clear" role="group" aria-label="Clear all local data">
          <p>
            Delete everything Triya keeps on this device? Open drawings close and their unsaved
            changes are lost. Files on your disk are not touched.
          </p>
          <button type="button" className="danger" disabled={step === 'clearing'} onClick={clear}>
            Clear and restart
          </button>
          <button type="button" disabled={step === 'clearing'} onClick={() => setStep('idle')}>
            Cancel
          </button>
        </div>
      )}
      {failed.length > 0 && (
        <p className="message error" role="alert">
          Could not clear {failed.join(', ')}. Close Triya in other tabs and windows, then try
          again.
        </p>
      )}
    </section>
  );
}
