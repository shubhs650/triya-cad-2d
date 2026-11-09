// The app's offline and update chrome (M2-19, PRD FR-F10 and T1, ARCHITECTURE.md §14): the
// title bar's offline status ("Ready offline" once every file is cached), its Install button
// while the browser would install the app, and the banner offering a new version, which
// reloads only when the user presses Reload.
import { useSyncExternalStore } from 'react';
import type { Pwa } from './pwa';

export function OfflineStatus({ pwa }: { pwa: Pwa }) {
  useSyncExternalStore(pwa.subscribe, pwa.getSnapshot);
  const label = pwa.label();
  if (!label) return null;
  const ready = label === 'Ready offline' || label === 'Working offline';
  return (
    <span
      className={ready ? 'badge offline-status ready' : 'badge offline-status'}
      data-testid="offline-status"
      role="status"
      title={
        ready
          ? 'Triya CAD 2D is saved on this device and works without a connection.'
          : 'Saving Triya CAD 2D on this device so it works without a connection.'
      }
    >
      {label}
    </span>
  );
}

export function InstallButton({ pwa }: { pwa: Pwa }) {
  const { install } = useSyncExternalStore(pwa.subscribe, pwa.getSnapshot);
  if (!install) return null;
  return (
    <button
      type="button"
      className="install-button"
      title="Install Triya CAD 2D as an app on this device"
      onClick={() => void pwa.install()}
    >
      Install
    </button>
  );
}

export function UpdateBanner({ pwa }: { pwa: Pwa }) {
  const { update } = useSyncExternalStore(pwa.subscribe, pwa.getSnapshot);
  if (!update) return null;
  return (
    <div className="banner update" role="region" aria-label="New version">
      <span>
        A new version of Triya CAD 2D is ready. Reload to use it; drawings with unsaved changes ask
        first.
      </span>
      <span className="banner-actions">
        <button type="button" onClick={() => pwa.applyUpdate()}>
          Reload
        </button>
        <button type="button" onClick={() => pwa.dismissUpdate()}>
          Later
        </button>
      </span>
    </div>
  );
}
