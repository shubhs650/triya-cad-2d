// The recovery banner (M2-14, PRD FR-F5, UI_SPEC §10): on launch, each unsaved drawing a page
// that is gone left behind (a crash, a killed tab, a window closed with changes) is offered
// with Recover and Discard, as AutoCAD's Drawing Recovery offers its autosave files.
import { useSyncExternalStore } from 'react';
import type { RecoveryOffers } from './recovery';

export function RecoveryBanner({
  offers,
  onRecover,
}: {
  offers: RecoveryOffers;
  onRecover: (key: string) => void;
}) {
  const list = useSyncExternalStore(offers.subscribe, offers.getSnapshot);
  if (list.length === 0) return null;
  return (
    <div className="banner recovery" role="region" aria-label="Drawing recovery">
      {list.map((i) => (
        <div className="recovery-row" key={i.key} data-testid="recovery-offer">
          <span>
            Recover unsaved drawing? <strong>{i.name}</strong>, {i.edits}{' '}
            {i.edits === 1 ? 'change' : 'changes'} not saved, autosaved{' '}
            {new Date(i.savedAt).toLocaleString()}.
          </span>
          <button type="button" onClick={() => onRecover(i.key)}>
            Recover
          </button>
          <button type="button" onClick={() => void offers.discard(i.key).catch(() => undefined)}>
            Discard
          </button>
        </div>
      ))}
    </div>
  );
}
