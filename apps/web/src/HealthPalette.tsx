// The Health palette (M1-70, UI_SPEC.md §4 "Health: report cards"): the drawing health report
// (M1-25) of the drawing on screen, one folding card per section. The file's facts come from
// the I/O worker with the drawing; the report sets them against the fonts and hatch patterns
// the app has loaded, so it is worked out again when the user adds .pat files. Keyboard
// operable: each card folds from its summary.
// Fonts (M1-38 part 3): the report asks a book of the fonts the renderers get, bundled, the
// user's files and installed faces, so it follows them as they change, and it lists the font
// files the app could not read or parse and the installed faces the drawing draws with.
// Dimensions (M2-30 part 3, DEC-011): each dimension's stored block against what the dimension
// engine draws for it, asked of the render side (it has the drawing as edited and the fonts),
// again after every edit while the palette is open. One that differs is listed with what
// differs and, in the space on screen, a button that zooms to it.
// Purge fixes (M5-09 part 3, PRD FR-Z4 "unused layers/blocks/styles, empty text, zero-length
// ... one-click fixes"): what PURGE would take, asked of the drawing's engine again after every
// edit while the palette is open. Unused items: their counts by category, Purge All (each unused
// item and what only they use, as the Purge dialog's Purge All with Purge nested items) and
// Purge... (the Purge dialog, to choose); zero-length geometry, empty text and orphaned data (the
// DGN linestyle data no linetype uses, M5-09 part 5): Delete. Each fix is one PURGE undo step;
// registered applications are left to -PURGE, as in the dialog.
// Drawing checks (M8-07, PRD FR-Z4 "duplicate (OVERKILL candidates) ... units/scale sanity ...
// one-click fixes"): asked of the drawing's engine as the purge counts are. Units: a unitless
// drawing (Use Millimeters or Use Inches, as its measurement suggests, or Units... for the
// dialog) and a MEASUREMENT that disagrees with INSUNITS (Set Measurement); the Drawing card
// shows the units as they now are. Duplicate objects: what OVERKILL's initial settings delete in
// every space (Delete Duplicates, one OVERKILL undo step, or Overkill... to choose). Dynamic blocks
// and constraints present: what the drawing holds, which Triya draws without evaluating (dynamic
// blocks, PRD non-goal 2) or solves (constraints, M9); Parameters Manager... opens PARAMETERS.
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DimensionMismatch, DrawingDimensionHealth } from '@triya/dims';
import {
  INSUNITS_NAMES,
  type HealthChecks,
  type HealthFixEdit,
  type PurgeEdit,
  type PurgeHealth,
} from '@triya/engine';
import { healthReport, type HealthReport } from '@triya/io/health';
import { patternLibrary } from '@triya/render';
import { controllerOf, controllersOf } from './canvas/registry';
import type { DocumentStore, OpenDocument } from './documents';
import { engines } from './engine/registry';
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
  store,
  patternSources,
  fontStore,
  deviceFonts,
  onClose,
}: {
  doc: OpenDocument;
  /** For the purge fixes: the drawing's revision moves with each (M5-09 part 3). */
  store: DocumentStore;
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
  const checks = useHealthChecks(doc);
  // The units as they now are once the engine says (a fix changes them); the file's until then.
  const unitsName = checks
    ? (INSUNITS_NAMES[checks.units.insUnits] ?? `Unknown (${checks.units.insUnits})`)
    : units.name;
  const measurement = checks?.units.measurement ?? units.measurement;

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
            <dd>{unitsName}</dd>
            <dt>Measurement</dt>
            <dd>{measurement === 'metric' ? 'Metric' : 'Imperial'}</dd>
          </dl>
        </Card>

        <UnitsCard doc={doc} store={store} checks={checks} />

        <PurgeCards doc={doc} store={store} />

        <DuplicatesCard doc={doc} store={store} checks={checks} />

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

        <DynamicBlocksCard checks={checks} />

        <ConstraintsCard doc={doc} checks={checks} />

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

/**
 * How long the drawing must stay unedited before the purge counts are asked again: they walk the
 * whole drawing in its engine (about a quarter second at 100k objects), so a run of edits asks once.
 */
const PURGE_HEALTH_SETTLE_MS = 300;

/**
 * What PURGE would take from the drawing, from its engine: asked at once for a drawing shown, and
 * again once its edits settle; undefined until the first answer.
 */
function usePurgeHealth(doc: OpenDocument): PurgeHealth | undefined {
  const [health, setHealth] = useState<{ doc: number; health: PurgeHealth }>();
  const known = health?.doc === doc.id;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () =>
        void engines.purgeHealth(doc.id).then(
          (h) => {
            if (live && h) setHealth({ doc: doc.id, health: h });
          },
          () => {},
        ),
      known ? PURGE_HEALTH_SETTLE_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `known` only picks the delay: asking again when the first answer comes would be wasted.
  }, [doc.id, doc.revision]);
  return known ? health.health : undefined;
}

function PurgeCards({ doc, store }: { doc: OpenDocument; store: DocumentStore }) {
  const health = usePurgeHealth(doc);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fix = async (what: PurgeEdit['what']) => {
    setBusy(true);
    try {
      const r = await engines.edit(doc.id, { kind: 'purge', what });
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      setMessage(undefined);
      store.edited(doc.id);
    } finally {
      setBusy(false);
    }
  };
  if (!health) {
    return (
      <Card id="unused" title="Unused items">
        <p className="empty">Checking…</p>
      </Card>
    );
  }
  const total = health.unused.reduce((n, c) => n + c.count, 0);
  const status = message && (
    <p className="hint" role="status">
      {message}
    </p>
  );
  return (
    <>
      <Card id="unused" title="Unused items" count={total}>
        {total === 0 ? (
          <p className="empty">None: every named item is in use.</p>
        ) : (
          <>
            <p className="hint">
              Layers, blocks and styles nothing in the drawing uses.
              {health.nested > 0 &&
                ` Purging them also takes ${plural(health.nested, 'item')} only they use.`}
            </p>
            <Counts
              label="Unused items"
              head={['Category', 'Unused']}
              rows={health.unused.map((c) => [c.title, c.count])}
            />
          </>
        )}
        <div className="health-fixes">
          {total > 0 && (
            <button type="button" disabled={busy} onClick={() => void fix('unused')}>
              Purge All
            </button>
          )}
          <button
            type="button"
            title="Choose what to purge in the Purge dialog"
            onClick={() => engines.command(doc.id, { kind: 'invoke', name: 'PURGE' })}
          >
            Purge…
          </button>
        </div>
        {status}
      </Card>

      <Card id="zero-length" title="Zero-length geometry" count={health.zeroLength}>
        {health.zeroLength === 0 ? (
          <p className="empty">None.</p>
        ) : (
          <>
            <p className="hint">
              Lines, arcs, circles and polylines with no length, outside blocks and locked layers.
            </p>
            <div className="health-fixes">
              <button
                type="button"
                disabled={busy}
                aria-label="Delete zero-length geometry"
                onClick={() => void fix('zero-length')}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </Card>

      <Card id="empty-text" title="Empty text objects" count={health.emptyText}>
        {health.emptyText === 0 ? (
          <p className="empty">None.</p>
        ) : (
          <>
            <p className="hint">
              Text and multiline text showing only spaces, outside blocks and locked layers.
            </p>
            <div className="health-fixes">
              <button
                type="button"
                disabled={busy}
                aria-label="Delete empty text objects"
                onClick={() => void fix('empty-text')}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </Card>

      <Card id="orphaned-data" title="Orphaned data" count={health.orphaned}>
        {health.orphaned === 0 ? (
          <p className="empty">None.</p>
        ) : (
          <>
            <p className="hint">DGN linestyle data no linetype uses.</p>
            <div className="health-fixes">
              <button
                type="button"
                disabled={busy}
                aria-label="Delete orphaned data"
                onClick={() => void fix('orphaned')}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

/**
 * What the drawing checks find (M8-07), from the drawing's engine: asked at once for a drawing
 * shown, and again once its edits settle, as the purge counts are; undefined until the first
 * answer. OVERKILL's plan of every space is most of the cost (0.4 s at 100k objects).
 */
function useHealthChecks(doc: OpenDocument): HealthChecks | undefined {
  const [checks, setChecks] = useState<{ doc: number; checks: HealthChecks }>();
  const known = checks?.doc === doc.id;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () =>
        void engines.healthChecks(doc.id).then(
          (c) => {
            if (live && c) setChecks({ doc: doc.id, checks: c });
          },
          () => {},
        ),
      known ? PURGE_HEALTH_SETTLE_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `known` only picks the delay, as in usePurgeHealth.
  }, [doc.id, doc.revision]);
  return known ? checks.checks : undefined;
}

/** A drawing-check fix (M8-07) as an engine edit; its refusal shown, the drawing marked edited. */
function useHealthFix(doc: OpenDocument, store: DocumentStore) {
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fix = async (edit: HealthFixEdit) => {
    setBusy(true);
    try {
      const r = await engines.edit(doc.id, edit);
      if (!r.ok) {
        setMessage(r.message);
        return;
      }
      setMessage(undefined);
      store.edited(doc.id);
    } finally {
      setBusy(false);
    }
  };
  const status = message && (
    <p className="hint" role="status">
      {message}
    </p>
  );
  return { fix, busy, status };
}

const Checking = ({ id, title }: { id: string; title: string }) => (
  <Card id={id} title={title}>
    <p className="empty">Checking…</p>
  </Card>
);

const unitName = (code: number) => INSUNITS_NAMES[code] ?? `Unknown (${code})`;
const systemName = (m: 'imperial' | 'metric') => (m === 'metric' ? 'Metric' : 'Imperial');

function UnitsCard({
  doc,
  store,
  checks,
}: {
  doc: OpenDocument;
  store: DocumentStore;
  checks: HealthChecks | undefined;
}) {
  const { fix, busy, status } = useHealthFix(doc, store);
  if (!checks) return <Checking id="units" title="Units" />;
  const { problems } = checks.units;
  return (
    <Card id="units" title="Units" count={problems.length}>
      {problems.length === 0 && (
        <p className="empty">None: the drawing has units, and its measurement agrees with them.</p>
      )}
      {problems.map((p) =>
        p.kind === 'unitless' ? (
          <div key={p.kind}>
            <p className="hint">
              The drawing is unitless (INSUNITS 0): blocks inserted into it and objects pasted from
              other drawings are not scaled to its size.
            </p>
            <div className="health-fixes">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void fix({ kind: 'health-fix', what: 'units', insUnits: p.suggested })
                }
              >
                Use {unitName(p.suggested)}
              </button>
              <button
                type="button"
                title="Choose the units in the Drawing Units dialog"
                onClick={() => engines.command(doc.id, { kind: 'invoke', name: 'UNITS' })}
              >
                Units…
              </button>
            </div>
          </div>
        ) : (
          <div key={p.kind}>
            <p className="hint">
              The drawing is in {unitName(p.insUnits)} but its measurement is{' '}
              {systemName(p.measurement)} (MEASUREMENT {p.measurement === 'metric' ? 1 : 0}): new
              hatch patterns and linetypes come from the {p.measurement} files.
            </p>
            <div className="health-fixes">
              <button
                type="button"
                disabled={busy}
                onClick={() => void fix({ kind: 'health-fix', what: 'measurement' })}
              >
                Set Measurement to {systemName(p.suggested)}
              </button>
            </div>
          </div>
        ),
      )}
      {status}
    </Card>
  );
}

function DuplicatesCard({
  doc,
  store,
  checks,
}: {
  doc: OpenDocument;
  store: DocumentStore;
  checks: HealthChecks | undefined;
}) {
  const { fix, busy, status } = useHealthFix(doc, store);
  if (!checks) return <Checking id="duplicates" title="Duplicate objects" />;
  const { duplicates, overlaps } = checks.duplicates;
  const total = duplicates + overlaps;
  return (
    <Card id="duplicates" title="Duplicate objects" count={total}>
      {total === 0 ? (
        <p className="empty">None: OVERKILL finds nothing to delete.</p>
      ) : (
        <>
          <p className="hint">
            What OVERKILL deletes with its initial settings, in model space and each layout, outside
            locked layers: objects drawn twice, and lines, arcs and segments lying on others.
          </p>
          <Counts
            label="Duplicate objects"
            head={['Kind', 'Count']}
            rows={[
              ['Duplicates', duplicates],
              ['Overlapping', overlaps],
            ]}
          />
        </>
      )}
      <div className="health-fixes">
        {total > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void fix({ kind: 'health-fix', what: 'duplicates' })}
          >
            Delete Duplicates
          </button>
        )}
        <button
          type="button"
          title="Select the objects and choose the settings in Delete Duplicate Objects"
          onClick={() => engines.command(doc.id, { kind: 'invoke', name: 'OVERKILL' })}
        >
          Overkill…
        </button>
      </div>
      {status}
    </Card>
  );
}

function DynamicBlocksCard({ checks }: { checks: HealthChecks | undefined }) {
  if (!checks) return <Checking id="dynamic-blocks" title="Dynamic blocks" />;
  const { blocks, references } = checks.dynamicBlocks;
  return (
    <Card id="dynamic-blocks" title="Dynamic blocks" count={blocks.length}>
      {blocks.length === 0 ? (
        <p className="empty">None.</p>
      ) : (
        <>
          <p className="hint">
            Drawn as saved, in {plural(references, 'reference')}. Triya keeps their parameters and
            actions unchanged but does not run them: edit them in AutoCAD.
          </p>
          <Counts
            label="Dynamic blocks"
            head={['Block', 'References']}
            rows={blocks.map((b) => [b.name, b.references])}
          />
        </>
      )}
    </Card>
  );
}

function ConstraintsCard({ doc, checks }: { doc: OpenDocument; checks: HealthChecks | undefined }) {
  if (!checks) return <Checking id="constraints" title="Constraints" />;
  const { geometric, dimensional, userParameters } = checks.constraints;
  const total = geometric + dimensional;
  return (
    <Card id="constraints" title="Constraints" count={total}>
      {total + userParameters === 0 ? (
        <p className="empty">None.</p>
      ) : (
        <>
          <p className="hint">
            Parametric constraints, in the drawing and its blocks: edits keep them satisfied.
          </p>
          <Counts
            label="Constraints"
            head={['Kind', 'Count']}
            rows={[
              ['Geometric', geometric],
              ['Dimensional', dimensional],
              ['User parameters', userParameters],
            ]}
          />
        </>
      )}
      <div className="health-fixes">
        <button
          type="button"
          onClick={() => engines.command(doc.id, { kind: 'invoke', name: 'PARAMETERS' })}
        >
          Parameters Manager…
        </button>
      </div>
    </Card>
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
