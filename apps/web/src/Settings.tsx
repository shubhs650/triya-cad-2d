// Options (OPTIONS, OP; UI_SPEC.md §1 title bar's Settings, M2-20; tabbed in M7-04): the app's
// per-user settings in AutoCAD 2024's Options dialog's tabs and labels (AutoCAD Help, "Options
// Dialog Box"). Files: the user's files the app draws with, hatch pattern files (M1-50), font
// files (M1-38, M1-37), linetypes, layer states and templates, as AutoCAD's Files tab lists its
// support files. Display: the chrome's theme, the canvas colours, the coordinate display, layout
// elements and fade control. Open and Save: how Triya saves (DXF only, DEC-047) and keeps recovery
// copies. Plot and Publish: plot style tables and plot transparency. System: "Clear all local
// data" (PRD FR-F11). User Preferences: command aliases, shortcut keys and fields. Drafting:
// AutoSnap, AutoTrack and the drafting aids. Selection: pickbox, grips and selection modes.
// Settings apply as they change and are kept between sessions, so the dialog has Close where
// AutoCAD's has OK, Cancel and Apply. One modal <dialog>: focus stays inside and Esc closes it.
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { GripColorsDialog } from './GripColorsDialog';
import { useModalDialog } from './modal-dialog';
import { TooltipAppearanceDialog } from './DraftingSettingsDialog';
import { OPTIONS_TABS, nextTab, optionsDialog, type OptionsTab } from './options-dialog';
import { AUTOSAVE_DELAY_MS } from './recovery';
import { RECENT_MAX } from './recent';
import { OSNAP, OSNAP_MODES } from '@triya/engine';
import {
  AUTOSNAP_MAGNET,
  AUTOSNAP_MARKER,
  AUTOSNAP_TIP,
  AUTOSNAP_TRACK_TIP,
  POLARMODE_SHIFT_ACQUIRE,
  drafting,
} from './drafting';
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
import type { Contrast, Motion } from './theme';

export function Settings({
  preferences,
  onClearAll,
  patterns,
  fonts,
  plotStyles,
  linetypes,
  layerStates,
  templates,
  deviceFonts,
  open,
  onClose,
  onAdd,
  onAddFonts,
  onAddFiles,
  onAddTemplates,
  onEditAliases,
  onEditShortcuts,
}: {
  preferences: PreferencesStore;
  /** Deletes everything on the device; the page reloads unless something could not go. */
  onClearAll: () => Promise<ClearReport>;
  patterns: PatternStore;
  fonts: FontStore;
  plotStyles: SupportFileStore;
  linetypes: SupportFileStore;
  /** The user's layer state files (M5-18 part 3), which -LAYER stAte Import finds by name. */
  layerStates: SupportFileStore;
  /** The user's drawing templates (M5-10 part 2). */
  templates: SupportFileStore;
  deviceFonts: DeviceFonts;
  open: boolean;
  onClose: () => void;
  onAdd: (files: Iterable<File>) => void;
  onAddFonts: (files: Iterable<File>) => void;
  /** Plot style tables, linetype files and layer state files, each to its store. */
  onAddFiles: (files: Iterable<File>) => void;
  /** Drawing templates, each opened to check it before it is kept. */
  onAddTemplates: (files: Iterable<File>) => void;
  /** Opens the Edit Aliases dialog (M3-10). */
  onEditAliases?: () => void;
  /** Opens the Keyboard Shortcuts dialog (M3-10 part 2). */
  onEditShortcuts?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const fontPicker = useRef<HTMLInputElement>(null);
  const { files, notice, error } = useSyncExternalStore(patterns.subscribe, patterns.getSnapshot);
  const fontState = useSyncExternalStore(fonts.subscribe, fonts.getSnapshot);
  const device = useSyncExternalStore(deviceFonts.subscribe, deviceFonts.getSnapshot);

  useModalDialog(dialog, open);

  const { tab } = useSyncExternalStore(optionsDialog.subscribe, optionsDialog.get);
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const panel = (t: OptionsTab) => ({
    role: 'tabpanel',
    id: `${id}-${t}-panel`,
    'aria-labelledby': `${id}-${t}-tab`,
    className: 'options-panel',
    hidden: tab !== t,
  });

  return (
    <dialog ref={dialog} className="settings" aria-labelledby="settings-title" onClose={onClose}>
      <h2 id="settings-title">Options</h2>
      {/* AutoCAD's tabs (options-dialog.ts), a tab list moved along with the arrow keys. */}
      <div
        ref={tabs}
        role="tablist"
        aria-label="Options"
        className="cad-dialog-tabs options-tabs"
        onKeyDown={(e) => {
          const to = nextTab(tab, e.key);
          if (!to) return;
          e.preventDefault();
          optionsDialog.showTab(to);
          tabs.current?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-${to}-tab`)}`)?.focus();
        }}
      >
        {OPTIONS_TABS.map(({ tab: t, label }) => (
          <button
            key={t}
            id={`${id}-${t}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`${id}-${t}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => optionsDialog.showTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Every tab stays mounted, hidden while another shows, so what a tab holds (a file being
          added, Clear all local data's question) outlives switching tabs, as AutoCAD's does. */}
      <div {...panel('files')}>
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
            Your SHX, TrueType and OpenType files draw the text styles that name them, instead of
            the bundled stand-in. They stay on this device. You can also drop them on the window.
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
        <SupportFiles
          title="Layer states"
          about="Your .las layer state files, which -LAYER's stAte Import finds by name, as AutoCAD finds them in its support path. stAte EXport keeps the files it writes here too. They stay on this device. You can also drop them on the window."
          empty="No layer state files added."
          listLabel="Layer state files"
          button="Add layer state files…"
          accept=".las"
          testId="layer-state-picker"
          store={layerStates}
          onAdd={onAddFiles}
        />
        <SupportFiles
          title="Templates"
          about="Your .dxf drawing templates, listed in the Select Template dialog (NEW) after the bundled ones. Each is opened as it is added, to check that a drawing can start from it. They stay on this device."
          empty="No templates added."
          listLabel="Template files"
          button="Add templates…"
          accept=".dxf"
          testId="template-picker"
          store={templates}
          onAdd={onAddTemplates}
        />
      </div>
      <div {...panel('display')}>
        <DisplaySettings preferences={preferences} />
      </div>
      <div {...panel('opensave')}>
        <OpenSaveSettings />
      </div>
      <div {...panel('plot')}>
        {/* AutoCAD's Plot and Publish tab: Add or Edit Plot Style Tables. */}
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
        <PlotSettings />
      </div>
      <div {...panel('system')}>
        <LocalData onClearAll={onClearAll} />
        <ErrorReportSettings preferences={preferences} />
      </div>
      <div {...panel('user')}>
        <section aria-labelledby="aliases-title">
          <h3 id="aliases-title">Command aliases</h3>
          <p>Your own aliases, in acad.pgp syntax, run in place of the default ones.</p>
          <button type="button" onClick={onEditAliases}>
            Edit aliases…
          </button>
        </section>
        <section aria-labelledby="shortcuts-title">
          <h3 id="shortcuts-title">Keyboard shortcuts</h3>
          <p>AutoCAD&apos;s shortcut keys (F1–F12, Ctrl+…), and your own for any command.</p>
          <button type="button" onClick={onEditShortcuts}>
            Edit shortcut keys…
          </button>
        </section>
        <UserPreferenceSettings />
      </div>
      <div {...panel('drafting')}>
        <DraftingSettings />
      </div>
      <div {...panel('selection')}>
        <SelectionSettings />
      </div>
      <form method="dialog" className="options-buttons">
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

/**
 * OPTIONS > Display: the colour theme, the canvas colours, how coordinates show and the layout
 * elements (M6-06).
 */
function DisplaySettings({ preferences }: { preferences: PreferencesStore }) {
  const p = useSyncExternalStore(preferences.subscribe, preferences.get);
  const d = useSyncExternalStore(drafting.subscribe, drafting.get);
  const id = useId();
  const setCanvas = (patch: Partial<CanvasColours>) =>
    preferences.update({ canvas: { ...p.canvas, ...patch } });
  return (
    <section>
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
      {/* M7-05: high contrast and reduced motion, each the device's setting unless chosen. */}
      <div className="setting-row">
        <label htmlFor={`${id}-contrast`}>Contrast</label>
        <select
          id={`${id}-contrast`}
          value={p.contrast}
          aria-describedby={`${id}-contrast-note`}
          onChange={(e) => preferences.update({ contrast: e.currentTarget.value as Contrast })}
        >
          <option value="system">Same as system</option>
          <option value="standard">Standard</option>
          <option value="high">High contrast</option>
        </select>
      </div>
      <p className="setting-note" id={`${id}-contrast-note`}>
        High contrast also draws model space and the layout background in black while they keep
        their default colors.
      </p>
      <div className="setting-row">
        <label htmlFor={`${id}-motion`}>Motion</label>
        <select
          id={`${id}-motion`}
          value={p.motion}
          onChange={(e) => preferences.update({ motion: e.currentTarget.value as Motion })}
        >
          <option value="system">Same as system</option>
          <option value="standard">Standard</option>
          <option value="reduced">Reduce motion</option>
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
      <label className="setting-check">
        <input
          type="checkbox"
          checked={d.rolloverTips}
          onChange={(e) => drafting.configure({ rolloverTips: e.currentTarget.checked })}
        />
        Show rollover tooltips (ROLLOVERTIPS)
      </label>
      {/* M6-06: AutoCAD's Options > Display > Layout elements, for a new layout first shown. */}
      <fieldset>
        <legend>Layout elements</legend>
        <label className="setting-check">
          <input
            type="checkbox"
            checked={d.showPageSetupForNewLayouts}
            onChange={(e) =>
              drafting.configure({ showPageSetupForNewLayouts: e.currentTarget.checked })
            }
          />
          Show Page Setup Manager for new layouts (SHOWPAGESETUPFORNEWLAYOUTS)
        </label>
        <label className="setting-check">
          <input
            type="checkbox"
            checked={d.layoutCreateViewport}
            onChange={(e) => drafting.configure({ layoutCreateViewport: e.currentTarget.checked })}
          />
          Create viewport in new layouts (LAYOUTCREATEVIEWPORT)
        </label>
      </fieldset>
      {/* Display > Fade control: what is not in REFEDIT's working set (M5-02 part 5). */}
      <fieldset>
        <legend>Fade control</legend>
        <Slider
          id={`${id}-xfade`}
          label="In-place edit and annotative representations (XFADECTL)"
          range={X_FADES}
          value={d.xFade}
          onChange={(xFade) => drafting.configure({ xFade })}
        />
      </fieldset>
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
 * The Grip size slider's range (M2-59 part 3): AutoCAD's Options slider covers small sizes only;
 * a larger GRIPSIZE set at the command line (up to 255) widens it to show where it is.
 */
const GRIP_SLIDER = { min: 1, max: 20 } as const;

/**
 * The Options dialog's Selection tab's "Selection preview" (AutoCAD 2024 Help, "Selection Tab
 * (Options Dialog Box)"): SELECTIONPREVIEW's bits 2 and 1 (M3-04 part 5).
 */
const SELECTION_PREVIEW_CHECKS = [
  { bit: 2, label: 'When a command is active' },
  { bit: 1, label: 'When no command is active' },
] as const;

/**
 * OPTIONS > Drafting's AutoSnap Settings, AUTOSNAP's bits but POLAR's and OTRACK's (the status
 * bar's buttons) and AutoTrack's tooltip (a group of its own), labelled as AutoCAD 2024's Options
 * dialog labels them (M2-59).
 */
const AUTOSNAP_CHECKS = [
  { bit: AUTOSNAP_MARKER, label: 'Marker' },
  { bit: AUTOSNAP_MAGNET, label: 'Magnet' },
  { bit: AUTOSNAP_TIP, label: 'Display AutoSnap tooltip' },
] as const;

/** A slider with its value beside it, as the Options dialog's sizes and fades show. */
function Slider(props: {
  id: string;
  label: string;
  range: { readonly min: number; readonly max: number };
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="setting-row">
      <label htmlFor={props.id}>{props.label}</label>
      <span>
        <input
          id={props.id}
          type="range"
          min={props.range.min}
          max={Math.max(props.range.max, props.value)}
          value={props.value}
          onChange={(e) => props.onChange(Number(e.currentTarget.value))}
        />
        <span className="range-value">{props.value}</span>
      </span>
    </div>
  );
}

/** A check box for a setting, labelled with what AutoCAD calls it. */
function Check(props: { checked: boolean; onChange: (on: boolean) => void; children: string }) {
  return (
    <label className="setting-check">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      {props.children}
    </label>
  );
}

/** XFADECTL's range (AutoCAD 2024 system variable reference): 0 to 90 percent. */
const X_FADES = { min: 0, max: 90 } as const;
/** PICKBOX's range: 0 to 50 pixels. */
const PICKBOXES = { min: 0, max: 50 } as const;

/**
 * OPTIONS > Open and Save (M7-04), as Triya's are fixed: it saves AutoCAD 2018 DXF only (DEC-047),
 * keeps a recovery copy of each changed drawing on this device a few seconds after its last edit
 * (M2-14) where AutoCAD's SAVETIME counts minutes, and lists the drawings opened last.
 */
function OpenSaveSettings() {
  const id = useId();
  return (
    <section>
      <fieldset>
        <legend>File Save</legend>
        <div className="setting-row">
          <label htmlFor={`${id}-saveas`}>Save as</label>
          <select id={`${id}-saveas`} disabled value="AC1032">
            <option value="AC1032">AutoCAD 2018 DXF (*.dxf)</option>
          </select>
        </div>
        <p>Drawings are saved as DXF files only, whatever they were opened from.</p>
      </fieldset>
      <fieldset>
        <legend>File Safety Precautions</legend>
        <p>
          Automatic save: a recovery copy of each changed drawing is kept on this device{' '}
          {AUTOSAVE_DELAY_MS / 1000} seconds after its last edit, and offered again after a crash
          (DRAWINGRECOVERY).
        </p>
      </fieldset>
      <fieldset>
        <legend>File Open</legend>
        <div className="setting-row">
          <label htmlFor={`${id}-recent`}>Number of recently-used files</label>
          <output id={`${id}-recent`}>{RECENT_MAX}</output>
        </div>
      </fieldset>
    </section>
  );
}

/** PLOTTRANSPARENCYOVERRIDE's values, as AutoCAD's system variable reference describes them. */
const PLOT_TRANSPARENCY = [
  { value: 1, label: 'As each page setup or plot says' },
  { value: 0, label: 'Never' },
  { value: 2, label: 'Always' },
] as const;

/** OPTIONS > Plot and Publish (M7-04): whether plots show object transparency (M6-04 part 2). */
function PlotSettings() {
  const d = useSyncExternalStore(drafting.subscribe, drafting.get);
  const id = useId();
  return (
    <fieldset>
      <legend>Plot transparency (PLOTTRANSPARENCYOVERRIDE)</legend>
      {PLOT_TRANSPARENCY.map(({ value, label }) => (
        <label key={value} className="setting-check">
          <input
            type="radio"
            name={`${id}-transparency`}
            checked={d.plotTransparencyOverride === value}
            onChange={() => drafting.configure({ plotTransparencyOverride: value })}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * OPTIONS > System > Error reports (M7-08, PRD §8 G6): whether the app offers to send a report
 * when a problem occurs. Each report is shown in full and sent only on Send Report.
 */
function ErrorReportSettings({ preferences }: { preferences: PreferencesStore }) {
  const p = useSyncExternalStore(preferences.subscribe, preferences.get);
  const id = useId();
  return (
    <section aria-labelledby={`${id}-reports`}>
      <h3 id={`${id}-reports`}>Error reports</h3>
      <p>
        A report holds the error, your browser, the app version and counts of what the drawing
        holds, never its text, names, file names or paths. You see it before anything is sent.
      </p>
      <label className="setting-check">
        <input
          type="checkbox"
          checked={p.errorReports}
          onChange={(e) => preferences.update({ errorReports: e.currentTarget.checked })}
        />
        Offer to send an error report when a problem occurs
      </label>
    </section>
  );
}

/** OPTIONS > User Preferences > Fields (M7-04): FIELDDISPLAY (M4-10 part 3). */
function UserPreferenceSettings() {
  const d = useSyncExternalStore(drafting.subscribe, drafting.get);
  return (
    <fieldset>
      <legend>Fields</legend>
      <Check
        checked={d.fieldDisplay}
        onChange={(fieldDisplay) => drafting.configure({ fieldDisplay })}
      >
        Display background of fields (FIELDDISPLAY)
      </Check>
    </fieldset>
  );
}

/**
 * OPTIONS > Drafting: AutoSnap and AutoTrack settings (AUTOSNAP's bits but POLAR's and OTRACK's,
 * M2-59), the marker and aperture sizes, Alignment point acquisition (POLARMODE 8, M3-06 part 3),
 * PDFOSNAP and Drafting Tooltip Settings (DSETTINGS' Tooltip Appearance, M3-06 part 8); and the
 * drafting aids DSETTINGS also sets (the running object snap modes, the polar increment and
 * Dynamic Input), which the status bar's buttons follow and the preferences keep.
 */
function DraftingSettings() {
  const d = useSyncExternalStore(drafting.subscribe, drafting.get);
  const dyn = useSyncExternalStore(dynMode.subscribe, dynMode.get);
  const id = useId();
  const [appearance, setAppearance] = useState(false);
  const autosnap = (bit: number, label: string) => (
    <Check
      key={bit}
      checked={(d.autosnap & bit) !== 0}
      onChange={(on) => drafting.configure({ autosnap: on ? d.autosnap | bit : d.autosnap & ~bit })}
    >
      {label}
    </Check>
  );
  return (
    <section>
      <fieldset>
        <legend>AutoSnap Settings</legend>
        {AUTOSNAP_CHECKS.map(({ bit, label }) => autosnap(bit, label))}
      </fieldset>
      <Slider
        id={`${id}-marker`}
        label="AutoSnap marker size"
        range={MARKER_SIZES}
        value={d.markerSize}
        onChange={(markerSize) => drafting.configure({ markerSize })}
      />
      <fieldset>
        <legend>AutoTrack Settings</legend>
        {autosnap(AUTOSNAP_TRACK_TIP, 'Display AutoTrack tooltip')}
      </fieldset>
      <fieldset>
        <legend>Alignment point acquisition</legend>
        {[
          { shift: false, label: 'Automatic' },
          { shift: true, label: 'Shift to acquire' },
        ].map(({ shift, label }) => (
          <label key={label} className="setting-check">
            <input
              type="radio"
              name={`${id}-acquire`}
              checked={((d.polarMode & POLARMODE_SHIFT_ACQUIRE) !== 0) === shift}
              onChange={() =>
                drafting.configure({
                  polarMode: shift
                    ? d.polarMode | POLARMODE_SHIFT_ACQUIRE
                    : d.polarMode & ~POLARMODE_SHIFT_ACQUIRE,
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <Slider
        id={`${id}-aperture`}
        label="Aperture size"
        range={APERTURES}
        value={d.aperture}
        onChange={(aperture) => drafting.configure({ aperture })}
      />
      <fieldset>
        <legend>Object Snap Options</legend>
        <Check checked={d.pdfOsnap} onChange={(pdfOsnap) => drafting.configure({ pdfOsnap })}>
          Snap to PDF underlays (PDFOSNAP)
        </Check>
      </fieldset>
      <button type="button" onClick={() => setAppearance(true)}>
        Drafting Tooltip Settings...
      </button>
      {appearance && (
        <TooltipAppearanceDialog
          value={d.tooltip}
          onOk={(tooltip) => {
            drafting.configure({ tooltip });
            setAppearance(false);
          }}
          onCancel={() => setAppearance(false)}
        />
      )}
      <fieldset>
        <legend>Drafting aids (DSETTINGS)</legend>
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
        <Check checked={dyn} onChange={(on) => dynMode.set(on)}>
          Dynamic Input (F12)
        </Check>
      </fieldset>
    </section>
  );
}

/**
 * OPTIONS > Selection: the pickbox and grip sizes, Grip Colors (M3-05 part 5), Selection modes
 * (PICKFIRST, PICKADD) and Selection preview (SELECTIONPREVIEW, COMMANDPREVIEW; M3-04 part 5).
 */
function SelectionSettings() {
  const d = useSyncExternalStore(drafting.subscribe, drafting.get);
  const id = useId();
  const [gripColors, setGripColors] = useState(false);
  return (
    <section>
      <Slider
        id={`${id}-pickbox`}
        label="Pickbox size"
        range={PICKBOXES}
        value={d.pickbox}
        onChange={(pickbox) => drafting.configure({ pickbox })}
      />
      <Slider
        id={`${id}-grip`}
        label="Grip size"
        range={GRIP_SLIDER}
        value={d.gripSize}
        onChange={(gripSize) => drafting.configure({ gripSize })}
      />
      <div className="setting-row">
        <span>Grip colors</span>
        <button type="button" onClick={() => setGripColors(true)}>
          Grip Colors...
        </button>
      </div>
      {gripColors && (
        // AutoCAD's Options > Selection > Grip Colors (M3-05 part 5): GRIPCOLOR, GRIPHOT,
        // GRIPHOVER and GRIPCONTOUR.
        <GripColorsDialog
          initial={d.gripColors}
          onOk={(c) => {
            drafting.configure({ gripColors: c });
            setGripColors(false);
          }}
          onCancel={() => setGripColors(false)}
        />
      )}
      <fieldset>
        <legend>Selection modes</legend>
        <Check checked={d.pickfirst} onChange={(pickfirst) => drafting.configure({ pickfirst })}>
          Noun/verb selection (PICKFIRST)
        </Check>
        {/* AutoCAD sets PICKADD 0 when checked, and its initial 2 when not. */}
        <Check
          checked={d.pickadd === 0}
          onChange={(on) => drafting.configure({ pickadd: on ? 0 : 2 })}
        >
          Use Shift to add to selection (PICKADD)
        </Check>
      </fieldset>
      <fieldset>
        <legend>Selection preview (SELECTIONPREVIEW)</legend>
        {SELECTION_PREVIEW_CHECKS.map(({ bit, label }) => (
          <Check
            key={bit}
            checked={(d.selectionPreview & bit) !== 0}
            onChange={(on) =>
              drafting.configure({
                selectionPreview: on ? d.selectionPreview | bit : d.selectionPreview & ~bit,
              })
            }
          >
            {label}
          </Check>
        ))}
        <Check
          checked={d.commandPreview === 1}
          onChange={(on) => drafting.configure({ commandPreview: on ? 1 : 0 })}
        >
          Command preview (COMMANDPREVIEW)
        </Check>
      </fieldset>
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
