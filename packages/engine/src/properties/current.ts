// The drawing's current settings for new objects (M2-35): what AutoCAD's Properties palette shows
// and sets with nothing selected ("No selection", General), and what every object a command
// draws takes. AutoCAD keeps them as system variables saved in the drawing (AutoCAD 2024 Help,
// "CECOLOR", "CLAYER", "CELTYPE", "CELTSCALE", "CELWEIGHT", "CETRANSPARENCY"); Triya carries them
// in the header as the DXF HEADER states them:
//   $CECOLOR    DXF 62: 256 BYLAYER, 0 BYBLOCK, 1–255 an ACI (the DXF header has no true colour)
//   $CLAYER     the layer's name
//   $CELTYPE    the linetype's name, BYLAYER or BYBLOCK
//   $CELTSCALE  a factor > 0
//   $CELWEIGHT  DXF 370: hundredths of a mm, −1 BYLAYER, −2 BYBLOCK, −3 Default
// CETRANSPARENCY has no HEADER variable in DXF: Triya carries it under its bare name, as the
// AcDbVariableDictionary entries are (map/header.ts), as AutoCAD spells it ("ByLayer", "ByBlock",
// or a percentage 0–90). The save writes it only into a drawing whose variable dictionary holds
// it; otherwise it lasts for the session (io export/header.ts, docs/FILE_FIDELITY.md).
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { Color, HeaderValue, Lineweight, LinetypeRef, Transparency } from '../model/types';
import type { GeneralProps } from './sheet';

export const CETRANSPARENCY = 'CETRANSPARENCY';

/**
 * The layer new objects go on: `$CLAYER`, else layer 0 (a drawing whose CLAYER names no layer
 * is damaged; AutoCAD's AUDIT sets it back to 0).
 */
export function currentLayer(model: DocumentModel): Handle {
  const name = model.header.get('$CLAYER');
  let zero: Handle | undefined;
  for (const l of model.tables.layers.values()) {
    if (typeof name === 'string' && l.name.toUpperCase() === name.toUpperCase()) return l.handle;
    if (l.name === '0') zero = l.handle;
  }
  if (zero === undefined) throw new Error('the drawing has no layer 0');
  return zero;
}

const BY_LAYER_ACI = 256;
const BY_BLOCK_ACI = 0;
const LINEWEIGHT_CODES: Readonly<Record<number, Lineweight>> = {
  [-1]: 'ByLayer',
  [-2]: 'ByBlock',
  [-3]: 'Default',
};

function currentColor(v: HeaderValue | undefined): Color {
  if (typeof v !== 'number' || v === BY_LAYER_ACI) return { kind: 'byLayer' };
  if (v === BY_BLOCK_ACI) return { kind: 'byBlock' };
  return Number.isInteger(v) && v >= 1 && v <= 255
    ? { kind: 'aci', index: v }
    : { kind: 'byLayer' };
}

function currentLinetype(model: DocumentModel, v: HeaderValue | undefined): LinetypeRef {
  if (typeof v !== 'string') return 'ByLayer';
  const key = v.toUpperCase();
  if (key === 'BYBLOCK') return 'ByBlock';
  if (key === 'BYLAYER') return 'ByLayer';
  for (const l of model.tables.linetypes.values())
    if (l.name.toUpperCase() === key) return l.handle;
  // A CELTYPE naming no linetype is damaged; AutoCAD's AUDIT sets it back to BYLAYER.
  return 'ByLayer';
}

function currentLineweight(v: HeaderValue | undefined): Lineweight {
  if (typeof v !== 'number') return 'ByLayer';
  return LINEWEIGHT_CODES[v] ?? (v >= 0 ? v : 'ByLayer');
}

/** CETRANSPARENCY as a Transparency: alpha from the percentage, as Properties types it. */
function currentTransparency(v: HeaderValue | undefined): Transparency {
  if (typeof v === 'number') return percentTransparency(v);
  if (typeof v !== 'string') return 'ByLayer';
  if (/^bylayer$/i.test(v)) return 'ByLayer';
  if (/^byblock$/i.test(v)) return 'ByBlock';
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? percentTransparency(n) : 'ByLayer';
}

const percentTransparency = (percent: number): Transparency =>
  percent >= 0 && percent <= 90 ? { alpha: Math.round(((100 - percent) / 100) * 255) } : 'ByLayer';

/** The properties a new object takes: the drawing's current settings. */
export function currentProps(model: DocumentModel): GeneralProps {
  const scale = model.header.get('$CELTSCALE');
  return {
    layer: currentLayer(model),
    color: currentColor(model.header.get('$CECOLOR')),
    linetype: currentLinetype(model, model.header.get('$CELTYPE')),
    ltScale: typeof scale === 'number' && scale > 0 ? scale : 1,
    lineweight: currentLineweight(model.header.get('$CELWEIGHT')),
    transparency: currentTransparency(model.header.get(CETRANSPARENCY)),
  };
}

/**
 * The header values that make `patch` (a General edit) the current settings, or the reason it
 * cannot be: a true colour (the DXF header's CECOLOR is an ACI) or a frozen layer (AutoCAD
 * refuses to make one current).
 */
export function currentHeader(
  model: DocumentModel,
  patch: Partial<GeneralProps>,
): Map<string, HeaderValue> | string {
  const out = new Map<string, HeaderValue>();
  const { color, layer, linetype, ltScale, lineweight, transparency } = patch;
  if (color) {
    if (color.kind === 'rgb') return 'Invalid input';
    out.set(
      '$CECOLOR',
      color.kind === 'byLayer'
        ? BY_LAYER_ACI
        : color.kind === 'byBlock'
          ? BY_BLOCK_ACI
          : color.index,
    );
  }
  if (layer !== undefined) {
    const record = model.tables.layers.get(layer);
    if (!record) return 'Invalid input';
    if (record.frozen) return 'Cannot set a frozen layer current';
    out.set('$CLAYER', record.name);
  }
  if (linetype !== undefined) {
    // ByLayer and ByBlock spelled as the drawing's own LTYPE records are (the save checks that
    // CELTYPE names a record, by its exact name).
    const name =
      linetype === 'ByLayer' || linetype === 'ByBlock'
        ? ([...model.tables.linetypes.values()].find(
            (l) => l.name.toUpperCase() === linetype.toUpperCase(),
          )?.name ?? linetype)
        : model.tables.linetypes.get(linetype)?.name;
    if (name === undefined) return 'Invalid input';
    out.set('$CELTYPE', name);
  }
  if (ltScale !== undefined) out.set('$CELTSCALE', ltScale);
  if (lineweight !== undefined) {
    const code = Object.entries(LINEWEIGHT_CODES).find(([, w]) => w === lineweight)?.[0];
    out.set('$CELWEIGHT', code !== undefined ? Number(code) : lineweight);
  }
  if (transparency !== undefined) {
    out.set(
      CETRANSPARENCY,
      typeof transparency === 'string'
        ? transparency
        : String(Math.round((1 - transparency.alpha / 255) * 100)),
    );
  }
  return out;
}
