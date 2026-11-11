// The Health palette (M1-70, UI_SPEC.md §4 "Health: report cards"): the drawing health report
// (M1-25) of the drawing on screen, one folding card per section. The file's facts come from
// the I/O worker with the drawing; the report sets them against the fonts and hatch patterns
// the app has loaded, so it is worked out again when the user adds .pat files. Fix buttons
// arrive with the complete report (M8-07). Keyboard operable: each card folds from its summary.
// Fonts (M1-38 part 3): the report asks a book of the fonts the renderers get, bundled, the
// user's files and installed faces, so it follows them as they change, and it lists the font
// files the app could not read or parse and the installed faces the drawing draws with.
// Dimensions (M2-30 part 3, DEC-011): each dimension's stored block against what the dimension
// engine draws for it, asked of the render side (it has the drawing as edited and the fonts),
// again after every edit while the palette is open. One that differs is listed with what
// differs and, in the space on screen, a button that zooms to it.
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DimensionMismatch, DrawingDimensionHealth } from '@triya/dims';
import { healthReport, type HealthReport } from '@triya/io/health';
import { patternLibrary } from '@triya/render';
import { controllerOf, controllersOf } from './canvas/registry';
import type { OpenDocument } from './documents';
import { appFontErrors, appFonts } from './fonts';
import type { DeviceFonts } from './local-fonts';
import type { FontStore } from './user-fonts';

const REFERENCE_KIND: Record<HealthReport['references'][number]['kind'], string> = {
  xref: 'Xref',
  image: 'Image',
  pdf: 'PDF underlay',
};

export function HealthPalette({
  doc,
  patternSources,
  fontStore,
  deviceFonts,
  onClose,
}: {
  doc: OpenDocument;
  /** The user's .pat files (M1-50): the report is redone when they change. */
  patternSources: readonly string[];
  /** The user's font files (M1-38): the report is redone when they change. */
  fontStore: FontStore;
  /** Fonts installed on this computer (M1-38 part 2). */
  deviceFonts: DeviceFonts;
  onClose: () => void;
}) {
  const facts = doc.opened.facts;
  const own = useSyncExternalStore(fontStore.subscribe, fontStore.getSnapshot);
  const device = useSyncExternalStore(deviceFonts.subscribe, deviceFonts.getSnapshot);
  // The same object until the fonts change (FontStore), so the book is loaded once per change.
  const fontSources = fontStore.sources();
  const report = useMemo(() => {
    const app = appFonts(fontSources);
    return healthReport(facts, {
      fonts: app.book,
      patterns: patternLibrary(patternSources),
      fontErrors: appFontErrors({
        failed: app.failed,
        own: own.files.map((f) => f.name),
        unreadable: own.unreadable,
        device: device.warnings,
      }),
      installed: device.used,
    });
  }, [facts, patternSources, fontSources, own, device]);
  const { version, units, fonts, references, patterns, unknownObjects, unmappedEntities } = report;
  const dims = useDimensionHealth(doc, fontSources);

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

        <Card id="font-errors" title="Font errors" count={fonts.errors.length}>
          {fonts.errors.length === 0 ? (
            <p className="empty">None: every font file reads.</p>
          ) : (
            <>
              <p className="hint">Text these fonts serve draws as if they were missing.</p>
              <table aria-label="Font errors">
                <thead>
                  <tr>
                    <th scope="col">Font</th>
                    <th scope="col">From</th>
                    <th scope="col">Problem</th>
                    <th scope="col">Text styles</th>
                  </tr>
                </thead>
                <tbody>
                  {fonts.errors.map((e, i) => (
                    <tr key={`${e.source} ${e.font} ${i}`}>
                      <th scope="row">{e.font}</th>
                      <td>{e.source}</td>
                      <td>{e.problem}</td>
                      <td>
                        {e.styles.length ? e.styles.map((s) => s || '(unnamed)').join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>

        {fonts.installed.length > 0 && (
          <Card id="installed" title="Fonts from this computer" count={fonts.installed.length}>
            <table aria-label="Fonts from this computer">
              <thead>
                <tr>
                  <th scope="col">Font</th>
                  <th scope="col">Drawn with</th>
                  <th scope="col">Text styles</th>
                </tr>
              </thead>
              <tbody>
                {fonts.installed.map((f) => (
                  <tr key={f.font}>
                    <th scope="row">{f.font}</th>
                    <td>{f.face}</td>
                    <td>{f.styles.map((s) => s || '(unnamed)').join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <DimensionsCard doc={doc} health={dims} />

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

/** How many differences a row shows before "and n more". */
const SHOWN_PROBLEMS = 2;

/**
 * The drawing's dimension health, from the render side of the drawing on screen: asked again
 * when the drawing is edited or its fonts change; undefined until the first answer.
 */
function useDimensionHealth(doc: OpenDocument, fonts: unknown): DrawingDimensionHealth | undefined {
  const [health, setHealth] = useState<{ doc: number; health: DrawingDimensionHealth }>();
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (tries: number) => {
      const c = controllerOf(doc.id, doc.block) ?? controllersOf(doc.id)[0];
      if (!c) {
        // The canvas registers as it mounts: wait for it a little.
        if (tries > 0) timer = setTimeout(() => ask(tries - 1), 100);
        return;
      }
      c.dimensionHealth().then(
        (h) => {
          if (live && h) setHealth({ doc: doc.id, health: h });
        },
        () => {},
      );
    };
    ask(50);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [doc.id, doc.block, doc.revision, fonts]);
  return health?.doc === doc.id ? health.health : undefined;
}

function DimensionsCard({
  doc,
  health,
}: {
  doc: OpenDocument;
  health: DrawingDimensionHealth | undefined;
}) {
  if (!health) {
    return (
      <Card id="dimensions" title="Dimensions">
        <p className="empty">Checking…</p>
      </Card>
    );
  }
  const { checked, mismatched, blockless, unchecked } = health;
  const none = checked + blockless + unchecked === 0;
  return (
    <Card id="dimensions" title="Dimensions" count={mismatched.length}>
      {none ? (
        <p className="empty">None: the drawing has no dimensions.</p>
      ) : (
        <>
          {checked > 0 && (
            <p className="hint">
              {mismatched.length === 0
                ? `${plural(checked, 'dimension')} checked: every stored block matches what Triya draws.`
                : `${plural(checked, 'dimension')} checked: ${mismatched.length} stored ${
                    mismatched.length === 1 ? 'block differs' : 'blocks differ'
                  } from what Triya draws.`}
            </p>
          )}
          {blockless > 0 && (
            <p className="hint">
              {plural(blockless, 'dimension')} without a stored block: Triya draws{' '}
              {blockless === 1 ? 'it' : 'them'}, and saving gives {blockless === 1 ? 'it' : 'them'}{' '}
              one.
            </p>
          )}
          {unchecked > 0 && (
            <p className="hint">
              {plural(unchecked, 'dimension')} not checked: no loaded font measures{' '}
              {unchecked === 1 ? 'its' : 'their'} text.
            </p>
          )}
          {mismatched.length > 0 && (
            <table aria-label="Dimensions that differ" className="health-dimensions">
              <thead>
                <tr>
                  <th scope="col">Dimension</th>
                  <th scope="col">Differences</th>
                  <th scope="col" aria-label="Zoom" />
                </tr>
              </thead>
              <tbody>
                {mismatched.map((d) => (
                  <DimensionRow key={d.handle} doc={doc} dim={d} />
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Card>
  );
}

function DimensionRow({ doc, dim }: { doc: OpenDocument; dim: DimensionMismatch }) {
  const shown = dim.problems.slice(0, SHOWN_PROBLEMS);
  const more = dim.problems.length - shown.length;
  const where = dim.space.kind === 'layout' ? dim.space.name : `Block ${dim.space.name}`;
  return (
    <tr>
      <th scope="row">
        {dim.handle}{' '}
        <span className="dim-where">
          {dim.type}, {where}
        </span>
      </th>
      <td>
        {shown.join('; ')}
        {more > 0 && `; and ${more} more`}
      </td>
      <td>
        {dim.owner === doc.block && (
          <button
            type="button"
            aria-label={`Zoom to dimension ${dim.handle}`}
            title="Zoom to it"
            onClick={() => void controllerOf(doc.id, doc.block)?.zoomObjects([dim.id])}
          >
            Zoom
          </button>
        )}
      </td>
    </tr>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
