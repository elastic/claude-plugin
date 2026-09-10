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
```

## Commit attribution

Use `Assisted-by:` trailers (not `Co-Authored-By:`) for AI-assisted commits, following the Linux kernel convention adopted at Elastic:

```
Assisted-by: Claude Code <noreply@anthropic.com>
```

## CI / GitHub Actions

Five workflows:

1. **CI** (`ci.yml`) — validates the plugin (`claude plugin validate --strict .`), runs lint (`eslint`), and runs tests (`jest`) on push, PR, and daily cron.
2. **Generate skills list** (`generate-skills-list.yml`) — auto-commits an updated `plugin.json` when `skills/` or the script changes.
3. **Changelog** (`changelog.yml`) — auto-commits a changelog entry from the PR title. Add the `skip-changelog` label to bypass.
4. **Release** (`release.yml`) — manual `workflow_dispatch`. Takes an explicit semver version string, validates it (semver format, single logical bump, tag doesn't exist), bumps `plugin.json`, stamps the changelog, and opens a PR with `skip-changelog`.
5. **Tag Release** (`release-tag.yml`) — fires on push to `main` when `plugin.json` changes. Creates the git tag (`{name}--v{version}`) and GitHub Release after the release PR merges.

## Versioning and releases

Releases are triggered manually via the Release workflow (`Actions` → `Release` → `Run workflow`). Provide the target version (e.g. `0.1.0`). The workflow validates the version, bumps `plugin.json`, stamps the changelog, and opens a PR. Once the PR merges, the Tag Release workflow automatically creates the tag and GitHub Release. Do not manually bump `plugin.json` `version` — the workflow owns that. Tag format: `elastic--v{version}`.

## Skill anatomy

Each skill is a directory under `skills/<domain>/` containing at minimum a `SKILL.md` with YAML frontmatter (`name`, `description`, `metadata`, optionally `compatibility`). Skills may also include:

- `references/*.md` — domain knowledge the skill loads on demand
- `scripts/*.js` — executable helpers (Node.js 22+, some require env vars for cluster access)
- `assets/*.json` — template payloads (e.g., Kibana dashboard JSON)
