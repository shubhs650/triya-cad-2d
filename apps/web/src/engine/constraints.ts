// The geometric constraint solver GEOMCONSTRAINT and GC* use (M9-05): `@triya/constraints`'
// model over PlaneGCS. Imported only when a constraint is first applied, and the module then
// fetches the solver's WebAssembly from the app's own files (cached offline once warmed, as
// pdf.js is), so neither weighs on the engine worker's start. The About dialog carries the
// module's LGPL and MPL notices (M9-07).
import { constraintSolver, loadPlaneGcs } from '@triya/constraints';
import wasmUrl from '@triya/constraints/wasm/planegcs.wasm?url';

export async function solver() {
  const gcs = await loadPlaneGcs(async () => (await fetch(wasmUrl)).arrayBuffer());
  return constraintSolver(gcs);
}
