# Changelog fragments

Every PR adds exactly one file here instead of editing `CHANGELOG.md`. Separate files never conflict, so parallel threads stop blocking each other's merges on the changelog.

- **Name:** `<task-id>.md` for roadmap work (`M1-04.md`, `M1-04-part-2.md` or `M1-04-part-3a.md` when a task ships in parts, `M0-GO.md`), or `infra-<slug>.md` for repo work outside the roadmap.
- **Content:** one bullet per entry, written for a reader of the changelog, with the PR number: `- M1-04 part 2 (#19): what changed and why it matters.` Indented continuation lines are allowed; headings are not.
- **Order:** entries are assembled newest PR number first, so open the PR as a draft first and put its number in the fragment.

`pnpm changelog` prints the assembled changelog, `pnpm changelog:check` validates this folder (CI runs it), and `pnpm changelog --release <version>` folds every fragment into `CHANGELOG.md` and deletes them at release time.
