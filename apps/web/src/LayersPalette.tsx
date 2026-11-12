// The Layers palette (M1-23, UI_SPEC.md §4), docked right as AutoCAD's Layer Properties
// Manager: the layers by name with Status, On, Freeze, Lock, Plot, Color, Linetype,
// Lineweight and Description (M1-104) columns, and VP Freeze in a layout. On, Freeze and Lock
// toggle; each toggle is a document edit the drawing's engine applies (M1-67) and every canvas
// of the drawing redraws.
// The rest is read-only until property editing (M2). Fully keyboard operable: every toggle is a
// button.
import { useMemo, useState } from 'react';
import type { EngineEdit } from '@triya/engine';
import { controllerOf } from './canvas/registry';
import type { DocumentStore, OpenDocument } from './documents';
import { engines } from './engine/registry';
import { layerRows, type LayerRow } from './layers';

type Toggle = 'on' | 'frozen' | 'locked';

const TOGGLES: readonly { key: Toggle; title: string; label: (r: LayerRow) => string }[] = [
  { key: 'on', title: 'On', label: (r) => (r.on ? 'On' : 'Off') },
  { key: 'frozen', title: 'Freeze', label: (r) => (r.frozen ? 'Frozen' : 'Thawed') },
  { key: 'locked', title: 'Lock', label: (r) => (r.locked ? 'Locked' : 'Unlocked') },
];

export function LayersPalette({
  doc,
  store,
  onClose,
}: {
  doc: OpenDocument;
  store: DocumentStore;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | undefined>();
  const [last, setLast] = useState<{ click: number; frame: number } | undefined>();
  const inLayout = doc.block !== doc.opened.modelSpace;
  const rows = useMemo(
    () => layerRows(doc.opened.init, engines.changesOf(doc.id), inLayout ? doc.block : undefined),
    // `revision` changes when the engine applied an edit, which is what the rows read.
    [doc.opened, doc.id, doc.block, doc.revision, inLayout],
  );
  const needle = search.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;

  const toggle = async (row: LayerRow, key: Toggle) => {
    const start = performance.now();
    // After a click Chromium runs nothing else on the page, the engine's answer included, until
    // it has drawn its next frame: the toggle's own latency counts from that frame (DEC-054).
    let frame: number | undefined;
    requestAnimationFrame(() => {
      frame ??= performance.now();
    });
    const edit: EngineEdit = { kind: 'layer', layer: row.handle, [key]: !row[key] };
    const result = await engines.edit(doc.id, edit);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    // Toggle → canvas: until the space on screen has drawn the change (acceptance < 16 ms).
    // The palette's own re-render comes after, so it is not counted.
    await controllerOf(doc.id, doc.block)?.flush();
    const end = performance.now();
    setMessage(undefined);
    setLast({ click: end - start, frame: end - (frame ?? start) });
    store.edited(doc.id);
  };

  return (
    <aside
      className="palette layers-palette"
      aria-labelledby="layers-title"
      data-last-toggle-ms={last?.click.toFixed(1)}
      data-last-toggle-frame-ms={last?.frame.toFixed(1)}
    >
      <header>
        <h2 id="layers-title">Layers</h2>
        <button type="button" aria-label="Close Layers" onClick={onClose}>
          ×
        </button>
      </header>
      <input
        type="search"
        className="layer-search"
        placeholder="Search for layer"
        aria-label="Search for layer"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {message && (
        <p className="message error" role="alert">
          {message}
        </p>
      )}
      <div className="layer-table-wrap">
        <table className="layer-table" aria-label="Layers of the drawing">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Name</th>
              {TOGGLES.map((t) => (
                <th key={t.key} scope="col">
                  {t.title}
                </th>
              ))}
              {inLayout && <th scope="col">VP Freeze</th>}
              <th scope="col">Plot</th>
              <th scope="col">Color</th>
              <th scope="col">Linetype</th>
              <th scope="col">Lineweight</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.handle} data-current={r.current}>
                <td className="status">
                  {r.current ? <span aria-label="Current layer">✓</span> : null}
                </td>
                <th scope="row" className="name">
                  {r.name}
                </th>
                {TOGGLES.map((t) => (
                  <td key={t.key}>
                    <button
                      type="button"
                      className={`toggle ${t.key}`}
                      aria-pressed={t.key === 'on' ? r.on : r[t.key]}
                      aria-label={`${t.title} ${r.name}`}
                      title={t.label(r)}
                      onClick={() => void toggle(r, t.key)}
                    >
                      {t.label(r)}
                    </button>
                  </td>
                ))}
                {inLayout && (
                  <td className="vp-freeze">
                    {r.vpFrozen && r.vpFrozen.of > 0
                      ? `${r.vpFrozen.frozen} of ${r.vpFrozen.of}`
                      : '—'}
                  </td>
                )}
                <td>{r.plot ? 'Plot' : 'No plot'}</td>
                <td className="color">
                  <span className="swatch" style={{ background: r.color.css }} aria-hidden />
                  {r.color.label}
                </td>
                <td>{r.linetype}</td>
                <td>{r.lineweight}</td>
                <td className="description">{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No layer matches “{search}”.</p>}
      </div>
    </aside>
  );
}
