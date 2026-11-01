import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// The acad-ts spike runners (docs/SPIKE_M0_ACAD_TS.md): data collection, not gates, so they are
// `*.spike.ts` and stay out of `pnpm test`. Run with `pnpm spike:read` / `pnpm spike:roundtrip`.
export default mergeConfig(
  base,
  defineConfig({
    test: { include: ['packages/testkit/src/spike/*.spike.ts'], testTimeout: 600_000 },
  }),
);
