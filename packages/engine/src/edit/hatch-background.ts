// A pattern hatch's background colour (M4-07 part 3), AutoCAD's HPBACKGROUNDCOLOR. AutoCAD keeps
// it as the hatch's `HATCHBACKGROUNDCOLOR` xdata: one 1071 group, an AcCmEntityColor (the colour
// method in the high byte: 0xC2 a true colour in the low three bytes, 0xC3 an ACI in the low
// byte, 0xC8 none), as ezdxf's `Hatch.bgcolor` writes it. The model shows it as
// `HatchGeometry.background` (io reads it from the xdata), so whatever sets one sets both here.
import type { ChangeSetBuilder } from '../model/builder';
import type { Handle } from '../model/handle';
import type { DocumentModel } from '../model/document';
import type { Color, Xdata } from '../model/types';

export const HATCH_BACKGROUND_APP = 'HATCHBACKGROUNDCOLOR';

/** A background is an ACI or a true colour: ByLayer and ByBlock have no meaning behind lines. */
export type BackgroundColor = Color & { kind: 'aci' | 'rgb' };

/** The 1071 value of a background colour: an ACI or a true colour, as a signed 32-bit number. */
export function backgroundColorValue(c: BackgroundColor): number {
  if (c.kind === 'aci') return 0xc3000000 | (c.index & 0xff) | 0;
  return 0xc2000000 | ((c.r & 0xff) << 16) | ((c.g & 0xff) << 8) | (c.b & 0xff) | 0;
}

/** The background a 1071 value states: an ACI or a true colour, else none. */
export function backgroundColorOf(v: number): BackgroundColor | undefined {
  const method = (v >>> 24) & 0xff;
  if (method === 0xc3) return { kind: 'aci', index: v & 0xff };
  if (method === 0xc2)
    return { kind: 'rgb', r: (v >>> 16) & 0xff, g: (v >>> 8) & 0xff, b: v & 0xff };
  return undefined;
}

/** The drawing's HATCHBACKGROUNDCOLOR APPID, registered by `b` when it has none. */
export function hatchBackgroundAppId(b: ChangeSetBuilder, model: DocumentModel): Handle {
  for (const r of model.tables.appIds.values()) {
    if (r.name.toUpperCase() === HATCH_BACKGROUND_APP) return r.handle;
  }
  return b.addTableRecord('appIds', { name: HATCH_BACKGROUND_APP, flags: 0 }).handle;
}

/**
 * `xdata` with the background colour `color` under the APPID `app` (none when undefined): the
 * application keeps its place among the others when it had one, a new one goes last. Undefined
 * when nothing is left.
 */
export function withHatchBackground(
  xdata: Xdata | undefined,
  app: Handle,
  color: BackgroundColor | undefined,
): Xdata | undefined {
  const mine = color
    ? [{ appId: app, values: [{ code: 1071, value: backgroundColorValue(color) }] }]
    : [];
  const all = xdata ?? [];
  const at = all.findIndex((a) => a.appId === app);
  const rest = all.filter((a) => a.appId !== app);
  const out = at >= 0 ? [...rest.slice(0, at), ...mine, ...rest.slice(at)] : [...rest, ...mine];
  return out.length > 0 ? out : undefined;
}
