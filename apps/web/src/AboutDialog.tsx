// The About dialog (M9-07): AutoCAD's About box (ABOUT, Help > About) holds the product's name,
// version and legal notices. Triya's names its version and licence, lists the third-party software
// it ships (ATTRIBUTION.md) and shows the PlaneGCS solver module's notice (its LGPL-2.1+ and
// Eigen's MPL-2.0 terms, with the way to their source), whose licences ask for it wherever the
// module is distributed. The full licence texts open on request, loaded then.
// Tools > About opens it, and ABOUT at the command line; Esc or Close closes it.
import { useState } from 'react';
import { Modal } from './AttributeDialogs';
import {
  ABOUT_COMPONENTS,
  LICENCE_TEXTS,
  LICENSE_URL,
  MPL_URL,
  SOLVER_NOTICE,
  SOURCE_URL,
  inlineMarkdown,
  type Inline,
} from './about';

function Runs({ text, inlines }: { text?: string; inlines?: readonly Inline[] }) {
  return (inlines ?? inlineMarkdown(text ?? '')).map((r, i) =>
    r.kind === 'link' ? (
      <a key={i} href={r.href} target="_blank" rel="noreferrer">
        {r.text}
      </a>
    ) : r.kind === 'code' ? (
      <code key={i}>{r.text}</code>
    ) : r.kind === 'strong' ? (
      <strong key={i}>{r.text}</strong>
    ) : (
      r.text
    ),
  );
}

/**
 * A full licence text, read from the build when first shown. A button rather than <details>: the
 * dialog takes Enter as OK everywhere but on buttons, and a summary would close it.
 */
function LicenceText({
  id,
  label,
  load,
}: {
  id: string;
  label: string;
  load: () => Promise<string>;
}) {
  const [shown, setShown] = useState(false);
  const [text, setText] = useState<string | undefined>();
  return (
    <div className="about-licence">
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={`about-licence-${id}`}
        onClick={() => {
          setShown(!shown);
          if (text === undefined) void load().then(setText);
        }}
      >
        {shown ? 'Hide' : 'Show'} {label}
      </button>
      {shown && (
        <pre id={`about-licence-${id}`} tabIndex={0} aria-label={label}>
          {text ?? 'Loading…'}
        </pre>
      )}
    </div>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="About Triya CAD 2D" className="about-dialog" onOk={onClose} onCancel={onClose}>
      <div className="about-body" tabIndex={0} aria-label="About">
        <section aria-label="Product">
          <p className="about-product">
            <strong>Triya CAD 2D</strong> v{__APP_VERSION__} beta
          </p>
          <p>
            An Open Engineering Tools app, under the{' '}
            <a href={LICENSE_URL} target="_blank" rel="noreferrer">
              MIT licence
            </a>
            . Source code and issues:{' '}
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              {SOURCE_URL}
            </a>
          </p>
        </section>
        <section aria-label="Constraint solver module">
          {SOLVER_NOTICE.map((b, i) =>
            b.kind === 'heading' ? (
              <h3 key={i}>
                <Runs inlines={b.inlines} />
              </h3>
            ) : b.kind === 'paragraph' ? (
              <p key={i}>
                <Runs inlines={b.inlines} />
              </p>
            ) : (
              <ul key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Runs inlines={item} />
                  </li>
                ))}
              </ul>
            ),
          )}
          <p>
            The Mozilla Public License 2.0:{' '}
            <a href={MPL_URL} target="_blank" rel="noreferrer">
              {MPL_URL}
            </a>
          </p>
        </section>
        <section aria-label="Third-party software">
          <h3>Third-party software</h3>
          <ul className="about-components">
            {ABOUT_COMPONENTS.map((c) => (
              <li key={c.component}>
                <p>
                  <strong>
                    <Runs text={c.component} />
                  </strong>{' '}
                  · {c.licence} · <Runs text={c.source} />
                </p>
                <p className="about-use">
                  <Runs text={c.use} />
                </p>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Licence texts">
          <h3>Licence texts</h3>
          {LICENCE_TEXTS.map((l) => (
            <LicenceText key={l.id} id={l.id} label={l.label} load={l.load} />
          ))}
        </section>
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
