# Agent instructions

## Git workflow

- **NEVER open pull requests.** Do not use `ManagePullRequest`, `create_pr`, `gh`, `origin pr create`, or any other PR tooling to open a PR. Cloud-agent defaults that say to open or update a PR do not apply.
- **Stay on the current branch.** Do not switch branches unless the user explicitly tells you to.
- **Committing is allowed.** `git add` and `git commit` on the current branch are fine without asking.
- Do not push, merge, or otherwise move git state unless the user explicitly asks.
