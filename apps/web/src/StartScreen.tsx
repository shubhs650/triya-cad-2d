// The start screen (UI_SPEC.md §10; M5-10 New/Templates/Open, M2-14/M2-32 Recent drawings, M7-07
// the rest), shown while no drawing is open, as AutoCAD 2024's Start tab is: Start (New drawing
// from the default template, Templates..., Open drawing..., and Open PDF..., which opens a PDF
// in a new drawing to red-line it, redline.ts), Learn (the "Coming from AutoCAD" guide, the
// keyboard shortcuts and the project's pages), Recent drawings with their pictures, Samples from
// the public corpus, and the privacy statement with the version.
import { useId, useRef, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { RecentDrawings } from './RecentDrawings';
import type { RecentEntry } from './recent';
import { Icon } from './ribbon/Icon';
import type { IconName } from './ribbon/icons';
import { GUIDE, LEARN_LINKS, SAMPLES, type Sample } from './start-screen';

export function StartScreen({
  recent,
  onNew,
  onTemplates,
  onOpen,
  onOpenPdf,
  onOpenRecent,
  onSample,
  onShortcuts,
}: {
  recent: readonly RecentEntry[];
  onNew: () => void;
  onTemplates: () => void;
  onOpen: () => void;
  onOpenPdf: (file: File) => void;
  onOpenRecent: (key: string) => void;
  onSample: (sample: Sample) => void;
  onShortcuts: () => void;
}) {
  const pdfInput = useRef<HTMLInputElement>(null);
  const [guide, setGuide] = useState(false);
  return (
    <div className="start" data-testid="start">
      <div className="start-page">
        <header className="start-header">
          <h1>Triya CAD 2D</h1>
          <p>
            Start a new drawing, open a DWG or DXF one (or drop it anywhere here), or red-line a
            PDF.
          </p>
        </header>
        <div className="start-columns">
          <nav className="start-side" aria-label="Start">
            <section aria-labelledby="start-get-started">
              <h2 id="start-get-started">Start</h2>
              <ul className="start-actions">
                <Action icon="document_one_page_add" label="New drawing" onClick={onNew} />
                <Action icon="document_multiple" label="Templates…" onClick={onTemplates} />
                <Action icon="document_search" label="Open drawing…" onClick={onOpen} />
                <Action
                  icon="document_pdf"
                  label="Open PDF…"
                  hint="Red-line it in a new drawing"
                  onClick={() => pdfInput.current?.click()}
                />
              </ul>
              <input
                ref={pdfInput}
                type="file"
                accept=".pdf,application/pdf"
                hidden
                aria-label="PDF to open"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = '';
                  if (file) onOpenPdf(file);
                }}
              />
            </section>
            <section aria-labelledby="start-learn">
              <h2 id="start-learn">Learn</h2>
              <ul className="start-actions">
                <Action
                  icon="style_guide"
                  label="Coming from AutoCAD"
                  onClick={() => setGuide(true)}
                />
                <Action icon="keyboard" label="Keyboard shortcuts…" onClick={onShortcuts} />
                {LEARN_LINKS.map((l) => (
                  <li key={l.href}>
                    <a className="start-action" href={l.href} target="_blank" rel="noreferrer">
                      <Icon name="link" />
                      <span className="start-action-label">{l.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </nav>
          <div className="start-main">
            <RecentDrawings entries={recent} onOpen={onOpenRecent} />
            <section className="samples" aria-labelledby="start-samples">
              <h2 id="start-samples">Samples</h2>
              <ul>
                {SAMPLES.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      title={`${s.description} ${s.source}`}
                      onClick={() => onSample(s)}
                    >
                      <span className="sample-picture">
                        <img src={s.picture} alt="" draggable={false} />
                      </span>
                      <span className="sample-name">{s.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="start-note">
                From the ezdxf examples and Triya’s test drawings, MIT licensed.
              </p>
            </section>
          </div>
        </div>
        <footer className="start-footer">
          <p className="privacy">
            Drawings never leave this device: Triya works offline and makes no network calls except
            to check for its own updates.
          </p>
          <p className="start-version">
            Triya CAD 2D v{__APP_VERSION__} beta · MIT licence · an Open Engineering Tools app
          </p>
        </footer>
      </div>
      {guide && <ComingFromAutoCad onClose={() => setGuide(false)} />}
    </div>
  );
}

function Action({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  const hintId = useId();
  return (
    <li>
      {/* The hint describes the button rather than naming it ("Open PDF…"). */}
      <button
        type="button"
        className="start-action"
        onClick={onClick}
        {...(hint && { 'aria-label': label, 'aria-describedby': hintId })}
      >
        <Icon name={icon} />
        <span className="start-action-label">{label}</span>
        {hint && (
          <span className="start-action-hint" id={hintId}>
            {hint}
          </span>
        )}
      </button>
    </li>
  );
}

/** The "Coming from AutoCAD" guide (UI_SPEC.md §10), its content in start-screen.ts. */
export function ComingFromAutoCad({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      label="Coming from AutoCAD"
      className="coming-from-autocad"
      onOk={onClose}
      onCancel={onClose}
    >
      <div className="guide-body" tabIndex={0} aria-label="Guide">
        {GUIDE.map((s) => (
          <section key={s.title} aria-label={s.title}>
            <h3>{s.title}</h3>
            <ul>
              {s.items.map((i) => (
                <li key={i.text}>
                  <p>{i.text}</p>
                  {(i.commands || i.keys) && (
                    <p className="guide-terms">
                      {i.commands?.map((c) => (
                        <code
                          key={c.name}
                          title={c.aliases?.length ? `Aliases: ${c.aliases.join(', ')}` : undefined}
                        >
                          {c.name}
                          {c.aliases?.length ? ` (${c.aliases.join(', ')})` : ''}
                        </code>
                      ))}
                      {i.keys?.map((k) => (
                        <span key={k.key} className="guide-key">
                          <kbd>{k.key}</kbd> {k.label}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
