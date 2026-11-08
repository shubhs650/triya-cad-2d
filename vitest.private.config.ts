import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// `pnpm test:private` (M1-106): the round-trip suite on the owner's private corpus only. Its
// file is named *.private.ts so the default `pnpm test` never collects it. Spread, not
// mergeConfig, which would add the include list to the default one.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['packages/testkit/src/roundtrip/corpus-roundtrip.private.ts'],
    coverage: { enabled: false },
  },
});
