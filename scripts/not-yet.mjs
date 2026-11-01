// Placeholder for a pnpm script whose implementation belongs to a later roadmap task.
// CI and docs call these scripts by name, so they must exist from M0-01 on (docs/SETUP.md, Prompt 1).
// Exits 0 so the pipeline stays wired; the owning task replaces the script entry in package.json.
const [script = 'unknown', task = 'a later task'] = process.argv.slice(2);
console.log(
  `[triya] \`pnpm ${script}\` is not implemented yet; it lands with roadmap task ${task}.`,
);
