# Private corpus (gitignored)

Owner's real vessel GAs and vendor drawings. Same `corpus.json` schema as `corpus/public`.
Run with `pnpm test:private` (round-trip and golden images; TESTING.md §2.2). The manifest is
`corpus/private/corpus.json`, with paths relative to `corpus/` starting `private/`. Golden images
are written to `refs/golden/` here with `TRIYA_UPDATE_GOLDEN=1 pnpm test:private`, and a round-trip
baseline to `roundtrip-baseline.json` with `TRIYA_UPDATE_BASELINE=1 pnpm test:private`.
Nothing in this folder is ever committed or uploaded.
