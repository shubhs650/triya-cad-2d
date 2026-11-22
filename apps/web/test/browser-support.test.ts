// M7-09: what the app does differently in a browser without Chromium's file and clipboard APIs
// (PRD §8, DEC-023), which the first-run compatibility notice lists.
import { describe, expect, it } from 'vitest';
import { browserFeatures, browserLimits, showBrowserNotice } from '../src/browser-support';
import { CLIPBOARD_FORMAT } from '../src/system-clipboard';
import { DEFAULT_PREFERENCES, normalizePreferences } from '../src/preferences';

const fn = () => undefined;
/** Chromium's window as the app sees it: every API the full feature set uses. */
const CHROMIUM = {
  showSaveFilePicker: fn,
  showOpenFilePicker: fn,
  DataTransferItem: { prototype: { getAsFileSystemHandle: fn } },
  launchQueue: { setConsumer: fn },
  ClipboardItem: { supports: (type: string) => type === CLIPBOARD_FORMAT || type === 'image/png' },
};
/** Firefox: no File System Access, no launch queue, no web custom clipboard formats. */
const FIREFOX = { ClipboardItem: { supports: (type: string) => !type.startsWith('web ') } };
/** Safari 17: ClipboardItem without `supports`. */
const SAFARI = { ClipboardItem: {} };

describe('browserFeatures', () => {
  it('finds the full feature set in Chromium', () => {
    expect(browserFeatures(CHROMIUM)).toEqual({
      saveInPlace: true,
      keptFolders: true,
      systemClipboard: true,
      openWith: true,
    });
  });

  it('finds none of them in Firefox or Safari', () => {
    const none = {
      saveInPlace: false,
      keptFolders: false,
      systemClipboard: false,
      openWith: false,
    };
    expect(browserFeatures(FIREFOX)).toEqual(none);
    expect(browserFeatures(SAFARI)).toEqual(none);
    expect(browserFeatures({})).toEqual(none);
  });

  it('takes a property that is not a function for a missing API', () => {
    expect(browserFeatures({ ...CHROMIUM, showSaveFilePicker: true }).saveInPlace).toBe(false);
  });
});

describe('browserLimits', () => {
  it('lists nothing in Chromium', () => {
    expect(browserLimits(browserFeatures(CHROMIUM))).toEqual([]);
  });

  it('names each thing the browser does differently, Save first', () => {
    const limits = browserLimits(browserFeatures(FIREFOX));
    expect(limits.map((l) => l.id)).toEqual(['save', 'folders', 'clipboard', 'open-with']);
    expect(limits[0]!.text).toMatch(/download/i);
    expect(limits[1]!.text).toMatch(/folders/i);
    expect(limits[2]!.text).toMatch(/clipboard/i);
    expect(limits[3]!.text).toMatch(/Open/);
  });

  it('lists only what is missing', () => {
    const f = { ...browserFeatures(CHROMIUM), systemClipboard: false };
    expect(browserLimits(f).map((l) => l.id)).toEqual(['clipboard']);
  });
});

describe('showBrowserNotice', () => {
  const limits = browserLimits(browserFeatures(FIREFOX));

  it('shows once the settings are read, until it is dismissed', () => {
    expect(showBrowserNotice(limits, { loaded: true, seen: false })).toBe(true);
    expect(showBrowserNotice(limits, { loaded: true, seen: true })).toBe(false);
  });

  it('waits for the stored settings, so a dismissed notice never flashes', () => {
    expect(showBrowserNotice(limits, { loaded: false, seen: false })).toBe(false);
  });

  it('never shows in a browser with the full feature set', () => {
    expect(showBrowserNotice([], { loaded: true, seen: false })).toBe(false);
  });

  it('is remembered in the preferences, not seen by default', () => {
    expect(DEFAULT_PREFERENCES.browserNoticeSeen).toBe(false);
    expect(normalizePreferences({ browserNoticeSeen: true }).browserNoticeSeen).toBe(true);
    expect(normalizePreferences({ browserNoticeSeen: 'yes' }).browserNoticeSeen).toBe(false);
  });
});
