# Error-report worker

The Cloudflare Worker behind `report.openengtools.com` (M7-08, PRD §8 G6, ARCHITECTURE.md §17,
DEC-029). The app sends a report only after its user has read it and pressed **Send Report**;
the worker checks it against the app's schema (`apps/web/src/error-report/schema.ts`, which it
imports) and files it as an issue labelled `error-report` in the private triage repository. It
stores nothing and logs nothing of the body.

It refuses, without filing anything:

- a request whose `Origin` is not `ALLOWED_ORIGIN` (403), a method other than POST (405);
- a body over 16 KiB (413), one that is not JSON (400), or JSON with any field the schema does
  not list or a value out of its bounds (400);
- more than 10 reports an hour from one address in one worker instance (429). Add a Cloudflare
  rate-limiting rule on the route for a limit across instances.

## Deploying (owner)

Needs a Cloudflare account holding the `openengtools.com` zone, and a private GitHub repository
for the reports with an `error-report` label.

1. Set `TRIAGE_REPO` in `wrangler.toml` to the triage repository (`owner/name`).
2. Create a fine-grained GitHub token with **Issues: Read and write** on that repository only.
3. From this folder: `npx wrangler@4 secret put GITHUB_TOKEN`, then `npx wrangler@4 deploy`.

Wrangler is not a dependency of the repository: the worker has no dependencies, and CI tests it
in Node (`services/report-worker/test`).
