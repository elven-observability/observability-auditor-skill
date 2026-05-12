# Prompt Library

Use these as Codex/Claude prompts or feed them through `mcp-observability-auditor prompt <id>` to substitute placeholders. They mirror the operating loop in SKILL.md.

Each prompt assumes the agent already has access to the skill and its references. The prompts are deliberately compact — they invoke the skill rather than re-stating it.

## master

You are running the `mcp-observability-auditor` skill on a real production environment. Use MCP discovery first. Treat the audit as read-only unless the user explicitly authorises a write. Be honest about gaps. Cite every claim with the seven evidence fields.

Context:

```yaml
grafana_url: "[GRAFANA_URL]"
org_id: "[ORG_ID]"
client: "[CLIENT]"
timezone: "[TIMEZONE]"
environments: "[ENVIRONMENTS]"
services: "[SERVICES]"
time_window: "[TIME_WINDOW]"
business_question: "[BUSINESS_QUESTION]"
operation_mode: "read_only"
```

Deliver:

1. Standard context block (echoed).
2. Telemetry coverage matrix (`references/org-discovery.md`).
3. Per-service health summary (`references/app-deep-dive.md`).
4. Incident or trend timeline if a bad window was given (`references/incident-timeline.md`).
5. Alert audit table with scores (`references/alert-threshold-audit.md`).
6. Dashboard audit table with scores (`references/dashboard-audit.md`).
7. Two-layer report following `references/report-template.md`: executive first, technical after.
8. Reproducible appendix.

Stop conditions are in SKILL.md.

## org-audit

Audit `[CLIENT_OR_ORG]` for observability maturity.

Discover datasources, canonical label model, services by environment, dashboards by purpose, alert rules by service/severity/team, recent incidents, ownership. Identify blind spots, stale telemetry, broken or expensive dashboard queries, alert thresholds that do not match baselines.

Output:

- coverage matrix;
- top label inconsistencies;
- top blind spots;
- top 5 dashboards worth using (scored);
- top 10 alerts worth trusting (scored);
- prioritised remediation plan with owner and validation query.

Read-only.

## app-deep-dive

Analyze `[SERVICE_NAME]` in `[ENVIRONMENT]` from `[START]` to `[END]` in `[TIMEZONE]`.

Compare against `[BASELINE_WINDOW]`. Walk the signal stack in order (traffic → errors → latency → saturation → dependencies → deploy events → business counters). Build the correlation grid from `references/app-deep-dive.md`. For each finding state mechanism, counter-test, confidence, validation query, recommended safe action.

Stop at high-confidence finding with falsifying counter-test, or at a clearly-documented medium-confidence hypothesis with concrete next steps.

## incident-timeline

Build an incident timeline for `[CLIENT]`.

```yaml
bad_window: "[BAD_WINDOW]"
good_window: "[GOOD_WINDOW]"
timezone: "[TIMEZONE]"
business_symptom: "[BUSINESS_SYMPTOM]"
```

Normalise the windows. Build the slice grid. Pull metrics, logs (signature top-K), traces (slow + error), infra saturation, dependency health, business counters, annotations.

Tag recovery using the taxonomy in `references/incident-timeline.md`. Identify which signals moved with degradation, which moved with recovery, which stayed flat. Produce the standard timeline table, the three strongest evidence points, the leading root-cause chain with confidence, residual risks, and reproducible appendix.

## alert-threshold-audit

Audit alert rules for `[CLIENT_OR_ORG]`.

For each rule: inspect query, datasource, condition, threshold, evaluation interval and `for`, no-data/error handling, labels, annotations, severity, ownership, runbook, firing history if available.

Validate each threshold against 24h, 7d, 30d, same-hour baseline, and known incidents. Score 0–5 with the rubric in `references/alert-threshold-audit.md` and recommend keep/tune/delete/split/replace with the exact change.

Read-only. Do not modify alerts unless explicitly authorised.

## dashboard-audit

Audit dashboards for `[CLIENT_OR_ORG]`.

For each dashboard inspect: variables, label consistency, panels, query cost, units, threshold colours, links to logs/traces/alerts, usability during a real incident.

Score 0–5 with the rubric in `references/dashboard-audit.md`. Recommend concrete edits with priority. Do not modify dashboards unless explicitly authorised.

## executive-report

Produce a client-facing executive report for `[CLIENT]` covering `[TIME_WINDOW]`.

Use the two-layer structure from `references/report-template.md`:

1. Executive layer (one page) — what happened, strongest evidence, recovery and residuals, top three recommendations with owner and impact.
2. Technical layer — timeline table, scored alerts/dashboards if requested, evidence ledger, full query appendix.

Use careful language (see `references/anti-patterns.md` for what to refuse). Confidence labels follow the ladder in SKILL.md. Every recommendation has an owner, an expected impact, and a validation query.
