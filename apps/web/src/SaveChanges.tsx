// AutoCAD's "Save changes to <file>?" message box (M2-13, UI_SPEC.md §7): Yes saves the drawing
// and closes it, No closes it without saving, Cancel (and Esc) keeps it open. A modal dialog,
// so the keyboard reaches its buttons first; Yes has the focus, as in AutoCAD.
import { useRef, useSyncExternalStore } from 'react';
import type { SaveChangesPrompt } from './save-changes';
import { useModalDialog } from './modal-dialog';

export function SaveChanges({ prompt }: { prompt: SaveChangesPrompt }) {
  const question = useSyncExternalStore(prompt.subscribe, prompt.get);
  const dialog = useRef<HTMLDialogElement>(null);
  const yes = useRef<HTMLButtonElement>(null);

  useModalDialog(dialog, question !== undefined, () => yes.current?.focus());

  return (
    <dialog
      ref={dialog}
      className="save-changes"
      aria-labelledby="save-changes-title"
      aria-describedby="save-changes-text"
      onCancel={(e) => {
        e.preventDefault();
        prompt.answer('cancel');
      }}
    >
      <h2 id="save-changes-title">Triya CAD 2D</h2>
      <p id="save-changes-text">Save changes to {question?.name}?</p>
      <div className="buttons">
        <button ref={yes} type="button" onClick={() => prompt.answer('yes')}>
          Yes
        </button>
        <button type="button" onClick={() => prompt.answer('no')}>
          No
        </button>
        <button type="button" onClick={() => prompt.answer('cancel')}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
