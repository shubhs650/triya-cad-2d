// LINETYPE's Linetype Manager and the Load or Reload Linetypes dialog (M5-08), with AutoCAD
// 2024's labels (AutoCAD Help, "Linetype Manager", "Load or Reload Linetypes Dialog Box";
// UI_SPEC.md §7):
// - Linetype Manager: Linetype filters (Show all linetypes, Show all used linetypes, Show all Xref
//   dependent linetypes) with Invert filter; Load..., Delete, Current and Show details / Hide
//   details; "Current Linetype:"; the list (Linetype, Appearance, Description; Click, Ctrl+click,
//   Shift+click, arrows, Ctrl+A); Details: Name, Description, Use paper space units for scaling
//   (PSLTSCALE), Global scale factor (LTSCALE), Current object scale (CELTSCALE) and ISO pen width
//   (which sets the object scale: the bundled ISO linetypes are drawn for a 1 mm pen). Delete
//   refuses ByLayer, ByBlock, Continuous, the current linetype, xref-dependent linetypes and
//   linetypes in use, saying so; nothing changes the drawing until OK, which is one LINETYPE
//   undo step. Details' Name and Description rename and describe the linetype selected (M5-08
//   part 4): ByLayer, ByBlock and xref-dependent linetypes are read only and Continuous keeps
//   its name ("Linetype names cannot be edited for ByLayer, ByBlock, Continuous, and
//   xref-dependent linetypes"); OK refuses an empty, invalid or taken name, saying so.
// - Load or Reload Linetypes: File (the bundled files, then the user's .lin files; Browse... picks
//   one from disk, which is kept with the user's, Settings > Linetypes), Available Linetypes
//   (multi-select, Select All and Clear All on its shortcut menu, here buttons). OK on a
//   linetype the drawing has asks AutoCAD's Reload Linetype: reload them or keep them.
// Each is keyboard operable: Enter is OK and Esc Cancel (`Modal`).
import {
  LINETYPE_DESCRIPTION_MAX,
  linetypeNameProblem,
  type DialogRequest,
  type Handle,
  type LinetypeAnswer,
  type LinetypeDefinition,
  type LinetypeEdit,
} from '@triya/engine';
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';
import { linetypeDashes } from './layers';
import {
  findLinetypeFile,
  linetypesOf,
  type LinetypeFiles,
  type LinetypeFileSource,
} from './linetype-files';

type Request = Extract<DialogRequest, { type: 'linetype' }>;

/** The Appearance column's sample, in CSS pixels. */
const SAMPLE_WIDTH = 96;

/** A linetype's sample: its dashes, gaps and dots repeated across the column (M5-05, M5-08). */
export function LinetypeAppearance({
  elements,
}: {
  elements: readonly { readonly length: number }[];
}) {
  const dashes = linetypeDashes(elements, SAMPLE_WIDTH);
  return (
    <svg
      className="linetype-sample"
      width={SAMPLE_WIDTH}
      height="8"
      viewBox={`0 0 ${SAMPLE_WIDTH} 8`}
      aria-hidden
    >
      <line
        x1="0"
        y1="4"
        x2={SAMPLE_WIDTH}
        y2="4"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray={dashes?.join(' ')}
      />
    </svg>
  );
}

const upper = (s: string) => s.toUpperCase();
const FIXED = ['BYLAYER', 'BYBLOCK', 'CONTINUOUS'];

/** ISO pen widths (mm), as AutoCAD's list offers them. */
const PEN_WIDTHS = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2];

/**
 * A multi-select list's selection after a click or key, as Windows lists do: a click selects one,
 * Ctrl toggles, Shift extends from the anchor.
 */
function pick(
  keys: readonly string[],
  selected: ReadonlySet<string>,
  anchor: string | undefined,
  at: string,
  e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
): Set<string> {
  if (e.shiftKey && anchor !== undefined) {
    const a = keys.indexOf(anchor);
    const b = keys.indexOf(at);
    if (a >= 0 && b >= 0) return new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1));
  }
  if (e.ctrlKey || e.metaKey) {
    const next = new Set(selected);
    if (next.has(at)) next.delete(at);
    else next.add(at);
    return next;
  }
  return new Set([at]);
}

/** Up/Down/Home/End move the selection in a list, Ctrl+A selects all; returns the key moved to. */
function listKey(
  e: KeyboardEvent,
  keys: readonly string[],
  focus: string | undefined,
): { to?: string; all?: boolean } {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') return { all: true };
  const at = focus === undefined ? -1 : keys.indexOf(focus);
  const to =
    e.key === 'ArrowDown'
      ? Math.min(at + 1, keys.length - 1)
      : e.key === 'ArrowUp'
        ? Math.max(at - 1, 0)
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? keys.length - 1
            : undefined;
  return to === undefined || keys[to] === undefined ? {} : { to: keys[to] };
}

export function LoadLinetypesDialog({
  files,
  loaded,
  onOk,
  onCancel,
}: {
  files: LinetypeFiles;
  /** The names the drawing (or the manager) has loaded already. */
  loaded: readonly string[];
  onOk: (linetypes: LinetypeDefinition[], reload: boolean) => void;
  onCancel: () => void;
}) {
  const [listed, setListed] = useState<readonly LinetypeFileSource[]>(() => files.list());
  const [fileName, setFileName] = useState(() => findLinetypeFile(listed)?.name ?? '');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string>();
  const [asking, setAsking] = useState<readonly string[]>();
  const [message, setMessage] = useState<string>();
  const browse = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const file = listed.find((f) => f.name === fileName);
  const linetypes = useMemo(() => (file ? linetypesOf(file) : []), [file]);
  const names = linetypes.map((l) => l.name);
  const isLoaded = (name: string) => loaded.some((n) => upper(n) === upper(name));

  const chosen = () => linetypes.filter((l) => selected.has(l.name));
  const ok = () => {
    const defs = chosen();
    if (defs.length === 0) {
      onCancel();
      return;
    }
    const again = defs.filter((l) => isLoaded(l.name)).map((l) => l.name);
    if (again.length > 0) setAsking(again);
    else onOk(defs, false);
  };

  const choose = (name: string) => {
    setFileName(name);
    setSelected(new Set());
    setAnchor(undefined);
  };

  const added = async (picked: File | undefined) => {
    if (!picked) return;
    const r = await files.add(picked.name, new Uint8Array(await picked.arrayBuffer()));
    if ('error' in r) {
      setMessage(r.error);
      return;
    }
    setMessage(undefined);
    const next = files.list();
    setListed(next);
    // The user's file, which wins over a bundled one of the same name.
    const kept = findLinetypeFile(next, r.name);
    if (kept) choose(kept.name);
  };

  const keys = (e: KeyboardEvent) => {
    const k = listKey(e, names, anchor);
    if (k.all) {
      e.preventDefault();
      setSelected(new Set(names));
      return;
    }
    if (k.to === undefined) return;
    e.preventDefault();
    setSelected(e.shiftKey ? pick(names, selected, anchor, k.to, e) : new Set([k.to]));
    if (!e.shiftKey) setAnchor(k.to);
    list.current
      ?.querySelector(`[data-name="${CSS.escape(k.to)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <Modal
      label="Load or Reload Linetypes"
      className="linetype-load"
      onOk={() => (asking ? undefined : ok())}
      onCancel={() => (asking ? setAsking(undefined) : onCancel())}
    >
      <div className="linetype-file">
        <label>
          <span>File</span>
          <select aria-label="File" value={fileName} onChange={(e) => choose(e.target.value)}>
            {listed.map((f) => (
              <option key={`${f.bundled}:${f.name}`} value={f.name}>
                {f.name}
                {f.bundled ? '' : ' (yours)'}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => browse.current?.click()}>
          Browse...
        </button>
        <input
          ref={browse}
          type="file"
          accept=".lin"
          hidden
          aria-label="Linetype file to load"
          onChange={(e) => {
            void added(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      <span id="linetype-load-label">Available Linetypes</span>
      <div className="linetype-head" aria-hidden>
        <span>Linetype</span>
        <span>Appearance</span>
        <span>Description</span>
      </div>
      <div
        ref={list}
        role="listbox"
        aria-multiselectable
        aria-labelledby="linetype-load-label"
        className="linetype-list"
        tabIndex={0}
        autoFocus
        onKeyDown={keys}
      >
        {linetypes.map((l) => (
          <div
            key={l.name}
            data-name={l.name}
            role="option"
            aria-selected={selected.has(l.name)}
            onClick={(e: MouseEvent) => {
              setSelected(pick(names, selected, anchor, l.name, e));
              if (!e.shiftKey) setAnchor(l.name);
            }}
          >
            <span>{l.name}</span>
            <LinetypeAppearance elements={l.elements} />
            <span>{l.description}</span>
          </div>
        ))}
      </div>
      <div className="linetype-select-buttons">
        <button type="button" onClick={() => setSelected(new Set(names))}>
          Select All
        </button>
        <button type="button" onClick={() => setSelected(new Set())}>
          Clear All
        </button>
      </div>
      {message && (
        <p role="alert" className="linetype-message">
          {message}
        </p>
      )}
      {asking && (
        <div role="alertdialog" aria-label="Reload Linetype" className="linetype-reload">
          <p>
            {asking.length === 1
              ? `The linetype "${asking[0]}" is already loaded.`
              : `The linetypes ${asking.map((n) => `"${n}"`).join(', ')} are already loaded.`}{' '}
            What do you want to do?
          </p>
          <button type="button" autoFocus onClick={() => onOk(chosen(), true)}>
            Reload the linetype{asking.length === 1 ? '' : 's'}
          </button>
          <button type="button" onClick={() => onOk(chosen(), false)}>
            Keep the loaded linetype{asking.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={asking !== undefined}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

type Filter = 'all' | 'used' | 'xref';

/** One row of the manager: a linetype the drawing has, or one Load... added. */
interface Row {
  readonly key: string;
  readonly handle?: Handle;
  readonly name: string;
  readonly description: string;
  readonly elements: readonly { readonly length: number }[];
  readonly xref: boolean;
  readonly used: boolean;
  /** Loaded (or reloaded) in the dialog: its definition in `loads`, by the name it loaded as. */
  readonly loadKey?: string;
}

const sortRows = (rows: Row[]): Row[] => {
  const order = (n: string) => (upper(n) === 'BYLAYER' ? 0 : upper(n) === 'BYBLOCK' ? 1 : 2);
  return rows.sort(
    (a, b) =>
      order(a.name) - order(b.name) ||
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
};

/** A positive number typed, or undefined. */
const positive = (s: string): number | undefined => {
  const n = Number(s.trim());
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
};

const shown = (n: number) => String(Number(n.toPrecision(10)));

/** Why OK cannot take Details' names: empty, invalid or another linetype's (ignoring case). */
function detailsProblem(rows: readonly Row[]): string | undefined {
  const seen = new Set<string>();
  for (const r of rows) {
    const name = r.name.trim();
    const bad = linetypeNameProblem(name);
    if (bad) return bad;
    if (seen.has(upper(name))) return `A linetype named ${name} already exists.`;
    seen.add(upper(name));
  }
  return undefined;
}

export function LinetypeManagerDialog({
  doc,
  request,
  files,
}: {
  doc: number;
  request: Request;
  files: LinetypeFiles;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    request.linetypes.map((l) => ({ ...l, key: l.handle })),
  );
  const [loads, setLoads] = useState<ReadonlyMap<string, LinetypeDefinition>>(new Map());
  const [deleted, setDeleted] = useState<readonly Handle[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string>();
  const [current, setCurrent] = useState(request.current);
  const [filter, setFilter] = useState<Filter>('all');
  const [invert, setInvert] = useState(false);
  const [details, setDetails] = useState(false);
  const [ltscale, setLtscale] = useState(shown(request.ltscale));
  const [celtscale, setCeltscale] = useState(shown(request.celtscale));
  const [psltscale, setPsltscale] = useState(request.psltscale);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  /** The drawing's linetypes as the dialog opened on them, by handle (Details' renames). */
  const original = useMemo(
    () => new Map(request.linetypes.map((l) => [l.handle as string, l])),
    [request.linetypes],
  );

  const visible = rows.filter((r) => {
    const keep = filter === 'all' ? true : filter === 'used' ? r.used : r.xref;
    return invert ? !keep : keep;
  });
  const keys = visible.map((r) => r.key);
  const chosen = visible.filter((r) => selected.has(r.key));
  const one = chosen.length === 1 ? chosen[0] : undefined;
  const isCurrent = (r: Row) => upper(r.name) === upper(current);

  const cancel = () => void engines.command(doc, { kind: 'cancel' });
  const ok = () => {
    const lt = positive(ltscale);
    const ct = positive(celtscale);
    if (lt === undefined || ct === undefined) {
      setMessage('The scale factors must be numbers greater than zero.');
      return;
    }
    const problem = detailsProblem(rows);
    if (problem) {
      setMessage(problem);
      return;
    }
    // A linetype loaded here loads as Details left it; one the drawing has is edited by handle.
    const load = [...loads.entries()].map(([k, def]) => {
      const row = rows.find((r) => r.handle === undefined && r.loadKey === k);
      return row ? { ...def, name: row.name.trim(), description: row.description } : def;
    });
    const edit: LinetypeEdit[] = [];
    for (const r of rows) {
      const was = r.handle === undefined ? undefined : original.get(r.handle);
      if (!was) continue;
      const name = r.name.trim() !== was.name ? r.name.trim() : undefined;
      const description = r.description !== was.description ? r.description : undefined;
      if (name !== undefined || description !== undefined)
        edit.push({
          handle: was.handle,
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
        });
    }
    const answer: LinetypeAnswer = {
      ...(load.length > 0 && { load }),
      ...(edit.length > 0 && { edit }),
      ...(deleted.length > 0 && { delete: deleted }),
      current,
      ltscale: lt,
      celtscale: ct,
      psltscale,
      // Other... in the Properties palette (M5-08 part 2): the linetype highlighted is applied.
      ...(request.apply && one && { apply: one.name.trim() }),
    };
    void engines.command(doc, {
      kind: 'answer',
      answer: { kind: 'dialog', action: 'ok', linetype: answer },
    });
  };

  const loadDone = (defs: LinetypeDefinition[], reload: boolean) => {
    setLoading(false);
    const nextLoads = new Map(loads);
    let next = [...rows];
    for (const def of defs) {
      const at = next.findIndex((r) => upper(r.name) === upper(def.name));
      if (at >= 0 && !reload) continue;
      if (at >= 0 && (next[at]!.xref || FIXED.includes(upper(def.name)))) continue;
      nextLoads.set(upper(def.name), def);
      const row: Row = {
        loadKey: upper(def.name),
        key: at >= 0 ? next[at]!.key : `new:${upper(def.name)}`,
        ...(at >= 0 && next[at]!.handle !== undefined && { handle: next[at]!.handle }),
        name: at >= 0 ? next[at]!.name : def.name,
        description: def.description,
        elements: def.elements,
        xref: false,
        used: at >= 0 ? next[at]!.used : false,
      };
      next = at >= 0 ? next.map((r, i) => (i === at ? row : r)) : [...next, row];
    }
    setRows(sortRows(next));
    setLoads(nextLoads);
    setMessage(undefined);
    // Opened by Other..., the linetype just loaded is highlighted, ready to be applied at OK.
    if (request.apply) {
      const loaded = defs.filter((d) => nextLoads.has(upper(d.name)));
      const first = loaded
        .map((d) => next.find((r) => upper(r.name) === upper(d.name))?.key)
        .find((k) => k !== undefined);
      if (first !== undefined) {
        setSelected(new Set([first]));
        setAnchor(first);
      }
    }
  };

  const remove = () => {
    if (chosen.length === 0) return;
    const refused: string[] = [];
    const gone = new Set<string>();
    for (const r of chosen) {
      const why = FIXED.includes(upper(r.name))
        ? `${r.name} cannot be deleted`
        : isCurrent(r)
          ? `${r.name} is the current linetype`
          : r.xref
            ? `${r.name} is xref-dependent`
            : r.used
              ? `${r.name} is in use`
              : undefined;
      if (why) refused.push(why);
      else gone.add(r.key);
    }
    if (gone.size > 0) {
      const nextLoads = new Map(loads);
      const handles: Handle[] = [];
      for (const r of rows.filter((x) => gone.has(x.key))) {
        if (r.loadKey !== undefined) nextLoads.delete(r.loadKey);
        if (r.handle !== undefined) handles.push(r.handle);
      }
      setLoads(nextLoads);
      setDeleted([...deleted, ...handles]);
      setRows(rows.filter((r) => !gone.has(r.key)));
      setSelected(new Set());
    }
    setMessage(
      refused.length > 0
        ? `The selected linetype${refused.length === 1 ? '' : 's'} cannot be deleted: ${refused.join('; ')}. ByLayer, ByBlock, Continuous, the current linetype, xref-dependent linetypes and linetypes in use cannot be deleted.`
        : undefined,
    );
  };

  const onKey = (e: KeyboardEvent) => {
    const k = listKey(e, keys, anchor);
    if (k.all) {
      e.preventDefault();
      setSelected(new Set(keys));
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      remove();
      return;
    }
    if (k.to === undefined) return;
    e.preventDefault();
    setSelected(e.shiftKey ? pick(keys, selected, anchor, k.to, e) : new Set([k.to]));
    if (!e.shiftKey) setAnchor(k.to);
    list.current
      ?.querySelector(`[data-key="${CSS.escape(k.to)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  /** Details' Name or Description typed for the linetype selected; Current follows its name. */
  const detail = (field: 'name' | 'description', value: string) => {
    if (!one) return;
    if (field === 'name' && isCurrent(one)) setCurrent(value);
    setRows(rows.map((r) => (r.key === one.key ? { ...r, [field]: value } : r)));
    setMessage(undefined);
  };
  const by =
    one !== undefined &&
    ['BYLAYER', 'BYBLOCK'].includes(upper(original.get(one.handle ?? '')?.name ?? one.name));
  const readOnly = !one || one.xref || by;
  const nameFixed =
    readOnly ||
    (one.handle !== undefined && FIXED.includes(upper(original.get(one.handle)?.name ?? '')));

  const iso = one !== undefined && /ISO/i.test(one.name);
  const pen = PEN_WIDTHS.find((w) => positive(celtscale) === w);

  return (
    <Modal label="Linetype Manager" className="linetype-manager" onOk={ok} onCancel={cancel}>
      <div className="linetype-manager-top">
        <label>
          <span>Linetype filters</span>
          <select
            aria-label="Linetype filters"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">Show all linetypes</option>
            <option value="used">Show all used linetypes</option>
            <option value="xref">Show all Xref dependent linetypes</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
          Invert filter
        </label>
        <div className="linetype-manager-actions">
          <button type="button" onClick={() => setLoading(true)}>
            Load...
          </button>
          <button type="button" onClick={remove} disabled={chosen.length === 0}>
            Delete
          </button>
          <button type="button" onClick={() => one && setCurrent(one.name)} disabled={!one}>
            Current
          </button>
          <button type="button" aria-expanded={details} onClick={() => setDetails(!details)}>
            {details ? 'Hide details' : 'Show details'}
          </button>
        </div>
      </div>
      <p className="linetype-current">
        Current Linetype: <strong>{current}</strong>
      </p>
      {request.apply && (
        <p className="linetype-apply-note">
          OK applies the highlighted linetype to the objects selected, or makes it current when none
          are.
        </p>
      )}
      <span id="linetype-manager-label" className="visually-hidden">
        Linetypes
      </span>
      <div className="linetype-head" aria-hidden>
        <span>Linetype</span>
        <span>Appearance</span>
        <span>Description</span>
      </div>
      <div
        ref={list}
        role="listbox"
        aria-multiselectable
        aria-labelledby="linetype-manager-label"
        className="linetype-list"
        tabIndex={0}
        autoFocus
        onKeyDown={onKey}
      >
        {visible.map((r) => (
          <div
            key={r.key}
            data-key={r.key}
            role="option"
            aria-selected={selected.has(r.key)}
            aria-current={isCurrent(r) || undefined}
            onClick={(e: MouseEvent) => {
              setSelected(pick(keys, selected, anchor, r.key, e));
              if (!e.shiftKey) setAnchor(r.key);
            }}
            onDoubleClick={() => setCurrent(r.name)}
          >
            <span>{r.name}</span>
            <LinetypeAppearance elements={r.elements} />
            <span>{r.description}</span>
          </div>
        ))}
      </div>
      {details && (
        <fieldset className="linetype-details">
          <legend>Details</legend>
          <label>
            Name
            <input
              readOnly={nameFixed}
              value={one?.name ?? ''}
              onChange={(e) => detail('name', e.target.value)}
            />
          </label>
          <label>
            Global scale factor
            <input
              inputMode="decimal"
              value={ltscale}
              onChange={(e) => setLtscale(e.target.value)}
            />
          </label>
          <label>
            Description
            <input
              readOnly={readOnly}
              maxLength={LINETYPE_DESCRIPTION_MAX}
              value={one?.description ?? ''}
              onChange={(e) => detail('description', e.target.value)}
            />
          </label>
          <label>
            Current object scale
            <input
              inputMode="decimal"
              value={celtscale}
              onChange={(e) => setCeltscale(e.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={psltscale}
              onChange={(e) => setPsltscale(e.target.checked)}
            />
            Use paper space units for scaling
          </label>
          <label>
            <span>ISO pen width</span>
            <select
              aria-label="ISO pen width"
              disabled={!iso}
              value={pen === undefined ? '' : String(pen)}
              onChange={(e) => e.target.value && setCeltscale(e.target.value)}
            >
              <option value="">Custom</option>
              {PEN_WIDTHS.map((w) => (
                <option key={w} value={String(w)}>
                  {w.toFixed(w < 1 && String(w).length > 3 ? 2 : 1)} mm
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      )}
      {message && (
        <p role="alert" className="linetype-message">
          {message}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
      {loading && (
        <LoadLinetypesDialog
          files={files}
          loaded={rows.map((r) => r.name)}
          onOk={loadDone}
          onCancel={() => setLoading(false)}
        />
      )}
    </Modal>
  );
}
