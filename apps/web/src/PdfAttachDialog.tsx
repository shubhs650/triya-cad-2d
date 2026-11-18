// PDFATTACH's Attach PDF Underlay dialog (M5-04 part 8), with the structure and labels of
// AutoCAD's (AutoCAD Help, "Attach PDF Underlay Dialog Box"; UI_SPEC.md §7): Name (the drawing's
// PDF files) with Browse..., "Select one or more pages" (Shift or Ctrl selects several), Path type,
// Insertion point (Specify on-screen, X, Y), Scale (Specify on-screen, the factor), Rotation
// (Specify on-screen, Angle), and Show Details (Found in, Saved path); OK and Cancel. What is
// Specify on-screen is asked at the command line once the dialog closes (commands/pdf-attach.ts).
//
// Browse... picks the file (AutoCAD's Select Reference File dialog); pdf.js reads its pages and
// their sizes. On OK its bytes go to the app's PDF pages, so the underlay draws at once, and the
// definition names the file alone: a browser cannot tell a file's folder, so Path type is No path
// (Full path and Relative path greyed), which Triya and AutoCAD look for beside the drawing. A file
// the drawing shows lists its pages when it was supplied this session (dropped or picked);
// otherwise Browse... to it. The page list shows each page's number and size (AutoCAD shows
// thumbnails). Left out: the insertion point's Z and Help.
import type { DialogRequest, PdfAttachEntry, PdfAttachSettings } from '@triya/engine';
import { INSUNITS_NAMES } from '@triya/engine';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';
import { NumberField, OnScreen, numberOf, shown } from './ImageAttachDialog';

type Request = Extract<DialogRequest, { type: 'pdfattach' }>;

/** A page's size in inches, as displayed. */
export interface PdfPageSize {
  readonly width: number;
  readonly height: number;
}

/** The PDF files the dialog reads and supplies (App's `pdfPages`). */
export interface PdfAttachFiles {
  /** The pages of the supplied file of this name; undefined when it was not supplied. */
  pages(fileName: string): Promise<readonly PdfPageSize[] | undefined>;
  /** The pages of a file picked with Browse...; undefined when pdf.js cannot read it. */
  read(bytes: Uint8Array): Promise<readonly PdfPageSize[] | undefined>;
  /** The picked file, on OK: the app's PDF pages serve it to the drawing. */
  add(fileName: string, bytes: Uint8Array): void;
}

/** A file picked with Browse..., not in the drawing yet. */
interface Picked extends PdfAttachEntry {
  readonly bytes: Uint8Array;
  readonly sizes: readonly PdfPageSize[];
}

const baseName = (fileName: string) =>
  fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || fileName;

/** A page's size as the list shows it, in the drawing's units at scale 1. */
const sizeText = (p: PdfPageSize, k: number) => `${shown(p.width * k)} x ${shown(p.height * k)}`;

export function PdfAttachDialog({
  doc,
  request,
  files,
}: {
  doc: number;
  request: Request;
  files?: PdfAttachFiles | undefined;
}) {
  const s = request.settings;
  const [picked, setPicked] = useState<Picked>();
  const [name, setName] = useState(request.pdfs[0]?.name ?? '');
  const [problem, setProblem] = useState<string>();
  /** The listed file's pages, once read: undefined while reading, null when not supplied. */
  const [sizes, setSizes] = useState<readonly PdfPageSize[] | null>();
  const [selected, setSelected] = useState<readonly string[]>(['1']);
  const [pointOnScreen, setPointOnScreen] = useState(s.pointOnScreen);
  const [x, setX] = useState(shown(s.point.x));
  const [y, setY] = useState(shown(s.point.y));
  const [scaleOnScreen, setScaleOnScreen] = useState(s.scaleOnScreen);
  const [scale, setScale] = useState(shown(s.scale));
  const [rotationOnScreen, setRotationOnScreen] = useState(s.rotationOnScreen);
  const [angle, setAngle] = useState(shown((s.rotation * 180) / Math.PI));
  const [details, setDetails] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const nameId = useId();
  const pagesId = useId();
  const pathTypeId = useId();

  // A drawing without PDFs opens on Browse..., as AutoCAD opens on picking the file.
  useEffect(() => {
    if (request.pdfs.length === 0) browse.current?.focus();
  }, [request.pdfs.length]);

  const entries = useMemo(
    () => (picked ? [picked, ...request.pdfs.filter((e) => e.name !== picked.name)] : request.pdfs),
    [picked, request.pdfs],
  );
  const pdf = entries.find((e) => e.name === name);

  // The pages of a listed file: the picked one's, else the supplied file's, read once per name.
  useEffect(() => {
    let live = true;
    const read = !pdf
      ? Promise.resolve(undefined)
      : picked && pdf === picked
        ? Promise.resolve(picked.sizes)
        : (files?.pages(pdf.fileName) ?? Promise.resolve(undefined));
    setSizes(undefined);
    void read.then((p) => {
      if (live) setSizes(p ?? null);
    });
    return () => {
      live = false;
    };
  }, [pdf, picked, files]);

  const take = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const read = await (files?.read(bytes) ?? Promise.resolve(undefined));
    if (!read || read.length === 0) {
      setProblem(`${file.name} is not a PDF file Triya can attach.`);
      return;
    }
    const known = request.pdfs.find((e) => e.fileName.toLowerCase() === file.name.toLowerCase());
    const entry: Picked = {
      name: known?.name ?? baseName(file.name),
      fileName: file.name,
      pages: known?.pages ?? [],
      bytes,
      sizes: read,
    };
    setProblem(undefined);
    setPicked(entry);
    setName(entry.name);
    setSelected(['1']);
  };

  const pages = sizes
    ? sizes.map((size, i) => ({ page: String(i + 1), width: size.width, height: size.height }))
    : [];
  const chosen = pages.filter((p) => selected.includes(p.page));
  const values = {
    x: numberOf(x),
    y: numberOf(y),
    scale: numberOf(scale),
    angle: numberOf(angle),
  };
  const valid =
    pdf !== undefined &&
    chosen.length > 0 &&
    (pointOnScreen || (values.x !== undefined && values.y !== undefined)) &&
    (scaleOnScreen || (values.scale !== undefined && values.scale > 0)) &&
    (rotationOnScreen || values.angle !== undefined);

  const settings = (): PdfAttachSettings => ({
    pointOnScreen,
    point: { x: values.x ?? s.point.x, y: values.y ?? s.point.y },
    scaleOnScreen,
    scale: values.scale ?? s.scale,
    rotationOnScreen,
    rotation: values.angle === undefined ? s.rotation : (values.angle * Math.PI) / 180,
  });
  const ok = () => {
    if (!valid || !pdf) return;
    if (picked && pdf === picked) files?.add(picked.fileName, picked.bytes);
    void engines.command(doc, {
      kind: 'answer',
      answer: {
        kind: 'dialog',
        action: 'ok',
        pdfAttach: { file: { fileName: pdf.fileName, pages: chosen }, settings: settings() },
      },
    });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });

  const unit = INSUNITS_NAMES[request.units] ?? INSUNITS_NAMES[0]!;
  const found =
    picked && pdf === picked
      ? 'Picked this session'
      : sizes
        ? 'Supplied this session'
        : 'Not found';
  const listNote =
    pdf === undefined
      ? 'Browse... to a PDF file.'
      : sizes === null
        ? `${pdf.fileName} was not found: Browse... to it to list its pages.`
        : undefined;

  return (
    <Modal label="Attach PDF Underlay" className="pdf-attach-dialog" onOk={ok} onCancel={cancel}>
      <div className="insert-dialog-head">
        <div className="image-attach-name">
          <label className="cad-dialog-field insert-dialog-name" htmlFor={nameId}>
            <span>Name:</span>
            <select
              id={nameId}
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value);
                setSelected(['1']);
              }}
            >
              {pdf === undefined && <option value={name}>{name}</option>}
              {entries.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <button ref={browse} type="button" onClick={() => input.current?.click()}>
            Browse...
          </button>
          <input
            ref={input}
            type="file"
            accept=".pdf,application/pdf"
            hidden
            aria-label="Select Reference File"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) void take(f);
            }}
          />
          <label className="cad-dialog-field" htmlFor={pathTypeId}>
            <span>Path type:</span>
            <select id={pathTypeId} value="none" disabled>
              <option value="full" disabled>
                Full path
              </option>
              <option value="relative" disabled>
                Relative path
              </option>
              <option value="none">No path</option>
            </select>
          </label>
        </div>
        <label className="cad-dialog-field pdf-attach-pages" htmlFor={pagesId}>
          <span>Select one or more pages:</span>
          <select
            id={pagesId}
            multiple
            size={6}
            value={[...selected]}
            onChange={(e) => setSelected([...e.currentTarget.selectedOptions].map((o) => o.value))}
          >
            {pages.map((p) => (
              <option key={p.page} value={p.page}>
                {`Page ${p.page} (${sizeText(p, request.unitsPerInch)})`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {listNote && <p className="insert-dialog-unit">{listNote}</p>}
      <div className="block-definition-groups">
        <fieldset className="block-definition-group">
          <legend>Insertion point</legend>
          <OnScreen checked={pointOnScreen} onChange={setPointOnScreen} />
          <NumberField label="X:" value={x} onChange={setX} disabled={pointOnScreen} />
          <NumberField label="Y:" value={y} onChange={setY} disabled={pointOnScreen} />
        </fieldset>
        <fieldset className="block-definition-group">
          <legend>Scale</legend>
          <OnScreen checked={scaleOnScreen} onChange={setScaleOnScreen} />
          <NumberField label="Scale:" value={scale} onChange={setScale} disabled={scaleOnScreen} />
        </fieldset>
        <fieldset className="block-definition-group">
          <legend>Rotation</legend>
          <OnScreen checked={rotationOnScreen} onChange={setRotationOnScreen} />
          <NumberField
            label="Angle:"
            value={angle}
            onChange={setAngle}
            disabled={rotationOnScreen}
          />
        </fieldset>
      </div>
      {details && (
        <fieldset className="block-definition-group image-attach-details">
          <legend>Path</legend>
          <p className="insert-dialog-unit">
            Found in: <span data-testid="pdf-attach-found">{pdf ? found : ''}</span>
          </p>
          <p className="insert-dialog-unit">
            Saved path: <span data-testid="pdf-attach-path">{pdf?.fileName ?? ''}</span>
          </p>
          <p className="insert-dialog-unit">
            Page sizes in: <span data-testid="pdf-attach-unit">{unit}</span>
          </p>
        </fieldset>
      )}
      {(problem ?? request.note) !== undefined && (
        <p role="alert" className="cell-block-error">
          {problem ?? request.note}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => setDetails(!details)}>
          {details ? 'Hide Details' : 'Show Details'}
        </button>
        <button type="button" onClick={ok} disabled={!valid}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
