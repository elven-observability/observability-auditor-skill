# Report Template

Use this for client-facing outputs. Two layers, always in this order: executive on top, technical evidence below. The structural skeleton lives in `assets/templates/audit-report.md`; this file is the language guide.

## Executive summary (one page)

Open with a single block:

```text
Between <start> and <end> (<timezone>), <one-line business symptom>.
The strongest evidence indicates <main finding>.
The recovery/degradation aligns most closely with <change>, while <remaining issue> persisted.
Confidence: <high|medium|low>.
```

Then three bullets max:

- What happened.
- What we changed our understanding about during the audit.
- The single most important thing to do next.

No code, no PromQL, no dashboard JSON on this page. An executive must be able to forward it as-is.

## One-page structure (when the user asks for a brief)

1. Business impact.
2. What changed.
3. What improved.
4. What remained risky.
5. What we recommend now.

## Full report structure

```markdown
# Observability Audit — <client/org>

## Context
<standard context block from preflight, including operation_mode and forbidden_actions>

## Executive Summary

## Timeline
<table from references/incident-timeline.md>

## Service Health
<per-service summary, scored>

## Business Metrics
<domain counters with comparators>

## Metrics Evidence
<grouped by signal family>

## Logs Evidence
<signature top-K, with redacted samples>

## Traces Evidence
<slow / error traces, with deeplinks>

## Infrastructure And Dependencies
<saturation per-instance, DB/cache/queue health>

## Alerts And Thresholds
<scored table; see references/alert-threshold-audit.md>

## Dashboards
<scored table; see references/dashboard-audit.md>

## Root-Cause Hypotheses
<leading + alternates with counter-tests>

## Risks And Blind Spots
<coverage gaps, label drift, missing telemetry>

## Recommendations
<each with owner, expected impact, validation query, priority>

## Appendix: Queries And Evidence
<every datasource/tool/query/window>
```

## Finding format

Each finding inside the technical layer follows this exact shape:

```markdown
### <Finding title>

- Severity: critical|high|medium|low
- Confidence: high|medium|low
- Impact: <customer/business impact, with magnitude>
- Evidence:
  - datasource: <name>
  - tool/query: <PromQL/LogQL/TraceQL/MCP call>
  - window: <start–end, TZ>
  - filters: <label set>
  - observed: <value>
  - baseline: <value, label>
- Interpretation: <what it means>
- Counter-test: <what would falsify this>
- Next validation: <cheapest query/check>
- Recommendation: <safe next step>
- Owner: <team or person>
```

## Language rules

Use:

- "Evidence indicates ..."
- "Aligned with the recovery ..."
- "Remained pressured ..."
- "Inconsistent with ..."
- "Insufficient telemetry to determine ..."

Avoid:

- "Caused by"
- "Definitively"
- "100%"
- "Normal" without a baseline
- Blaming a team or vendor without a citable observation
- Recommendations without an owner

Explain uncertainty before the client asks. A two-sentence "leading hypothesis with medium confidence; this is what would resolve it" earns trust. An overconfident wrong answer destroys it.

## Reproducibility

The appendix must let a different engineer reproduce every claim:

- Exact tool name and arguments (or PromQL/LogQL/TraceQL text).
- Datasource name.
- Absolute window with timezone.
- Label filters.
- Observed values.

Include Grafana deeplinks (`generate_deeplink`) wherever a panel image was used.
