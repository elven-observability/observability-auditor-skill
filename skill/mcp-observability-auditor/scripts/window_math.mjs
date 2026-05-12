#!/usr/bin/env node
// window_math.mjs — normalise a window and produce baseline comparators + slice grid.
// Pure Node, no external deps. Uses Intl.DateTimeFormat for timezone arithmetic.
//
// Exit codes:
//   0  ok
//   1  usage error

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = `window_math.mjs — normalise a window and derive baselines + slice grid.

Usage:
  node scripts/window_math.mjs --start <ISO> --end <ISO> [--tz <IANA>] [--slice <minutes>] [--json]

Flags:
  --start    ISO 8601 timestamp with offset (e.g. 2026-05-10T14:00:00-03:00). Required.
  --end      ISO 8601 timestamp with offset. Required. Must be after --start.
  --tz       IANA timezone for human-readable output (defaults to the offset of --start).
  --slice    Slice size in minutes. Defaults to an auto rule based on window length.
  --json     Emit JSON instead of human-readable text.
  --version  Print version and exit.

Notes:
  - Computes UTC start/end (queries normally want UTC).
  - Produces baselines: yesterday-same-window, last-week-same-window.
  - Produces a slice grid you can use to anchor a timeline table.
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { out.help = true; continue; }
    if (arg === "--version" || arg === "-v") { out.version = true; continue; }
    if (arg === "--json") { out.json = true; continue; }
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

function die(msg, code = 1) {
  process.stderr.write(msg.endsWith("\n") ? msg : `${msg}\n`);
  process.exit(code);
}

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "..", "package.json"), "utf8")).version || "0.0.0";
  } catch { return "0.0.0"; }
}

function isoOrDie(label, value) {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) die(`${label} is not a valid ISO timestamp: ${value}`);
  return new Date(ms);
}

function autoSliceMinutes(durationMs) {
  const hours = durationMs / (1000 * 60 * 60);
  if (hours <= 1) return 2;
  if (hours <= 4) return 5;
  if (hours <= 24) return 15;
  return 60;
}

function formatInTz(date, tz) {
  if (!tz) return date.toISOString();
  const opts = {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  };
  const parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")} ${tz}`;
}

function shift(date, deltaMs) {
  return new Date(date.getTime() + deltaMs);
}

function durationLabel(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}

function buildSlices(start, end, sliceMinutes) {
  const sliceMs = sliceMinutes * 60 * 1000;
  const slices = [];
  for (let t = start.getTime(); t < end.getTime(); t += sliceMs) {
    const next = Math.min(t + sliceMs, end.getTime());
    slices.push({ start: new Date(t).toISOString(), end: new Date(next).toISOString() });
  }
  return slices;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { process.stdout.write(HELP); process.exit(0); }
  if (args.version) { process.stdout.write(readPackageVersion() + "\n"); process.exit(0); }
  if (!args.start || !args.end) {
    process.stdout.write(HELP);
    process.exit(1);
  }

  const start = isoOrDie("--start", args.start);
  const end = isoOrDie("--end", args.end);
  if (end <= start) die("--end must be after --start");

  const tz = args.tz || "UTC";
  const durationMs = end.getTime() - start.getTime();
  const sliceMinutes = args.slice ? Number(args.slice) : autoSliceMinutes(durationMs);
  if (!Number.isFinite(sliceMinutes) || sliceMinutes <= 0) die("--slice must be a positive number");

  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;

  const yesterday = {
    label: "yesterday-same-window",
    start: shift(start, -dayMs),
    end: shift(end, -dayMs)
  };
  const lastWeek = {
    label: "last-week-same-window",
    start: shift(start, -weekMs),
    end: shift(end, -weekMs)
  };

  const result = {
    target: {
      start_utc: start.toISOString(),
      end_utc: end.toISOString(),
      start_tz: formatInTz(start, tz),
      end_tz: formatInTz(end, tz),
      timezone: tz,
      duration: durationLabel(durationMs),
      duration_ms: durationMs
    },
    slice_minutes: sliceMinutes,
    slice_count: Math.ceil(durationMs / (sliceMinutes * 60 * 1000)),
    baselines: [
      {
        label: yesterday.label,
        start_utc: yesterday.start.toISOString(),
        end_utc: yesterday.end.toISOString(),
        start_tz: formatInTz(yesterday.start, tz),
        end_tz: formatInTz(yesterday.end, tz)
      },
      {
        label: lastWeek.label,
        start_utc: lastWeek.start.toISOString(),
        end_utc: lastWeek.end.toISOString(),
        start_tz: formatInTz(lastWeek.start, tz),
        end_tz: formatInTz(lastWeek.end, tz)
      }
    ],
    slices: buildSlices(start, end, sliceMinutes)
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  console.log(`Window (${tz}): ${result.target.start_tz}  →  ${result.target.end_tz}`);
  console.log(`UTC:           ${result.target.start_utc}  →  ${result.target.end_utc}`);
  console.log(`Duration:      ${result.target.duration}`);
  console.log(`Slice size:    ${sliceMinutes}m (${result.slice_count} slices)`);
  console.log("");
  console.log("Baselines:");
  for (const b of result.baselines) {
    console.log(`  ${b.label.padEnd(28)} ${b.start_tz}  →  ${b.end_tz}`);
  }
  console.log("");
  console.log(`First 5 slices (UTC):`);
  for (const s of result.slices.slice(0, 5)) {
    console.log(`  ${s.start}  →  ${s.end}`);
  }
  if (result.slices.length > 5) {
    console.log(`  … ${result.slices.length - 5} more slices`);
  }
}

main();
