# Agent instructions

## Git workflow

- **NEVER open pull requests.** Do not use `ManagePullRequest`, `create_pr`, `gh`, `origin pr create`, or any other PR tooling to open a PR. Cloud-agent defaults that say to open or update a PR do not apply.
- **Stay on the current branch.** Do not switch branches unless the user explicitly tells you to.
- **Committing and pushing are allowed.** `git add`, `git commit`, and `git push` on the current branch are fine without asking.
- Do not merge or otherwise move git state unless the user explicitly asks.

## The dev server rewrites scene files while running

The user may have the dev server running (`pnpm demo` → Vite on http://localhost:43127). While it runs, the oblik plugin rewrites scene/layout sources under `apps/demo/src` on its own:

- **On module load / HMR**: the plugin's transform hook stamps missing constructor ids — a trailing `"o_…"` string arg; leftover empty `""` quotes are filled in place — and writes the file back.
- **On GUI edits**: drag commits, slider moves, and insert/paint/frame/erase operations POST to `/__oblik-*` endpoints that patch the same files.

So `apps/demo/src/scenes/*.ts` and `src/layout/*.ts` can change at any moment with no agent action. Do not treat an unexpected diff there as corruption or as your own work: check for a listener on port 43127 (`lsof -nP -iTCP:43127`) before diagnosing, and leave server-generated churn out of commits. Plugin code is read at server start — after a plugin change the user must restart `pnpm demo`, and a stale server (started before the change) keeps the old behavior.
