# Setup — GitHub repo, Claude Code Project, and autodrive

Everything below is a one-time owner task (~45 minutes). After it, your involvement is: answer `needs-human` issues, run the owner-only gates (AutoCAD AUDIT, private corpus, drafter sessions), and skim the Overview pane when you feel like it.

## Part 1 — GitHub repository (10 min)

1. Create `shubhs650/triya-cad-2d`, **private**, no template, no README (we bring our own).
2. Unzip this kit into an empty folder and push it:
   ```bash
   git init -b main && git add -A && git commit -m "chore: kickoff kit (PRD, architecture, roadmap, CLAUDE.md, CI)"
   git remote add origin git@github.com:shubhs650/triya-cad-2d.git && git push -u origin main
   ```
3. **Settings → General → Pull Requests:** tick **Allow auto-merge**; tick **Automatically delete head branches**; allow only **squash merging**.
4. **Settings → Branches → Add branch ruleset** for `main`:
   - Require a pull request before merging (0 approvals — CI is the reviewer).
   - Require status checks to pass: `lint · typecheck · unit · round-trip` and `fidelity · offline · ui` (they appear in the list after the first CI run; add them then).
   - Require branches to be up to date before merging.
   - **Do not** block force-pushes for admins only; **do** block deletions.
   - Bypass list: add yourself so `roadmap: claim/complete` commits from threads (which run with your GitHub identity through the Claude GitHub App) can go straight to `main`. If you'd rather keep `main` strictly PR-only, tell the project (Part 3, instruction C) and threads will route roadmap edits through their PR instead.
5. **Settings → Secrets → Actions:** add `AUTOMERGE_TOKEN` = a fine-grained PAT scoped to this repo with *Pull requests: read/write* and *Contents: read/write*. `.github/workflows/auto-merge.yml` uses it to enable auto-merge after CI passes on a PR's head, so the squash commit on `main` also triggers CI (a merge made with the default `GITHUB_TOKEN` does not).
6. **Labels:** create `needs-human`, `adr-proposal`, `fidelity`, `perf`, `bug`, `enhancement`.
7. Install the **Claude GitHub App** (github.com/apps/claude) on this repository if it isn't already, and confirm it under github.com/settings/installations → Repository access.
8. Optional but recommended: **Settings → Code security → Dependabot** security updates on; Actions permissions → "Allow GitHub Actions to create and approve pull requests" on (needed for the fallback workflow).

Private-corpus note: never push `corpus/private/` (it is gitignored). Keep it on your machine; threads will ask you to run `pnpm test:private` via a `needs-human` issue at milestone gates.

## Part 2 — Claude Code Project (10 min)

Projects live at claude.ai/code → **Projects** (or under **More**). Pro/Max plan required; the Claude GitHub App on the repo is required (Part 1 step 7).

1. **New project**
   - Name: `Triya CAD 2D`
   - Goal: `Ship Triya CAD 2D v1.0 by completing docs/ROADMAP.md milestone by milestone with CI as the only reviewer.`
   - Context → Add repository: `shubhs650/triya-cad-2d`.
   - Create project. If Claude posts **Setup recommendations**, accept the repository and skip any suggested scheduled tasks for now.
2. **Project settings (gear icon) → General**
   - Thread model: **Opus**, Thread effort: **High** (this codebase rewards it; lower later for M7 UI polish if usage bites).
   - Coordinator model: **Opus**, Coordinator effort: **Low**.
3. **Project settings → Memory → Project instructions:** paste **Part 3** verbatim.
4. **Project settings → Environment:** leave the default Anthropic-hosted environment unless CI needs a domain outside the default allowlist. The repo's `pnpm`, Playwright and Node needs are covered by the default; PlaneGCS's Docker/Emscripten build (M9) will need a setup script — the thread doing M9-01 will tell you exactly what to add.
5. Desktop app only: project sidebar menu → **Notifications** → turn on "thread needs input" so `needs-human` stops reach you without opening the project.

What threads get from the repo automatically: `CLAUDE.md` and `.claude/rules/*.md` (loaded at thread start). What they do **not** get: `.claude/settings.json`, hooks, repo-local skills, `.mcp.json` — this kit deliberately uses none of those.

## Part 3 — Project instructions (paste into Memory → Project instructions)

```text
This project builds Triya CAD 2D (repository shubhs650/triya-cad-2d), an AutoCAD-grade, fully in-browser 2D CAD PWA for Open Engineering Tools. The repository's CLAUDE.md is the operating manual for every thread; docs/PRD.md, docs/ARCHITECTURE.md, docs/ROADMAP.md and docs/DECISIONS.md are the source of truth. Read CLAUDE.md fully before doing anything.

A. Autodrive. This project runs without a human in the loop. Do not ask me to confirm plans, pick options, or approve PRs. Start threads immediately. Make decisions yourself and record them in the PR description; open a GitHub issue labelled needs-human only for the six stop conditions in CLAUDE.md, and keep working on other tasks meanwhile.

B. Work source. Every thread takes the top-most unclaimed task from the current milestone in docs/ROADMAP.md (claim it there first), works it to the roadmap's acceptance text, and closes it out as CLAUDE.md describes. Milestones are sequential; M1 tasks do not start until M0-GO is checked by me. Within a milestone, run up to 3 threads at a time on independent tasks; prefer tasks in different packages so PRs don't conflict.

C. Branches and PRs. Branch from main, one task per branch, conventional commits, commit and push at least every 30 minutes and before any long step. Open one PR per task using the repository PR template, run `gh pr merge --auto --squash`, watch CI, and fix failures in the same branch. Never weaken, skip or delete a check or test to get green. Never force-push main. Roadmap claim/complete edits go directly to main as tiny commits; if main is protected against that, include them in the task's PR instead.

D. Quality gates. A task is done only when tests were written first, `pnpm lint && pnpm typecheck && pnpm test && pnpm test:fidelity` pass, perf tests pass when render/engine hot paths changed, the PR auto-merged, docs/ROADMAP.md and status docs are updated, and a CHANGELOG line exists. Round-trip structural diff must be zero on every public corpus file at all times.

E. Reporting. Post in the project conversation only when a thread finishes a task, hits a needs-human stop, or discovers roadmap work it added. Final thread messages include: task id, PR number, gate results with numbers, deferred items, needs-human issues.

F. When something is missing (a corpus file, a reference plot, a secret, a tool), do not mock or guess around it: add the gap as a roadmap task or needs-human issue with exactly what is missing, and move to the next task.

G. Memory. Remember corrections I give you here and apply them to all later threads. Remember: owner GitHub handle is shubhs650; the app URL is https://triya-cad-2d.openengtools.com (lowercase); repository license is MIT; GPL/AGPL dependencies are forbidden; Autodesk-copyrighted files are never committed.
```

## Part 4 — Kickoff prompts (send in the project conversation, in order)

**Prompt 1 — bootstrap (sends M0-01..M0-05 as parallel threads):**

```text
Start now, without asking me to confirm. Read CLAUDE.md and docs/ROADMAP.md. Run M0 as follows: one thread for M0-01 (monorepo scaffold, including the pnpm scripts that .github/workflows/ci.yml calls: lint, typecheck, test, test:fidelity, test:offline, test:ui, test:perf, build, corpus:list, corpus:validate — no-ops that exit 0 are acceptable where the implementation doesn't exist yet, but they must exist); one thread for M0-02 (make CI green on a trivial PR, then confirm the two required status-check names so I can add them to branch protection and tell me those names in the conversation); then M0-03, M0-04 and M0-05 in parallel once M0-01 has merged. Each thread follows the autodrive protocol in CLAUDE.md, auto-merges its PR, and reports back. Post one message when all five are merged.
```

**Prompt 2 — the keystone spike (after Prompt 1 reports done):**

```text
Run M0-06 as a single thread following docs/SPIKE_M0_ACAD_TS.md end to end. Do not stop at the first failure: categorise all failures, patch the top five root causes in third_party/acad-ts with tests and PATCHES.md entries, and produce docs/reports/M0-acad-ts-spike.md with a GO / CONDITIONAL GO / NO-GO recommendation. Put the written-back DWG/DXF files in a zip in the project Library so I can run AutoCAD AUDIT on them. Open a needs-human issue with the recommendation and the exact list of files to AUDIT. Then stop and wait for M0-GO.
```

Owner action at this point: run AUDIT on the zip in AutoCAD (M0-07), attach results to the issue, and if the recommendation holds, check `M0-GO` in `docs/ROADMAP.md` (a one-line commit on `main`). Also drop your self-authored corpus DWGs and their AutoCAD reference PDFs into `corpus/public/` with a `corpus.json` entry each (TESTING.md §2.1 lists the set); threads can proceed on the ezdxf/ACadSharp samples until you do.

**Prompt 3 — release M1 and go hands-off:**

```text
M0-GO is checked. From now on run the roadmap continuously: keep up to 3 threads working on the top unclaimed tasks of the current milestone, start the next milestone's tasks only when the current milestone's exit criteria are met, and never wait for me unless a needs-human stop applies. When a milestone completes, post a one-paragraph milestone report: what shipped, gate numbers, open needs-human items, and the next milestone's first three tasks. Do this until M10-06 is done.
```

**Prompt 4 — optional scheduled heartbeat (keeps the queue moving if the coordinator idles):**

```text
Create a scheduled task in this project that runs every day at 05:30 Asia/Kolkata: "Read docs/ROADMAP.md on main. If fewer than 3 threads are working and the current milestone has unclaimed tasks, start threads for the top unclaimed ones per CLAUDE.md. If any PR has been failing CI for more than 12 hours, start a thread to fix it. If a needs-human issue is older than 7 days, re-post its summary in the conversation. Post nothing otherwise."
```

Note: a thread started by a scheduled task does not wait out a usage-limit; it stops and needs a message after the limit resets. Normal threads wait automatically.

## Part 5 — Steering prompts you may need later

- Usage getting heavy: `Run at most one thread at a time` or `Use Sonnet at medium effort for M7 UI tasks`.
- Wrong routing: `Answer that here instead of starting a thread.`
- Something slipped past the docs: `Remember: <correction>. Apply it to all future threads and add it to the right doc in a PR.`
- Pause everything: **Project settings → General → Pause**.
- Check state: `For every open thread, list what it was asked to do, what it assumed or couldn't reach, and what it's waiting on.`

## Part 6 — Owner checklist (what only you can do, when)

| When | What |
|---|---|
| After Prompt 1 | Add the two CI check names to branch protection |
| After Prompt 2 | AutoCAD AUDIT on the spike zip; tick `M0-GO`; add self-authored corpus DWGs + reference PDFs |
| M2 exit | AUDIT sweep on Triya-saved corpus; verify one CTB PDF in Acrobat + PDF-XChange; `pnpm test:private` |
| M5 exit | AUDIT on bound-xref and template files; verify PURGE parity once |
| M8 | Spot-check a sample of B16.5/B16.47 table values |
| M9 | Add the Emscripten/Docker setup script the M9-01 thread specifies to the project environment; AUDIT a file with `TRIYA_CONSTRAINTS` |
| M10 | Private corpus sweep, two drafter test sessions, decide public-repo date, flip Cloudflare Pages to production domain |
