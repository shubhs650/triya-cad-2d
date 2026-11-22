// Firefox and Safari's degraded mode (M7-09, PRD §8, DEC-023): Chromium has the full feature set;
// elsewhere the app keeps working through other routes, and a first-run notice says what differs.
// Each route is decided where it is used, from the same API being present (save-browser.ts,
// reference-files.ts, system-clipboard.ts, App.tsx's launch queue); this module only names the
// differences for the notice, from the same checks, so the notice never promises what the code
// does not do.
import { CLIPBOARD_FORMAT } from './system-clipboard';

/** The Chromium APIs the full feature set rests on. */
export interface BrowserFeatures {
  /** File System Access save picker: Save writes over the file it opened (save.ts). */
  readonly saveInPlace: boolean;
  /**
   * Handles for dropped files and folders (`getAsFileSystemHandle`): the folders dropped for
   * references are kept for later sessions (reference-files.ts).
   */
  readonly keptFolders: boolean;
  /** Web custom clipboard formats: copied objects paste in other windows (system-clipboard.ts). */
  readonly systemClipboard: boolean;
  /** The launch queue: the installed app opens .dwg and .dxf files from the desktop. */
  readonly openWith: boolean;
}

/** The parts of `window` read here; any of them may be missing. */
type FeatureWindow = Readonly<Record<string, unknown>>;

const isFunction = (v: unknown): boolean => typeof v === 'function';

export function browserFeatures(win: FeatureWindow): BrowserFeatures {
  const item = win['ClipboardItem'] as { supports?: unknown } | undefined;
  const supports = item?.supports;
  return {
    saveInPlace: isFunction(win['showSaveFilePicker']),
    keptFolders: isFunction(
      (win['DataTransferItem'] as { prototype?: { getAsFileSystemHandle?: unknown } } | undefined)
        ?.prototype?.getAsFileSystemHandle,
    ),
    systemClipboard:
      typeof supports === 'function' && (supports as (t: string) => boolean)(CLIPBOARD_FORMAT),
    openWith: isFunction(
      (win['launchQueue'] as { setConsumer?: unknown } | undefined)?.setConsumer,
    ),
  };
}

export interface BrowserLimit {
  readonly id: 'save' | 'folders' | 'clipboard' | 'open-with';
  readonly text: string;
}

/** What this browser does differently, in the order a drafter meets it. */
export function browserLimits(f: BrowserFeatures): readonly BrowserLimit[] {
  const out: BrowserLimit[] = [];
  if (!f.saveInPlace)
    out.push({
      id: 'save',
      text: 'Save and Save As download the drawing as a DXF file instead of saving over the file you opened.',
    });
  if (!f.keptFolders)
    out.push({
      id: 'folders',
      text: 'Folders you drop for references are used until you close the page; drop them again next time.',
    });
  if (!f.systemClipboard)
    out.push({
      id: 'clipboard',
      text: 'Copied objects paste in this window only; they are not put on the system clipboard.',
    });
  if (!f.openWith)
    out.push({
      id: 'open-with',
      text: 'Drawings open with Open or by dropping them on the window, not by double-clicking the file.',
    });
  return out;
}

/**
 * The notice shows on the first visit in a browser with limits, once the stored settings say it
 * was not dismissed before (so it never flashes up before they arrive).
 */
export function showBrowserNotice(
  limits: readonly BrowserLimit[],
  s: { readonly loaded: boolean; readonly seen: boolean },
): boolean {
  return limits.length > 0 && s.loaded && !s.seen;
}
