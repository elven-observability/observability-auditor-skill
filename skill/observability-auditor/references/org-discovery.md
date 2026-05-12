# Organization Discovery

Inventory the org before judging any service, alert, or dashboard. Two hours of bad discovery becomes two days of confident-but-wrong audit.

## Discovery order (run in parallel where possible)

1. `list_datasources` — classify each entry as Prometheus/Mimir, Loki, Tempo, ClickHouse, Elasticsearch, Pyroscope, cloud metrics, synthetic monitoring, or other.
2. `list_prometheus_metric_names` (regex match `http_|rpc_|business_|node_|process_|jvm_|beyla_`) and `list_prometheus_label_names` against the leading scope — confirms metric availability and label model.
3. `list_loki_label_names` and `list_loki_label_values` for the canonical `service_name` / `service` / `app` key.
4. `list_pyroscope_profile_types` and `list_pyroscope_label_values` — confirms profiling coverage.
5. `search_folders` and `search_dashboards` — gets dashboard inventory with folder/tag context.
6. `list_alert_groups` — gets all alert rules.
7. `list_incidents` for the last 30d — gives the recent incident shape.
8. `list_oncall_schedules` / `list_oncall_teams` — ownership map.
9. `get_assertions` — what Grafana itself already asserts about this stack.

Cache the canonical label model (the exact label keys this org uses for `client`, `environment`, `service`, `host`, `instance`, `cluster`, `region`) in the evidence ledger after step 3. Never re-probe within the same investigation.

## Coverage matrix

Produce this as a markdown table in the report. One row per `service × environment`.

| service | env | metrics | logs | traces | profiles | infra | dashboards | alerts | incidents (30d) | owner | notes |

Use these statuses, with the supporting tool call:

- `covered` — present and label-consistent. (`query_prometheus`/`query_loki_logs` returned data with the canonical label set.)
- `partial` — present but labels inconsistent, missing buckets, missing routes, or stale.
- `blind` — no useful telemetry. Probed and returned empty.
- `unknown` — not yet probed; finish discovery first.

## Label validation discipline

The single biggest cause of bad audits is querying with the wrong label key. Standard suspects:

| Concept | Common keys (probe to confirm) |
|---|---|
| Service | `service`, `service_name`, `app`, `job`, `serviceName` |
| Host | `host`, `host_name`, `hostname`, `instance`, `nodename` |
| Environment | `env`, `environment`, `stage`, `tier` |
| Tenant | `client`, `tenant`, `customer`, `org`, `account` |
| Pod/Container | `pod`, `container`, `kubernetes_pod_name`, `k8s.pod.name` |
| Cluster | `cluster`, `k8s_cluster`, `cluster_name` |
| Region | `region`, `aws_region`, `gcp_region`, `zone` |

Watch for:

- Dotted vs dashed vs underscored service names (`order-service` vs `order_service` vs `order.service`).
- Mixed casing (`Checkout` vs `checkout`).
- Plural vs singular environments (`prods` vs `prod`).
- Old labels still produced by one collector, new labels by another (label drift).
- Resource-attribute prefix vs flattened key (`resource.service.name` vs `service_name`).

Document discrepancies once in the evidence ledger:

```yaml
finding_id: f-label-drift
claim: "Two label conventions coexist for service identity"
confidence: high
datasource: "mimir-prod"
tool_or_query: "list_prometheus_label_values service_name | list_prometheus_label_values service"
observed: "service_name has 42 values; service has 18 values; overlap 12; old key still emitted by collectors X, Y"
recommendation: "Standardise on service_name; alert dashboard owners that 6 alerts still use service=…"
```

## Org-health signals

A healthy org tends to have:

- One canonical label model used across metrics, logs, traces, dashboards, alerts, and incidents.
- A `service_name` value that joins metrics → logs → traces without renaming.
- Dashboards with `client`, `environment`, `service` variables and sensible defaults.
- Alert rules with `severity`, `team`/`owner`, `service_name`, `environment`, `alert_type` labels and `summary`/`runbook_url`/`dashboard_url` annotations.
- Symptom alerts for business-critical services, not only host alerts.
- Runbooks that link to a specific dashboard + a specific exploration query.
- Annotations on deploys/restarts so timelines can correlate.

Score the org on these dimensions (0–5 each) and average. Show the rubric.

## Required output

End discovery with:

1. **Telemetry coverage matrix** (rows above).
2. **Label drift findings** — explicit list of inconsistencies with severity.
3. **Top blind spots** — what would be invisible during an incident.
4. **Dashboards worth using** — the ≤5 highest-quality, scored.
5. **Alerts worth trusting** — the ≤10 highest-quality, scored.
6. **Recent incidents (30d)** — shape (frequency, services affected, average duration).
7. **Recommended deep dives** — what to investigate next.

No prose paragraphs until those seven sections exist.
