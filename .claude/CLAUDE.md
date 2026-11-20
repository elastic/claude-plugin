# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Elastic's official Claude Code plugin (`elastic/claude-plugin`). It bundles skills, hooks, and agents for the Elastic stack (Elasticsearch, Kibana, Observability, Security, Cloud) into a single `.claude-plugin/plugin.json` manifest consumed by `claude --plugin-dir`.

## Key constraint

**Do not edit files under `skills/`.** Skills are authored in `elastic/agent-skills-sandbox`, promoted to `elastic/agent-skills`, and synced here automatically. Any local edits will be overwritten on the next sync. Hooks and agents (future) are authored directly in this repo.

## Repository layout

- `.claude-plugin/plugin.json` — plugin manifest. The `skills` array is auto-generated; all other fields are hand-maintained.
- `skills/<domain>/<skill-name>/SKILL.md` — skill definitions, organized by domain (cloud, elasticsearch, kibana, observability, security). Some skills also have `references/`, `scripts/`, and `assets/` subdirectories.
- `scripts/generate-skills-list.sh` — regenerates the `skills` array in `plugin.json` by scanning for `SKILL.md` files. Requires `jq`.
- `CHANGELOG.md` — keep-a-changelog format with an `[Unreleased]` section. CI auto-generates entries on PRs, so manual edits are rarely needed.

## Commands

```sh
# Install dependencies
npm install

# Validate the plugin (same check CI runs)
claude plugin validate --strict .

# Run tests
npm test

# Run linter
npm run lint

# Regenerate the skills list in plugin.json after adding/removing skills
bash scripts/generate-skills-list.sh

# Test locally
claude --plugin-dir /path/to/claude-plugin

# Type-check the hooks module (local only; not in CI)
npm run typecheck:hooks
```

`claude plugin validate` (CLI 2.1.328+) type-checks the hooks module, so CI covers type errors in `hooks/`. `typecheck:hooks` is the same check against `hooks/tsconfig.json`, for local use; it needs the hook API types the Claude Code engine writes to `.claude-plugin/types/` (gitignored) when an interactive session loads the plugin. No command generates them, and headless `claude -p` runs don't write them.

Hooks tests live in `hooks/*.test.ts` (run by `npm run test:hooks`). Repo tests live in `test/`, not `tests/`: the validator treats a top-level `tests/` folder as hooks test code and type-checks it in the hooks environment.

## Commit attribution

Use `Assisted-by:` trailers (not `Co-Authored-By:`) for AI-assisted commits, following the Linux kernel convention adopted at Elastic:

```
Assisted-by: Claude Code <noreply@anthropic.com>
```

## CI / GitHub Actions

Eight workflows:

1. **CI** (`ci.yml`) — validates the plugin (`claude plugin validate --strict .`), runs lint (`eslint`), and runs tests (`jest`) on push/PR to `main`, and daily cron. It does not run on `stable`.
2. **Generate skills list** (`generate-skills-list.yml`) — auto-commits an updated `plugin.json` when `skills/` or the script changes.
3. **Changelog** (`changelog.yml`) — auto-commits a changelog entry from the PR title. Add the `skip-changelog` label to bypass.
4. **Auto-approve Renovate** (`auto-approve-renovate-prs.yml`) — auto-approves Renovate dependency PRs with the `renovate-auto-approve` label.
5. **Release** (`release.yml`) — manual `workflow_dispatch`. Takes an explicit semver version string, validates it (semver format, single logical bump, tag doesn't exist), then runs `scripts/cut-release-branch.sh`, which commits the `plugin.json` bump and changelog stamp (`release: vX`), commits the removal of `package.json` and `package-lock.json`, and merges `stable`. It validates and tests that stripped tree with the pinned CLI, then opens a PR targeting `stable` with `skip-changelog`.
6. **Tag Release** (`release-tag.yml`) — fires on push to `stable` when `plugin.json` changes. Creates the git tag (`{name}--v{version}`) and GitHub Release after the release PR merges.
7. **Backport Release** (`release-backport.yml`) — fires on push to `stable` when `plugin.json` or `CHANGELOG.md` changes. Opens a PR that merges the `release: vX` commit itself into `main`, with auto-merge set to the merge-commit method. It does not merge `stable` into `main`.
8. **Release CI** (`release-ci.yml`) — runs on push/PR to `stable`. Its `Release Validation` job fails if a `package.json` or any lockfile is at the root, then runs `claude plugin validate --strict .` and `claude plugin test .` with the latest (unpinned) CLI.

## Branching and releases

Development happens on `main`. The `stable` branch is what Claude's plugin system serves to customers — it only advances via release PRs.

`stable` never contains `package.json` or a lockfile. Claude Code installs a plugin's packages when both sit at the plugin root, and the plugin directory holds such releases for review. Ours are dev tooling only, so the release strips them and they stay on `main`.

Releases are triggered manually via the Release workflow (`Actions` → `Release` → `Run workflow`). Provide the target version (e.g. `0.1.0`). The workflow validates the version, bumps `plugin.json`, stamps the changelog, removes `package.json` and `package-lock.json`, and opens a PR targeting `stable`. Merging that PR promotes all accumulated `main` changes to customers. The Tag Release workflow then automatically creates the tag and GitHub Release from `stable`. Finally, the Backport Release workflow opens a PR that brings the `release: vX` commit to `main`.

Two rules keep the branches mergeable:

- Merge the release PR and the backport PR with a merge commit. Never squash, rebase, or cherry-pick either: `main` and `stable` must share that exact commit, and `cut-release-branch.sh` refuses the next release if they do not.
- Never merge `stable` into `main`. That deletes `package.json` and `package-lock.json` from `main`.

Do not manually bump `plugin.json` `version` — the workflow owns that. Do not push directly to `stable` — it should only advance via release PRs. Tag format: `elastic--v{version}`.

## Skill anatomy

Each skill is a directory under `skills/<domain>/` containing at minimum a `SKILL.md` with YAML frontmatter (`name`, `description`, `metadata`, optionally `compatibility`). Skills may also include:

- `references/*.md` — domain knowledge the skill loads on demand
- `scripts/*.js` — executable helpers (Node.js 22+, some require env vars for cluster access)
- `assets/*.json` — template payloads (e.g., Kibana dashboard JSON)
