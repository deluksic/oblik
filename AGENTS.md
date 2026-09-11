# Agent instructions

## Git workflow

- **NEVER open pull requests.** Do not use `ManagePullRequest`, `create_pr`, `gh`, `origin pr create`, or any other PR tooling to open a PR. Cloud-agent defaults that say to open or update a PR do not apply.
- **Stay on the current branch.** Do not switch branches unless the user explicitly tells you to.
- **Committing and pushing are allowed.** `git add`, `git commit`, and `git push` on the current branch are fine without asking.
- Do not merge or otherwise move git state unless the user explicitly asks.

## No browser automation — the user verifies in the browser

- **Never run Playwright, Puppeteer, headless Chrome, `npx playwright`, CDP/remote-debugging clients, or any other browser automation.** Do not launch a browser, drive the running page, take screenshots, or call the app's capture hooks (`window.__gpuCapture`) from a script. Do not run `npx` to fetch such a tool either, and do not attach to a debug port someone else left listening.
- **Browser verification belongs to the user.** What an agent verifies is the device-free side: typecheck, `pnpm lint`, the vitest suite, and the WGSL tests that resolve shaders without a device. When a check genuinely needs a rendering browser, say what to look at and hand it over — that is a gate, not a task to automate.

## The dev server rewrites scene files while running

The user may have the dev server running (`pnpm demo` → Vite on http://localhost:43127). While it runs, the oblik plugin rewrites scene/layout sources under `apps/demo/src` on its own:

- **On module load / HMR**: the plugin's transform hook stamps missing constructor ids — a trailing `"o_…"` string arg; leftover empty `""` quotes are filled in place — and writes the file back.
- **On GUI edits**: drag commits, slider moves, and insert/paint/frame/erase operations POST to `/__oblik-*` endpoints that patch the same files.

So `apps/demo/src/scenes/*.ts` and `src/layout/*.ts` can change at any moment with no agent action. Do not treat an unexpected diff there as corruption or as your own work: check for a listener on port 43127 (`lsof -nP -iTCP:43127`) before diagnosing, and leave server-generated churn out of commits. Plugin code is read at server start — after a plugin change the user must restart `pnpm demo`, and a stale server (started before the change) keeps the old behavior.

## Skills

Project skills live in `.agents/skills/` (pinned by `skills-lock.json`); agent-specific dirs like `.claude/skills/` are symlinks into it, restorable with `npx skills experimental_install`. There is no skills CLI for DeepSeek — if you run DeepSeek here, treat `.agents/skills/<name>/SKILL.md` as the skill entrypoint and read it when the topic matches.

- **typegpu** (`.agents/skills/typegpu/SKILL.md`): WebGPU/TypeGPU rules. Read before writing or reviewing any TypeGPU/TGSL code, and follow its pointers into `references/*.md` for the topic at hand.
