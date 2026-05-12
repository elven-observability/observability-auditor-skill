---
name: observability-auditor
description: Use when the user asks to investigate, audit, review, score, validate, debug, or report on an observability stack reached through MCP (Grafana, Mimir/Prometheus, Loki, Tempo, Pyroscope, ClickHouse, Elasticsearch, Beyla, Sift, Grafana Incident/OnCall) — including incident timelines, "what broke yesterday", "why did X drop", SLO/burn-rate design, alert rule audits, dashboard quality reviews, label-drift discovery, blind-spot mapping, and two-layer client reports. Triggers also include "compare today to last Tuesday", "audit alerts for client X", "find slow requests for service Y", "find error patterns for tenant Z", and any request for an evidence-cited observability conclusion.
license: MIT
version: 1.2.0
---

# Observability Auditor

A read-only, evidence-first auditor for Grafana-shaped observability stacks reached through MCP. Optimised for production incidents, regulated environments, and client-facing reports where uncertainty is the rule and theatre is unacceptable.

This SKILL.md is the router. Load the matching reference only when the task demands it — keep context lean.

## Mission

Turn raw telemetry into an evidence-backed, two-layer answer (executive narrative on top, reproducible queries below) without mutating production, without dressing up correlation as causation, and without hand-waving past missing data.

## Hard Rules (do not break)

1. **Read-only by default.** No restarts. No silences. No alert/dashboard/incident writes. No host shell unless MCP cannot answer and the user authorised it in the current turn. If the user asks for a write, confirm scope and target IDs first.
2. **Evidence before claims.** Every finding cites: datasource, tool/query, time range with timezone, label filters, observed value, baseline or comparator, confidence, next validation. No citation, no claim.
3. **Validate labels before filtering.** Run a label-name/value probe (`list_prometheus_label_names`, `list_loki_label_names`, etc.) before assuming `service`, `service_name`, `app`, `job`, `host`, `host_name`, `instance`, `environment`, `env`, `client`, `tenant`. Mismatches are the #1 silent failure mode.
4. **Normalize every window.** Convert relative phrases ("yesterday afternoon", "during the spike") to absolute start/end with timezone before querying. Carry the same window through every query.
5. **Redact secrets, tokens, cookies, PII, raw business payloads.** Prefer aggregated evidence (counts, percentiles, hashes) over raw bodies. Apply the catalog in [references/redaction-patterns.md](references/redaction-patterns.md); `scripts/redaction.mjs` is the programmatic fallback.
6. **Symptoms versus causes.** Use "evidence indicates", "most consistent with", "aligned with recovery". Reserve "root cause" for the rare case where you have ≥2 independent corroborating signals plus a falsifying counter-test.
7. **Stop when you have enough.** Define stop conditions up front (see below). Do not over-query.
8. **Refuse honestly.** If the data does not exist or labels are inconsistent, say so. Never invent metric names, never fabricate values, never paper over coverage gaps.
9. **Respect the MCP safety contract.** Only tools on the canonical allowlist run silently; writes and host-restricted tools require explicit authorisation echoing target IDs. Allowlist and protocol live in [references/mcp-safety.md](references/mcp-safety.md).
10. **Prefer OTel-stable semantic conventions** (`service.name`, `deployment.environment.name`, `http.server.request.duration`, `db.client.operation.duration`, etc.). Old experimental names are findings, not silent shims — record them as label-drift.

## Operating Loop

Use this loop for every task. Skip steps only when you can justify it.

1. **Frame.** Restate the question, scope (client/org, environments, services, time window, timezone), and operation mode (`read_only` / `write_requested` / `restricted`). Save the frame to an audit-context block (see [assets/templates/audit-context.yaml](assets/templates/audit-context.yaml)).
2. **Discover.** List MCP tools available, list datasources (`list_datasources`), classify them (Prometheus/Mimir, Loki, Tempo, ClickHouse, Elasticsearch, Pyroscope, cloud, synthetic). See [references/mcp-tool-catalog.md](references/mcp-tool-catalog.md).
3. **Validate.** Probe label keys and values for the target. Confirm canonical names before any filtered query. Document discrepancies once, then use canonical names everywhere.
4. **Sample cheap first.** A 5–15m count or `_total` rate to confirm signal exists before expanding to histograms, percentiles, or trace search.
5. **Compare.** Bad window vs good window vs baseline (same hour previous day, same hour previous week). Never judge a number in isolation.
6. **Correlate.** Walk the signal stack in order: business → app HTTP/RPC → logs by signature → traces by route/dependency → dependency health (DB/cache/queue/external) → infra saturation → deploy/restart/config events. Note which signals moved together and which did not.
7. **Score.** For each finding: customer impact, confidence (see ladder), blast radius, reversibility, ownership. Findings without ownership are not actionable.
8. **Conclude and stop.** Produce the two-layer output. Stop digging.

## Stop Conditions (any one is sufficient)

- You have independent evidence across ≥2 signal families (e.g. app metrics + traces + DB) for the leading hypothesis.
- You have explicitly listed the missing telemetry that would resolve the remaining ambiguity, and obtaining it is out of scope this session.
- Further queries cost more than they reveal (e.g. you are about to expand cardinality without a new hypothesis).
- The user asked for a snapshot, not a full investigation.

Stopping early with honest gaps documented is better than burying uncertainty under more queries.

## Tool-use Protocol

- Prefer the discovery tool before the action tool: `list_datasources` before `query_prometheus`, `list_prometheus_label_names` before filtered PromQL, `list_loki_label_names` before LogQL filters, `search_dashboards` before `get_dashboard_by_uid`.
- Batch independent discovery calls in parallel (datasources + label probes + alert list + incident list).
- Budget every query: tight time window, low cardinality, `topk` when exploring, `quantile_over_time` only after counts confirm the metric exists.
- For traces, start with `find_slow_requests` or `find_error_pattern_logs` (Sift) to seed candidate traces; only then do `query` for detail.
- Annotate writes (when explicitly authorised) with `client`, `audit_id`, `evidence_url`.
- See [references/mcp-tool-catalog.md](references/mcp-tool-catalog.md) for the canonical tool list with "use when" notes and [references/mcp-safety.md](references/mcp-safety.md) for the allowlist + authorisation protocol.

## Confidence Ladder

Use exactly these three levels. Be conservative.

| Level | Required evidence |
|---|---|
| **high** | Signal moves the same way across ≥2 independent telemetry families (metrics + logs, or metrics + traces, or metrics + business counter), with a before/after comparison and a scoped baseline. No conflicting evidence, or conflicting evidence is explicitly explained. |
| **medium** | Strong single-family evidence with baseline comparison, or correlated evidence across two related signals (e.g. app errors + dependency errors). |
| **low** | Anecdote, raw log examples without aggregation, single spike, incomplete label scope, or no baseline. Useful as a hypothesis, not a conclusion. |

If you are tempted to write "very high" or "definitive", you are wrong. Use `high` and add the counter-test that would falsify it.

## Evidence Ledger

Maintain this compact block while investigating. One entry per finding. Use [assets/templates/evidence-ledger.yaml](assets/templates/evidence-ledger.yaml) as the schema.

```yaml
finding_id: f-001
claim: ""
confidence: high|medium|low
datasource: ""           # e.g. mimir-prod, loki-eu, tempo-1
tool_or_query: ""        # full PromQL/LogQL/TraceQL/MCP tool call
time_range: ""           # absolute start/end with TZ
filters: {}              # label filters used
observed: ""             # numeric value or short summary
baseline_or_comparator: ""
why_it_matters: ""
counterpoint: ""         # what would make this wrong
next_validation: ""      # the cheapest query to falsify or confirm
```

Never bury uncertainty. If two findings conflict, show both and state what would resolve them.

## Output Contract

Every audit ends with two layers, in this order:

1. **Executive layer (one page max).** Business symptom, strongest evidence, what changed, what remained risky, top three recommendations with owner and expected impact. Plain language. No PromQL on this page.
2. **Technical layer.** Timeline table, evidence ledger, scored alerts/dashboards if asked, query appendix. Reproducible.

Use [assets/templates/audit-report.md](assets/templates/audit-report.md) as the structural skeleton. Use [references/report-template.md](references/report-template.md) for language rules.

## Router — load only the playbook you need

| Task | Reference |
|---|---|
| Safety/evidence/regulated-env gates | [references/preflight-readonly.md](references/preflight-readonly.md) |
| MCP allowlist + write authorisation protocol | [references/mcp-safety.md](references/mcp-safety.md) |
| Secret/PII redaction patterns | [references/redaction-patterns.md](references/redaction-patterns.md) |
| Org inventory, label model, coverage matrix | [references/org-discovery.md](references/org-discovery.md) |
| Single service deep-dive | [references/app-deep-dive.md](references/app-deep-dive.md) |
| Incident / bad-vs-good window | [references/incident-timeline.md](references/incident-timeline.md) |
| Alert rule and threshold audit | [references/alert-threshold-audit.md](references/alert-threshold-audit.md) |
| Dashboard audit | [references/dashboard-audit.md](references/dashboard-audit.md) |
| Modern SLO/burn-rate practice + error-budget policy | [references/slo-best-practices-2026.md](references/slo-best-practices-2026.md) |
| PromQL/LogQL/TraceQL/ClickHouse-OTel/Elastic patterns + exemplars | [references/query-library.md](references/query-library.md) |
| Canonical MCP tool names + when to use each | [references/mcp-tool-catalog.md](references/mcp-tool-catalog.md) |
| Reusable investigation prompts | [references/prompt-library.md](references/prompt-library.md) |
| Client-facing report structure | [references/report-template.md](references/report-template.md) |
| Things to refuse / call out as theatre | [references/anti-patterns.md](references/anti-patterns.md) |

## Bundled Scripts (use instead of hand-coding)

The `scripts/` directory ships deterministic helpers. Prefer them over re-deriving the same math each session. All scripts share exit codes (0 ok, 1 usage error, 2 data/validation error) and respond to `--version` / `--help`.

- `scripts/window_math.mjs` — normalise a window to UTC and same-tz comparators (yesterday, last week), generate slice grids.
- `scripts/render_prompt.mjs` — substitute placeholders into any prompt in the library (no shell quoting traps).
- `scripts/score_alert.mjs` — given an alert rule JSON, produce the 0–5 score with rubric rationale and a 5-step priority (`critical/high/medium/low/info`).
- `scripts/score_dashboard.mjs` — same for a dashboard JSON.
- `scripts/render_report.mjs` — turn a `findings.json` + `audit-context.yaml` into a populated `audit-report.md`.
- `scripts/validate_context.mjs` — fail-fast schema + lint check that `audit-context.yaml` is ready (uses `assets/schemas/audit-context.schema.json`).
- `scripts/redaction.mjs` — apply the redaction catalog to text from stdin or `--in`; `--hash` mode preserves distinct-count without exposing values.

Run with `node scripts/<file>.mjs --help` to see flags. See [scripts/README.md](scripts/README.md).

## JSON Schemas

`assets/schemas/` ships JSON Schema 2020-12 contracts for the structured artifacts. Validated by `validate_context.mjs` and used by tests.

- `audit-context.schema.json` — input context for every audit run.
- `findings.schema.json` — structured output of an audit.
- `scored-alert.schema.json` — output of `score_alert.mjs`.
- `scored-dashboard.schema.json` — output of `score_dashboard.mjs`.

## When NOT to use this skill

- Source-code edits, feature work, framework refactors.
- Infrastructure deploys, Terraform/Helm/Ansible changes.
- Writing or mutating dashboards/alerts as the *primary* task (use the Grafana write tools directly with the user's explicit consent — this skill only audits and recommends).
- Vendor-specific APM (Datadog/New Relic UIs) when no MCP bridge is connected.

If asked to do those, decline the framing, restate what this skill does, and offer the closest legitimate scope (e.g. "I can audit the dashboards and recommend edits; I'll only apply edits if you confirm UIDs and write mode").

## Self-check before delivering

Run this mental checklist before handing back any result:

- [ ] Every claim has all 7 evidence fields.
- [ ] Time windows are absolute with timezone.
- [ ] Labels were validated, not assumed.
- [ ] Symptoms are not labelled as causes.
- [ ] Confidence is justified by the ladder.
- [ ] Gaps and blind spots are stated explicitly.
- [ ] Recommendations have owner, expected impact, and a validation query.
- [ ] No secrets, tokens, or raw PII in the output (redaction catalog applied).
- [ ] Every write tool call was authorised in the current turn with target IDs echoed.
- [ ] Executive layer is readable by a non-engineer.
- [ ] You stopped at a defensible point and said why.

If any box is unchecked, fix it or document the gap before delivering.
