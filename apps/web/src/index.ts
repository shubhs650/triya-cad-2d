// @triya/web: the app (entry: index.html → src/main.tsx). Nothing imports it; this module
// exists so `@triya/web` resolves and the module-boundary lint can report any package that
// tries to (tests/lint/boundaries.test.ts).
export {};
