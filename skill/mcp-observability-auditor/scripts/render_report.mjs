#!/usr/bin/env node
// render_report.mjs — fill assets/templates/audit-report.md with data from
// findings.json (+ optional audit-context.yaml). Pure text rendering. Missing
// placeholders are left as `(missing)` so reviewers can spot gaps fast.
//
// Exit codes:
//   0  ok
//   1  usage error
//   2  data error (invalid findings.json / template not found / parse failure)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadYamlSubset } from "./lib/yaml_subset.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = `render_report.mjs — render an audit report from findings.json.

Usage:
  node scripts/render_report.mjs \\
    --findings ./findings.json \\
    [--context ./audit-context.yaml] \\
    [--template ../assets/templates/audit-report.md] \\
    [--out ./audit-report.md]

If --out is omitted, the rendered markdown is printed to stdout.

Flags:
  --findings  Path to findings.json. Required.
  --context   Optional audit-context.yaml — merged into placeholders.
  --template  Optional template path (defaults to packaged audit-report.md).
  --out       Optional output path. Stdout if omitted.
  --version   Print version and exit.
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { out.help = true; continue; }
    if (arg === "--version" || arg === "-v") { out.version = true; continue; }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) out[key] = true;
      else { out[key] = value; i += 1; }
    }
  }
  return out;
}

function bail(msg, code) {
  process.stderr.write(msg.endsWith("\n") ? msg : `${msg}\n`);
  process.exit(code);
}

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "..", "package.json"), "utf8")).version || "0.0.0";
  } catch { return "0.0.0"; }
}

function flat(obj, prefix, into) {
  for (const [k, v] of Object.entries(obj || {})) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flat(v, full, into);
    else into[full] = v;
  }
}

function safe(v) {
  if (v === undefined || v === null || v === "") return "(missing)";
  if (Array.isArray(v)) return v.length === 0 ? "(none)" : v.join(", ");
  return String(v);
}

function renderServiceHealth(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return "| _no service health rows_ |  |  |  |  |  |  |  |";
  }
  return rows.map((r) => `| ${[
    r.service, r.env, r.rps_delta, r.p95_delta, r.err_pct_delta,
    r.dep_risk, r.infra_risk, r.summary
  ].map(safe).join(" | ")} |`).join("\n");
}

function renderTimeline(findings) {
  const timelineFinding = findings.find((f) => Array.isArray(f.timeline_rows));
  if (!timelineFinding) return "| _no timeline data_ |  |  |  |  |  |  |  |  |  |  |  |";
  return timelineFinding.timeline_rows.map((r) => `| ${[
    r.time, r.business, r.rps, r.p95_ms, r.err_pct, r.top_log_signature,
    r.top_slow_span, r.db, r.infra, r.external, r.annotation, r.interpretation
  ].map(safe).join(" | ")} |`).join("\n");
}

function renderFindingsSection(findings, tag) {
  const subset = findings.filter((f) => Array.isArray(f.tags) && f.tags.includes(tag));
  if (subset.length === 0) return `_No findings in this section._`;
  return subset.map(renderFindingBlock).join("\n\n");
}

function renderFindingBlock(f) {
  const filters = f.filters && Object.keys(f.filters).length
    ? JSON.stringify(f.filters)
    : "(none)";
  return [
    `### ${safe(f.title)}`,
    "",
    `- Severity: ${safe(f.severity)}`,
    `- Confidence: ${safe(f.confidence)}`,
    `- Impact: ${safe(f.impact)}`,
    `- Evidence:`,
    `  - datasource: ${safe(f.datasource)}`,
    `  - tool/query: ${safe(f.tool_or_query)}`,
    `  - window: ${safe(f.time_range?.start)} → ${safe(f.time_range?.end)}`,
    `  - filters: ${filters}`,
    `  - observed: ${safe(f.observed)}`,
    `  - baseline: ${safe(f.baseline_or_comparator)}`,
    `- Interpretation: ${safe(f.interpretation)}`,
    `- Counter-test: ${safe(f.counter_test)}`,
    `- Next validation: ${safe(f.next_validation)}`,
    `- Recommendation: ${safe(f.recommendation)}`,
    `- Owner: ${safe(f.owner)}`
  ].join("\n");
}

function renderAlertRows(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return "| _no alerts scored_ |  |  |  |  |  |  |  |  |  |  |  |";
  }
  return alerts.map((a) => `| ${[
    a.uid, a.title, a.service, a.env, a.severity, a.alert_type,
    a.current_threshold, a.observed, a.lead_time, a.issue, a.recommendation, a.score
  ].map(safe).join(" | ")} |`).join("\n");
}

function renderDashboardRows(dashes) {
  if (!Array.isArray(dashes) || dashes.length === 0) {
    return "| _no dashboards scored_ |  |  |  |  |  |  |  |";
  }
  return dashes.map((d) => `| ${[
    d.uid, d.title, d.primary_question, d.score,
    (d.strengths || []).join("; "),
    (d.gaps || []).join("; "),
    (d.risks || []).join("; "),
    d.recommended_edits
  ].map(safe).join(" | ")} |`).join("\n");
}

function renderRecommendations(recs) {
  if (!Array.isArray(recs) || recs.length === 0) {
    return "| - | _no recommendations_ |  |  |  |  |";
  }
  return recs.map((r, i) => `| ${i + 1} | ${[
    r.title, r.owner, r.expected_impact, r.validation_query, r.priority
  ].map(safe).join(" | ")} |`).join("\n");
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { process.stdout.write(HELP); process.exit(0); }
  if (args.version) { process.stdout.write(readPackageVersion() + "\n"); process.exit(0); }
  if (!args.findings) { process.stdout.write(HELP); process.exit(1); }

  const findingsPath = path.resolve(String(args.findings));
  if (!fs.existsSync(findingsPath)) bail(`Findings not found: ${findingsPath}`, 1);
  let findings;
  try { findings = JSON.parse(fs.readFileSync(findingsPath, "utf8")); }
  catch (e) { bail(`Invalid JSON in ${findingsPath}: ${e.message}`, 2); }

  const templatePath = args.template
    ? path.resolve(String(args.template))
    : path.join(SCRIPT_DIR, "..", "assets", "templates", "audit-report.md");
  if (!fs.existsSync(templatePath)) bail(`Template not found: ${templatePath}`, 1);
  let template = fs.readFileSync(templatePath, "utf8");

  let context = {};
  if (args.context) {
    const ctxPath = path.resolve(String(args.context));
    if (!fs.existsSync(ctxPath)) bail(`Context not found: ${ctxPath}`, 1);
    try { context = loadYamlSubset(fs.readFileSync(ctxPath, "utf8")); }
    catch (e) { bail(`Cannot parse YAML ${ctxPath}: ${e.message}`, 2); }
  }

  const flat_ctx = {};
  flat(context, "", flat_ctx);
  const flat_find = {};
  flat(findings, "", flat_find);

  const variables = {
    ...flat_ctx,
    ...flat_find,
    business_symptom: findings.summary?.business_symptom,
    leading_finding: findings.summary?.leading_finding,
    residual_risk: findings.summary?.residual_risk,
    leading_confidence: findings.summary?.leading_confidence,
    recovery_taxonomy: findings.recovery_taxonomy,
    top_action_1: (findings.summary?.top_actions || [])[0],
    top_action_2: (findings.summary?.top_actions || [])[1],
    top_action_3: (findings.summary?.top_actions || [])[2],
    timeline_rows: renderTimeline(findings.findings || []),
    service_health_rows: renderServiceHealth(findings.service_health),
    metrics_findings: renderFindingsSection(findings.findings || [], "metrics"),
    logs_findings: renderFindingsSection(findings.findings || [], "logs"),
    traces_findings: renderFindingsSection(findings.findings || [], "traces"),
    infra_findings: renderFindingsSection(findings.findings || [], "infra"),
    business_metrics_block: renderFindingsSection(findings.findings || [], "business"),
    alert_rows: renderAlertRows(findings.alerts_scored),
    dashboard_rows: renderDashboardRows(findings.dashboards_scored),
    recommendation_rows: renderRecommendations(findings.recommendations),
    root_cause_section: renderFindingsSection(findings.findings || [], "root-cause"),
    blind_spots: Array.isArray(findings.blind_spots) && findings.blind_spots.length
      ? findings.blind_spots.map((b) => `- ${b}`).join("\n")
      : "_None recorded._",
    "bad_window.start": context.bad_window?.start ?? findings.time_range?.start,
    "bad_window.end": context.bad_window?.end ?? findings.time_range?.end,
    "good_window.start": context.good_window?.start,
    "good_window.end": context.good_window?.end,
    baseline_windows_inline: JSON.stringify(context.baseline_windows || []),
    allowed_actions_count: Array.isArray(context.allowed_actions) ? context.allowed_actions.length : 0,
    forbidden_actions_yaml: Array.isArray(context.forbidden_actions)
      ? context.forbidden_actions.map((a) => `  - ${a}`).join("\n")
      : "  - (not configured)",
    evidence_appendix: renderFindingsSection(findings.findings || [], "appendix")
  };

  template = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    if (value === undefined || value === null || value === "") return "(missing)";
    return String(value);
  });

  if (args.out) {
    const outPath = path.resolve(String(args.out));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, template.endsWith("\n") ? template : template + "\n");
    console.log(`Wrote ${outPath}`);
  } else {
    process.stdout.write(template.endsWith("\n") ? template : template + "\n");
  }
}

main();
