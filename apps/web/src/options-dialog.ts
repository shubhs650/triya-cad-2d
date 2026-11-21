// The Options dialog's state (M7-04): open or not, the tab it shows, and what OPTIONS waits for
// (the dialog to close). The title bar's Settings button, the Ctrl+K palette's Settings and
// OPTIONS (OP) at the command line all open the same dialog.

/**
 * The Options dialog's tabs, in AutoCAD 2024's order (AutoCAD Help, "Options Dialog Box"). Its 3D
 * Modeling tab is left out (PRD non-goal: no 3D) and so is Profiles: Triya keeps one set of
 * settings per browser, which "Clear all local data" (System) resets.
 */
export const OPTIONS_TABS = [
  { tab: 'files', label: 'Files' },
  { tab: 'display', label: 'Display' },
  { tab: 'opensave', label: 'Open and Save' },
  { tab: 'plot', label: 'Plot and Publish' },
  { tab: 'system', label: 'System' },
  { tab: 'user', label: 'User Preferences' },
  { tab: 'drafting', label: 'Drafting' },
  { tab: 'selection', label: 'Selection' },
] as const;

export type OptionsTab = (typeof OPTIONS_TABS)[number]['tab'];

export interface OptionsState {
  readonly open: boolean;
  /** The tab shown, kept while the dialog is closed: AutoCAD opens it on the tab shown last. */
  readonly tab: OptionsTab;
}

/** The tab `key` moves to from `tab` in the tab list (ARIA's tabs pattern), wrapping around. */
export function nextTab(tab: OptionsTab, key: string): OptionsTab | undefined {
  const i = OPTIONS_TABS.findIndex((t) => t.tab === tab);
  const n = OPTIONS_TABS.length;
  const to =
    key === 'ArrowRight'
      ? (i + 1) % n
      : key === 'ArrowLeft'
        ? (i + n - 1) % n
        : key === 'Home'
          ? 0
          : key === 'End'
            ? n - 1
            : undefined;
  return to === undefined ? undefined : OPTIONS_TABS[to]!.tab;
}

export function createOptionsDialog() {
  let state: OptionsState = { open: false, tab: 'files' };
  let waiting: (() => void)[] = [];
  const listeners = new Set<() => void>();
  const set = (patch: Partial<OptionsState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };
  return {
    get: (): OptionsState => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Shows the dialog (on the tab shown last); resolves when it closes. */
    show(): Promise<void> {
      if (!state.open) set({ open: true });
      return new Promise((resolve) => waiting.push(resolve));
    },
    showTab(tab: OptionsTab) {
      if (tab !== state.tab) set({ tab });
    },
    close() {
      if (state.open) set({ open: false });
      const done = waiting;
      waiting = [];
      for (const d of done) d();
    },
  };
}

export type OptionsDialog = ReturnType<typeof createOptionsDialog>;

export const optionsDialog = createOptionsDialog();
