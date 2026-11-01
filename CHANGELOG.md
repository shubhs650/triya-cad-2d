# Changelog

All notable changes are recorded here by the thread that lands them (one line per merged task, newest first).

## Unreleased
- M1-02 part 1 (#11): geometry kernel `engine/geom`: vectors, angles, extents-derived `Tolerance` (DEC-036), curve shapes shared with the model, parametric evaluation of every curve type, NURBS (rational, unclamped) evaluation, flattening within a deviation, exact bounds (polished spline extremes), affine transforms of curves; ≥ 95 % coverage gate on `engine/geom` in `pnpm test`.
- M1-01 (#10): document model in `@triya/engine` (`engine/src/model`): entity/table/object/header types, frozen-value update helpers, `HandleAllocator` above `$HANDSEED` (monotonic, raises stale seeds), permanent `EntityIdMap`, atomic `DocumentModel.apply`, invertible `ChangeSet` with block positions, and `ChangeSetBuilder` for commands (DEC-035). fast-check added for property-based tests.
- M0-GO: owner accepted the M0-06 CONDITIONAL GO (#7); M1 read-only work released, Save stays blocked on M1-27 to M1-30 and the deferred M0-07 AUDIT.
- M0-06 (#6): acad-ts spike, recommendation CONDITIONAL GO (`docs/reports/M0-acad-ts-spike.md`). acad-ts patches 0002–0013 and a fidelity writer profile take the public round trip from 35,447 to 26,728 differences and 0 to 11 clean files; `pnpm spike:read` / `pnpm spike:roundtrip` report failure taxonomy and handle coverage (4,379 of 36,911 declared objects never loaded). Follow-ups M1-27 to M1-30.
- M0-05 (#5): round-trip harness in `@triya/testkit` (`roundTrip`, `structuralDiff`, per-file report, regression ratchet in `corpus/roundtrip-baseline.json`), `writeCadDocument` in `@triya/io`, `pnpm corpus:roundtrip`. Baseline: 118 of 119 public files round-trip with differences, 1 read error; snapshot in `docs/reports/M0-roundtrip-baseline.md`. DEC-034 allows `$TDUUPDATE`.
- M0-03 (#3): acad-ts vendored at upstream 315f3d8 as a filtered snapshot (DEC-033) with patch 0001 (ESM-safe `createExtendedDictionary`); `@triya/io` reads DWG/DXF in Node and in a module Web Worker under Vite (`pnpm test:io`).
- M0-04 (#2): public corpus skeleton: 119 MIT-licensed ezdxf and ACadSharp drawings (R12–R2018, DWG and ASCII/binary DXF), `corpus.json` manifest + JSON schema, `pnpm corpus:list` / `pnpm corpus:validate` in `@triya/testkit`.
- M0-01 (#1): pnpm/turbo monorepo scaffold with strict TypeScript, ESLint module-boundary and no-DOM rules (tested edge by edge), Prettier, Vitest, Playwright suites, Husky pre-commit, and every pnpm script CI calls.
- Kickoff kit: PRD, architecture, roadmap, decisions, testing, UI spec, command reference, fidelity matrix, M0 spike plan, CLAUDE.md, CI scaffold.
