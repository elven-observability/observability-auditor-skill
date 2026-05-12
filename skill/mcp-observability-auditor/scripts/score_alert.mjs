#!/usr/bin/env node
// score_alert.mjs — apply the alert-threshold-audit rubric to one or many rules.
// Input is a JSON description of an alert rule (or an array thereof). The
// shape is intentionally loose so any Grafana/Mimir/Prometheus rule dump works
// after a light reshape. Required-ish fields:
//
//   title, uid, datasource, query, condition, threshold, for, evalInterval,
//   noDataState, errorState, labels (object), annotations (object),
//   firingHistory (array, optional),
//   baseline: { p50, p95, p99 } (optional but heavily rewarded)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = `score_alert.mjs — score an alert rule against the rubric.

Usage:
  node scripts/score_alert.mjs --alert <file>            # single rule JSON
  node scripts/score_alert.mjs --batch <file>            # array of rule JSON
  node scripts/score_alert.mjs --batch -                 # read JSON array from stdin
  node scripts/score_alert.mjs --inline '<json>'         # inline JSON

Output is JSON with: { uid, title, score (0-5), reasons[], recommendation, priority }.

Flags:
  --version  Print version and exit.

Exit codes:
  0  ok
  1  usage error
  2  data error (invalid JSON / unreadable file)
`;

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "..", "package.json"), "utf8")).version || "0.0.0";
  } catch { return "0.0.0"; }
}

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

function die(msg, code = 1) {
  process.stderr.write(msg.endsWith("\n") ? msg : `${msg}\n`);
  process.exit(code);
}

function readJsonInput(args) {
  if (args.inline) {
    try { return JSON.parse(String(args.inline)); }
    catch (e) { die(`Invalid --inline JSON: ${e.message}`, 2); }
  }
  if (args.alert) {
    const p = path.resolve(String(args.alert));
    if (!fs.existsSync(p)) die(`Alert file not found: ${p}`, 1);
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { die(`Invalid JSON in ${p}: ${e.message}`, 2); }
  }
  if (args.batch) {
    if (args.batch === true || args.batch === "-") {
      const chunks = [];
      process.stdin.setEncoding("utf8");
      return new Promise((resolve, reject) => {
        process.stdin.on("data", (c) => chunks.push(c));
        process.stdin.on("end", () => {
          try { resolve(JSON.parse(chunks.join(""))); }
          catch (err) { reject(err); }
        });
        process.stdin.on("error", reject);
      });
    }
    const p = path.resolve(String(args.batch));
    if (!fs.existsSync(p)) die(`Batch file not found: ${p}`, 1);
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { die(`Invalid JSON in ${p}: ${e.message}`, 2); }
  }
  die(HELP, 1);
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function hasField(v) { return v !== undefined && v !== null && v !== ""; }

function evaluateOne(rule) {
  const labels = rule.labels || {};
  const ann = rule.annotations || {};
  const baseline = rule.baseline || {};
  const reasons = [];
  let score = 5;

  // metadata
  const required_labels = ["severity", "service_name", "environment"];
  for (const k of required_labels) {
    if (!hasField(labels[k])) { score -= 0.5; reasons.push(`missing label: ${k}`); }
  }
  const owner = labels.team || labels.owner;
  if (!hasField(owner)) { score -= 0.5; reasons.push("missing owner/team label"); }
  if (!labels.alert_type) reasons.push("note: no alert_type label (symptom|cause|telemetry|business)");

  // annotations
  const required_ann = ["summary", "runbook_url"];
  for (const a of required_ann) {
    if (!hasField(ann[a])) { score -= 0.5; reasons.push(`missing annotation: ${a}`); }
  }
  if (!hasField(ann.dashboard_url)) { score -= 0.25; reasons.push("missing annotation: dashboard_url"); }
  if (!hasField(ann.validation_query)) { score -= 0.25; reasons.push("missing annotation: validation_query"); }
  if (!hasField(ann.impact)) { score -= 0.25; reasons.push("missing annotation: impact"); }

  // for / no-data
  const forVal = String(rule.for || "").trim();
  if (forVal === "" || forVal === "0" || forVal === "0s" || forVal === "0m") {
    score -= 0.75;
    reasons.push("for is 0 — flapping risk");
  }
  if (rule.noDataState && String(rule.noDataState).toLowerCase() === "ok") {
    score -= 0.5;
    reasons.push("noDataState=OK for what may be a critical telemetry pipeline — confirm intentional");
  }

  // threshold vs baseline
  const threshold = num(rule.threshold);
  const p50 = num(baseline.p50);
  const p95 = num(baseline.p95);
  const p99 = num(baseline.p99);
  if (threshold !== null && p50 !== null && p95 !== null && p99 !== null) {
    if (threshold < p50) { score -= 1.0; reasons.push(`threshold (${threshold}) below baseline p50 (${p50}) — will flap`); }
    else if (threshold > p99) { score -= 1.0; reasons.push(`threshold (${threshold}) above baseline p99 (${p99}) — likely to miss real issues`); }
    else if (threshold < p95) { score -= 0.25; reasons.push("threshold between p50–p95 — verify intent"); }
    else reasons.push(`threshold in p95–p99 band (${threshold} vs p95=${p95}/p99=${p99}) — reasonable`);
  } else {
    score -= 0.5;
    reasons.push("no baseline provided (p50/p95/p99) — cannot validate threshold");
  }

  // firing history (if provided)
  if (Array.isArray(rule.firingHistory)) {
    const totalFires = rule.firingHistory.length;
    const matchedIncidents = rule.firingHistory.filter((f) => f.matched_incident).length;
    if (totalFires > 0 && matchedIncidents === 0) {
      score -= 0.5;
      reasons.push(`fired ${totalFires} times but matched 0 incidents — likely noise`);
    }
    const leadTimes = rule.firingHistory
      .map((f) => num(f.lead_time_seconds))
      .filter((x) => x !== null && x < 0);
    if (leadTimes.length > 0) {
      score -= 0.5;
      reasons.push(`fired AFTER customer impact in ${leadTimes.length} case(s) — late page`);
    }
  }

  // type-specific penalties
  if (labels.alert_type === "cause" && hasField(ann.impact) && /user|customer|checkout|payment|login/i.test(String(ann.impact))) {
    score -= 0.5;
    reasons.push("cause-type alert on a user-facing journey — add a symptom alert and demote this to ticket");
  }

  // bounds
  score = Math.max(0, Math.min(5, Math.round(score * 4) / 4)); // quarter-point granularity

  const recommendation = recommend(score, reasons);
  const priority = priorityFor(score);

  return {
    uid: rule.uid || null,
    title: rule.title || rule.uid || "(untitled)",
    score,
    reasons,
    recommendation,
    priority
  };
}

// Five-step priority ladder. Quarter-point scores collapse to one bucket.
//   critical: 0–1   (broken or misleading — page operators away from it)
//   high:     1.25–2 (rewrite — keep intent, redesign body)
//   medium:   2.25–3 (tune — adjust threshold/for/metadata)
//   low:      3.25–4 (minor fixes — fill metadata)
//   info:     4.25–5 (keep as-is, re-validate next cycle)
function priorityFor(score) {
  if (score <= 1) return "critical";
  if (score <= 2) return "high";
  if (score <= 3) return "medium";
  if (score <= 4) return "low";
  return "info";
}

function recommend(score, reasons) {
  if (score <= 1) return "delete or replace — current rule is misleading";
  if (score <= 2) return "rewrite — keep the intent but redesign the query, threshold, and metadata";
  if (score <= 3) return "tune — adjust threshold/for/labels/annotations as called out";
  if (score <= 4) return "minor fixes — fill missing metadata, validate threshold";
  return "keep as-is and re-validate next audit cycle";
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { process.stdout.write(HELP); process.exit(0); }
  if (args.version) { process.stdout.write(readPackageVersion() + "\n"); process.exit(0); }
  const input = await readJsonInput(args);

  const list = Array.isArray(input) ? input : [input];
  const scored = list.map(evaluateOne);
  process.stdout.write(JSON.stringify(scored.length === 1 ? scored[0] : scored, null, 2) + "\n");
}

main().catch((err) => die(String(err && err.stack || err), 2));
