# Query Library

Patterns, not ground truth. Validate datasource names, label names, metric names, and units in the target org before using any of these. The placeholders below are substituted by `scripts/render_prompt.mjs` or by hand.

## Placeholders

```text
$CLIENT              # tenant/client label value
$ENVIRONMENT         # environment label value (regex OK)
$SERVICE_REGEX       # service_name regex
$NAMESPACE           # service_namespace value (OTel service.namespace)
$HOST_REGEX          # host_name regex
$ROUTE_REGEX         # http.route or http_route regex
$WINDOW              # PromQL/LogQL duration, e.g. 5m, 1h
$TEXT                # free-text log search
$BUSINESS_REGEX      # business-event regex (e.g. "checkout_completed")
$LE                  # bucket boundary for histogram_quantile (rarely needed)
```

Always anchor regexes (`^`, `$`) when the label set is small and known.

## OTel semconv quick-reference (stable in 2025–2026)

Old `experimental` names still exist in many orgs. When you find both, treat as label-drift.

| Concept | Old / experimental | Stable (semconv ≥1.27) |
|---|---|---|
| Service identity | `service` | `service.name` (`service_name`) |
| Service grouping | — | `service.namespace` (`service_namespace`) |
| Deployment env | `deployment.environment` | `deployment.environment.name` (`environment`) |
| HTTP server latency | `http_request_duration_seconds_*` | `http.server.request.duration` (`http_server_request_duration_seconds_*`) |
| HTTP method | `http_method` | `http.request.method` (`http_request_method`) |
| HTTP status | `http_status_code` | `http.response.status_code` (`http_response_status_code`) |
| HTTP route | `http_target` | `http.route` (`http_route`) |
| HTTP client latency | `http_client_duration_*` | `http.client.request.duration` (`http_client_request_duration_seconds_*`) |
| RPC server latency | `rpc_duration_*` | `rpc.server.duration` (`rpc_server_duration_seconds_*`) |
| DB call latency | `db_client_duration_*` | `db.client.operation.duration` (`db_client_operation_duration_seconds_*`) |
| Cluster | `cluster` | `k8s.cluster.name` (`k8s_cluster_name`) |

## HTTP / RPC metrics (OTel-style)

Requests per second per service:

```promql
sum by (service_name) (
  rate(http_server_request_duration_seconds_count{
    client="$CLIENT",
    environment=~"$ENVIRONMENT",
    service_name=~"$SERVICE_REGEX"
  }[$WINDOW])
)
```

P95 latency:

```promql
histogram_quantile(
  0.95,
  sum by (le, service_name) (
    rate(http_server_request_duration_seconds_bucket{
      client="$CLIENT",
      environment=~"$ENVIRONMENT",
      service_name=~"$SERVICE_REGEX"
    }[$WINDOW])
  )
)
```

5xx error rate:

```promql
sum by (service_name) (
  rate(http_server_request_duration_seconds_count{
    client="$CLIENT",
    environment=~"$ENVIRONMENT",
    service_name=~"$SERVICE_REGEX",
    http_response_status_code=~"5.."
  }[$WINDOW])
)
```

Error ratio (defensive divide):

```promql
(
  sum by (service_name) (rate(http_server_request_duration_seconds_count{
    client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX", http_response_status_code=~"5.."
  }[$WINDOW]))
)
/
clamp_min(
  sum by (service_name) (rate(http_server_request_duration_seconds_count{
    client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX"
  }[$WINDOW])),
  0.001
)
```

Top slow routes:

```promql
topk(10,
  histogram_quantile(0.95,
    sum by (le, http_route, service_name) (
      rate(http_server_request_duration_seconds_bucket{
        client="$CLIENT", service_name=~"$SERVICE_REGEX", environment=~"$ENVIRONMENT"
      }[$WINDOW])
    )
  )
)
```

## HTTP client (outgoing calls — dependency health)

p95 client-side latency to downstreams (often the symptom of a slow dependency):

```promql
histogram_quantile(0.95,
  sum by (le, service_name, server_address) (
    rate(http_client_request_duration_seconds_bucket{
      client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX"
    }[$WINDOW])
  )
)
```

Client error rate by target:

```promql
sum by (service_name, server_address) (
  rate(http_client_request_duration_seconds_count{
    client="$CLIENT", environment=~"$ENVIRONMENT",
    service_name=~"$SERVICE_REGEX",
    http_response_status_code=~"5.."
  }[$WINDOW])
)
```

## DB calls (OTel `db.client.operation.duration`)

p95 DB operation duration by system and operation:

```promql
histogram_quantile(0.95,
  sum by (le, db_system_name, db_operation_name, service_name) (
    rate(db_client_operation_duration_seconds_bucket{
      client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX"
    }[$WINDOW])
  )
)
```

DB errors:

```promql
sum by (db_system_name, db_operation_name, service_name) (
  rate(db_client_operation_duration_seconds_count{
    client="$CLIENT", environment=~"$ENVIRONMENT",
    service_name=~"$SERVICE_REGEX",
    error_type!=""
  }[$WINDOW])
)
```

## Exemplars (metric ↔ trace jump)

Make sure the histogram emits exemplars. Then the same `histogram_quantile` query renders clickable dots in Grafana that open the slow trace directly.

```promql
histogram_quantile(0.99,
  sum by (le, service_name) (
    rate(http_server_request_duration_seconds_bucket{
      client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX"
    }[$WINDOW])
  )
)
```

When the panel is configured (Tempo datasource + "Show exemplars"), one click goes from spike → trace_id → trace view, no manual log search. If exemplars are absent, recommend enabling them as a remediation rather than working around manually.

## Spanmetrics (Tempo-derived service metrics)

When Tempo + spanmetrics is enabled, you get cross-service RPS/errors/latency without app-side instrumentation:

```promql
sum by (service_name, span_kind) (
  rate(traces_spanmetrics_calls_total{
    client="$CLIENT", environment=~"$ENVIRONMENT",
    service_name=~"$SERVICE_REGEX"
  }[$WINDOW])
)
```

```promql
histogram_quantile(0.95,
  sum by (le, service_name, span_name) (
    rate(traces_spanmetrics_latency_bucket{
      client="$CLIENT", environment=~"$ENVIRONMENT",
      service_name=~"$SERVICE_REGEX"
    }[$WINDOW])
  )
)
```

If `traces_spanmetrics_*` is absent for a service in scope, mark trace coverage as `blind` for that service rather than claiming "no trace issues".

## Beyla / auto-instrumentation

Instrumented processes:

```promql
count by (service_name, host_name) (
  beyla_instrumented_processes{
    client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX"
  }
)
```

Instrumentation errors:

```promql
sum by (service_name, host_name) (
  increase(beyla_instrumentation_errors_total{
    client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX"
  }[$WINDOW])
)
```

## Host saturation

Load per core:

```promql
node_load1{client="$CLIENT", environment=~"$ENVIRONMENT", host_name=~"$HOST_REGEX"}
/
count by (host_name) (
  node_cpu_seconds_total{client="$CLIENT", environment=~"$ENVIRONMENT", host_name=~"$HOST_REGEX", mode="idle"}
)
```

I/O wait %:

```promql
100 * avg by (host_name) (
  rate(node_cpu_seconds_total{
    client="$CLIENT", environment=~"$ENVIRONMENT", host_name=~"$HOST_REGEX", mode="iowait"
  }[$WINDOW])
)
```

Disk busy %:

```promql
100 * max by (host_name, device) (
  rate(node_disk_io_time_seconds_total{
    client="$CLIENT", environment=~"$ENVIRONMENT", host_name=~"$HOST_REGEX"
  }[$WINDOW])
)
```

Memory available %:

```promql
100 * node_memory_MemAvailable_bytes{client="$CLIENT", environment=~"$ENVIRONMENT", host_name=~"$HOST_REGEX"}
/
node_memory_MemTotal_bytes{client="$CLIENT", environment=~"$ENVIRONMENT", host_name=~"$HOST_REGEX"}
```

## Logs (LogQL)

Error count by service:

```logql
sum by (service_name) (
  count_over_time(
    {client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX"}
      |~ "(?i)(error|exception|fatal|critical)"
    [$WINDOW]
  )
)
```

Signature search:

```logql
{client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX"} |= "$TEXT"
```

Top extracted patterns (best for unknown-shape failures):

```logql
{client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX"}
  |~ "(?i)(error|warn|fatal)"
  | pattern `<_>`
```

Business event counts:

```logql
sum by (service_name) (
  count_over_time(
    {client="$CLIENT", environment=~"$ENVIRONMENT", service_name=~"$SERVICE_REGEX"} |~ "$BUSINESS_REGEX"
    [$WINDOW]
  )
)
```

## Trace exploration (Tempo / TraceQL)

When the MCP server exposes Tempo TraceQL or Sift:

```traceql
{ resource.service.name="$SERVICE" && status=error } | duration > 500ms
```

```traceql
{ resource.service.name="$SERVICE" } | by(name) | avg(duration) | top(10)
```

Otherwise pivot from a slow log line: extract `trace_id`, then look it up in the trace UI.

`find_slow_requests` (Sift) is usually the cheapest start.

## Database / cache / queue (exporter-dependent)

Use the exporter's actual metric names; the patterns below assume common Prometheus exporters.

MySQL:

- `mysql_global_status_threads_connected`
- `mysql_global_status_slow_queries`
- `mysql_global_status_innodb_row_lock_waits`

PostgreSQL:

- `pg_stat_activity_count{state="active"}`
- `pg_locks_count`
- `pg_stat_database_deadlocks`

Redis:

- `redis_commands_duration_seconds_bucket`
- `redis_evicted_keys_total`
- `redis_blocked_clients`
- `redis_mem_fragmentation_ratio`

Kafka / queues:

- consumer lag (oldest unprocessed offset)
- queue depth
- DLQ count
- processing latency

For any of these, run `list_prometheus_metric_names` with a substring matcher to confirm the metric exists in the target org.

## ClickHouse (when accessed via Grafana MCP)

Counts by service:

```sql
SELECT service_name, count() AS rows
FROM otel_logs
WHERE timestamp >= toDateTime($START)
  AND timestamp <  toDateTime($END)
  AND client = '$CLIENT'
GROUP BY service_name
ORDER BY rows DESC
LIMIT 50
```

## Elasticsearch (Lucene)

```lucene
service_name:"$SERVICE" AND environment:"$ENVIRONMENT" AND (level:ERROR OR level:FATAL)
```

## Pyroscope

Profile types and labels:

- `list_pyroscope_profile_types`
- `list_pyroscope_label_names`
- `list_pyroscope_label_values`

Diff a bad window vs a baseline by service and profile type to find regressed hot paths.

## ClickHouse OTel logs (Grafana → ClickHouse)

When logs are stored via the OTel ClickHouse exporter (`otel_logs` table):

```sql
SELECT
  ResourceAttributes['service.name'] AS service,
  SeverityText                       AS sev,
  count()                            AS rows
FROM otel_logs
WHERE Timestamp >= toDateTime($START)
  AND Timestamp <  toDateTime($END)
  AND ResourceAttributes['deployment.environment.name'] = '$ENVIRONMENT'
  AND ResourceAttributes['service.name'] LIKE '$SERVICE_REGEX'
GROUP BY service, sev
ORDER BY rows DESC
LIMIT 50
```

Top error patterns:

```sql
SELECT
  Body                                AS pattern,
  count()                             AS rows,
  uniqExact(TraceId)                  AS unique_traces
FROM otel_logs
WHERE Timestamp >= toDateTime($START)
  AND Timestamp <  toDateTime($END)
  AND ResourceAttributes['service.name'] = '$SERVICE'
  AND SeverityNumber >= 17           -- ERROR and above
GROUP BY pattern
ORDER BY rows DESC
LIMIT 20
```

Pivot from a trace via `TraceId` to its logs without a second tool.

## Universal rules

- Run `list_*_label_names` and `list_*_label_values` before filtering.
- Validate metric `type` and `unit` via metadata before percentile math.
- Prefer OTel-stable names; record any drift you find (old vs new) once as a label-drift finding.
- Anchor regexes; do not use `.*` defaults.
- Bound windows; do not query unbounded ranges.
- Use `topk` while exploring; only show full sets in the final report.
- If a histogram supports exemplars and the dashboard does not surface them, that is a finding worth flagging.
