---
description: Rules for anything under packages/io, packages/testkit and third_party/acad-ts
globs: ["packages/io/**", "packages/testkit/**", "third_party/acad-ts/**"]
---
- Save is DXF only (AC1032, DEC-047); DWG and older-version writers get no new work. Round-trip structural diff must stay at zero on every file in `corpus/public` (DWG and pre-AC1032 files: see DEC-047 item 4). Run `pnpm test` (round-trip suite) before opening a PR; paste the summary line in the PR.
- Never renumber handles. New objects allocate above `$HANDSEED` and write `$HANDSEED` back.
- Export always starts from the retained acad-ts original and applies changes by handle. Never rebuild a document from Triya's model alone.
- Any object you do not map stays in `PassthroughStore` untouched, including its xdata, reactors, extension dictionary and owner link.
- A new allowed exception to the diff requires a `DECISIONS.md` entry; do not add it silently.
- Patches to `third_party/acad-ts` are minimal, logged in `PATCHES.md` with the upstream PR text, and covered by a unit test that fails on the unpatched code.
- Update `docs/FILE_FIDELITY.md` rows for every type you touch, in the same PR.
