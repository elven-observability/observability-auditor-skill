#!/usr/bin/env node
// validate_context.mjs — fail-fast check on audit-context.yaml.
// Two layers:
//   1. JSON Schema (assets/schemas/audit-context.schema.json) — structural.
//   2. Audit-specific lints (--strict, --schema flags) — semantic.
//
// Exit codes (consistent across all scripts in this skill):
//   0  ok
//   1  usage error (bad/missing flags, file not found, unparseable input)
//   2  validation error (schema or lint failure)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, formatErrors } from "./lib/schema_check.mjs";
import { loadYamlSubset } from "./lib/yaml_subset.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA = path.join(SCRIPT_DIR, "..", "assets", "schemas", "audit-context.schema.json");

const HELP = `validate_context.mjs — verify audit-context.yaml is ready.

Usage:
  node scripts/validate_context.mjs --context ./audit-context.yaml
  node scripts/validate_context.mjs --json ./audit-context.json
  node scripts/validate_context.mjs --context ./audit-context.yaml --strict
  node scripts/validate_context.mjs --context ./audit-context.yaml --schema ./custom.schema.json

Flags:
  --context  Path to audit-context.yaml.
  --json     Path to a pre-parsed JSON context.
  --strict   Also require baseline_windows[0], labels.service, environments, services.
  --schema   Path to JSON schema (defaults to packaged audit-context.schema.json).
  --no-schema  Skip schema validation, run lints only.
  --quiet    Suppress warnings (errors still printed).
  --version  Print version and exit.
`;

const REQUIRED_TOP = ["client", "grafana_url", "org_id", "timezone", "operation_mode"];
const VALID_MODES = ["read_only", "write_requested", "restricted"];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { out.help = true; continue; }
    if (arg === "--version" || arg === "-v") { out.version = true; continue; }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = value;
        i += 1;
      }
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
    const pkg = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "..", "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch { return "0.0.0"; }
}

function isIso(s) {
  if (typeof s !== "string" || !s) return false;
  return !Number.isNaN(Date.parse(s));
}

function runLints(ctx, strict) {
  const errors = [];
  const warnings = [];

  for (const k of REQUIRED_TOP) {
    const v = ctx[k];
    if (v === undefined || v === "" || v === null) errors.push(`Missing required field: ${k}`);
  }
  if (ctx.operation_mode && !VALID_MODES.includes(String(ctx.operation_mode))) {
    errors.push(`operation_mode must be one of ${VALID_MODES.join(", ")}, got: ${ctx.operation_mode}`);
  }

  for (const wkey of ["bad_window", "good_window"]) {
    const w = ctx[wkey];
    if (!w || typeof w !== "object") continue;
    if (w.start && !isIso(w.start)) errors.push(`${wkey}.start is not a valid ISO timestamp`);
    if (w.end && !isIso(w.end)) errors.push(`${wkey}.end is not a valid ISO timestamp`);
    if (w.start && w.end && isIso(w.start) && isIso(w.end) && Date.parse(w.end) <= Date.parse(w.start)) {
      errors.push(`${wkey}.end must be after ${wkey}.start`);
    }
    if ((w.start && !w.end) || (!w.start && w.end)) {
      warnings.push(`${wkey} is half-specified (start xor end)`);
    }
  }

  if (strict) {
    if (!Array.isArray(ctx.environments) || ctx.environments.length === 0) {
      errors.push("strict: environments must be a non-empty list");
    }
    if (!Array.isArray(ctx.services) || ctx.services.length === 0) {
      warnings.push("strict: services list is empty");
    }
    if (!ctx.labels || !ctx.labels.service) {
      warnings.push("strict: labels.service is unset (probe before querying)");
    }
    if (!Array.isArray(ctx.baseline_windows) || ctx.baseline_windows.length === 0) {
      warnings.push("strict: no baseline_windows configured");
    }
  }

  return { errors, warnings };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { process.stdout.write(HELP); process.exit(0); }
  if (args.version) { process.stdout.write(readPackageVersion() + "\n"); process.exit(0); }
  if (!args.context && !args.json) bail(HELP, 1);

  let ctx;
  if (args.json) {
    const p = path.resolve(String(args.json));
    if (!fs.existsSync(p)) bail(`JSON not found: ${p}`, 1);
    try { ctx = JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { bail(`Invalid JSON in ${p}: ${e.message}`, 1); }
  } else {
    const p = path.resolve(String(args.context));
    if (!fs.existsSync(p)) bail(`Context not found: ${p}`, 1);
    try { ctx = loadYamlSubset(fs.readFileSync(p, "utf8")); }
    catch (e) { bail(`Cannot parse YAML ${p}: ${e.message}`, 1); }
  }

  // Schema layer
  let schemaErrors = [];
  if (!args["no-schema"]) {
    const schemaPath = args.schema ? path.resolve(String(args.schema)) : DEFAULT_SCHEMA;
    if (!fs.existsSync(schemaPath)) bail(`Schema not found: ${schemaPath}`, 1);
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const result = validate(ctx, schema);
    schemaErrors = result.errors;
  }

  // Lint layer
  const { errors, warnings } = runLints(ctx, Boolean(args.strict));

  if (!args.quiet) {
    for (const w of warnings) process.stdout.write(`WARN: ${w}\n`);
  }
  for (const e of errors) process.stderr.write(`ERROR: ${e}\n`);

  if (schemaErrors.length > 0) {
    process.stderr.write(`Schema validation failed (${schemaErrors.length} error${schemaErrors.length === 1 ? "" : "s"}):\n`);
    process.stderr.write(formatErrors(schemaErrors) + "\n");
  }

  if (errors.length > 0 || schemaErrors.length > 0) {
    const total = errors.length + schemaErrors.length;
    process.stderr.write(`\nValidation failed with ${total} error(s).\n`);
    process.exit(2);
  }
  process.stdout.write(`OK: context valid${warnings.length ? ` (with ${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}.\n`);
}

main();
