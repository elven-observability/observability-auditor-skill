# Observability Audit — AcmeRetail

<!-- scripts/render_report.mjs replaces every double-curly placeholder below using
     findings.json (primary) and audit-context.yaml (secondary). Missing values
     surface as "(missing)" so reviewers can spot gaps. Hand-edit only inside
     "### Finding" blocks if you want to keep regeneration safe. -->

## Context

```yaml
client: "AcmeRetail"
grafana_url: "https://grafana.acme.com"
org_id: "42"
timezone: "America/Sao_Paulo"
operation_mode: "read_only"
windows:
  bad: { start: "2026-05-10T14:00:00-03:00", end: "2026-05-10T16:30:00-03:00" }
  good: { start: "2026-05-09T14:00:00-03:00", end: "2026-05-09T16:30:00-03:00" }
  baselines: [{"label":"same-hour-yesterday","start":"2026-05-09T14:00:00-03:00","end":"2026-05-09T16:30:00-03:00"},{"label":"same-weekday-last-week","start":"2026-05-03T14:00:00-03:00","end":"2026-05-03T16:30:00-03:00"}]
allowed_actions: 17 actions whitelisted
forbidden_actions: see appendix
```

## Executive Summary

> Between 2026-05-10T14:00:00-03:00 and 2026-05-10T16:30:00-03:00 (America/Sao_Paulo), checkout completion rate dropped 42% (from 87% to 50%) between 14:10 and 16:00 BRT.
> The strongest evidence indicates Postgres connection pool exhaustion on checkout-db, aligned with traffic burst from marketing campaign.
> Recovery aligned most closely with dependency-relief, while Tempo coverage for checkout service is partial — trace evidence unavailable for routes /v2/cart and /v2/finalize persisted.
> Confidence: **high**.

Top three actions:

1. Raise checkout-db max_connections from 200 to 400 (owner: data-platform, validate: pg_stat_activity_count < 350)
2. Add multi-window burn-rate alert on Checkout availability SLO 99.5%/28d (owner: checkout-platform)
3. Enable Tempo↔Mimir exemplars on http_server_request_duration_seconds for service_name=checkout

## Timeline

| time (America/Sao_Paulo) | business | RPS | p95 (ms) | err % | top log signature | top slow span | DB | infra | external | annotation | interpretation |
|---|---|---|---|---|---|---|---|---|---|---|---|
| _no timeline data_ |  |  |  |  |  |  |  |  |  |  |  |

## Service Health

| service | env | RPS Δ | p95 Δ | err% Δ | dep risk | infra risk | summary |
|---|---|---|---|---|---|---|---|
| _no service health rows_ |  |  |  |  |  |  |  |

## Business Metrics

_No findings in this section._

## Metrics Evidence

### Checkout 5xx ratio peaked at 18%

- Severity: high
- Confidence: high
- Impact: ~37% customer abandonment during 95 minutes; estimated R$248k revenue impact
- Evidence:
  - datasource: mimir-prod
  - tool/query: sum(rate(http_server_request_duration_seconds_count{service_name="checkout",http_response_status_code=~"5.."}[5m])) / clamp_min(sum(rate(http_server_request_duration_seconds_count{service_name="checkout"}[5m])), 0.001)
  - window: 2026-05-10T14:00:00-03:00 → 2026-05-10T16:30:00-03:00
  - filters: {"service_name":"checkout","environment":"prod"}
  - observed: p95 ratio 0.18, baseline 0.005 (same-hour-yesterday) — delta +3500%
  - baseline: same-hour-yesterday p95 ratio = 0.005
- Interpretation: Service returned 5xx coincident with downstream DB latency surge
- Counter-test: If DB p95 stayed flat the cause would be upstream caller; observed DB p95 went 12ms → 850ms at the same minute, refuting the counter
- Next validation: histogram_quantile(0.95, sum by (le, db_system_name)(rate(db_client_operation_duration_seconds_bucket{service_name="checkout"}[5m])))
- Recommendation: Raise checkout-db connection pool ceiling; add traffic-floor burn-rate alert
- Owner: checkout-platform

### checkout-db connection pool saturation

- Severity: high
- Confidence: high
- Impact: Database refused new acquires, propagated as 5xx upstream
- Evidence:
  - datasource: mimir-prod
  - tool/query: max_over_time(pg_stat_activity_count{datname="checkout",state="active"}[5m])
  - window: 2026-05-10T14:15:00-03:00 → 2026-05-10T16:00:00-03:00
  - filters: {"datname":"checkout"}
  - observed: 200 active connections (ceiling) for 96 consecutive minutes
  - baseline: same-hour-yesterday peak = 78 active connections
- Interpretation: Pool exhausted under campaign-driven traffic burst
- Counter-test: If error happened without saturation, observed would stay below ceiling — refuted by sustained ceiling pin
- Next validation: show pg_settings where name='max_connections'
- Recommendation: Raise max_connections 200 → 400; add per-route concurrency limit
- Owner: data-platform

## Logs Evidence

_No findings in this section._

## Traces Evidence

_No findings in this section._

## Infrastructure And Dependencies

### checkout-db connection pool saturation

- Severity: high
- Confidence: high
- Impact: Database refused new acquires, propagated as 5xx upstream
- Evidence:
  - datasource: mimir-prod
  - tool/query: max_over_time(pg_stat_activity_count{datname="checkout",state="active"}[5m])
  - window: 2026-05-10T14:15:00-03:00 → 2026-05-10T16:00:00-03:00
  - filters: {"datname":"checkout"}
  - observed: 200 active connections (ceiling) for 96 consecutive minutes
  - baseline: same-hour-yesterday peak = 78 active connections
- Interpretation: Pool exhausted under campaign-driven traffic burst
- Counter-test: If error happened without saturation, observed would stay below ceiling — refuted by sustained ceiling pin
- Next validation: show pg_settings where name='max_connections'
- Recommendation: Raise max_connections 200 → 400; add per-route concurrency limit
- Owner: data-platform

## Alerts And Thresholds

| uid | title | service | env | sev | type | threshold | observed (p50/p95/p99) | lead-time | issue | recommendation | score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| _no alerts scored_ |  |  |  |  |  |  |  |  |  |  |  |

## Dashboards

| uid | dashboard | primary question | score | strengths | gaps | risks | recommended edits |
|---|---|---|---|---|---|---|---|
| _no dashboards scored_ |  |  |  |  |  |  |  |

## Root-Cause Hypotheses

### Checkout 5xx ratio peaked at 18%

- Severity: high
- Confidence: high
- Impact: ~37% customer abandonment during 95 minutes; estimated R$248k revenue impact
- Evidence:
  - datasource: mimir-prod
  - tool/query: sum(rate(http_server_request_duration_seconds_count{service_name="checkout",http_response_status_code=~"5.."}[5m])) / clamp_min(sum(rate(http_server_request_duration_seconds_count{service_name="checkout"}[5m])), 0.001)
  - window: 2026-05-10T14:00:00-03:00 → 2026-05-10T16:30:00-03:00
  - filters: {"service_name":"checkout","environment":"prod"}
  - observed: p95 ratio 0.18, baseline 0.005 (same-hour-yesterday) — delta +3500%
  - baseline: same-hour-yesterday p95 ratio = 0.005
- Interpretation: Service returned 5xx coincident with downstream DB latency surge
- Counter-test: If DB p95 stayed flat the cause would be upstream caller; observed DB p95 went 12ms → 850ms at the same minute, refuting the counter
- Next validation: histogram_quantile(0.95, sum by (le, db_system_name)(rate(db_client_operation_duration_seconds_bucket{service_name="checkout"}[5m])))
- Recommendation: Raise checkout-db connection pool ceiling; add traffic-floor burn-rate alert
- Owner: checkout-platform

## Risks And Blind Spots

- No Pyroscope coverage for checkout-svc — CPU regression invisible.
- Tempo spanmetrics_calls_total returned 0 spans for /v2/finalize during the window — exemplar-driven jumps unavailable for that route.

## Recommendations

| # | recommendation | owner | expected impact | validation query | priority |
|---|---|---|---|---|---|
| 1 | Raise checkout-db max_connections 200 → 400 with monitoring | data-platform | Eliminates connection-pool ceiling under campaign-grade traffic | max_over_time(pg_stat_activity_count[1h]) < 350 | high |
| 2 | Add multi-window burn-rate alert on Checkout availability SLO 99.5%/28d | checkout-platform | Page within 5 min of 14.4× burn instead of waiting for fixed-threshold to trip | ALERTS{alertname="CheckoutSLOFastBurn"} | high |
| 3 | Enable Tempo↔Mimir exemplars on checkout HTTP histogram | platform-observability | Click-through from p99 spike to slow trace, no manual trace_id lookup | exemplar dots visible in checkout overview dashboard | medium |

## Appendix — Queries And Evidence

```yaml
forbidden_actions:
  - alerting_manage_rules
  - alerting_manage_routing
  - update_dashboard
  - create_incident
  - add_activity_to_incident
  - shell_*
  - sql_exec
  - restart_*
```

_No findings in this section._
