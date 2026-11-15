// The Edit Aliases dialog (M3-10, FR-C4): the user alias file in acad.pgp syntax, which AutoCAD's
// Manage tab opens in a text editor (Edit Aliases). Its lines are checked as they are typed (a
// line that cannot be read, a command Triya does not have, an alias a command name hides); OK
// keeps the file with the settings and every drawing's command line follows it at once, where
// AutoCAD waits for REINIT. Import… reads a .pgp file in place of the text, Export… downloads it.
import { ALIASES, aliasFileProblems, formatAliasFile, parseAliasFile } from '@triya/engine';
import { useMemo, useRef, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { download } from './PlotDialog';
import { ALIAS_FILE_MAX, NEW_ALIAS_FILE, appRegistry } from './user-aliases';

export function AliasEditor({
  file,
  onOk,
  onCancel,
}: {
  /** The user alias file kept now; '' for none. */
  file: string;
  onOk: (file: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(file === '' ? NEW_ALIAS_FILE : file);
  const picker = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseAliasFile(text), [text]);
  const problems = useMemo(() => aliasFileProblems(parsed, appRegistry), [parsed]);
  const count = Object.keys(parsed.aliases).length;
  const overrides = Object.keys(parsed.aliases).filter((a) => ALIASES[a] !== undefined).length;
  const tooLong = text.length > ALIAS_FILE_MAX;
  const ok = () => {
    if (!tooLong) onOk(text);
  };
  return (
    <Modal label="Edit Aliases" className="alias-editor" onOk={ok} onCancel={onCancel}>
      <label className="alias-editor-file">
        User aliases (acad.pgp)
        <textarea
          value={text}
          spellCheck={false}
          rows={16}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="alias-editor-count" aria-live="polite">
        {count === 1 ? '1 alias' : `${count} aliases`}
        {overrides > 0 && `, ${overrides} in place of default ones`}
      </p>
      {(problems.length > 0 || tooLong) && (
        <ul className="alias-editor-problems" aria-label="Problems">
          {tooLong && <li>The file is longer than {ALIAS_FILE_MAX} characters.</li>}
          {problems.map((p, i) => (
            <li key={i}>
              Line {p.line}: {p.message}
            </li>
          ))}
        </ul>
      )}
      <details className="alias-editor-defaults">
        <summary>Default aliases</summary>
        <pre>{formatAliasFile(ALIASES)}</pre>
      </details>
      <input
        ref={picker}
        type="file"
        accept=".pgp,text/plain"
        hidden
        data-testid="alias-file-picker"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void f.text().then(setText);
        }}
      />
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => picker.current?.click()}>
          Import…
        </button>
        <button
          type="button"
          onClick={() => download('acad.pgp', new TextEncoder().encode(text), 'text/plain')}
        >
          Export…
        </button>
        <span className="alias-editor-gap" />
        <button type="button" disabled={tooLong} onClick={ok}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
