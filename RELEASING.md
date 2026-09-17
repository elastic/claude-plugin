# Releasing

Releases are managed through GitHub Actions. Do not manually bump the version
in `plugin.json` — the workflow owns that.

## How to release

1. Go to **Actions** → **Release** → **Run workflow**.
2. Enter the target version (e.g. `0.1.0`). Must be a single logical bump
   (patch, minor, or major) from the current version.
3. The workflow validates the version, bumps `plugin.json`, stamps the
   changelog, and opens a release PR with the `skip-changelog` label.
4. Review and merge the release PR.
5. On merge, the **Tag Release** workflow automatically creates the git tag
   (`elastic--v{version}`) and a GitHub Release.

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
