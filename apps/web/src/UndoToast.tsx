// UI_SPEC §11's undo toast (M2-23): after U, UNDO or REDO on the drawing shown, what it undid or
// redid and how many steps are left, for a moment, in a polite live region.
import { useEffect, useSyncExternalStore } from 'react';
import type { UndoStates } from './undo';

/** How long the toast shows. */
const TOAST_MS = 2500;

export function UndoToast({
  states,
  active,
}: {
  readonly states: UndoStates;
  readonly active: number | undefined;
}) {
  useSyncExternalStore(states.subscribe, states.version);
  const toast = states.toast;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => states.dismiss(toast.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [states, toast]);
  // Another drawing's toast is not this one's news.
  const shown = toast && toast.doc === active ? toast : undefined;
  return (
    <div className="undo-toast-region" role="status" aria-live="polite">
      {shown && (
        <div className="undo-toast" key={shown.id} data-testid="undo-toast">
          {shown.text}
        </div>
      )}
    </div>
  );
}
