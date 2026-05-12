#!/usr/bin/env node
// score_dashboard.mjs — apply the dashboard-audit rubric to a dashboard JSON.
// Expects a structured payload (Grafana dashboard JSON or a flattened summary)
// with at least: uid, title, folder, tags, datasources[], variables[], panels[],
// refreshInterval, links[]. Each panel: { type, title, unit, datasource, query, legend,
// thresholds, isPercentile?, isRate?, isCounter? }.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = `score_dashboard.mjs — score a dashboard against the rubric.

Usage:
  node scripts/score_dashboard.mjs --dashboard <file>
  node scripts/score_dashboard.mjs --batch <file>
  node scripts/score_dashboard.mjs --batch -          # read JSON array from stdin
  node scripts/score_dashboard.mjs --inline '<json>'

Output: { uid, title, score (0-5), reasons[], strengths[], gaps[], recommendation, priority }.

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

async function readJsonInput(args) {
  if (args.inline) {
    try { return JSON.parse(String(args.inline)); }
    catch (e) { die(`Invalid --inline JSON: ${e.message}`, 2); }
  }
  if (args.dashboard) {
    const p = path.resolve(String(args.dashboard));
    if (!fs.existsSync(p)) die(`Dashboard file not found: ${p}`, 1);
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { die(`Invalid JSON in ${p}: ${e.message}`, 2); }
  }
  if (args.batch) {
    if (args.batch === true || args.batch === "-") {
      const chunks = [];
      process.stdin.setEncoding("utf8");
      return await new Promise((resolve, reject) => {
        process.stdin.on("data", (c) => chunks.push(c));
        process.stdin.on("end", () => {
          try { resolve(JSON.parse(chunks.join(""))); } catch (err) { reject(err); }
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

function hasVar(vars, key) {
  if (!Array.isArray(vars)) return false;
  return vars.some((v) => {
    const name = (v.name || v.id || v.key || "").toLowerCase();
    return name === key.toLowerCase() || name.endsWith(`_${key.toLowerCase()}`);
  });
}

function evaluateOne(dash) {
  const reasons = [];
  const strengths = [];
  const gaps = [];
  let score = 5;

  const vars = dash.variables || [];
  const panels = dash.panels || [];

  // variables
  for (const key of ["service", "environment", "client"]) {
    if (hasVar(vars, key) || hasVar(vars, `${key}_name`)) {
      strengths.push(`has ${key} variable`);
    } else {
      score -= 0.5;
      gaps.push(`no ${key} variable`);
    }
  }

  // "All" default checks
  const allDefault = vars.filter((v) => {
    const def = String(v.default ?? v.current ?? "");
    return def.toLowerCase() === "all" || def === "*" || def === ".*";
  });
  if (allDefault.length > 0) {
    score -= 0.5;
    gaps.push(`${allDefault.length} variable(s) default to "All" — cardinality risk`);
  }

  // links
  const links = dash.links || [];
  const hasLogLink = links.some((l) => /logs?|loki|explore/i.test(`${l.title || ""} ${l.url || ""}`));
  const hasTraceLink = links.some((l) => /trace|tempo/i.test(`${l.title || ""} ${l.url || ""}`));
  const hasAlertLink = links.some((l) => /alert|on.?call/i.test(`${l.title || ""} ${l.url || ""}`));
  if (hasLogLink) strengths.push("links to logs"); else { score -= 0.25; gaps.push("no log link"); }
  if (hasTraceLink) strengths.push("links to traces"); else { score -= 0.25; gaps.push("no trace link"); }
  if (hasAlertLink) strengths.push("links to alerts"); else { score -= 0.25; gaps.push("no alert link"); }

  // panel checks
  let unitsMissing = 0;
  let counterPlottedRaw = 0;
  let percentileOnGauge = 0;
  let bigPanelCount = panels.length;

  for (const p of panels) {
    if (!p.unit) unitsMissing += 1;
    if (p.isCounter && !p.isRate && !/rate\(|increase\(/i.test(String(p.query || ""))) counterPlottedRaw += 1;
    if (p.isPercentile && p.isGauge) percentileOnGauge += 1;
  }

  if (unitsMissing > 0) {
    score -= Math.min(0.5, unitsMissing * 0.1);
    gaps.push(`${unitsMissing} panel(s) missing units`);
  }
  if (counterPlottedRaw > 0) {
    score -= Math.min(1.0, counterPlottedRaw * 0.25);
    gaps.push(`${counterPlottedRaw} panel(s) plot a counter directly (should be rate/increase)`);
  }
  if (percentileOnGauge > 0) {
    score -= 0.5;
    gaps.push(`${percentileOnGauge} panel(s) use percentile on a gauge`);
  }

  if (bigPanelCount > 40) {
    score -= 0.5;
    gaps.push(`dashboard has ${bigPanelCount} panels — operators will get lost`);
  }
  if (bigPanelCount === 0) {
    score = 0;
    gaps.push("no panels");
  }

  // primary-question detection — does the top of the dashboard answer a journey question?
  const topPanel = panels[0];
  const primaryQuestion = topPanel?.title || "";
  const looksUserFacing = /checkout|payment|order|signup|login|conversion|success|availability|error|latency/i.test(primaryQuestion);
  if (looksUserFacing) strengths.push("top panel is user-facing");
  else { score -= 0.25; gaps.push("top panel is not user-facing"); }

  score = Math.max(0, Math.min(5, Math.round(score * 4) / 4));

  const recommendation = recommend(score);
  const priority = priorityFor(score);

  return {
    uid: dash.uid || null,
    title: dash.title || dash.uid || "(untitled)",
    score,
    reasons,
    strengths,
    gaps,
    recommendation,
    priority,
    primary_question: primaryQuestion
  };
}

// Same five-step ladder as score_alert.mjs; align so reports merge cleanly.
function priorityFor(score) {
  if (score <= 1) return "critical";
  if (score <= 2) return "high";
  if (score <= 3) return "medium";
  if (score <= 4) return "low";
  return "info";
}

function recommend(score) {
  if (score <= 1) return "rebuild or retire — misleading during incidents";
  if (score <= 2) return "major edits — fix variables, links, and panel types";
  if (score <= 3) return "edits needed — add filters/links, fix units, prune cardinality";
  if (score <= 4) return "minor improvements — fill metadata, tighten panel set";
  return "keep and re-evaluate next audit cycle";
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
