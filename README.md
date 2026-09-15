# Elastic's official Claude plugin

Umbrella plugin for the Elastic stack — Elasticsearch, Kibana, Observability, Security,
and Cloud.

## Structure

```
.claude-plugin/plugin.json   # Plugin manifest (skills array auto-generated)
.mcp.json                    # MCP server configurations
skills/                      # Synced from elastic/agent-skills on each release
hooks/                       # Authored directly in this repo (future)
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

## Local development

```sh
claude --plugin-dir /path/to/claude-plugin
```
