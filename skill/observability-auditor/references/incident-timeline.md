# Incident Timeline

Use when the user asks "what happened" or "what changed" between a bad window and a recovery window. The deliverable is a defensible narrative anchored on a slice-by-slice table, not a guess sandwich.

## Window normalisation (do this first)

For every input window, produce:

- `tz` — IANA timezone.
- `start` / `end` — absolute ISO timestamps in that timezone.
- `start_utc` / `end_utc` — UTC equivalents (queries usually want UTC).
- `duration_minutes` — derived.

Three windows minimum:

1. `bad_window` — when the symptom was visible.
2. `good_window` — after recovery, similar duration.
3. `baseline_window` — same-hour-yesterday or same-weekday-last-week, same duration.

Use `scripts/window_math.mjs` to compute these — it avoids the common timezone-off-by-one bug.

## Slice grid

Pick slice size from window length:

| Window length | Slice size |
|---|---|
| ≤ 1h | 1–2 minutes |
| 1h–4h | 5 minutes |
| 4h–24h | 15 minutes |
| > 24h | 1 hour |

Anchor the grid on absolute timestamps (not "5m before recovery") so the report is reproducible.

## Comparison method

1. Build the top-level chart family for the affected services: RPS, error rate, p95, p99.
2. Get annotations: `get_annotations` for the full bad+good window plus 1h pad on each side.
3. Pull logs by level and signature in both windows; diff signature top-K.
4. Find slow/error traces in both windows; diff top routes and top dependencies.
5. Pull infra saturation per-instance.
6. Pull dependency health (DB/cache/queue/external).
7. Pull business counters.
8. List every event that appears/disappears at degradation start or recovery start.

After the data is collected, classify each signal:

- **moved-with-symptom and moved-with-recovery** → strong correlation.
- **moved-with-symptom but not with-recovery** → contributing factor or downstream still pressured.
- **moved-with-recovery but not with-symptom onset** → likely the trigger of recovery, not the cause of degradation.
- **flat throughout** → likely irrelevant — note as ruled-out.

## Questions to answer (every report)

- What was the customer-visible symptom?
- When did the symptom start? (first business-minute, not first alert)
- What changed at that moment? (signals that moved)
- What did not change? (signals that stayed flat — important for ruling out hypotheses)
- When did the symptom recover?
- What changed at recovery?
- What did not recover? (residual risk)
- Was recovery caused by: lower load, fewer errors, faster dependency, restart/deploy, DB relief, queue drain, external recovery, mitigation action?
- What is the leading hypothesis and what is its counter-test?
- Which missing telemetry prevents higher confidence?

## Timeline table

Use this exact column set. Time is local, in the operation timezone. UTC mirror at end of the report.

| time (local) | business signal | app RPS | app p95 | app err% | top log signature | top slow span | DB pressure | infra peak | external dep | annotation | interpretation |

Make the interpretation cell terse — a phrase, not a paragraph. The narrative paragraph belongs in the executive summary.

## Executive language

Use:

- "The strongest evidence indicates ..."
- "Aligned with the recovery at <time> ..."
- "Remained pressured through recovery ..."
- "Inconsistent with the leading hypothesis: <signal stayed flat> ..."
- "Insufficient telemetry to determine ..."

Avoid:

- "Caused by"
- "Definitively"
- "100% confirms"
- "Likely" with no evidence chain
- Blaming a team or vendor without a citable observation

## Recovery taxonomy

Tag the recovery with one of:

- `traffic-drop` — load fell, app caught up.
- `dependency-relief` — DB/cache/queue/external recovered first.
- `app-restart` — process churn cleared state.
- `deploy-or-rollback` — code/config change.
- `mitigation-action` — manual rate-limit, feature flag, scale-up.
- `unknown` — none of the above match the evidence.

`unknown` is honest. `traffic-drop` masquerading as `mitigation` is theatre.

## Output checklist

- [ ] One-paragraph executive summary.
- [ ] Standard context block (from preflight).
- [ ] Timeline table with the exact columns above.
- [ ] Top three evidence points with full citation.
- [ ] Plausible root-cause chain with confidence ladder.
- [ ] Recovery taxonomy tag.
- [ ] Residual risks (what did not recover).
- [ ] Concrete next actions with owner and validation query.
- [ ] Coverage gaps explicitly listed.
- [ ] Reproducible appendix: every query, every window.
