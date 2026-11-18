// LWUNITS as the dialogs' lineweight lists read it (M5-08 part 5, M5-12): AutoCAD lists every
// lineweight in the units LWUNITS names, 0 inches and 1 millimetres (AutoCAD 2024 Help,
// "LWUNITS"). The app keeps LWUNITS with its drafting settings (Lineweight Settings sets it).
import { useSyncExternalStore } from 'react';
import type { LineweightUnits } from '@triya/engine';
import { drafting } from './drafting';

export const lineweightUnitsOf = (lwUnits: number): LineweightUnits =>
  lwUnits === 0 ? 'in' : 'mm';

/** LWUNITS now, kept current while a dialog is open. */
export function useLineweightUnits(): LineweightUnits {
  return lineweightUnitsOf(useSyncExternalStore(drafting.subscribe, () => drafting.get().lwUnits));
}
