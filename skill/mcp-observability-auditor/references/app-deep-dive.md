# Application Deep Dive

Use this when one service is the focus. The goal is to explain what the service is doing, what is hurting users (or proving it is not), and which dependencies are involved — with evidence.

## Scope block

Fill before querying:

```yaml
service_name: ""
environment: ""
time_window: { start: "", end: "", tz: "" }
comparison_window: { label: "", start: "", end: "" }   # e.g. yesterday-same-hour
business_flow: ""        # e.g. "checkout v2", "payment authorisation", "search"
known_dependencies: []   # services, DBs, queues, external APIs
deploy_window_known: ""  # if a deploy happened, when
```

Without a comparison window, almost no conclusion is meaningful. Pick one before querying.

## Signal order

Walk these in order. Each step must produce a number with a comparator.

1. **Traffic.** RPS, request count, route mix, method mix.
   - PromQL: `sum by (service_name) (rate(http_server_request_duration_seconds_count{service_name="X", environment="prod"}[5m]))`.
2. **Errors.** 5xx rate, 4xx rate (if business-meaningful), exception/fatal log count, span error rate.
   - Compare absolute count and ratio. Both matter — a 1% error rate is fine at 10 rps and catastrophic at 10k rps.
3. **Latency.** p50/p90/p95/p99 overall, then by route. Use `query_prometheus_histogram` or `histogram_quantile`.
   - Verify bucket coverage with `list_prometheus_label_values le ...` — missing buckets distort percentiles.
4. **Saturation.** Per-host/per-pod: CPU, load-per-core, memory available, swap, disk busy, iowait, file descriptors, threads.
   - Always per-instance — averages hide one bad pod.
5. **Dependencies.** Database (connections, slow queries, locks), cache (latency, evictions, fragmentation), queues (depth, age, retries, DLQ), external APIs (success rate, latency).
6. **Deploy/restart/config events.** `get_annotations` for the window; logs filtered by collector restart or process start signatures.
7. **Business telemetry.** Domain counters — orders, payments, reservations, sign-ups, logins, conversions. These are the truth that customer impact actually moved.

For each step, capture: value, comparator, delta, interpretation, confidence. If a step returns nothing, mark it `blind` and note the gap.

## Correlation grid

Build this once data is collected:

| time slice | rps | p95 (ms) | 5xx/s | error % | top log signature | top slow span | DB p95 | cache p95 | queue lag | infra peak | biz counter | interpretation |

Slice grids:

- 5m for fast incidents (≤2h windows).
- 15m for app/dependency comparison (2–8h).
- 1h for executive narratives (≥1d).
- Always overlay deploy/restart annotations on the time axis.

## Pattern catalogue (with worked examples)

Use the catalogue to interpret the grid. Always state which evidence supports the chosen pattern.

| Pattern | Looks like | What it suggests | Cheapest falsification |
|---|---|---|---|
| Volume-only spike | RPS up, errors flat, p95 flat | Capacity held. Not an incident. | Check downstream saturation didn't hide. |
| Silent throttling | Low RPS, high errors, log says "rate limited" | Upstream caller or upstream LB rejecting. | Compare LB/gateway error rate. |
| Slow dependency | High p95/p99 with low 5xx | Wait, lock, slow downstream. | Look at top slow span — is it `db.query` or `http.client`? |
| Retry storm | High log volume without 5xx, p95 fine | Catch-and-continue loop, often invisible to users. | Find the retry signature; count attempts vs success. |
| Capacity-only risk | Infra peaks without user-facing change | Latent risk, not impact. | Show error/latency flat at the same minute. |
| Recovery without root-fix | App improved, infra still pressured | Workload moved or downstream cleared, infra problem remains. | Track infra past the recovery marker. |
| Cardinality blow-up | Suddenly missing series or query timeout | Label exploded. | `count by (__name__)(group by (__name__) (...))`. |

## Trace review

When traces are available, answer:

- Which operation/route dominates total latency? (`sum by (op)(span_duration_seconds_sum) / sum by (op)(span_duration_seconds_count)`).
- Which span is slow: app code, DB, cache, queue, HTTP client, external API?
- Are errors propagated or swallowed by handlers?
- Did error rate change by route or by dependency?
- Do trace labels (`service.name`, `http.route`) match the metric label set?

`find_slow_requests` (Sift) is the fastest seed. From a slow trace, pivot to its log stream via `trace_id`.

## Finding format (per problem)

```text
Finding: <one-line title>
Impact: <customer/business effect, with magnitude>
Evidence:
  - <datasource> | <tool/query> | <window> | observed=<X>, baseline=<Y>, delta=<+Z%>
  - ...
Why this is likely: <mechanism>
Why this might be wrong: <counter-test or competing hypothesis>
Confidence: <high|medium|low>
Next validation: <cheapest query/check>
Recommended action: <safe step with owner>
```

If you cannot fill `Why this might be wrong`, downgrade confidence.

## Stop conditions for a deep-dive

Stop when one of:

- You have a high-confidence finding with two independent corroborating signals and a falsifying counter-test that you ran.
- You have a medium-confidence leading hypothesis and have listed the exact next-step queries that would resolve it.
- The data needed does not exist in this org — say so and stop.

Do not keep digging out of momentum. The user values an honest medium-confidence answer with clear next steps over a low-confidence essay.
