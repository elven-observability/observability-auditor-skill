# Observability Audit — {{client}}

<!-- scripts/render_report.mjs replaces every double-curly placeholder below using
     findings.json (primary) and audit-context.yaml (secondary). Missing values
     surface as "(missing)" so reviewers can spot gaps. Hand-edit only inside
     "### Finding" blocks if you want to keep regeneration safe. -->

## Context

```yaml
client: "{{client}}"
grafana_url: "{{grafana_url}}"
org_id: "{{org_id}}"
timezone: "{{timezone}}"
operation_mode: "{{operation_mode}}"
windows:
  bad: { start: "{{bad_window.start}}", end: "{{bad_window.end}}" }
  good: { start: "{{good_window.start}}", end: "{{good_window.end}}" }
  baselines: {{baseline_windows_inline}}
allowed_actions: {{allowed_actions_count}} actions whitelisted
forbidden_actions: see appendix
```

## Executive Summary

> Between {{bad_window.start}} and {{bad_window.end}} ({{timezone}}), {{business_symptom}}.
> The strongest evidence indicates {{leading_finding}}.
> Recovery aligned most closely with {{recovery_taxonomy}}, while {{residual_risk}} persisted.
> Confidence: **{{leading_confidence}}**.

Top three actions:

1. {{top_action_1}}
2. {{top_action_2}}
3. {{top_action_3}}

## Timeline

| time ({{timezone}}) | business | RPS | p95 (ms) | err % | top log signature | top slow span | DB | infra | external | annotation | interpretation |
|---|---|---|---|---|---|---|---|---|---|---|---|
{{timeline_rows}}

## Service Health

| service | env | RPS Δ | p95 Δ | err% Δ | dep risk | infra risk | summary |
|---|---|---|---|---|---|---|---|
{{service_health_rows}}

## Business Metrics

{{business_metrics_block}}

## Metrics Evidence

{{metrics_findings}}

## Logs Evidence

{{logs_findings}}

## Traces Evidence

{{traces_findings}}

## Infrastructure And Dependencies

{{infra_findings}}

## Alerts And Thresholds

| uid | title | service | env | sev | type | threshold | observed (p50/p95/p99) | lead-time | issue | recommendation | score |
|---|---|---|---|---|---|---|---|---|---|---|---|
{{alert_rows}}

## Dashboards

| uid | dashboard | primary question | score | strengths | gaps | risks | recommended edits |
|---|---|---|---|---|---|---|---|
{{dashboard_rows}}

## Root-Cause Hypotheses

{{root_cause_section}}

## Risks And Blind Spots

{{blind_spots}}

## Recommendations

| # | recommendation | owner | expected impact | validation query | priority |
|---|---|---|---|---|---|
{{recommendation_rows}}

## Appendix — Queries And Evidence

```yaml
forbidden_actions:
{{forbidden_actions_yaml}}
```

{{evidence_appendix}}
