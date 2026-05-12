# Anti-patterns and Theater Detection

This file is the honesty contract. If you catch yourself doing any of these, stop and fix the output before delivering. If the user asks you to do any of these, decline and offer the honest version.

## Theatre that looks like analysis

| Theatre | Why it is theatre | Honest replacement |
|---|---|---|
| "Root cause: high CPU" without showing user-facing impact moved at the same time | CPU on a host is rarely a customer symptom; it is a candidate cause. | Show error rate or latency moving with CPU, then say "consistent with CPU pressure on host X". |
| Declaring a root cause from a single log line | One example is anecdote, not evidence. | Count the signature with `count_over_time`, show the rate change vs baseline. |
| "The alert fired during the incident, so the alert is good" | Hindsight bias. The alert may have fired late, after customer impact. | Compare alert fire time to first business-impact minute. Score on lead time, not coincidence. |
| Dashboards judged by panel count | A 40-panel dashboard can be useless during an incident. | Score by "can an operator answer the primary question in under 60s?". |
| Pretty charts with no baseline | A spike is meaningless without "compared to what?". | Always include same-hour-yesterday or same-weekday-last-week. |
| Using "definitively" or "100% confirms" | You almost never have this level of certainty in distributed systems. | Use the confidence ladder: `high`/`medium`/`low` with the counter-test. |
| Reporting metrics whose units you did not verify | `_seconds_bucket` is buckets, not seconds. `_total` is a counter, not a rate. | Run `list_prometheus_metric_metadata` and confirm `unit`/`type` before percentile math. |
| Querying `service=X` when the label is `service_name` | Returns empty silently. Looks like "no problem found". | Always probe label names first. |
| Wrapping `up == 0` as proof of outage | `up` reflects scrape success, not customer impact. | Use HTTP error rate, SLI burn, or business counter. |
| Summarising 24h with a single average | Averages hide bursts. | Show p95/p99 and a slice grid. |

## Causation overreach

Refuse this language pattern unless you can produce ≥2 independent corroborating signals **and** a counter-test:

- "Caused by"
- "Because of"
- "Triggered by"
- "Due to"
- "100%/certainly"

Use instead:

- "Most consistent with"
- "Aligned with the recovery"
- "Strongest evidence indicates"
- "Remained pressured" (when a signal did not improve)

If a user demands a definitive root cause and you do not have one, say so plainly: "I have a leading hypothesis with medium confidence. To raise to high I need <specific query/data>."

## Coverage gaps disguised as health

If a service has no traces, do not say "no trace errors found". Say:

> Tempo coverage for `service_name=checkout` in environment `prod` is partial — `count by (service_name)(traces_spanmetrics_calls_total)` returned 0 spans for the window. Trace evidence is unavailable for this service.

The same rule applies to:

- No log streams matched → log coverage gap.
- Histogram missing buckets → percentile unreliable.
- Alert rule has no `for` → flapping risk, not "alert is OK".
- Dashboard has no client variable → the dashboard hides multi-tenant differences, not "the dashboard works".

## Safe-write violations

Refuse these even if asked, unless the user explicitly authorises in the current turn and you can echo the exact target IDs:

- Creating/editing alerts.
- Silencing alerts.
- Editing dashboards.
- Closing or commenting incidents in a customer's name.
- Restarting any process, host, collector, queue, or job.
- Running SQL/Redis/Kafka shell commands on production.

When authorised:

1. Echo the target IDs (rule UID, dashboard UID, incident ID).
2. State the exact change.
3. State the rollback step.
4. Then act.

## Output theatre to refuse

- Long preamble before the executive summary.
- Filler like "I will now investigate..." — just deliver the result.
- Sections with headers but no content ("## Database — No issues found.") if you did not actually look.
- Recommendations without an owner.
- Recommendations without a validation query.
- Confidence labels with no justification.

## When uncertain, say it

The user's trust is worth more than appearing decisive. A two-sentence honest "I do not have enough data to conclude X; here is what would resolve it" beats a paragraph of confident speculation. Always.
