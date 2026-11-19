// The Unreconciled New Layers alert (M5-19 part 4; AutoCAD 2024 Help, "LAYERNOTIFY" and the Layer
// Settings dialog's Notify options; "Use New Layer Notification"). After each event a drawing's
// LAYERNOTIFY names (open, save, an xref's attach or reload, a layer state restored, an insert)
// with layers still unreconciled, the status bar shows the Unreconciled New Layers icon and its
// balloon, "each time the command that triggered the notification is used" until the layers are
// reconciled. View Unreconciled New Layers opens the Layer Properties Manager with the
// Unreconciled New Layers filter selected. PLOT asks in a dialog instead, Yes showing the new
// layers before plotting. The engine decides whether an event alerts (`layerNotice`); the alert
// waits here, outside React, per drawing.
//
// Help gives no wording for the balloon or the dialog (only that the dialog "informs you that
// there are new layers in the drawing since the layer list was last checked for new layers"),
// so Triya's text is its own.
import {
  layerNotice,
  type ChangeSet,
  type DocumentInit,
  type HeaderValue,
  type LayerNotifyEvent,
} from '@triya/engine';
import { editedHeader } from './coordinates';
import { drafting } from './drafting';
import { currentLayers } from './layers';

/** The unreconciled layers drawing `init` with `changes` alerts for on `event`; none when not. */
export function noticeLayers(
  init: DocumentInit,
  changes: readonly ChangeSet[],
  event: LayerNotifyEvent,
): string[] {
  const header = editedHeader(init.header, changes) as Map<string, HeaderValue>;
  return layerNotice({ header, layers: currentLayers(init, changes) }, event);
}

/**
 * The layers to alert for, as `noticeLayers`, but none while the user's LAYEREVALCTL is 0 (it is
 * told to the drawing's engine after it opens, so the change log may not hold it yet).
 */
export function alertLayers(
  init: DocumentInit,
  changes: readonly ChangeSet[],
  event: LayerNotifyEvent,
): string[] {
  return drafting.get().layerEvalCtl ? noticeLayers(init, changes, event) : [];
}

/** The balloon's text. */
export function noticeText(layers: readonly string[]): string {
  const n = layers.length;
  const shown = layers.slice(0, 5).join(', ');
  const names = n > 5 ? `${shown} and ${n - 5} more` : shown;
  return n === 1
    ? `1 new layer has been added since the layer list was last checked: ${names}.`
    : `${n} new layers have been added since the layer list was last checked: ${names}.`;
}

export interface LayerNotice {
  /** The layers the last event alerted for. */
  readonly layers: readonly string[];
  /** The balloon shows (until it is closed or the layers are viewed). */
  readonly balloon: boolean;
}

class Listeners {
  readonly #listeners = new Set<() => void>();

  readonly subscribe = (l: () => void): (() => void) => {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  };

  protected emit(): void {
    for (const l of this.#listeners) l();
  }
}

/** Each drawing's alert: raised by an event, its icon there until the layers are reconciled. */
export class LayerNotices extends Listeners {
  readonly #notices = new Map<number, LayerNotice>();

  readonly get = (doc: number): LayerNotice | undefined => this.#notices.get(doc);

  /** An event alerted for `layers` (none: it did not alert). */
  raise(doc: number, layers: readonly string[]): void {
    if (layers.length === 0) return;
    this.#notices.set(doc, { layers, balloon: true });
    this.emit();
  }

  closeBalloon(doc: number): void {
    const n = this.#notices.get(doc);
    if (!n?.balloon) return;
    this.#notices.set(doc, { ...n, balloon: false });
    this.emit();
  }

  /** The drawing closed, or its layers were all reconciled. */
  forget(doc: number): void {
    if (this.#notices.delete(doc)) this.emit();
  }
}

export const layerNotices = new LayerNotices();

/**
 * View Unreconciled New Layers: the drawing whose Layer Properties Manager is to select the
 * Unreconciled New Layers filter, until the manager, open or opening, takes it.
 */
export class UnreconciledView extends Listeners {
  #doc: number | undefined;

  request(doc: number): void {
    this.#doc = doc;
    this.emit();
  }

  /** Whether drawing `doc`'s manager is asked to show the filter (once). */
  take(doc: number): boolean {
    if (this.#doc !== doc) return false;
    this.#doc = undefined;
    return true;
  }
}

export const unreconciledView = new UnreconciledView();

/** PLOT's question (LAYERNOTIFY 1): view the new layers first? One question at a time. */
export class NoticeQuestion extends Listeners {
  #question: { readonly layers: readonly string[] } | undefined;
  #answer: ((view: boolean) => void) | undefined;

  readonly get = (): { readonly layers: readonly string[] } | undefined => this.#question;

  /** Resolves true for Yes (view the layers, no plot), false for No (plot). */
  ask(layers: readonly string[]): Promise<boolean> {
    this.answer(false);
    return new Promise((resolve) => {
      this.#question = { layers };
      this.#answer = resolve;
      this.emit();
    });
  }

  answer(view: boolean): void {
    const resolve = this.#answer;
    if (!resolve) return;
    this.#question = undefined;
    this.#answer = undefined;
    this.emit();
    resolve(view);
  }
}

export const plotNotice = new NoticeQuestion();
