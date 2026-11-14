// The Underlay Layers dialog (M2-56 part 1), ULAYERS', with AutoCAD 2024's structure and labels
// (UI_SPEC.md §7; AutoCAD 2024 Help, "Underlay Layers Dialog Box"): Reference Name, Search for
// layer, and the layer list with each layer's Status (on or off) and Name, then OK and Cancel.
// Each underlay keeps its own choices while the drafter moves between them in Reference Name;
// OK hands ULAYERS every underlay it changed, which ULAYERS applies as one undo step, and Cancel
// (and Esc) changes nothing. A layer is turned on or off with its check box, by mouse or with
// Space, so the dialog is keyboard operable throughout.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { EntityId } from '@triya/engine';
import { Modal } from './AttributeDialogs';
import {
  layerMatches,
  layerRows,
  okReply,
  toggled,
  underlayLayersDialog,
  type UnderlayLayersRequest,
} from './underlay-layers';

/** The PDF's layers by its file name: undefined when the file was not supplied. */
export type PdfLayers = (fileName: string) => Promise<readonly string[] | undefined>;

export function UnderlayLayers({
  doc,
  pdfLayers,
}: {
  doc: number | undefined;
  pdfLayers: PdfLayers;
}) {
  const open = useSyncExternalStore(underlayLayersDialog.subscribe, underlayLayersDialog.get);
  if (doc === undefined || open?.doc !== doc) return null;
  return <Body key={doc} request={open.request} pdfLayers={pdfLayers} />;
}

function Body({ request, pdfLayers }: { request: UnderlayLayersRequest; pdfLayers: PdfLayers }) {
  const { underlays } = request;
  const [selected, setSelected] = useState<EntityId>(request.current ?? underlays[0]!.id);
  const [edited, setEdited] = useState<ReadonlyMap<EntityId, readonly string[]>>(new Map());
  const [search, setSearch] = useState('');
  // The PDF's layers per file, read once each; null while reading.
  const [files, setFiles] = useState<ReadonlyMap<string, readonly string[] | undefined | null>>(
    new Map(),
  );
  const underlay = underlays.find((u) => u.id === selected) ?? underlays[0]!;
  const file = underlay.fileName;
  useEffect(() => {
    if (files.has(file)) return;
    setFiles((m) => new Map(m).set(file, null));
    void pdfLayers(file).then((layers) => setFiles((m) => new Map(m).set(file, layers)));
  }, [file, files, pdfLayers]);
  const read = files.get(file);
  const off = edited.get(underlay.id) ?? underlay.layersOff;
  const rows = useMemo(
    () => (read === null ? [] : layerRows(read, off).filter((r) => layerMatches(r.name, search))),
    [read, off, search],
  );
  const set = (name: string, on: boolean) =>
    setEdited((m) => new Map(m).set(underlay.id, toggled(off, name, on)));
  const ok = () => underlayLayersDialog.close(okReply(underlays, edited));
  const fileName = file.split(/[\\/]/).pop() ?? file;

  return (
    <Modal
      label="Underlay Layers"
      className="underlay-layers"
      onOk={ok}
      onCancel={() => underlayLayersDialog.close()}
    >
      <label className="cad-dialog-field">
        <span>Reference Name:</span>
        <select
          value={String(underlay.id)}
          onChange={(e) => setSelected(Number(e.target.value) as EntityId)}
        >
          {underlays.map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <label className="cad-dialog-field">
        <span>Search for layer:</span>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <table className="underlay-layers-list" aria-label="Layers">
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Name</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>
                <input
                  type="checkbox"
                  checked={r.on}
                  aria-label={r.name}
                  onChange={(e) => set(r.name, e.target.checked)}
                />
              </td>
              <td>{r.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {read === null && <p className="underlay-layers-note">Reading the PDF's layers…</p>}
      {read === undefined && (
        <p role="status" className="underlay-layers-note">
          {`${fileName} was not found: only the layers this underlay turns off are listed. Open the PDF (drop it on the window) to list them all.`}
        </p>
      )}
      {read !== undefined && read !== null && rows.length === 0 && search.trim() === '' && (
        <p role="status" className="underlay-layers-note">
          This PDF has no layers.
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={() => underlayLayersDialog.close()}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
