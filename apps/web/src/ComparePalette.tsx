// The Compare palette (M8-06, PRD FR-Z3, UI_SPEC.md §4 "Compare: source/target pickers, results
// list, filters"; DEC-092). COMPARE, COMPARECLOSE and the View tab's Compare open and close it.
//
// Original and Revision each pick an open drawing, or a drawing file (Browse...) read without
// opening it; Settings hold the tolerance and whether objects pair by handle and properties are
// compared (packages/compare `CompareSettings`). Compare makes the compare drawing, a new tab:
// the revision with what it added in green, what it modified in amber and what it kept in grey,
// and the original's removed objects and previous versions in red. The results list shows every
// difference with its layer, space and what changed; a row zooms the compare drawing to it. The
// filters (status, layer, type) narrow the list and show only those objects in the drawing.
// Export DXF... and Export PDF... save and plot the compare drawing as it shows.
import { useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { COMPARE_COLORS, itemShown, type CompareFilter, type MarkedItem } from '@triya/compare';
import type { CompareStatus } from '@triya/compare';
import type { EntityType } from '@triya/engine';
import { aciRgb } from '@triya/render';
import type { OpenDocument } from './documents';
import {
  STATUS_LABELS,
  changesText,
  compareSession,
  layersOf,
  toleranceOf,
  typesOf,
  type CompareSource,
} from './compare';

const STATUSES: readonly CompareStatus[] = ['added', 'removed', 'modified'];

const swatch = (status: keyof typeof COMPARE_COLORS): string => {
  const c = COMPARE_COLORS[status];
  if (c.kind !== 'aci') return 'transparent';
  const [r, g, b] = aciRgb(c.index);
  return `rgb(${r} ${g} ${b})`;
};

function Swatch({ status }: { status: keyof typeof COMPARE_COLORS }) {
  return <span className="compare-swatch" style={{ background: swatch(status) }} aria-hidden />;
}

/** An Original or Revision picker: the open drawings, or Browse... for a file. */
function SourcePicker(props: {
  label: string;
  docs: readonly OpenDocument[];
  value: CompareSource | undefined;
  onChange: (s: CompareSource) => void;
}) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const v = props.value;
  return (
    <div className="compare-source">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        value={v?.kind === 'open' ? String(v.doc) : v?.kind === 'file' ? 'file' : ''}
        onChange={(e) => {
          const d = props.docs.find((x) => String(x.id) === e.target.value);
          if (d) props.onChange({ kind: 'open', doc: d.id, name: d.name });
        }}
      >
        <option value="" disabled>
          Choose a drawing
        </option>
        {v?.kind === 'file' && <option value="file">{v.name}</option>}
        {props.docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => file.current?.click()}>
        Browse...
      </button>
      <input
        ref={file}
        type="file"
        accept=".dwg,.dxf"
        hidden
        aria-label={`${props.label.replace(/:$/, '')} drawing file`}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) props.onChange({ kind: 'file', file: f, name: f.name });
        }}
      />
    </div>
  );
}

export function ComparePalette(props: {
  docs: readonly OpenDocument[];
  /** The drawing on screen, the Revision until one is picked. */
  active: OpenDocument | undefined;
  onCompare: (original: CompareSource, revision: CompareSource) => void;
  onFilter: (filter: CompareFilter) => void;
  onZoom: (item: MarkedItem) => void;
  onExport: (as: 'dxf' | 'pdf') => void;
  onClose: () => void;
}) {
  const s = useSyncExternalStore(compareSession.subscribe, compareSession.getSnapshot);
  const id = useId();
  const revision: CompareSource | undefined =
    s.revision ??
    (props.active ? { kind: 'open', doc: props.active.id, name: props.active.name } : undefined);
  const tolerance = toleranceOf(s.options.tolerance);
  const badTolerance = tolerance !== undefined && Number.isNaN(tolerance);
  const run = s.run;
  const f = s.filter;
  const setFilter = (patch: { [K in keyof CompareFilter]?: CompareFilter[K] | undefined }) => {
    const next = { ...f, ...patch };
    const { layer, type, statuses, unchanged } = next;
    const rest = { statuses: statuses ?? f.statuses, unchanged: unchanged ?? f.unchanged };
    const clean: CompareFilter = {
      ...rest,
      ...(layer !== undefined && { layer }),
      ...(type !== undefined && { type }),
    };
    compareSession.update({ filter: clean });
    props.onFilter(clean);
  };
  const toggle = (status: CompareStatus, on: boolean) =>
    setFilter({
      statuses: STATUSES.filter((x) => (x === status ? on : f.statuses.includes(x))),
    });
  const items = run ? run.markup.items.filter((i) => itemShown(i, f)) : [];
  const can = s.original !== undefined && revision !== undefined && !badTolerance && !s.busy;

  let body: ReactNode = <p className="empty">Pick the original and the revision, then Compare.</p>;
  if (run) {
    body = (
      <>
        <p className="compare-summary" aria-live="polite">
          <span className="compare-run-name">{run.name}</span>: {run.counts.added} added,{' '}
          {run.counts.removed} removed, {run.counts.modified} modified, {run.counts.unchanged}{' '}
          unchanged.
        </p>
        <fieldset className="compare-filters">
          <legend>Show</legend>
          {STATUSES.map((st) => (
            <label key={st}>
              <input
                type="checkbox"
                checked={f.statuses.includes(st)}
                onChange={(e) => toggle(st, e.currentTarget.checked)}
              />
              <Swatch status={st} /> {STATUS_LABELS[st]}
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={f.unchanged}
              onChange={(e) => setFilter({ unchanged: e.currentTarget.checked })}
            />
            <Swatch status="unchanged" /> Unchanged
          </label>
          <div className="compare-narrow">
            <label htmlFor={`${id}-layer`}>Layer:</label>
            <select
              id={`${id}-layer`}
              value={f.layer ?? ''}
              onChange={(e) =>
                setFilter({
                  layer: e.currentTarget.value === '' ? undefined : e.currentTarget.value,
                })
              }
            >
              <option value="">All layers</option>
              {layersOf(run.markup).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <label htmlFor={`${id}-type`}>Type:</label>
            <select
              id={`${id}-type`}
              value={f.type ?? ''}
              onChange={(e) =>
                setFilter({
                  type:
                    e.currentTarget.value === ''
                      ? undefined
                      : (e.currentTarget.value as EntityType),
                })
              }
            >
              <option value="">All types</option>
              {typesOf(run.markup).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
        <div className="compare-results">
          {items.length === 0 ? (
            <p className="empty">
              {run.markup.items.length === 0
                ? 'The drawings are the same.'
                : 'No differences shown: change the filters.'}
            </p>
          ) : (
            <table aria-label="Differences">
              <thead>
                <tr>
                  <th scope="col">Difference</th>
                  <th scope="col">Layer</th>
                  <th scope="col">Space</th>
                  <th scope="col">Changes</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={`${item.status}-${item.a ?? ''}-${item.b ?? ''}-${i}`}>
                    <th scope="row">
                      <button
                        type="button"
                        disabled={item.marks.length === 0}
                        title={
                          item.marks.length === 0
                            ? 'Not shown: the revision has no such space'
                            : 'Zoom to it'
                        }
                        onClick={() => props.onZoom(item)}
                      >
                        <Swatch status={item.status} /> {STATUS_LABELS[item.status]} {item.type}
                      </button>
                    </th>
                    <td>{item.layer}</td>
                    <td>{item.space}</td>
                    <td>{changesText(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="compare-actions">
          <button type="button" onClick={() => props.onExport('dxf')}>
            Export DXF...
          </button>
          <button type="button" onClick={() => props.onExport('pdf')}>
            Export PDF...
          </button>
        </div>
      </>
    );
  }

  return (
    <aside className="palette compare-palette" aria-labelledby={`${id}-title`}>
      <header>
        <h2 id={`${id}-title`}>Compare</h2>
        <button type="button" aria-label="Close Compare" onClick={props.onClose}>
          ×
        </button>
      </header>
      <div className="compare-body">
        <SourcePicker
          label="Original:"
          docs={props.docs}
          value={s.original}
          onChange={(original) => compareSession.update({ original })}
        />
        <SourcePicker
          label="Revision:"
          docs={props.docs}
          value={revision}
          onChange={(r) => compareSession.update({ revision: r })}
        />
        <details className="compare-settings">
          <summary>Settings</summary>
          <div className="compare-tolerance">
            <label htmlFor={`${id}-tol`}>Tolerance:</label>
            <input
              id={`${id}-tol`}
              type="text"
              inputMode="decimal"
              placeholder="The drawings' own"
              aria-invalid={badTolerance}
              value={s.options.tolerance}
              onChange={(e) =>
                compareSession.update({
                  options: { ...s.options, tolerance: e.currentTarget.value },
                })
              }
            />
          </div>
          <label>
            <input
              type="checkbox"
              checked={s.options.matchHandles}
              onChange={(e) =>
                compareSession.update({
                  options: { ...s.options, matchHandles: e.currentTarget.checked },
                })
              }
            />{' '}
            Pair objects by handle (revisions of one file)
          </label>
          <label>
            <input
              type="checkbox"
              checked={s.options.properties}
              onChange={(e) =>
                compareSession.update({
                  options: { ...s.options, properties: e.currentTarget.checked },
                })
              }
            />{' '}
            Compare properties (layer, color, linetype...)
          </label>
        </details>
        <div className="compare-go">
          <button
            type="button"
            disabled={!can}
            onClick={() => s.original && revision && props.onCompare(s.original, revision)}
          >
            Compare
          </button>
          {s.busy && <span role="status">{s.busy}</span>}
        </div>
        {badTolerance && (
          <p className="message error" role="alert">
            The tolerance is a distance of 0 or more.
          </p>
        )}
        {s.message && (
          <p className="message error" role="alert">
            {s.message}
          </p>
        )}
        {body}
      </div>
    </aside>
  );
}
