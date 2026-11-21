// The Page Setup Manager (M6-01 part 3), PAGESETUP's dialog and the layout tab menu's Page Setup
// Manager..., with AutoCAD 2024's structure and labels (UI_SPEC.md §7; AutoCAD Help, "Page Setup
// Manager", "New Page Setup Dialog Box", "Page Setup Dialog Box", "Import Page Setups Dialog Box"):
//
//   - Current layout: the space shown (Model or the layout's name).
//   - Page setups: "Current page setup:" (the named page setup the layout has applied, LAYOUT
//     DXF 1, else <None>), and the list: the layout's own page setup as *Layout1* (with the name
//     it has applied in brackets), then the drawing's named page setups of the space's kind. A row
//     is selected by a click or the arrow keys; double-click sets it current; the shortcut menu
//     (right-click, Shift+F10) offers Set Current, Rename and Delete; F2 renames in place and
//     Delete deletes.
//   - Set Current copies the selected page setup into the layout's and names it there, New...
//     opens New Page Setup (the name, Setup1 by default, and Start with: <None>, <Default output
//     device>, <Previous plot>, the layout's own and the named ones) and then the Page Setup
//     dialog, Modify... opens the Page Setup dialog on the selected page setup, Import... reads a
//     drawing's named page setups into Import Page Setups (Name and Location; a name the drawing
//     has asks to redefine it).
//   - Selected page setup details: its plot size, plot area and scale.
//
// The Page Setup dialog is the Plot dialog's form (`PlotForm`): OK saves the settings into the
// page setup (a layout's own as Apply to Layout does), Cancel leaves it. Its Window< hides the
// dialogs and hands back to PAGESETUP, which asks for the corners as PLOT does and opens them
// again with the window picked. Triya's plotters are the dialog's own, not the page setup's, so
// <Default output device> starts as <None> does, and Device name is not listed in the details.
// Each change is one PAGESETUP (or LAYOUT) undo step at once, as AutoCAD's: Close does not take
// them back. M6-06: "Display when creating a new layout" (bottom left, as AutoCAD's) is
// SHOWPAGESETUPFORNEWLAYOUTS, which opens the manager on a new layout first shown (the engine's
// layout-init.ts); the Page Setup dialog's Preview... shows the plot preview of its settings, as
// the Plot dialog's does, and the dialogs come back as they were when it closes.
import {
  PAGE_SETUP_NAME_INVALID,
  namedPageSetups,
  pageSetupInitOf,
  type Box,
  type EngineEdit,
  type Handle,
  type NamedPageSetup,
} from '@triya/engine';
import type { PlotStyleTable } from '@triya/render';
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import type { CanvasController } from './canvas/controller';
import { controllerOf, controllersOf } from './canvas/registry';
import { drawingFileModel } from './dimstyle-import';
import type { OpenDocument } from './documents';
import { engines } from './engine/registry';
import {
  appliedPageSetup,
  defaultPlotSettings,
  newPageSetupSpace,
  pageSetupsOf,
  paperMm,
  withPageSetup,
  type PlotSettings,
  type PlotSpace,
} from './plot';
import { drafting } from './drafting';
import { lastPlotSettings, previewMode, previewOf } from './plot-preview';
import { PlotForm } from './PlotDialog';
import { drawingObjects, drawingRecords } from './saved-views';

/** What the Page Setup dialog edits: the layout's own page setup, a named one, or a new one. */
type Target =
  | { readonly kind: 'own' }
  | { readonly kind: 'named'; readonly handle: Handle; readonly name: string }
  | { readonly kind: 'new'; readonly name: string };

/** The Page Setup dialog open: what it edits, the space as it plots it, and its settings. */
interface Editing {
  readonly target: Target;
  readonly space: PlotSpace;
  readonly settings: PlotSettings;
}

/** The list's row of the layout's own page setup (a handle is never empty). */
const OWN = '';

/**
 * Which drawing the manager is open for, if any. PAGESETUP opens it (`show`) and waits until it
 * closes: true when the Page Setup dialog's Window< closed it, its state kept until PAGESETUP
 * shows it again (`resume`) with the window picked, or as it was after Esc at the corners.
 */
export const pageSetupManager = (() => {
  let open: number | undefined;
  let kept: { doc: number; block: string; selected: string; editing: Editing } | undefined;
  let done: ((pickWindow: boolean) => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: number | undefined) => {
    open = v;
    for (const l of listeners) l();
  };
  const finish = (pickWindow: boolean) => {
    const d = done;
    done = undefined;
    d?.(pickWindow);
  };
  return {
    get: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    show(
      doc: number,
      again: { window?: Box | undefined; resume?: boolean } = {},
    ): Promise<boolean> {
      finish(false);
      const { window, resume } = again;
      if (resume && kept?.doc === doc) {
        if (window) {
          const e = kept.editing;
          kept = {
            ...kept,
            editing: { ...e, settings: { ...e.settings, area: 'window', window } },
          };
        }
      } else kept = undefined;
      set(doc);
      return new Promise((resolve) => (done = resolve));
    },
    /** The state to reopen a space's manager with, after Window< in its Page Setup dialog. */
    resume(doc: number, block: string) {
      if (kept?.doc !== doc || kept.block !== block) return undefined;
      const k = kept;
      kept = undefined;
      return k;
    },
    /**
     * The Page Setup dialog's Preview... (M6-06): hides the dialogs, keeping their state, while
     * `show` shows the preview, then shows them again; PAGESETUP waits on throughout.
     */
    async preview(
      doc: number,
      block: string,
      selected: string,
      editing: Editing,
      show: () => Promise<void>,
    ) {
      kept = { doc, block, selected, editing };
      set(undefined);
      await show();
      if (kept?.doc === doc && done) set(doc);
    },
    /** Window<: hides the dialogs, keeping their state, for PAGESETUP to ask for the corners. */
    pickWindow(doc: number, block: string, selected: string, editing: Editing) {
      kept = { doc, block, selected, editing };
      set(undefined);
      finish(true);
    },
    close() {
      kept = undefined;
      set(undefined);
      finish(false);
    },
  };
})();

export function PageSetupManager({
  doc,
  userTables,
  underlayFile,
  edited,
}: {
  doc: OpenDocument | undefined;
  /** The plot style tables added in Settings. */
  userTables?: () => ReadonlyMap<string, PlotStyleTable>;
  /** A PDF underlay's file, for the preview. */
  underlayFile?: (fileName: string) => Uint8Array | undefined;
  edited: (id: number) => void;
}) {
  const open = useSyncExternalStore(pageSetupManager.subscribe, pageSetupManager.get);
  if (!doc || open !== doc.id) return null;
  const controller = controllerOf(doc.id, doc.block);
  if (!controller) return null;
  return (
    <ManagerBody
      key={`${doc.id}:${doc.block}`}
      doc={doc}
      controller={controller}
      {...(userTables && { userTables })}
      {...(underlayFile && { underlayFile })}
      edited={edited}
    />
  );
}

/** A question asked before going on: Import's "redefine it?". */
type Asking = { readonly name: string; readonly yes: () => void; readonly no: () => void };

/** The plot area and scale as the details list them. */
function areaText(s: PlotSettings): string {
  const area = {
    layout: 'Layout',
    extents: 'Extents',
    display: 'Display',
    limits: 'Limits',
    view: 'View',
    window: 'Window',
  }[s.area];
  const scale = s.fit ? 'Fit to paper' : `${s.scale.mm} mm = ${s.scale.units} units`;
  return `${area}, ${scale}`;
}

function ManagerBody({
  doc,
  controller,
  userTables,
  underlayFile,
  edited,
}: {
  doc: OpenDocument;
  controller: CanvasController;
  userTables?: () => ReadonlyMap<string, PlotStyleTable>;
  underlayFile?: (fileName: string) => Uint8Array | undefined;
  edited: (id: number) => void;
}) {
  const showForNew = useSyncExternalStore(
    drafting.subscribe,
    () => drafting.get().showPageSetupForNewLayouts,
  );
  const [own, setOwn] = useState<PlotSpace>();
  const [selected, setSelected] = useState<string>(OWN);
  const [editing, setEditing] = useState<Editing>();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [importing, setImporting] = useState<{
    file: string;
    setups: NamedPageSetup[];
    init: (p: NamedPageSetup) => ReturnType<typeof pageSetupInitOf>;
  }>();
  const [asking, setAsking] = useState<Asking>();
  const [message, setMessage] = useState<{ text: string; problem: boolean }>();
  const listRef = useRef<HTMLUListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const appIds = () => drawingRecords(doc.opened.init, engines.changesOf(doc.id), 'appIds');
  /** Every named page setup of the drawing, both kinds (names are unique across them). */
  const allSetups = () => {
    const objects = drawingObjects(doc.opened.init, engines.changesOf(doc.id));
    return [...pageSetupsOf(objects, true), ...pageSetupsOf(objects, false)];
  };

  const read = async (): Promise<PlotSpace> => {
    const sp = { ...(await controller.plotSpace()), userTables: userTables?.() };
    setOwn(sp);
    return sp;
  };

  useEffect(() => {
    let live = true;
    void read().then(() => {
      if (!live) return;
      const kept = pageSetupManager.resume(doc.id, doc.block);
      if (kept) {
        setSelected(kept.selected);
        setEditing(kept.editing);
      }
    });
    return () => {
      live = false;
    };
    // Read once, as the dialog opens; edits read again where they happen.
  }, []);

  const rows = own
    ? [
        {
          key: OWN,
          label: `*${own.name}${own.pageSetupName ? ` (${own.pageSetupName})` : ''}*`,
          page: undefined as NamedPageSetup | undefined,
        },
        ...(own.pageSetups ?? []).map((p) => ({ key: p.handle, label: p.name, page: p })),
      ]
    : [];
  const row = rows.find((r) => r.key === selected) ?? rows[0];

  const focusRow = (key: string) =>
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`li[data-key="${CSS.escape(key)}"]`)?.focus(),
    );

  /** Runs an edit; on success the drawing changed and the list reads it again. */
  const run = async (edit: EngineEdit): Promise<PlotSpace | undefined> => {
    const r = await engines.edit(doc.id, edit);
    if (!r.ok) {
      setMessage({ text: r.message, problem: true });
      return undefined;
    }
    setMessage(undefined);
    if (Object.keys(r.change).length > 0) {
      await Promise.all(controllersOf(doc.id).map((c) => c.flush()));
      edited(doc.id);
    }
    return read();
  };

  const selectNamed = (sp: PlotSpace, name: string) => {
    const p = sp.pageSetups?.find((x) => x.name.toUpperCase() === name.toUpperCase());
    const key = p?.handle ?? OWN;
    setSelected(key);
    focusRow(key);
  };

  const setCurrent = async () => {
    const layout = own?.pageSetup?.layout;
    if (!row?.page || !layout) return;
    const sp = await run({ kind: 'page-setup-current', setup: row.page.handle, layout });
    if (sp) setMessage({ text: `"${row.page.name}" is the current page setup.`, problem: false });
  };

  const remove = async () => {
    if (!row?.page) return;
    const at = rows.indexOf(row);
    if (!(await run({ kind: 'page-setup-delete', setup: row.page.handle }))) return;
    const next = rows.filter((r) => r !== row)[Math.min(at, rows.length - 2)]?.key ?? OWN;
    setSelected(next);
    focusRow(next);
  };

  const rename = async (to: string) => {
    setRenaming(false);
    if (row?.page && to !== '' && to !== row.page.name)
      await run({ kind: 'page-setup-edit', setup: row.page.handle, name: to });
    focusRow(selected);
  };

  /** Modify...: the Page Setup dialog on the selected page setup. */
  const modify = () => {
    if (!own || !row) return;
    setMessage(undefined);
    try {
      const space = row.page ? withPageSetup(own, row.page.name, appIds()) : own;
      const target: Target = row.page
        ? { kind: 'named', handle: row.page.handle, name: row.page.name }
        : { kind: 'own' };
      setEditing({ target, space, settings: defaultPlotSettings(space) });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), problem: true });
    }
  };

  /** New Page Setup's OK: the Page Setup dialog on what it starts with. */
  const startNew = (name: string, start: string) => {
    if (!own) return;
    setCreating(false);
    let space: PlotSpace;
    let settings: PlotSettings | undefined;
    if (start === START.previous) {
      space = { ...own, pageSetupName: undefined };
      settings = lastPlotSettings.get(doc.id, doc.block);
    } else if (start === START.own) space = { ...own, pageSetupName: undefined };
    else if (start === START.none || start === START.device) space = newPageSetupSpace(own);
    else space = withPageSetup(own, start, appIds());
    setEditing({
      target: { kind: 'new', name },
      space,
      settings: settings ?? defaultPlotSettings(space),
    });
  };

  /** The Page Setup dialog's OK. */
  /** Preview...: the plot the dialog's settings make, as the Plot dialog previews it. */
  const preview = async (e: Editing) => {
    setMessage(undefined);
    const title = `${doc.name} - ${e.space.name}`;
    let p;
    try {
      p = await previewOf((r) => controller.plot(r), e.space, e.settings, title, underlayFile);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), problem: true });
      return;
    }
    const { pdf, paper } = p;
    await pageSetupManager.preview(doc.id, doc.block, selected, e, () =>
      previewMode.show({ doc: doc.id, title, pdf, paper }),
    );
  };

  const save = async (e: Editing): Promise<boolean> => {
    let plot;
    try {
      plot = appliedPageSetup(e.settings, e.space);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), problem: true });
      return false;
    }
    const plotTransparency = e.settings.transparency;
    const t = e.target;
    const layout = own?.pageSetup?.layout;
    const edit: EngineEdit | undefined =
      t.kind === 'own'
        ? layout === undefined
          ? undefined
          : { kind: 'layout', layout, plot, plotTransparency }
        : t.kind === 'named'
          ? { kind: 'page-setup-edit', setup: t.handle, plot, plotTransparency }
          : {
              kind: 'page-setup-new',
              setup: { name: t.name, model: own?.sheet === undefined, plot, plotTransparency },
            };
    if (!edit) return false;
    const sp = await run(edit);
    if (!sp) return false;
    setEditing(undefined);
    if (t.kind === 'own') {
      setSelected(OWN);
      focusRow(OWN);
    } else selectNamed(sp, t.name);
    return true;
  };

  const importFile = async (file: File) => {
    setMessage(undefined);
    let source;
    try {
      source = await drawingFileModel(file);
    } catch (e) {
      const why = e instanceof Error ? e.message : 'The file could not be read.';
      setMessage({ text: `${file.name}: ${why}`, problem: true });
      return;
    }
    const setups = namedPageSetups(source);
    if (setups.length === 0) {
      setMessage({ text: `${file.name} has no named page setups.`, problem: true });
      return;
    }
    setImporting({ file: file.name, setups, init: (p) => pageSetupInitOf(source, p) });
  };

  /** Import Page Setups' OK: a name the drawing has asks to redefine it first, one by one. */
  const importSetups = (picked: NamedPageSetup[]) => {
    if (!importing) return;
    const { init } = importing;
    setImporting(undefined);
    const have = allSetups();
    const taken: NamedPageSetup[] = [];
    const next = async (i: number): Promise<void> => {
      const p = picked[i];
      if (!p) {
        setAsking(undefined);
        if (taken.length === 0) return;
        const sp = await run({
          kind: 'page-setup-import',
          setups: taken.map(init),
          replace: true,
        });
        if (!sp) return;
        const names = taken.map((x) => x.name);
        setMessage({
          text: `Page setup${names.length > 1 ? 's' : ''} imported: ${names.join(', ')}.`,
          problem: false,
        });
        // One of the space's kind is selected, when one came.
        const mine = taken.filter((x) => x.model === (sp.sheet === undefined)).at(-1);
        if (mine) selectNamed(sp, mine.name);
        return;
      }
      const clash = have.find((h) => h.name.toUpperCase() === p.name.toUpperCase());
      if (clash) {
        setAsking({
          name: clash.name,
          yes: () => {
            taken.push(p);
            void next(i + 1);
          },
          no: () => void next(i + 1),
        });
      } else {
        taken.push(p);
        await next(i + 1);
      }
    };
    void next(0);
  };

  const onListKey = (e: KeyboardEvent) => {
    if (renaming) return;
    const at = row ? rows.indexOf(row) : -1;
    const go = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!r) return;
      e.preventDefault();
      setSelected(r.key);
      focusRow(r.key);
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'Enter') {
      // Not the dialog's Close: Enter on a named page setup sets it current, as a double-click.
      e.preventDefault();
      e.stopPropagation();
      if (row?.page) void setCurrent();
    } else if (e.key === 'F2' && row?.page) {
      e.preventDefault();
      setRenaming(true);
    } else if (e.key === 'Delete' && row?.page) {
      e.preventDefault();
      void remove();
    } else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      const r = (e.target as HTMLElement).getBoundingClientRect();
      setMenu({ x: r.left + 16, y: r.bottom });
    }
  };

  const details = (() => {
    if (!own || !row) return undefined;
    try {
      const sp = row.page ? withPageSetup(own, row.page.name, appIds()) : own;
      const s = defaultPlotSettings(sp);
      const paper = paperMm(s, sp);
      return {
        size: `${paper.width.toFixed(2)} x ${paper.height.toFixed(2)} mm (${s.orientation === 'landscape' ? 'Landscape' : 'Portrait'})`,
        area: areaText(s),
        table: sp.pageSetup?.styleSheet || 'None',
      };
    } catch {
      return undefined;
    }
  })();

  const layout = own?.pageSetup?.layout;
  return (
    <Modal
      label="Page Setup Manager"
      className="page-setup-manager"
      onOk={() => !editing && !creating && pageSetupManager.close()}
      onCancel={() => pageSetupManager.close()}
    >
      {!own ? (
        <p className="plot-loading">Reading the drawing…</p>
      ) : (
        <>
          <p className="page-setup-current-layout">
            Current layout: <strong>{own.name}</strong>
          </p>
          <fieldset className="page-setup-list">
            <legend>Page setups</legend>
            <p>
              Current page setup: <strong>{own.pageSetupName ?? '<None>'}</strong>
            </p>
            <div className="page-setup-rows">
              <ul ref={listRef} role="listbox" aria-label="Page setups" onKeyDown={onListKey}>
                {rows.map((r) => (
                  <li
                    key={r.key}
                    data-key={r.key}
                    role="option"
                    tabIndex={r === row ? 0 : -1}
                    aria-selected={r === row}
                    onClick={() => setSelected(r.key)}
                    onDoubleClick={() => {
                      setSelected(r.key);
                      if (r.page && layout)
                        void run({ kind: 'page-setup-current', setup: r.page.handle, layout });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSelected(r.key);
                      setMenu({ x: e.clientX, y: e.clientY });
                    }}
                  >
                    {renaming && r === row && r.page ? (
                      <RenameField name={r.page.name} onDone={(to) => void rename(to)} />
                    ) : (
                      r.label
                    )}
                  </li>
                ))}
              </ul>
              <div className="page-setup-actions">
                <button
                  type="button"
                  disabled={!row?.page || !layout}
                  onClick={() => void setCurrent()}
                >
                  Set Current
                </button>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setMessage(undefined);
                    setCreating(true);
                  }}
                >
                  New...
                </button>
                <button type="button" aria-haspopup="dialog" disabled={!row} onClick={modify}>
                  Modify...
                </button>
                <button type="button" onClick={() => fileRef.current?.click()}>
                  Import...
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".dxf,.dwg,.dwt"
                  hidden
                  aria-label="Drawing to import page setups from"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (f) void importFile(f);
                  }}
                />
              </div>
            </div>
          </fieldset>
          <fieldset className="page-setup-details" aria-label="Selected page setup details">
            <legend>Selected page setup details</legend>
            {details && (
              <dl>
                <dt>Plot size:</dt>
                <dd>{details.size}</dd>
                <dt>Plot area:</dt>
                <dd>{details.area}</dd>
                <dt>Plot style table:</dt>
                <dd>{details.table}</dd>
              </dl>
            )}
          </fieldset>
        </>
      )}
      {message && (
        <p role={message.problem ? 'alert' : 'status'} className="page-setup-message">
          {message.text}
        </p>
      )}
      {asking && (
        <div role="alertdialog" aria-label="Page Setup - Redefine" className="new-view-replace">
          <p>{`The page setup "${asking.name}" already exists. Do you want to redefine it?`}</p>
          <button type="button" autoFocus onClick={asking.yes}>
            Yes
          </button>
          <button type="button" onClick={asking.no}>
            No
          </button>
        </div>
      )}
      <div className="cad-dialog-buttons page-setup-manager-buttons">
        <label className="page-setup-show-new">
          <input
            type="checkbox"
            checked={showForNew}
            onChange={(e) =>
              drafting.configure({ showPageSetupForNewLayouts: e.currentTarget.checked })
            }
          />
          Display when creating a new layout
        </label>
        <button type="button" onClick={() => pageSetupManager.close()}>
          Close
        </button>
      </div>
      {menu && row && (
        <ListMenu
          at={menu}
          named={row.page !== undefined}
          current={layout !== undefined}
          onClose={() => {
            setMenu(undefined);
            focusRow(row.key);
          }}
          onAction={(a) => {
            setMenu(undefined);
            if (a === 'current') void setCurrent();
            else if (a === 'rename') setRenaming(true);
            else void remove();
          }}
        />
      )}
      {creating && own && (
        <NewPageSetup
          own={own}
          previous={lastPlotSettings.get(doc.id, doc.block) !== undefined}
          problem={(name) => newNameProblem(name, allSetups())}
          onOk={startNew}
          onCancel={() => setCreating(false)}
        />
      )}
      {editing && (
        <PageSetupDialog
          editing={editing}
          problem={message?.problem ? message.text : undefined}
          onChange={(settings) => setEditing({ ...editing, settings })}
          pickWindow={() => pageSetupManager.pickWindow(doc.id, doc.block, selected, editing)}
          onPreview={() => void preview(editing)}
          onOk={() => void save(editing)}
          onCancel={() => {
            setEditing(undefined);
            setMessage(undefined);
            focusRow(selected);
          }}
        />
      )}
      {importing && (
        <ImportPageSetups
          file={importing.file}
          setups={importing.setups}
          onOk={importSetups}
          onCancel={() => setImporting(undefined)}
        />
      )}
    </Modal>
  );
}

/** Why New Page Setup cannot take `name`, or undefined: the engine's rules, checked first. */
function newNameProblem(name: string, setups: readonly NamedPageSetup[]): string | undefined {
  const n = name.trim();
  if (n === '' || n.length > 255 || PAGE_SETUP_NAME_INVALID.test(n))
    return 'Invalid page setup name.';
  const taken = setups.find((p) => p.name.toUpperCase() === n.toUpperCase());
  return taken && `A page setup named "${taken.name}" already exists.`;
}

/** New Page Setup's "Start with" entries of its own (a page setup cannot be named with `<`). */
const START = {
  none: '<None>',
  device: '<Default output device>',
  previous: '<Previous plot>',
  own: '*own*',
} as const;

/** New Page Setup: the new page setup's name and what it starts with. */
function NewPageSetup({
  own,
  previous,
  problem,
  onOk,
  onCancel,
}: {
  own: PlotSpace;
  /** The space plotted this session: <Previous plot> is listed. */
  previous: boolean;
  problem: (name: string) => string | undefined;
  onOk: (name: string, start: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(() => {
    let n = 1;
    while (problem(`Setup${n}`)) n++;
    return `Setup${n}`;
  });
  const [start, setStart] = useState<string>(START.none);
  const [why, setWhy] = useState<string>();
  const ok = () => {
    const p = problem(name);
    if (p) setWhy(p);
    else onOk(name.trim(), start);
  };
  const starts = [
    { value: START.none, label: '<None>' },
    { value: START.device, label: '<Default output device>' },
    ...(previous ? [{ value: START.previous, label: '<Previous plot>' }] : []),
    { value: START.own, label: `*${own.name}*` },
    ...(own.pageSetups ?? []).map((p) => ({ value: p.name, label: p.name })),
  ];
  return (
    <Modal label="New Page Setup" className="new-page-setup" onOk={ok} onCancel={onCancel}>
      <label className="cad-dialog-field">
        New page setup name:
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
            setWhy(undefined);
          }}
        />
      </label>
      <label className="cad-dialog-field new-page-setup-start">
        Start with:
        <select
          size={Math.min(8, starts.length)}
          value={start}
          onChange={(e) => setStart(e.currentTarget.value)}
        >
          {starts.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {why && (
        <p role="alert" className="page-setup-message">
          {why}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" disabled={name.trim() === ''} onClick={ok}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** The Page Setup dialog: the Plot dialog's settings for one page setup. */
function PageSetupDialog({
  editing,
  problem,
  onChange,
  pickWindow,
  onPreview,
  onOk,
  onCancel,
}: {
  editing: Editing;
  problem: string | undefined;
  onChange: (s: PlotSettings) => void;
  pickWindow: () => void;
  onPreview: () => void;
  onOk: () => void;
  onCancel: () => void;
}) {
  const { target, space, settings } = editing;
  const name = target.kind === 'own' ? space.name : target.name;
  return (
    <Modal
      label={`Page Setup - ${name}`}
      className="plot-dialog page-setup-dialog"
      onOk={onOk}
      onCancel={onCancel}
    >
      <fieldset className="plot-group">
        <legend>Page setup</legend>
        <p className="page-setup-name">
          Name: <strong>{target.kind === 'own' ? `<${space.name}>` : name}</strong>
        </p>
      </fieldset>
      <PlotForm
        s={settings}
        space={space}
        set={(patch) => onChange({ ...settings, ...patch })}
        pickWindow={pickWindow}
      />
      {problem && (
        <p role="alert" className="plot-error">
          {problem}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" className="plot-preview-button" onClick={onPreview}>
          Preview…
        </button>
        <button type="button" onClick={onOk}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Import Page Setups: a drawing's named page setups, by Name and Location, to pick from. */
function ImportPageSetups({
  file,
  setups,
  onOk,
  onCancel,
}: {
  file: string;
  setups: readonly NamedPageSetup[];
  onOk: (picked: NamedPageSetup[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<Handle>>(() => new Set());
  const ok = () => onOk(setups.filter((p) => picked.has(p.handle)));
  return (
    <Modal label="Import Page Setups" className="import-page-setups" onOk={ok} onCancel={onCancel}>
      <p>
        Source drawing: <strong>{file}</strong>
      </p>
      <table aria-label="Page setups to import">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Location</th>
          </tr>
        </thead>
        <tbody>
          {setups.map((p) => (
            <tr key={p.handle}>
              <th scope="row">
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(p.handle)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.currentTarget.checked) next.add(p.handle);
                      else next.delete(p.handle);
                      setPicked(next);
                    }}
                  />
                  {p.name}
                </label>
              </th>
              <td>{p.model ? 'Model' : 'Layout'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cad-dialog-buttons">
        <button type="button" disabled={picked.size === 0} onClick={ok}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

type ListAction = 'current' | 'rename' | 'delete';

/** The list's shortcut menu: Set Current, Rename and Delete, greyed for the layout's own row. */
function ListMenu({
  at,
  named,
  current,
  onAction,
  onClose,
}: {
  at: { readonly x: number; readonly y: number };
  named: boolean;
  /** Whether the space has a layout to set a page setup current for. */
  current: boolean;
  onAction: (a: ListAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, []);
  const items: { action: ListAction; label: string; disabled: boolean }[] = [
    { action: 'current', label: 'Set Current', disabled: !named || !current },
    { action: 'rename', label: 'Rename', disabled: !named },
    { action: 'delete', label: 'Delete', disabled: !named },
  ];
  return (
    <div
      ref={ref}
      className="snap-menu page-setup-menu"
      role="menu"
      aria-label="Page setup"
      style={{ left: at.x, top: at.y }}
      onContextMenu={(e) => e.preventDefault()}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null)) onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        const list = [
          ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
        ];
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : list.length - 1;
          list[(i + step) % list.length]?.focus();
        }
      }}
    >
      {items.map((it) => (
        <button
          key={it.action}
          type="button"
          role="menuitem"
          className="snap-menu-item"
          disabled={it.disabled}
          onClick={() => onAction(it.action)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** A page setup's name typed in place: Enter or leaving the field renames, Esc keeps the name. */
function RenameField({ name, onDone }: { name: string; onDone: (to: string) => void }) {
  const [text, setText] = useState(name);
  const done = useRef(false);
  const finish = (to: string) => {
    if (done.current) return;
    done.current = true;
    onDone(to);
  };
  return (
    <input
      aria-label={`Name of ${name}`}
      autoFocus
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(text.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(text.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(name);
        }
      }}
    />
  );
}
