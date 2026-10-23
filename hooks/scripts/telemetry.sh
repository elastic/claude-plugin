#!/usr/bin/env bash
# hooks/scripts/telemetry.sh — fire-and-forget; never block or fail the session
[ -n "$DO_NOT_TRACK" ] && exit 0

: "${ELASTIC_PLUGIN_TELEMETRY_URL:=https://localhost:9200/ebt-kibana-server/_doc}"
: "${ELASTIC_PLUGIN_TELEMETRY_USER:=elastic_serverless}"
: "${ELASTIC_PLUGIN_TELEMETRY_PASSWORD:=changeme}"

payload=$(cat)
[ -n "$payload" ] || exit 0

field() {
  [[ $payload =~ \"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]] && printf '%s' "${BASH_REMATCH[1]}"
}

bool_field() {
  [[ $payload =~ \"$1\"[[:space:]]*:[[:space:]]*(true|false) ]] && printf '%s' "${BASH_REMATCH[1]}"
}

json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

hook=$(field hook_event_name)
if [ -n "$hook" ]; then
  name=$(printf '%s' "$hook" | sed 's/\([A-Z]\)/_\1/g' | tr '[:upper:]' '[:lower:]' | sed 's/^_//')
else
  name=hook
fi

props=
add() {
  [ -n "$2" ] || return 0
  [ -n "$props" ] && props+=,
  props+="\"$1\":\"$(json_escape "$2")\""
}
add hook_event_name "$hook"
add session_id "$(field session_id)"
add source "$(field source)"
add tool_name "$(field tool_name)"
add cwd "$(field cwd)"
add skill_name "$(field skill)"
add success "$(bool_field success)"

event="{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"event_type\":\"claude_plugin_${name}\",\"properties\":{${props}},\"context\":{\"isDev\":true}}"
printf '%s\n' "$payload" >> /tmp/claude-plugin-telemetry.log

curl_args=(-s -m 3 -X POST "$ELASTIC_PLUGIN_TELEMETRY_URL" -H "Content-Type: application/json" --data-binary "$event")
case "$ELASTIC_PLUGIN_TELEMETRY_URL" in
  https://localhost:*|https://127.0.0.1:*) curl_args+=(-k) ;;
esac
if [ -n "${ELASTIC_PLUGIN_TELEMETRY_KEY:-}" ] && [ "$ELASTIC_PLUGIN_TELEMETRY_KEY" != "YOUR_ENCODED_API_KEY" ]; then
  curl_args+=(-H "Authorization: ApiKey $ELASTIC_PLUGIN_TELEMETRY_KEY")
else
  curl_args+=(-u "$ELASTIC_PLUGIN_TELEMETRY_USER:$ELASTIC_PLUGIN_TELEMETRY_PASSWORD")
fi
curl "${curl_args[@]}" >/dev/null 2>&1 || true
exit 0
