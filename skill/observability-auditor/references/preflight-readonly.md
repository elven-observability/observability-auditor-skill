# Preflight: Read-only and Regulated-environment Gates

Run this before any production investigation. The cost of a single mutating action in someone else's production is much higher than the cost of these four minutes of setup.

## 1. Frame the scope

Confirm or fill in:

```yaml
client: ""               # customer/tenant identifier
grafana_url: ""          # full URL with org if multi-org
org_id: ""               # numeric Grafana org id
timezone: ""             # IANA TZ (e.g. America/Sao_Paulo, UTC)
environments: []         # prod, staging, eu-prod, etc.
services: []             # service_name values, canonical
business_question: ""    # the actual question the user is asking
bad_window:              # absolute, with TZ
  start: ""
  end: ""
good_window:
  start: ""
  end: ""
baseline_windows:        # zero or more
  - label: "same-hour-yesterday"
    start: ""
    end: ""
operation_mode: read_only   # read_only | write_requested | restricted
```

If any of the top six fields is missing, ask before querying. Guessing the timezone is the most common silent bug.

## 2. Pick the operation mode

- **read_only** (default) — discovery, queries, dashboard reads, alert reads, incident reads. No writes.
- **write_requested** — the user explicitly asked for changes (alert/dashboard/annotation/incident edit). You must echo every target ID before acting.
- **restricted** — anything that touches a host shell, a database session, a queue, or a deploy pipeline. Off by default. Even when requested, prefer the MCP equivalent first.

If unsure which mode applies, ask one short question. Do not act on assumption.

## 3. Forbidden actions

Never do these unless the user explicitly authorises in the current turn and you can name the precise effect:

- Restart any host, container, application, or collector.
- Reload, drain, or fail-over a database or cache.
- Mutate production configuration.
- Create, update, silence, or delete an alert rule or notification policy.
- Edit, create, or delete a dashboard.
- Close or comment on an incident in a customer's name.
- Read or echo secrets, tokens, cookies, private keys, customer PII, raw business payloads, full SQL query strings containing PII.

## 4. Redaction rules

- Truncate raw log lines that may include user IDs, emails, phone numbers, payment metadata.
- Replace IPs/emails/tokens with stable hashes (`sha256[:8]`) when you need to count distinct values.
- Quote queries, not values: `{"user_id":"<redacted>"}`.
- Aggregate before showing: counts, rates, percentiles, top-K.

## 5. Pre-flight self-check

Before the first MCP call, you should be able to answer:

- What is the exact business symptom in one sentence?
- Which services and dependencies are likely in the path?
- What is the suspected bad window, recovery window, and one baseline?
- What would "normal" look like for the same app, day, and hour?
- Which labels are trustworthy for this org (probe first if unknown)?
- Which datasource owns each signal (metrics/logs/traces/dashboards/alerts)?

## 6. Evidence levels (mirror of SKILL.md)

- **High**: same signal moves across ≥2 independent telemetry families, with baseline comparison.
- **Medium**: strong single-family evidence or correlated evidence across 2 related signals.
- **Low**: anecdote, raw examples, single spike, missing baseline.

If you would mark something "high" but cannot name the counter-test that would falsify it, downgrade to "medium".

## 7. Regulated environment additions

When the target is regulated (finance, healthcare, gov, PCI, LGPD/GDPR):

- Minimise data collection. Pull aggregates, not raw payloads.
- Treat every read of customer data as auditable — note it in the evidence ledger with the exact query.
- Prefer screenshots/deeplinks over copying raw rows into the report.
- Do not export raw logs to your local filesystem.
- Note "every external action visible to client" in a separate column of the report's appendix.

## 8. Standard context block (paste into the report)

```yaml
client: "<client>"
grafana_url: "<url>"
org_id: "<id>"
timezone: "<tz>"
operation_mode: "read_only"
windows:
  bad: { start: "<ISO>", end: "<ISO>" }
  good: { start: "<ISO>", end: "<ISO>" }
  baselines:
    - { label: "yesterday-same-hour", start: "<ISO>", end: "<ISO>" }
allowed_actions:
  - list_datasources
  - query_prometheus
  - query_loki_logs
  - query_pyroscope
  - search_dashboards
  - list_alert_groups
  - list_incidents
forbidden_actions:
  - restart_*
  - alerting_manage_rules
  - alerting_manage_routing
  - update_dashboard
  - create_incident
  - add_activity_to_incident
  - shell_or_sql_on_host
```

Render this block at the top of every report. The client should see exactly what you did and what you refused to do.
