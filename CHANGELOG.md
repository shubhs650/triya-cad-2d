# Changelog

All notable changes are recorded here by the thread that lands them (one line per merged task, newest first).

## Unreleased
- M0-05 (#5): round-trip harness in `@triya/testkit` (`roundTrip`, `structuralDiff`, per-file report, regression ratchet in `corpus/roundtrip-baseline.json`), `writeCadDocument` in `@triya/io`, `pnpm corpus:roundtrip`. Baseline: 118 of 119 public files round-trip with differences, 1 read error; snapshot in `docs/reports/M0-roundtrip-baseline.md`. DEC-034 allows `$TDUUPDATE`.
- M0-03 (#3): acad-ts vendored at upstream 315f3d8 as a filtered snapshot (DEC-033) with patch 0001 (ESM-safe `createExtendedDictionary`); `@triya/io` reads DWG/DXF in Node and in a module Web Worker under Vite (`pnpm test:io`).
- M0-04 (#2): public corpus skeleton: 119 MIT-licensed ezdxf and ACadSharp drawings (R12–R2018, DWG and ASCII/binary DXF), `corpus.json` manifest + JSON schema, `pnpm corpus:list` / `pnpm corpus:validate` in `@triya/testkit`.
- M0-01 (#1): pnpm/turbo monorepo scaffold with strict TypeScript, ESLint module-boundary and no-DOM rules (tested edge by edge), Prettier, Vitest, Playwright suites, Husky pre-commit, and every pnpm script CI calls.
- Kickoff kit: PRD, architecture, roadmap, decisions, testing, UI spec, command reference, fidelity matrix, M0 spike plan, CLAUDE.md, CI scaffold.
