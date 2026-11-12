# Elastic's official Claude plugin

Umbrella plugin for the Elastic stack — Elasticsearch, Kibana, Observability, Security,
and Cloud.

## Structure

```
.claude-plugin/plugin.json   # Plugin manifest (skills array auto-generated)
.mcp.json                    # MCP server configurations
skills/                      # Synced from elastic/agent-skills on each release
hooks/                       # Authored directly in this repo (telemetry)
agents/                      # Authored directly in this repo (future)
```

## How skills get here

Skills are authored in
[`elastic/agent-skills-sandbox`](https://github.com/elastic/agent-skills-sandbox), promoted to
[`elastic/agent-skills`](https://github.com/elastic/agent-skills), and synced here
automatically on each `agent-skills` release. The sync copies the `skills/` directory and stamps
the version in `plugin.json`.

The `skills` array in `plugin.json` is regenerated automatically by CI on every PR — you don't
need to maintain it manually.

**Do not edit files under `skills/` in this repo.** Changes will be overwritten by the next sync.

## MCP servers

The plugin ships an `.mcp.json` that registers the public Elastic Docs MCP server
(`https://www.elastic.co/docs/_mcp/`). When the plugin is active, Claude can search
and retrieve Elastic documentation directly without leaving the conversation.

Authored directly in this repo. The sync never touches this file.

## Hooks, commands, and agents

Authored directly in this repo. The sync never touches these directories.

## Telemetry

The plugin sends usage data to Elastic to help us find issues and improve the
experience. Events are currently sent to Elastic's staging telemetry cluster.

### What is collected

| Event                         | When it is sent                                                        |
| ----------------------------- | ---------------------------------------------------------------------- |
| `claude_plugin_install`       | First session after the plugin is installed                            |
| `claude_plugin_active`        | Every session start with the plugin enabled                            |
| `claude_plugin_skill_invoked` | Every time an `elastic:` skill or slash command runs, by you or Claude |

Every event includes:

- A random `install_id`, stored in the plugin's own store, so events from the same install
  group together. It is not derived from your machine.
- The plugin version, Claude Code version, model, and session ID.
- Where the session runs (`surface`: terminal, desktop, or VS Code) and whether it is
  interactive (`is_interactive`).
- How full the context window is (`context_tokens`, `context_window`, `context_percent`).

Skill events also include the plugin name, the skill name, how long it took (`duration_ms`),
and whether it failed (`is_error`).

If the Elastic CLI is configured, the plugin runs
`elastic es info` once to send the cluster ID and stack version with each event.
If it isn't configured, both are sent as `unknown`.

Prompts, code, file contents, and skill arguments are not collected.

### Opting out

Set any one of these environment variables to `1`, `true`, `yes`, or `on` before starting
Claude Code, and the plugin sends nothing:

- `DO_NOT_TRACK`
- `DISABLE_TELEMETRY`
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`

```sh
export DO_NOT_TRACK=1
```

## Local development

```sh
claude --plugin-dir /path/to/claude-plugin
```
