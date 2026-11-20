#!/usr/bin/env bash
#
# Licensed to Elasticsearch B.V. under one or more contributor
# license agreements. See the NOTICE file distributed with
# this work for additional information regarding copyright
# ownership. Elasticsearch B.V. licenses this file to you under
# the Apache License, Version 2.0 (the "License"); you may
# not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

set -euo pipefail

# Build the release branch for <version>, ready to open as a PR into stable.
#
#   scripts/cut-release-branch.sh <version>
#
# Leaves automation/release-v<version> checked out, holding three things on
# top of BASE_REF:
#
#   B  "release: v<version>"   plugin.json bump + changelog stamp. This same
#                              commit is merged into main afterwards, so the
#                              two branches keep sharing history.
#   S  "chore: strip ..."      removes package.json and package-lock.json.
#                              Claude Code installs a plugin's packages when
#                              both sit at the plugin root, so the plugin
#                              directory holds any release carrying them.
#                              They are dev tooling and stay on main.
#   M  merge of STABLE_REF     keeps the branch up to date with stable.
#
# S has to come before M. stable has already deleted the manifests, so with S
# in place both sides agree; without it git reports a modify/delete conflict
# whenever the lockfile changed on main since the last release.
#
# Environment:
#   BASE_REF      ref to release from       (default: origin/main)
#   STABLE_REF    ref of the stable branch  (default: origin/stable)
#   RELEASE_DATE  date for the changelog    (default: today, YYYY-MM-DD)

PLUGIN_JSON=".claude-plugin/plugin.json"
CHANGELOG="CHANGELOG.md"

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <version>" >&2
  exit 1
fi

version="$1"
base_ref="${BASE_REF:-origin/main}"
stable_ref="${STABLE_REF:-origin/stable}"
release_date="${RELEASE_DATE:-$(date +%F)}"
branch="automation/release-v${version}"

if git rev-parse --verify --quiet "refs/heads/${branch}" >/dev/null; then
  echo "Branch ${branch} already exists. Delete it before cutting v${version} again." >&2
  exit 1
fi

# The previous release commit must be on both stable and main. If the release
# PR or its backport PR was squashed, rebased, or cherry-picked, one branch
# holds the same changes under a different commit and the merge of stable
# below conflicts.
prev="$(git show "${stable_ref}:${PLUGIN_JSON}" | jq -r '.version')"
# --no-merges: GitHub copies the PR title into the merge commit's body, so the
# merge of the release PR also carries a "release: vX" line.
prev_commit="$(git log "$stable_ref" --format=%H -1 --no-merges --grep="^release: v${prev//./\\.}$")"
if [ -z "$prev_commit" ]; then
  echo "No 'release: v${prev}' commit on stable. The v${prev} release PR was probably squashed or rebased; it has to be merged with a merge commit. main and stable no longer share that release and must be reconciled by hand before releasing (see RELEASING.md)." >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$prev_commit" "$base_ref"; then
  echo "Release commit ${prev_commit} (v${prev}) is on stable but not on main. Merge the v${prev} backport PR with a merge commit (not squash) before releasing." >&2
  exit 1
fi

git checkout -q -b "$branch" "$base_ref"

jq --arg v "$version" '.version = $v' "$PLUGIN_JSON" >"${PLUGIN_JSON}.tmp"
mv "${PLUGIN_JSON}.tmp" "$PLUGIN_JSON"

VERSION="$version" RELEASE_DATE="$release_date" CHANGELOG="$CHANGELOG" python3 - <<'PYEOF'
import os

version = os.environ["VERSION"]
today = os.environ["RELEASE_DATE"]
path = os.environ["CHANGELOG"]

with open(path, "r") as f:
    content = f.read()

if "## [Unreleased]" not in content:
    raise SystemExit(0)

content = content.replace(
    "## [Unreleased]",
    f"## [Unreleased]\n\n## [{version}] - {today}",
    1,
)

with open(path, "w") as f:
    f.write(content)
PYEOF

git add "$PLUGIN_JSON" "$CHANGELOG"
git commit -q -m "release: v${version}"

git rm -q package.json package-lock.json
git commit -q -m "chore: strip dev package manifests for stable"

git merge -q --no-edit "$stable_ref"
