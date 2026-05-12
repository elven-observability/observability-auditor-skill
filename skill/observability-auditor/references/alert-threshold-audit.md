# Alert Threshold Audit

Use when the user wants to know if their alerts will actually wake up the right person at the right time. The goal is a scored list with keep/tune/delete/split/replace recommendations — not a re-statement of what each alert does.

## Inputs

For every rule, collect via `list_alert_groups` + `get_alert_group`:

- `uid`, `title`, `folder`, `group`.
- `datasource` and full query.
- condition / reducer / threshold (numeric).
- evaluation `interval` and `for`.
- `no_data` and `error` behaviour.
- labels: `severity`, `team`/`owner`, `service_name`, `environment`, `client`/`tenant`, `alert_type` (symptom|cause|telemetry|business).
- annotations: `summary`, `description`, `runbook_url`, `dashboard_url`, `impact`, `suggested_first_action`, `validation_query`.
- firing history if available (from `list_incidents` or alert state APIs).
- linked dashboards and SLOs.

Pass each rule through `scripts/score_alert.mjs` for the rubric — do not re-derive scores by hand.

## Threshold validation method

Never judge a threshold in isolation. For each rule:

1. Query the same expression over `[now-24h]`, `[now-7d]`, `[now-30d]` (where data exists).
2. Compute p50/p90/p95/p99 of the value.
3. Compare against the configured threshold:
   - threshold below p50 → likely too sensitive, will flap.
   - threshold above p99 → likely too loose, will miss real issues.
   - threshold inside p90–p99 band → reasonable, validate further.
4. Compare against same-weekday/same-hour to check for traffic-pattern bias.
5. Compare against known incident windows: did this alert fire? When? How much before customer impact (lead time)?
6. Compare against business volume — a threshold that makes sense at peak traffic may be wrong at midnight.

## Quality scoring rubric (0–5)

| Score | Definition |
|---|---|
| 5 | Symptom-based, actionable, low-noise, owned, has runbook with dashboard link, validates user impact or SLO burn, sane `for`, sane no-data handling, threshold falls in p90–p99 band of recent baseline, lead-time on past incidents > 0. |
| 4 | Actionable and mostly tuned. Minor metadata or query gaps. Threshold slightly off but not dangerously so. |
| 3 | Useful signal but threshold needs tuning, or missing context (no runbook, no dashboard, no validation query). |
| 2 | Noisy, cause-only on a critical user journey, stale, missing owner, weak actionability. |
| 1 | Misleading — likely to page incorrectly or to mask real issues. |
| 0 | Broken: query returns empty, wrong datasource, wrong labels, impossible condition, deprecated metric. |

Every score must include a one-line reason and the cheapest tune action.

## Common anti-patterns (call them out explicitly)

- CPU-only paging on a user-facing service. → Replace with HTTP error rate or SLO burn.
- Disk/memory thresholds without service impact or trend. → Convert to ticket alert with growth-rate check.
- `for: 0m` on a noisy signal. → Add `for: 5m` minimum.
- Alert uses old label, dashboard uses new label. → Align.
- Missing `environment` or `service_name`. → Cannot route or scope. Add.
- Global threshold applied to services with very different baselines. → Per-service threshold or relative-to-baseline rule.
- `no_data` treated as `OK` for a critical telemetry pipeline. → Treat as `Alerting` for collectors and exporters.
- Alert title omits service or environment. → On-call cannot route.
- Duplicate rules with conflicting severities. → Consolidate or split with explicit semantics.
- Cause-only alert on a critical user journey. → Add a symptom alert too, demote the cause to ticket.

## Better alert shapes (recommend these)

- **Page on symptoms:** high error rate, latency SLO burn, request failure, business-flow failure (orders/payments/logins).
- **Ticket on causes:** disk growth, high iowait, DB connection saturation, collector silent.
- **Multi-window burn-rate** for mature SLOs (see slo-best-practices-2026.md).
- **Minimum event volume** to avoid low-traffic false positives — e.g. `AND sum(rate(...)) > 1`.
- **Per-tenant scoping** for multi-tenant services so a single tenant's incident does not silence the page.
- **Dependency context** in app alerts (e.g. "checkout 5xx AND db p95 > X" gives the on-call useful priors).

## Output table

```text
| uid | title | service | env | severity | type | current threshold | observed (p50/p95/p99) | incidents matched | issue | recommendation | priority |
```

Render with `scripts/score_alert.mjs --batch alerts.json` then post-process into the table.

## Safe-write rule

Only create or edit alert rules if the user explicitly authorises and confirms the target UID or folder/group. When you do:

1. Show the new rule body before calling `alerting_manage_rules`.
2. Echo the existing rule body so the diff is visible.
3. State the rollback (delete or restore).
4. After the write, echo the new UID and the deeplink.
