# SLO and Alerting Practices 2026

Use when recommending modern alerting and SLO design. The principles below trade off "page less, hit harder" against "never miss a real customer issue". They reflect the 2025–2026 convergence around symptom alerts, multi-window burn-rate, stable OpenTelemetry semantic conventions, tenant-aware noise control, and explicit error-budget policies.

## Principles

1. **Alert on symptoms users feel before causes operators inspect.** A failing checkout is a page; high CPU on one host is a ticket.
2. **Use SLOs for critical user journeys and threshold alerts for supporting causes.** Don't try to SLO everything — pick the 5–15 journeys that map directly to revenue or trust.
3. **Tune thresholds against real baselines** (p50/p90/p95/p99 over 7–30 days), not generic numbers.
4. **Prefer multi-window multi-burn-rate alerts** for mature availability/latency SLOs.
5. **Add minimum traffic or minimum failure count** to avoid low-volume noise (`AND sum(rate(...)) > N`).
6. **Distinguish paging alerts from ticket alerts** with explicit `severity` and routing.
7. **Keep labels stable and joinable** across metrics/logs/traces/dashboards/incidents — pick OTel semantic conventions (now stable for HTTP/RPC/DB) and stay disciplined.
8. **Make every alert actionable**: owner, runbook URL, dashboard URL, impact, suggested first action, validation query.
9. **Codify the error-budget policy.** What happens at 50% / 75% / 100% budget burn must be written down before it is needed.

## Good SLO candidates

- Checkout / order / payment success.
- API availability for critical routes (auth, search, top revenue route).
- Reservation/search/booking latency.
- Background job freshness (max-age of last successful run).
- Queue processing delay (oldest unprocessed message age).
- Login/auth success.
- External dependency success where the business owns mitigation.

## SLO inventory schema

When SLOs exist or you are recommending new ones, capture each one in this shape:

```yaml
slo_name: ""
business_journey: ""
service_name: ""
service_namespace: ""    # OTel: service.namespace (e.g. payments-platform)
environment: ""          # OTel: deployment.environment.name
sli_type: availability   # availability | latency | freshness | correctness
sli_query: ""            # the SLI itself, in PromQL/LogQL
objective: 0.999         # 99.9%
rolling_window: "28d"
error_budget_policy: ""  # → see "Error-budget policy" below
fast_burn_alert: ""      # rule UID + window/burn-rate
slow_burn_alert: ""      # rule UID + window/burn-rate
minimum_traffic_guard: "" # e.g. AND sum(rate(...)) > 1
owner: ""                # team or person
dashboard_url: ""
runbook_url: ""
validation_query: ""     # how to confirm a fire/recovery
current_status: ""       # green | burning | exhausted
recommendation: ""
```

## Multi-window burn-rate guidance

Use Google's classic pairing as a starting point; tune to the SLO objective and traffic shape.

| Severity | Long window | Short window | Burn rate | Typical use |
|---|---|---|---|---|
| Page (fast) | 1h | 5m | 14.4× | Burns 2% of 30-day budget in 1h |
| Page (medium) | 6h | 30m | 6× | Burns 5% of 30-day budget in 6h |
| Ticket (slow) | 24h | 2h | 3× | Burns 10% of 30-day budget in 24h |
| Ticket (very slow) | 3d | 6h | 1× | Sustained burn |

For low-traffic services, multiply by a traffic-floor guard so a single 5xx does not page on-call:

```promql
(
  sum(rate(http_server_request_duration_seconds_count{
    service_name="X", http_response_status_code=~"5..", environment="prod"
  }[1h]))
  /
  clamp_min(sum(rate(http_server_request_duration_seconds_count{
    service_name="X", environment="prod"
  }[1h])), 0.001)
) > (14.4 * (1 - 0.999))
AND
sum(rate(http_server_request_duration_seconds_count{
  service_name="X", environment="prod"
}[5m])) > 0.5    # traffic floor: 0.5 rps before page can fire
```

## Error-budget policy (write before you need it)

A policy worth the name has four named tiers and an owner per tier. Example for a 99.9% / 28d availability SLO:

| Budget burned | State | Required response | Who owns it |
|---|---|---|---|
| < 50% | green | normal velocity, run experiments | service owner |
| 50%–75% | yellow | block risky changes, schedule reliability work, raise to lead | service owner + tech lead |
| 75%–100% | orange | freeze non-critical deploys, dedicate >25% capacity to reliability | tech lead + EM |
| > 100% (exhausted) | red | full deploy freeze, RCA in 48h, customer-facing comms reviewed | EM + director on-call |

Render the policy explicitly in the audit report when SLOs exist or are being introduced. If no policy exists, that is itself a high-priority recommendation.

## Alert metadata standard

Required labels:

- `severity` (`critical` / `warning` / `info`).
- `team` or `owner`.
- `service_name` (OTel canonical).
- `environment` (OTel `deployment.environment.name` flattened).
- `client` or tenant label for multi-tenant.
- `alert_type` (`symptom` / `cause` / `telemetry` / `business`).

Required annotations:

- `summary` (one line).
- `description` (paragraph with context).
- `impact` (customer/business consequence).
- `runbook_url`.
- `dashboard_url`.
- `validation_query` (cheap query to confirm).
- `suggested_first_action`.

## Telemetry semantics (stable in 2025–2026)

OpenTelemetry stabilised HTTP, RPC, DB, and general resource conventions in late 2025. Use these names; old `experimental` names are still common in the wild — when you find them, flag as a label-drift finding.

| Concept | Stable attribute (`semconv` ≥1.27) | Common flattened metric/label name |
|---|---|---|
| Service identity | `service.name` | `service_name` |
| Service grouping | `service.namespace` | `service_namespace` (or omit if 1 namespace) |
| Service instance | `service.instance.id` | `service_instance_id` |
| Deployment env | `deployment.environment.name` | `environment` (or `deployment_environment_name`) |
| HTTP server latency | `http.server.request.duration` (histogram, seconds) | `http_server_request_duration_seconds_bucket/_count/_sum` |
| HTTP server status | `http.response.status_code` | `http_response_status_code` |
| HTTP server route | `http.route` | `http_route` |
| HTTP client latency | `http.client.request.duration` | `http_client_request_duration_seconds_bucket/_count/_sum` |
| RPC server latency | `rpc.server.duration` | `rpc_server_duration_seconds_bucket/_count/_sum` |
| DB call latency | `db.client.operation.duration` | `db_client_operation_duration_seconds_bucket/_count/_sum` |
| DB system | `db.system.name` | `db_system_name` |
| Cluster | `k8s.cluster.name` | `k8s_cluster_name` |
| Pod | `k8s.pod.name` | `k8s_pod_name` |

Keep metric units consistent — seconds and bytes universally. Avoid attacker-controlled or unbounded label values (raw URLs, user IDs as labels).

## Exemplars (metric ↔ trace linkage)

When the histogram supports OTel exemplars, **a single Grafana click jumps from a p99 spike to the slow trace**. This is the single highest-leverage 2026-grade telemetry feature for incident timelines.

In dashboards: enable "Show exemplars" on the histogram panel; toggle "Tempo" as the trace datasource.

In PromQL:

```promql
histogram_quantile(0.99,
  sum by (le, service_name) (
    rate(http_server_request_duration_seconds_bucket{
      service_name="X", environment="prod"
    }[5m])
  )
)
```

Make sure the histogram has the `__exemplar__` attribute populated by the SDK (`SDK_EXPORT_EXEMPLARS=true` for Otel SDKs, or the equivalent flag for Beyla / auto-instrumentation).

If exemplars are missing, that is a finding ("Tempo↔Prometheus exemplar linkage not configured — incident timelines require manual `trace_id` lookup").

## Adaptive Metrics / cost (Grafana Cloud and on-prem)

Modern Grafana stacks support **Adaptive Metrics** to drop unused label cardinality at ingest. Recommendations:

- Audit which metrics' label sets are never queried in the last 30d (Grafana Cloud "usage insights").
- Drop high-cardinality labels (raw user IDs, query strings, dynamic route params) before they hit storage.
- Re-aggregate noisy histograms with high-resolution recording rules instead of querying raw at dashboard time.

When SLOs are involved, never strip a label that participates in the SLI query — preview the change in a staging tenant first.

## Synthetic / external probes

Synthetic monitoring (Grafana Synthetic Monitoring, k6 Cloud) complements RUM/server SLIs:

- Use synthetic for **availability** when traffic is too low for trustworthy SLIs (e.g. internal admin APIs).
- Treat synthetic latency as a **floor**, not a ceiling — real user latency is always worse.
- Page on synthetic only when the symptom is invisible from the inside (network egress problem, cert expiry, DNS).

## What "good" looks like in one sentence

A page wakes the right person within seconds of customer impact, with a runbook that points to the dashboard that shows the same labels, that links to the logs that share the trace IDs, against an SLO whose budget you actually budget against, with a written policy for what happens when that budget burns.

## References

- Grafana SLO noise guidance: https://grafana.com/docs/grafana/latest/alerting/guides/when-slos-reduce-alert-noise/
- Grafana Cloud SLO best practices: https://grafana.com/docs/grafana-cloud/alerting-and-irm/slo/best-practices/
- Grafana Adaptive Metrics: https://grafana.com/docs/grafana-cloud/cost-management-and-billing/reduce-costs/metrics-costs/adaptive-metrics/
- Google SRE workbook — Alerting on SLOs: https://sre.google/workbook/alerting-on-slos/
- Prometheus alerting rules: https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/
- OpenTelemetry semantic conventions (stable): https://opentelemetry.io/docs/specs/semconv/
- OpenTelemetry HTTP metrics: https://opentelemetry.io/docs/specs/semconv/http/http-metrics/
- OpenTelemetry RPC metrics: https://opentelemetry.io/docs/specs/semconv/rpc/rpc-metrics/
- OpenTelemetry DB metrics: https://opentelemetry.io/docs/specs/semconv/database/database-metrics/
- OpenTelemetry exemplars spec: https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exemplars
