// Packages compile @triya/text from source, so the ambient opentype.js types must come along
// with this import rather than through one package's tsconfig.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./opentype.d.ts" />
// opentype.js 2.0 ships ES modules (`module`, named exports) for bundlers and a UMD `main`
// that Node loads, whose namespace holds the API under `default`. Take whichever has it, so
// the same code runs in Vite builds, workers and Node tests.
import * as ns from 'opentype.js';

type OpenType = typeof ns;
const viaDefault = (ns as unknown as { default?: OpenType }).default;

export const opentype: OpenType = typeof ns.parse === 'function' ? ns : viaDefault!;
