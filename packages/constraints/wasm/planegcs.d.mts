// Types for the Emscripten glue third_party/planegcs/build.sh writes next to this file.
// `@triya/constraints` (src/planegcs.ts) types the module's embind classes itself.
declare const createPlaneGcs: (options: {
  wasmBinary: ArrayBuffer | Uint8Array;
}) => Promise<unknown>;
export default createPlaneGcs;
