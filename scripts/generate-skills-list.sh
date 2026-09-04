#!/usr/bin/env bash
set -euo pipefail

# Scan skills/ for directories containing SKILL.md and regenerate
# the "skills" array in .claude-plugin/plugin.json.
#
# Preserves all other fields in plugin.json.

PLUGIN_JSON=".claude-plugin/plugin.json"

if [ ! -f "$PLUGIN_JSON" ]; then
  echo "Error: $PLUGIN_JSON not found" >&2
  exit 1
fi

# Find all skill directories (those containing SKILL.md)
# and build a JSON array of their paths.
if [ -d "skills" ]; then
  skills_json=$(find skills -name SKILL.md -print0 | \
    xargs -0 -I{} dirname {} | \
    sort | \
    jq -R -s 'split("\n") | map(select(length > 0))')
else
  skills_json="[]"
fi

# Update only the "skills" field, preserve everything else.
jq --argjson skills "$skills_json" '.skills = $skills' \
  "$PLUGIN_JSON" > "${PLUGIN_JSON}.tmp" && mv "${PLUGIN_JSON}.tmp" "$PLUGIN_JSON"

echo "Updated $PLUGIN_JSON with $(echo "$skills_json" | jq 'length') skill(s)."
