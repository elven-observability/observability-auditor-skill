# MCP Safety Contract

Use whenever the agent is about to call an MCP tool. The skill is read-only by default; this file is what makes that promise enforceable.

## The five-line contract

1. Read-only is the default mode and is assumed unless the user explicitly authorises a write in the current turn.
2. The canonical allowlist below is what may be called without confirmation.
3. The hard-block list below is what must never be called silently — even on user request — without echoing target IDs and the exact effect first.
4. Anything not on either list is treated as restricted: confirm scope, name the target, name the rollback.
5. If the connected MCP server lacks a needed tool, that is data — not a reason to escalate to a host shell.

## Canonical allowlist (safe in `read_only` mode)

These map across `mcp-grafana`, `EOAdmin`, `ElvenGrafana`, and equivalent Grafana-compatible servers. Substitute the prefix your environment exposes (`mcp__ElvenGrafana__list_datasources`, `mcp__EOAdmin__list_datasources`, etc.).

```yaml
discovery:
  - list_datasources
  - get_datasource
  - list_prometheus_metric_names
  - list_prometheus_metric_metadata
  - list_prometheus_label_names
  - list_prometheus_label_values
  - list_loki_label_names
  - list_loki_label_values
  - list_pyroscope_profile_types
  - list_pyroscope_label_names
  - list_pyroscope_label_values
  - search_folders
  - search_dashboards

reads:
  - query_prometheus
  - query_prometheus_histogram
  - query_loki_logs
  - query_loki_stats
  - query_loki_patterns
  - query_pyroscope
  - get_dashboard_by_uid
  - get_dashboard_summary
  - get_dashboard_panel_queries
  - get_dashboard_property
  - get_panel_image
  - list_alert_groups
  - get_alert_group
  - list_incidents
  - get_incident
  - list_sift_investigations
  - get_sift_investigation
  - get_sift_analysis
  - find_error_pattern_logs
  - find_slow_requests
  - get_annotations
  - get_annotation_tags
  - get_assertions
  - list_oncall_schedules
  - list_oncall_teams
  - list_oncall_users
  - get_oncall_shift
  - get_current_oncall_users
  - generate_deeplink
```

## Hard-block list (require explicit authorisation each turn)

```yaml
writes:
  - alerting_manage_rules        # create/update/delete alert rules
  - alerting_manage_routing      # change notification routing
  - update_dashboard             # edit dashboard JSON
  - create_annotation            # add timeline markers
  - update_annotation
  - create_incident              # open Grafana Incident
  - add_activity_to_incident     # comment in client's name
restricted:
  - "shell_*"                    # any host shell tool
  - "ssh_*"
  - "kubectl_*"
  - "exec_*"
  - "sudo_*"
  - "k8s_apply"
  - "deploy_*"
  - "restart_*"                  # process / container / collector restart
  - "drain_*"
  - "failover_*"
  - "sql_exec"                   # mutating SQL on host
  - "redis_exec"
  - "kafka_*"                    # write-side queue ops
```

If the MCP server you are connected to has none of the write/restricted tools above, log that as a positive finding in the report ("environment offers no write-capable MCP tools — read-only by construction").

## Authorisation protocol (when the user asks for a write)

For each write the user authorises in the current turn:

1. **Restate the change in one line.** "Add alert rule on `checkout` service for `error_rate > 0.02 for 5m`, severity=critical, folder `Checkout`."
2. **Echo the exact target IDs.** Rule UID (or folder + group), dashboard UID, incident ID, annotation IDs.
3. **Show the diff.** Existing body (if updating) and the proposed body, in a fenced block. For dashboards, show only the panels that changed.
4. **Name the rollback.** "Rollback: delete rule UID `abc123` or restore body `<…>`."
5. **Ask once for confirmation.** If the user said "go ahead, do it" already in this turn with the IDs visible, treat that as confirmation.
6. **After the call**, echo the new ID, the deeplink, and one cheap query to verify the change is in effect (e.g. "list_alert_groups | filter uid=abc123 → status=active").
7. **Annotate the write** with `client`, `audit_id`, and a stable `evidence_url`. This is how the report stays reproducible after the fact.

## Refusal templates (memorise the shape)

When the user asks to silence/edit/restart without scope confirmation:

```text
I can draft the alert rule body for review, but I won't call alerting_manage_rules
without the target UID/folder and an explicit authorisation echoing the change.

Proposed body:
  - <rule body>
Existing body (UID <uid>):
  - <existing body>
Rollback: <delete uid|restore body>

If you authorise, reply with the target UID and "go ahead". I'll then call
alerting_manage_rules and echo the new state.
```

When the user asks for raw secrets or production shell:

```text
I won't read or echo secrets/tokens/PII, and I won't run shell on a production
host. I can show you the symptom from metrics/logs (redacted) and propose the
exact command for you to run yourself. If you forward a redacted output back to
me, I'll continue the analysis.
```

## Tool-budget guard

Discovery tools are cheap; aggregation tools are mid; raw log/trace fetches and dashboard renders are expensive. Spend in this order, and stop when stop-conditions in `SKILL.md` are met.

| Class | Examples | Cost shape | Default cap per audit |
|---|---|---|---|
| Discovery | `list_datasources`, `list_*_label_names`, `search_dashboards` | O(seconds), cardinality-safe | unlimited |
| Aggregations | `query_prometheus`, `query_loki_stats`, `query_loki_patterns` | O(window × cardinality) | budget 30 calls |
| Raw fetches | `query_loki_logs` lines, `find_slow_requests`, `query_pyroscope` | O(volume) | budget 10 calls |
| Renders | `get_panel_image`, generated deeplinks | O(panels), can be slow | budget 5 panels |

When you approach a cap, pause and produce an interim finding before continuing.

## Coverage-gap reporting

If a tool is missing, say so plainly in the report and use the closest legitimate alternative. Never silently fall back to the host shell.

| Missing tool | Honest alternative |
|---|---|
| Sift (`find_error_pattern_logs`) | LogQL `pattern` + `topk` over `count_over_time` |
| Tempo TraceQL | Pivot from slow logs by `trace_id`; or `query_pyroscope` for CPU; mark trace evidence as "blind". |
| Pyroscope | Mark profile evidence "blind"; rely on metrics/traces only. |
| `generate_deeplink` | Hand-craft `/d/{uid}?from=…&to=…&var-…` URLs and mark them as best-effort. |

## Self-check before any tool call

- [ ] Is this tool on the allowlist?
- [ ] If it's a write tool, did the user authorise it in this turn?
- [ ] Did I echo target IDs?
- [ ] Did I check labels before filtering?
- [ ] Is my window absolute with timezone?
- [ ] Am I about to exceed the budget for this class?

If any answer is "no", stop and resolve it before continuing.
