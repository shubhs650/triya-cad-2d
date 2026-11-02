// The Health palette (M1-70, UI_SPEC.md §4 "Health: report cards"): the drawing health report
// (M1-25) of the drawing on screen, one folding card per section. The file's facts come from
// the I/O worker with the drawing; the report sets them against the fonts and hatch patterns
// the app has loaded, so it is worked out again when the user adds .pat files. Fix buttons
// arrive with the complete report (M8-07). Keyboard operable: each card folds from its summary.
import { useMemo, type ReactNode } from 'react';
import { healthReport, type HealthReport } from '@triya/io/health';
import { patternLibrary } from '@triya/render';
import type { OpenDocument } from './documents';
import { appFonts } from './fonts';

const REFERENCE_KIND: Record<HealthReport['references'][number]['kind'], string> = {
  xref: 'Xref',
  image: 'Image',
  pdf: 'PDF underlay',
};

export function HealthPalette({
  doc,
  patternSources,
  onClose,
}: {
  doc: OpenDocument;
  /** The user's .pat files (M1-50): the report is redone when they change. */
  patternSources: readonly string[];
  onClose: () => void;
}) {
  const facts = doc.opened.facts;
  const report = useMemo(
    () => healthReport(facts, { fonts: appFonts(), patterns: patternLibrary(patternSources) }),
    [facts, patternSources],
  );
  const { version, units, fonts, references, patterns, unknownObjects, unmappedEntities } = report;

  return (
    <aside className="palette health-palette" aria-labelledby="health-title">
      <header>
        <h2 id="health-title">Health</h2>
        <button type="button" aria-label="Close Health" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="health-cards">
        <Card id="drawing" title="Drawing">
          <dl>
            <dt>Saved as</dt>
            <dd>
              {version.release ? `${version.release} (${version.code})` : version.code || '—'}
            </dd>
            <dt>Units</dt>
            <dd>{units.name}</dd>
            <dt>Measurement</dt>
            <dd>{units.measurement === 'metric' ? 'Metric' : 'Imperial'}</dd>
          </dl>
        </Card>

        <Card id="fonts" title="Missing fonts" count={fonts.missing.length}>
          {fonts.missing.length === 0 ? (
            <p className="empty">None: every font the drawing names is loaded.</p>
          ) : (
            <table aria-label="Missing fonts">
              <thead>
                <tr>
                  <th scope="col">Font</th>
                  <th scope="col">Drawn with</th>
                  <th scope="col">Text styles</th>
                </tr>
              </thead>
              <tbody>
                {fonts.missing.map((f) => (
                  <tr key={f.font}>
                    <th scope="row">{f.font || '(none)'}</th>
                    <td>{f.substitute ?? 'Not drawn'}</td>
                    <td>
                      {f.styles.length ? f.styles.map((s) => s || '(unnamed)').join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card id="references" title="References" count={references.length}>
          {references.length === 0 ? (
            <p className="empty">None: the drawing attaches no other files.</p>
          ) : (
            <table aria-label="References">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Saved path</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {references.map((r, i) => (
                  <tr key={`${r.kind} ${r.name} ${i}`}>
                    <th scope="row">{r.name}</th>
                    <td>{REFERENCE_KIND[r.kind]}</td>
                    <td className="path">{r.path || '—'}</td>
                    <td>Not checked</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card id="patterns" title="Missing hatch patterns" count={patterns.missing.length}>
          {patterns.missing.length === 0 ? (
            <p className="empty">None: every hatch draws its pattern.</p>
          ) : (
            <>
              <p className="hint">Add the .pat file that defines them in Settings.</p>
              <Counts
                label="Missing hatch patterns"
                head={['Pattern', 'Hatches']}
                rows={patterns.missing.map((p) => [p.pattern, p.hatches])}
              />
            </>
          )}
        </Card>

        <Card id="unknown" title="Unknown objects" count={unknownObjects.total}>
          {unknownObjects.total === 0 ? (
            <p className="empty">None.</p>
          ) : (
            <>
              <p className="hint">Kept unchanged so saving loses nothing.</p>
              <Counts
                label="Unknown objects"
                head={['Type', 'Count']}
                rows={unknownObjects.byType.map((o) => [o.type, o.count])}
              />
            </>
          )}
        </Card>

        <Card id="not-drawn" title="Entities not drawn" count={unmappedEntities.total}>
          {unmappedEntities.total === 0 ? (
            <p className="empty">None: every entity draws.</p>
          ) : (
            <Counts
              label="Entities not drawn"
              head={['Type', 'Reason', 'Count']}
              rows={unmappedEntities.byType.map((e) => [e.type, e.reason, e.count])}
            />
          )}
        </Card>
      </div>
    </aside>
  );
}

function Card({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const heading = `health-${id}`;
  return (
    <details className="health-card" open aria-labelledby={heading}>
      <summary>
        <span id={heading}>{count === undefined ? title : `${title} (${count})`}</span>
      </summary>
      {children}
    </details>
  );
}

function Counts({
  label,
  head,
  rows,
}: {
  label: string;
  head: readonly string[];
  rows: readonly (readonly (string | number)[])[];
}) {
  return (
    <table aria-label={label}>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.join('\u0000')}>
            <th scope="row">{r[0]}</th>
            {r.slice(1).map((c, i) => (
              <td key={i}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
