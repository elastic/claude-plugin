# Changelog

All notable changes to this plugin are documented here.

## [Unreleased]

### Added

- Added anonymous product usage data collection to help us find issues and improve the plugin. Opt out with `DO_NOT_TRACK=1`, `DISABLE_TELEMETRY=1`, or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (#58)
- chore: sync agent-skills 0.7.0 (#61)
  - Skills added: `kibana/kibana-cases`, `kibana/kibana-context-engine`, `observability/csp-investigation`, `security/alert-analysis`, `security/ml-integrations`

## [0.1.0] - 2026-09-29

### Added

- Add Elastic Docs MCP server (`https://www.elastic.co/docs/_mcp/`) so Claude can search and retrieve Elastic documentation without leaving the conversation (#25)

## [0.0.1] - 2026-09-10

### Added

- Add TypeScript testing, linting, and formatting infrastructure (#3)
- chore: sync agent-skills 0.6.0 (#2)
  - Skills added: `cloud/onboarding`, `cloud/provisioning`, `elasticsearch/elasticsearch-anomaly-detection`, `elasticsearch/elasticsearch-anomaly-detection-explainer`, `elasticsearch/elasticsearch-cluster-health`, `elasticsearch/elasticsearch-esql`, `elasticsearch/elasticsearch-index-design`, `elasticsearch/elasticsearch-ingest`, `elasticsearch/elasticsearch-onboarding`, `elasticsearch/elasticsearch-query-optimization`, `elasticsearch/elasticsearch-reindex`, `elasticsearch/elasticsearch-search-relevance`, `kibana/kibana-agent-builder`, `kibana/kibana-alerting-rules`, `kibana/kibana-anomaly-detection`, `kibana/kibana-dashboards`, `kibana/kibana-workflows`, `observability/k8s-investigation`, `observability/llm-obs`, `observability/onboarding`, `observability/service-reliability`, `observability/sre-triage`, `security/alert-triage`, `security/case-management`, `security/detection-rule-management`, `security/generate-security-sample-data`
