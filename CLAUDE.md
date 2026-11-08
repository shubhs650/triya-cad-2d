# CLAUDE.md — Triya CAD 2D

You are building **Triya CAD 2D**, an AutoCAD-grade 2D drafting PWA for Open Engineering Tools. This file is loaded into every Claude Code thread. Read it fully before doing anything.

## Rule 0 — purpose (owner, 2026-11-08; DEC-047)

Triya is a **standalone 2D drafting app with functionality similar to AutoCAD**. AutoCAD compatibility is welcome, not mandatory. **Save is DXF only (AC1032)**: focus file work on it. DWG save, older DXF versions and other cross-compatibility work wait until after launch, and only if users ask. **Never ask the owner for AutoCAD files** (reference plots, sample DWGs, AUDIT runs, SHX renders). Author test drawings yourself (acad-ts, a committed ezdxf script, or by hand from the DXF reference), or move the item to the roadmap's post-launch list. Rendering is checked against Triya's own reviewed golden images. When anything below conflicts with Rule 0, Rule 0 wins.

## Read these first, in this order

1. `docs/PRD.md` — what we build and the 15 non-goals. Scope disputes end here.
2. `docs/ARCHITECTURE.md` — how it is structured. Module boundaries are enforced by lint.
3. `docs/ROADMAP.md` — milestones, their exit criteria, and the task board. **Your work comes from here.**
4. `docs/DECISIONS.md` — why. Do not re-litigate a decision; if one is wrong, open an ADR proposal issue.
5. `docs/TESTING.md`, `docs/UI_SPEC.md`, `docs/COMMANDS.md`, `docs/FILE_FIDELITY.md` as your task requires.
6. `.claude/rules/*.md` — path-scoped rules that apply to the files you touch.

## The job, in one sentence

Ship milestones from `ROADMAP.md` in order, one task per branch, tests first, fidelity never regressing, pushing early and often, with no human in the loop unless a rule below says to stop.

## Autodrive protocol (follow exactly)

1. **Claim a task.** Pick the top-most unclaimed task in the current milestone of `docs/ROADMAP.md`. Mark it `[~] (thread: <your thread name>)` in a tiny commit on `main` titled `roadmap: claim <task-id>` so other threads see it. If `main` moved, rebase and retry; if the task is already claimed, pick the next one.
2. **Branch.** `git checkout -b <milestone>/<task-id>-<slug>` from `main`.
3. **Write the test(s) first.** Unit tests for engine/geometry/parsing; a corpus or fidelity test for anything touching `packages/io`, `render`, `text`, `dims`, `hatch`; a Playwright test for UI behaviour. The test must fail before the implementation and pass after.
4. **Implement** the smallest thing that passes and satisfies the task's acceptance text in the roadmap.
5. **Run the gates locally:** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:fidelity` (and `pnpm test:perf` if you touched `render`/`engine` hot paths). All green or you are not done.
6. **Commit and push at least every 30 minutes of work** and before any long-running step. The sandbox can be recycled; unpushed work is lost. Use conventional commits (`feat(dims): …`, `fix(io): …`, `test(corpus): …`).
7. **Open a PR** with the template filled in: task id, what changed, how it was tested, fidelity/perf numbers before→after, any passthrough implications. Mark it ready for review; `.github/workflows/auto-merge.yml` enables squash auto-merge once CI is green on the PR's head. Do not enable auto-merge yourself before CI is green: until branch protection lists the required checks, that merges immediately. CI is the reviewer. When CI fails, fix it in the same branch; never disable or weaken a check to get green.
8. **Close out.** After merge: mark the task `[x]` in `docs/ROADMAP.md` with the PR number, update `docs/FILE_FIDELITY.md` / `docs/COMMANDS.md` status rows you affected, and add your changelog entry as a new file `changes/<task-id>.md` (one bullet with the PR number; see `changes/README.md`). Never edit `CHANGELOG.md` directly: every thread editing its top line is what made green PRs conflict. Commit directly to `main` as `roadmap: complete <task-id> (#PR)`.
9. **Report back** in your final message: task id, PR, gates run with numbers, anything you deferred (as new roadmap tasks you added, with reasons), and anything that needs the human (see "Stop and ask").
10. **Loop.** If you have context budget left, go to step 1. Otherwise end cleanly with everything pushed.

## Non-negotiable engineering rules

- **Passthrough invariant.** Any change to `packages/io` must keep the DXF round-trip structural diff at zero on every corpus file. If you cannot, the change is wrong, not the test. DWG and pre-AC1032 files stay as regression guards; DEC-047 item 4 says when one of their differences may be recorded in the baseline instead.
- **No DOM in the engine.** `packages/engine`, `io`, `text`, `hatch`, `dims`, `constraints`, `library`, `compare`, `pdf` must run in Node. `window`/`document`/`navigator` are build errors there.
- **Handles are never renumbered.** New objects get handles above `$HANDSEED`.
- **Commands are generators** on the `PromptBus`; they never read UI state directly. The command line, Dynamic Input and tests are front-ends to the same bus.
- **Renderer only via the `Renderer` interface.** No Canvas2D calls outside `packages/render`.
- **AutoCAD behaviour is the spec for how commands work.** When unsure how a command, osnap, DIMVAR or dialog behaves, match AutoCAD 2024's documented behaviour. If documentation is ambiguous, write a test that encodes the most common drafter expectation and note the ambiguity in the PR.
- **No Autodesk assets.** Never commit `.shx`, `acad.pat`, `acad.lin`, `acad.dwt`, `acad.ctb` or anything copied from an Autodesk install. Re-author from the published format specs.
- **No new dependencies without a line in `ATTRIBUTION.md`** and a license that is MIT/BSD/Apache/ISC/LGPL-as-separate-module. GPL/AGPL are forbidden.
- **Performance budgets are tests.** A regression in `pnpm test:perf` is a failing build.
- **Privacy.** No network calls from the app at runtime except SW update and the user-confirmed error report. The offline CI test enforces this.
- **Accessibility and responsiveness** per `docs/UI_SPEC.md`: Home-tab Draw/Modify/Annotate never overflow at 1366 px.

## Stop and ask the human (only these)

Open an issue labelled `needs-human`, post it in your final message, and **do not** proceed on that item (continue with other tasks):

1. *(Retired: the M0 go/no-go was decided on 2026-11-01.)*
2. A roadmap task contradicts `PRD.md` or a decision in `DECISIONS.md`.
3. A dependency you need has an incompatible license.
4. *(Retired by DEC-047: never ask for AutoCAD files or AUDIT runs. Author the test drawing yourself or move the item to the post-launch list.)*
5. A change would alter the privacy model, the licensing, or the public API of the saved-file format (`TRIYA_*` dictionaries).
6. You have evidence a performance target in `PRD.md` §12 is unreachable with Canvas 2D (triggers the WebGL decision).

Everything else: decide, document the decision in the PR, move on.

## Working style

- Small PRs. One task, one PR. Split if a PR exceeds ~800 changed lines excluding tests and generated data.
- Prefer boring, explicit code. No clever abstractions before the third use.
- Comment *why*, not *what*. Link DIMVAR/AutoCAD docs when encoding a rule.
- When you discover work that isn't on the roadmap, **add it as a task** in the right milestone with a one-line justification rather than doing it silently.
- When a corpus file reveals a bug in acad-ts, fix it in `third_party/acad-ts` with a minimal patch, log it in `third_party/acad-ts/PATCHES.md`, and draft the upstream PR text in the same file.
- Never mark a task complete with failing, skipped, or `.only` tests. Never delete a test to make a build pass.
- Keep `docs/` truthful: if you change behaviour, change the doc in the same PR.

## Commands you will use

```
pnpm install
pnpm dev                 # apps/web on :5173
pnpm lint | typecheck | test | test:fidelity | test:perf | test:offline | test:private
pnpm corpus:ref <file>   # rasterise a contributed AutoCAD reference PDF (post-launch M1-26; optional since DEC-047)
TRIYA_UPDATE_GOLDEN=1 pnpm test:fidelity   # rewrite golden images (M1-24); review every changed PNG
pnpm build               # production build
pnpm planegcs:build      # Emscripten build (docker)
gh pr create --fill && gh pr merge --auto --squash
```

## Definition of done (per task)

Test written first · implementation · gates green · PR auto-merged · roadmap/status docs updated · `changes/<task-id>.md` fragment · PR state MERGED · report posted.
