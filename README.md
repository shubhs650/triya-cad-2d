# Triya CAD 2D

**AutoCAD-grade 2D drafting in your browser. No login. No cookies. Nothing leaves your device.**

Part of [Open Engineering Tools](https://openengtools.com). Live at https://triya-cad-2d.openengtools.com (when released).

Triya CAD 2D opens real DWG/DXF files (R12–R2018) faithfully — model and paper space, blocks, dimensions, tables, hatches, SHX fonts, xrefs, PDF underlays — and gives experienced drafters the AutoCAD command line, aliases, osnaps, grips, layers and dimension styles they already know. It prints vector PDFs with CTB plot styles, works fully offline as an installable PWA, and adds a pressure-vessel symbol library, drawing compare, a drawing health report, and parametric constraints.

> **Status:** in development. Not yet released. See `docs/ROADMAP.md`.

## Why

Engineers receive vendor drawings every day and need to red-line, correct or re-issue them. That currently means an AutoCAD seat, a read-only viewer, or uploading confidential drawings to someone's server. Triya CAD 2D is the fourth option: a complete 2D CAD that runs locally in a browser tab.

## Principles

- **Private by construction.** All processing in the browser. The app makes no network requests after load except service-worker updates and error reports you explicitly send.
- **Fidelity first.** What you don't touch, we don't break: every object we don't understand is preserved verbatim. Tested against AutoCAD reference plots and `AUDIT`.
- **AutoCAD conventions.** Commands, aliases, option syntax, osnaps, DIMVARS, layers, layouts — the spec is AutoCAD's documented behaviour.
- **Open source.** MIT. Built in the open on real engineering drawings.

## Documentation

| Doc | Purpose |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Requirements, goals, non-goals, acceptance targets |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design and module boundaries |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones and task board |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decision register (ADRs) |
| [`docs/TESTING.md`](docs/TESTING.md) | Corpus, harnesses, gates |
| [`docs/UI_SPEC.md`](docs/UI_SPEC.md) | Ribbon, palettes, theme, responsive rules |
| [`docs/COMMANDS.md`](docs/COMMANDS.md) | Command/alias reference and status |
| [`docs/FILE_FIDELITY.md`](docs/FILE_FIDELITY.md) | Entity/object support matrix |
| [`docs/SPIKE_M0_ACAD_TS.md`](docs/SPIKE_M0_ACAD_TS.md) | The keystone dependency gate |
| [`docs/SETUP.md`](docs/SETUP.md) | Repo and Claude Code Projects setup |
| [`CLAUDE.md`](CLAUDE.md) | Operating instructions for Claude Code threads |

## Development

```
pnpm install
pnpm dev
pnpm lint && pnpm typecheck && pnpm test
pnpm test:fidelity   # needs Playwright browsers
```

Requires Node 22 and pnpm 9. The constraint solver (`third_party/planegcs`) builds with Emscripten via Docker: `pnpm planegcs:build`.

## Contributing

Issues and PRs welcome once the repo is public. Please read `CLAUDE.md` — it applies to humans too. Use the issue templates; for drawing-fidelity bugs, attach a minimal DXF that reproduces the problem (never a confidential drawing).

## License

MIT — see `LICENSE`. Third-party components and their licenses are listed in `ATTRIBUTION.md`. No Autodesk-copyrighted files are included; you may add your own fonts, patterns and plot styles, which stay on your device.
