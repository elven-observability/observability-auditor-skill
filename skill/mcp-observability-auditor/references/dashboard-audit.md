# Dashboard Audit

Use to decide whether a dashboard helps an operator answer the operational question quickly, or whether it is decoration. Score, justify, recommend.

## Inputs (per dashboard)

Collect via `search_dashboards`, `get_dashboard_by_uid`, `get_dashboard_summary`, `get_dashboard_panel_queries`:

- `uid`, `title`, `folder`, `tags`.
- datasources used.
- variables and their default values.
- panel list with: type, title, unit, datasource, query, legend, thresholds.
- service/environment/client/tenant variable presence.
- links to alerts, runbooks, logs, traces.
- query cost/cardinality risks (very wide regex, `{}` everywhere, expensive Loki `|=` chains).
- refresh interval (and whether it stresses backends).

Pass the structured dashboard JSON through `scripts/score_dashboard.mjs` for the rubric — do not eyeball the score.

## Quality criteria

A strong dashboard:

- Starts with user impact and service health, not with infra.
- Lets operators filter by client, environment, service, host, route, and dependency where each is relevant.
- Aligns labels with alert rules and traces (so on-call can pivot without renaming).
- Separates overview / app / dependency / infra / business panels clearly.
- Uses correct percentiles, rates, and counts (no `rate` on a gauge, no `histogram_quantile` on a gauge).
- Makes bad-vs-good comparison easy (built-in time-shift or compare-to overlay).
- Links to logs (Loki Explore link with the same labels) and traces (Tempo link by `trace_id` or `service.name`).
- Avoids high-cardinality variables defaulting to "All".
- Has meaningful panel titles and correct units (ms vs s vs bytes vs bytes/s).

## Quality scoring rubric (0–5)

| Score | Definition |
|---|---|
| 5 | Answers the primary operational question (e.g. "is checkout healthy?") in < 60s without leaving the page. Correct variables with sensible defaults. Links to logs/traces/alerts. Sane query cost. Clear business/user impact panel at the top. |
| 4 | Operationally useful. Minor gaps in metadata, links, or panel organisation. |
| 3 | Partially useful but requires manual label changes, extra Explore work, or tribal knowledge. |
| 2 | Noisy, stale, expensive, over-aggregated, or missing key service/environment filters. |
| 1 | Misleading during incidents because labels, units, thresholds, or panels are wrong. |
| 0 | Broken: queries return empty, unusable datasource, wrong tenant, or no relevant data. |

Always show the rubric line that drove the score and a concrete fix.

## Panel review checklist

For each panel:

- [ ] Query returns data for the selected time range.
- [ ] Units are correct and match the metric type.
- [ ] Legend is readable (no `{__name__}` blobs).
- [ ] Thresholds match alert semantics (the colours should mean the same as the alert).
- [ ] Null/no-data behaviour is explicit (`Connected` vs `Null as zero` vs `Null`).
- [ ] Panel does not hide per-instance outliers via excessive aggregation.
- [ ] Panel does not depend on deprecated labels.
- [ ] Panel cost is reasonable (cardinality, range, regex breadth).

## Executive dashboard shape (recommend this)

Top to bottom:

1. **Business outcome** — orders, payments, sign-ups, conversion path. The number an executive cares about.
2. **Traffic** — RPS, top routes.
3. **Errors and latency** — 5xx rate, p95, p99 per route.
4. **Dependency health** — DB, cache, queue, external APIs.
5. **Infrastructure saturation** — CPU, memory, IO per instance.
6. **Recent events** — deploys, restarts, config changes (`get_annotations`).
7. **Alert state and current risks** — fires + warnings.

## Output table

```text
| uid | dashboard | score | primary question | strengths | gaps | query risks | recommended edits | priority |
```

Render the table from `scripts/score_dashboard.mjs --batch`.

## Common bad-dashboard signatures

- "All" defaults that hit every tenant with high-cardinality queries.
- p95 panels using `quantile()` on a gauge.
- `_total` plotted directly (counter values are meaningless; plot `rate()`).
- Mixed units in one stacked panel (ms next to s).
- Threshold colours inverted (red below the threshold for an availability metric).
- Loki panels with `{}` selector and a tail filter — expensive and rarely useful.
- 40 panels with no anchor at the top — operators get lost.

Call these out by panel name in the report.
