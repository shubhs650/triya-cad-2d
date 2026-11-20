// LAYOUT Template's dialogs (M6-01 part 4), with AutoCAD 2024's structure and labels (UI_SPEC.md
// §7; AutoCAD 2024 Help, "LAYOUT (Command)": "a standard file selection dialog box is displayed
// for selecting a DWT, DWG, or DXF file. After you select a file, the Insert Layouts dialog box
// is displayed, which lists the layouts saved in the selected file"). A browser shows its own
// file picker only from a click, so the Insert Layout(s) dialog opens first, on its Select
// Template From File... button; the file's layouts then fill Layout name(s), all selected (a
// file with one layout has nothing to choose), and OK inserts those selected. Cancel and Esc
// insert nothing. The list is a multiple-selection list box, keyboard operable throughout.
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { Modal } from './AttributeDialogs';
import { drawingFileModel } from './dimstyle-import';
import { insertLayoutsDialog, templateFile, type TemplateFile } from './layout-template-files';

export function InsertLayoutsDialog({ doc }: { doc: number | undefined }) {
  const open = useSyncExternalStore(insertLayoutsDialog.subscribe, insertLayoutsDialog.get);
  if (doc === undefined || open?.doc !== doc) return null;
  return <Body key={doc} />;
}

function Body() {
  const [file, setFile] = useState<TemplateFile>();
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [problem, setProblem] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const read = async (f: File) => {
    setProblem(undefined);
    try {
      const t = templateFile(f.name, await drawingFileModel(f));
      if (t.layouts.length === 0) {
        setProblem(`${f.name} has no layouts.`);
        return;
      }
      setFile(t);
      setPicked(t.layouts.map((l) => l.template.name));
    } catch (e) {
      setProblem(`${f.name}: ${e instanceof Error ? e.message : 'The file could not be read.'}`);
    }
  };
  const ok = () => {
    if (file && picked.length > 0) insertLayoutsDialog.close(file, picked);
  };
  const cancel = () => insertLayoutsDialog.close();

  return (
    <Modal label="Insert Layout(s)" className="insert-layouts" onOk={ok} onCancel={cancel}>
      <div className="cad-dialog-field">
        <button type="button" onClick={() => input.current?.click()}>
          Select Template From File...
        </button>
        <input
          ref={input}
          type="file"
          accept=".dxf,.dwg,.dwt"
          hidden
          aria-label="Template file"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void read(f);
          }}
        />
        <span data-testid="insert-layouts-file">{file?.name ?? ''}</span>
      </div>
      <label className="cad-dialog-field insert-layouts-names" htmlFor={listId}>
        <span>Layout name(s):</span>
        <select
          id={listId}
          multiple
          size={8}
          value={[...picked]}
          onChange={(e) => setPicked([...e.currentTarget.selectedOptions].map((o) => o.value))}
          onDoubleClick={ok}
        >
          {file?.layouts.map((l) => (
            <option key={l.template.name} value={l.template.name}>
              {l.template.name}
            </option>
          ))}
        </select>
      </label>
      {problem && (
        <p role="alert" className="insert-layouts-problem">
          {problem}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={!file || picked.length === 0}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
