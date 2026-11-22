// M7-10: a modal <dialog>'s open and close, with the focus given back on closing (WAI-ARIA APG,
// dialog pattern: "When a dialog closes, focus returns to the element that invoked it"). A
// dialog closed by unmounting it lost the focus to the page's <body>, as `close()` ran on a
// dialog React had already taken out of the page; Tab then started again at the top of the
// window and Escape-then-type worked only because typing finds the command line anyway.
import { useLayoutEffect, type RefObject } from 'react';

/** The command line's input, where the focus goes when the element that had it is gone. */
const commandLine = () =>
  document.querySelector<HTMLElement>('.command-line input[aria-label="Command"]');

/**
 * Gives the focus back to `opener` (the element that had it when a dialog opened) once the
 * dialog `closed` has closed, unless the focus has already gone somewhere: to another dialog the engine
 * opened, say. When `opener` has left the page or cannot take the focus (inert under another
 * modal dialog, hidden), the command line takes it, as AutoCAD returns to its command line.
 */
export function restoreFocus(opener: Element | null, closed?: Element): void {
  const now = document.activeElement;
  // A control of the dialog just closed keeps the focus until the browser's next focus fixup.
  const nowhere = !now || now === document.body || !now.isConnected || closed?.contains(now);
  if (!nowhere && now !== opener) return;
  if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
    opener.focus({ preventScroll: true });
    if (document.activeElement === opener) return;
  }
  commandLine()?.focus({ preventScroll: true });
}

/**
 * Shows the <dialog> in `ref` modal while `open` (on mount, by default), and closes it when
 * `open` goes false or the component unmounts, giving the focus back (`restoreFocus`). A layout
 * effect, so the cleanup's `close()` runs while the dialog is still in the page. `onOpen` runs
 * once it shows (a message box focusing its default button).
 */
export function useModalDialog(
  ref: RefObject<HTMLDialogElement | null>,
  open = true,
  onOpen?: () => void,
): void {
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    const opener = document.activeElement;
    if (!d.open) d.showModal();
    onOpen?.();
    return () => {
      if (d.open) d.close();
      restoreFocus(opener, d);
    };
    // `onOpen` is read once, when the dialog shows.
  }, [open, ref]);
}
