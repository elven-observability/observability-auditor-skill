# MCP Tool Catalog

Canonical list of Grafana-compatible MCP tools the auditor uses, with the question each tool actually answers. Tool names follow the convention used by `mcp-grafana`, `EOAdmin`, `ElvenGrafana`, and similar servers. Substitute the server prefix your environment exposes (e.g. `mcp__ElvenGrafana__list_datasources`).

If a tool is missing from your server, that is data — note the coverage gap in the report instead of working around it silently.

## Discovery (run first)

| Tool | Question it answers | Notes |
|---|---|---|
| `list_datasources` | What metrics/log/trace/SQL backends does this org expose? | Always first. Classify each result. |
| `get_datasource` | What is the URL, type, and JSON config of one datasource? | Use to confirm Mimir vs Prometheus, Loki tenant, Tempo backend. |
| `search_folders` / `search_dashboards` | What dashboards exist for this client/service? | Filter by tag and folder. Cheaper than reading dashboards. |
| `list_prometheus_metric_names` | Does a metric exist before I write a PromQL query? | Use a regex matcher; expect substring matches. |
| `list_prometheus_metric_metadata` | What is the metric's `type`/`unit`/help string? | Confirms units before percentile math. |
| `list_prometheus_label_names` | Which labels actually exist on this metric scope? | Mandatory before filtered queries. |
| `list_prometheus_label_values` | Which values does a label hold for this scope? | Confirms `service_name` vs `service`, etc. |
| `list_loki_label_names` / `list_loki_label_values` | Log stream label model | Same discipline as Prometheus. |
| `list_pyroscope_profile_types` / `list_pyroscope_label_names` / `list_pyroscope_label_values` | Profiling availability | Only relevant when CPU/heap regression is suspected. |

## Metrics

| Tool | Question | Notes |
|---|---|---|
| `query_prometheus` | What is the numeric value of this PromQL right now or at instant T? | Default for instant snapshots. |
| `query_prometheus` (range) | How did this metric move over the window? | Always set start/end/step matching the slice grid. |
| `query_prometheus_histogram` | What is the p50/p90/p95/p99 for this histogram? | Prefer this over re-deriving `histogram_quantile` by hand. |

## Logs

| Tool | Question | Notes |
|---|---|---|
| `query_loki_logs` | Show me the raw or filtered log lines for this stream during the window | Cap line count; redact bodies. |
| `query_loki_stats` | How many streams/chunks/lines match this selector? | Use before pulling lines to estimate cost. |
| `query_loki_patterns` | What are the top extracted log patterns? | Pattern view is gold for signature analysis. |
| `find_error_pattern_logs` | Which Loki streams have anomalous error patterns in the window? | Sift-driven; usually a great seed for incident timelines. |

## Traces and slow paths

| Tool | Question | Notes |
|---|---|---|
| `find_slow_requests` | Which traces are slowest for this service in the window? | Sift; seed for deep-dive. |
| (proxied Tempo TraceQL) | Show traces matching `{ resource.service.name="X" && status=error }` | Use TraceQL when the MCP server exposes it. |

## Alerts and incidents

| Tool | Question | Notes |
|---|---|---|
| `list_alert_groups` | What alert rules exist (with labels/annotations)? | Page through; do not assume completeness. |
| `get_alert_group` | What is the full rule body (query, condition, `for`, no-data behaviour)? | Required input to `scripts/score_alert.mjs`. |
| `alerting_manage_rules` | Create/update/delete alert rules | **Write tool — never invoke without explicit user authorisation.** |
| `alerting_manage_routing` | Change notification routing | **Write tool.** |
| `list_incidents` / `get_incident` | What incidents are open or recent? | Cross-reference timeline. |
| `create_incident` / `add_activity_to_incident` | Open/update an incident | **Write tools.** Only on request. |

## On-call

| Tool | Question | Notes |
|---|---|---|
| `list_oncall_schedules` / `list_oncall_teams` / `list_oncall_users` / `get_oncall_shift` / `get_current_oncall_users` | Who is currently responsible? | Use to assign ownership in recommendations. |

## Sift investigations and assertions

| Tool | Question | Notes |
|---|---|---|
| `list_sift_investigations` / `get_sift_investigation` / `get_sift_analysis` | What automated investigations exist for this scope? | Can shortcut hours of manual work — always check before manual digging. |
| `get_assertions` | What service-level assertions does Grafana already have on this service? | Cross-reference with your own findings. |

## Annotations and dashboards

| Tool | Question | Notes |
|---|---|---|
| `get_annotations` / `get_annotation_tags` | What deploy/restart/business markers exist in the window? | Always check before claiming "no deploy correlation". |
| `create_annotation` / `update_annotation` | Mark the timeline | **Write tool.** |
| `get_dashboard_by_uid` / `get_dashboard_summary` / `get_dashboard_panel_queries` / `get_dashboard_property` | Read dashboard contents | Required for dashboard audit. |
| `update_dashboard` | Modify a dashboard | **Write tool.** |
| `get_panel_image` | Render a panel | Useful for evidence screenshots in reports. |

## Pyroscope

| Tool | Question | Notes |
|---|---|---|
| `query_pyroscope` | What is the CPU/heap flamegraph for service X in window W? | Use when latency p99 regresses without obvious dep cause. |

## Navigation

| Tool | Question | Notes |
|---|---|---|
| `generate_deeplink` | Give me a clickable Grafana URL to embed in the report | Always include deeplinks in client-facing reports for reproducibility. |

## Tool-budget rules

- Run discovery in parallel: `list_datasources`, label probes, dashboard search, alert list, incident list — all in one batch.
- Cap log line pulls (start at 50–200 lines, expand only when needed).
- Use `query_loki_stats` and `query_loki_patterns` before pulling raw lines.
- Never expand a label by `=~".*"` when you can list its values first.
- Cache canonical label names in the evidence ledger once validated — do not re-probe.

## When a tool is missing

If the connected MCP server lacks a needed tool (e.g. no Pyroscope, no Sift):

1. Note it in the coverage matrix.
2. Use the closest available alternative (PromQL `topk` instead of Sift, manual TraceQL instead of `find_slow_requests`).
3. State the workaround and its limitations in the report.
4. Do not silently degrade — the user must know which conclusions were reached with reduced tooling.
