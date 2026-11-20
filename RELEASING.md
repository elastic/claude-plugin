# Releasing

Releases are managed through GitHub Actions. Do not manually bump the version
in `plugin.json` — the workflow owns that.

## How to release

1. Go to **Actions** → **Release** → **Run workflow**.
2. Enter the target version (e.g. `0.1.0`). Must be a single logical bump
   (patch, minor, or major) from the current version.
3. The workflow validates the version, then builds the release branch as two
   commits: one that bumps `plugin.json` and stamps the changelog
   (`release: v{version}`), and one that removes `package.json` and
   `package-lock.json` (see [Why `stable` has no `package.json`](#why-stable-has-no-packagejson)).
   It validates the result and opens a release PR into `stable` with the
   `skip-changelog` label.
4. Review and merge the release PR **with a merge commit**. Its required check
   is `Release Validation`.
5. On merge, the **Tag Release** workflow automatically creates the git tag
   (`elastic--v{version}`) and a GitHub Release.
6. The **Backport Release** workflow opens a PR that brings the
   `release: v{version}` commit to `main`. Merge it **with a merge commit**.

Both workflows try to enable auto-merge with the merge-commit method on the PR
they open. If that fails they log a warning, and the method is yours to pick.

## Why `stable` has no `package.json`

Claude Code installs a plugin's packages by itself when `package.json` and a
lockfile both sit at the plugin root, and the Claude plugin directory holds
releases like that for review. Ours list development tools only, so the release
removes both files from `stable`. They stay on `main`, where they power lint,
tests, and the pinned Claude Code CLI.

## Two rules that keep `main` and `stable` mergeable

1. **Never squash, rebase, or cherry-pick the release PR or the backport PR.**
   `main` and `stable` must share the exact `release: v{version}` commit. If
   they do not, the Release workflow refuses to cut the next release.
   - Backport PR squashed or skipped: open a PR that merges that commit from
     `stable` into `main`, and merge it with a merge commit.
   - Release PR squashed or rebased into `stable`: the commit no longer exists
     on `stable`, so there is no scripted recovery. The two branches have to be
     reconciled by hand.
2. **Never merge `stable` into `main`.** `stable` has `package.json` and
   `package-lock.json` deleted, and that merge deletes them from `main` too.

## If `Release Validation` fails on a release PR

`Release Validation` installs the latest Claude Code CLI, not the version
pinned in `package.json`, so a new CLI release can fail it for reasons
unrelated to the release. Fix the problem on `main`, close the release PR,
delete the `automation/release-v{version}` branch, and run the Release workflow
again.

## Tag format

Git tags use the `{name}--v{version}` format (e.g. `elastic--v0.1.0`). This
matches the convention expected by `claude plugin tag` and the Claude
marketplace, even though CI creates tags with raw `git tag` rather than that
command. Changing the format would require a corresponding marketplace update.

## Versioning

This plugin follows [semver](https://semver.org/):

- **Patch** (`0.0.X`): bug fixes, docs, CI changes.
- **Minor** (`0.X.0`): new skills synced, new hooks added, non-breaking changes.
- **Major** (`X.0.0`): breaking changes to the plugin manifest or hook behavior.

## Changelog

The release workflow stamps `[Unreleased]` with the version and date, and adds a new,
empty, `[Unreleased]` section.
