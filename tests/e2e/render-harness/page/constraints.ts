/// <reference lib="dom" />
/// <reference types="vite/client" />
// Test page for the PlaneGCS module in the browser (M9-01, tests/e2e/perf/constraints.spec.ts).
// Nothing of the solver loads with the page: `solveFifty` loads it on its first call, as the
// app will on the first constrained edit, from the .wasm the bundler serves as an asset.
import { SolveStatus, fiftyConstraintSketch, loadPlaneGcs } from '@triya/constraints';
import wasmUrl from '../../../../packages/constraints/wasm/planegcs.wasm?url';

export interface FiftyResult {
  /** Loading the module (glue and .wasm) the first time. */
  loadMs: number;
  /** Building and solving the sketch, each run after a warm-up one. */
  solveMs: number[];
  statuses: number[];
  constraints: number;
  dofs: number;
  conflicting: number[];
}

async function solveFifty(runs: number): Promise<FiftyResult> {
  const t0 = performance.now();
  const gcs = await loadPlaneGcs(async () => (await fetch(wasmUrl)).arrayBuffer());
  const loadMs = performance.now() - t0;
  fiftyConstraintSketch(gcs).dispose();
  const solveMs: number[] = [];
  const statuses: number[] = [];
  let constraints = 0;
  let diagnosis = { dofs: -1, conflicting: [] as number[] };
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const s = fiftyConstraintSketch(gcs);
    statuses.push(s.solve());
    solveMs.push(performance.now() - start);
    constraints = s.constraintCount;
    diagnosis = s.diagnose();
    s.dispose();
  }
  return { loadMs, solveMs, statuses, constraints, ...diagnosis };
}

declare global {
  interface Window {
    solveFifty: typeof solveFifty;
    SolveStatus: typeof SolveStatus;
  }
}

window.solveFifty = solveFifty;
window.SolveStatus = SolveStatus;
document.title = 'ready';
