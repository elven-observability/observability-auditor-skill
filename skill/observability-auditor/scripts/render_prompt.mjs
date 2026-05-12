#!/usr/bin/env node
// render_prompt.mjs — substitute [PLACEHOLDERS] in any prompt from the library.
// Mirrors the substitution semantics of bin/observability-auditor.mjs prompt,
// but standalone so the skill can be used outside the npm package.
//
// Exit codes:
//   0  ok
//   1  usage error

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = `render_prompt.mjs — substitute [PLACEHOLDERS] in a prompt-library section.

Usage:
  node scripts/render_prompt.mjs --id <prompt-id> [--library <path>] [--set KEY=VALUE ...] [--out <file>]

Flags:
  --id        Section heading id in prompt-library.md (e.g. master, app-deep-dive). Required.
  --library   Path to prompt-library.md. Defaults to ../references/prompt-library.md (relative to this script).
  --set       Substitution. May be repeated. Example: --set CLIENT=AcmeRetail
  --out       Write to file. If omitted, print to stdout.
  --version   Print version and exit.

Known placeholders are passed through unchanged when no --set is given for them.
`;

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "..", "package.json"), "utf8")).version || "0.0.0";
  } catch { return "0.0.0"; }
}

function parseArgs(argv) {
  const out = { set: {} };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { out.help = true; continue; }
    if (arg === "--version" || arg === "-v") { out.version = true; continue; }
    if (arg === "--set") {
      const value = argv[i + 1];
      if (!value || !value.includes("=")) {
        console.error(`--set expects KEY=VALUE, got: ${value}`);
        process.exit(1);
      }
      const eq = value.indexOf("=");
      const key = value.slice(0, eq).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      out.set[key] = value.slice(eq + 1);
      i += 1;
      continue;
    }
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
  console.error(msg);
  process.exit(code);
}

function extractSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const target = `## ${heading}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === target);
  if (start === -1) die(`Heading not found: ${heading}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join("\n").trimStart();
}

function applySubstitutions(text, mapping) {
  let out = text;
  for (const [key, value] of Object.entries(mapping)) {
    out = out.replaceAll(`[${key}]`, String(value));
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { process.stdout.write(HELP); process.exit(0); }
  if (args.version) { process.stdout.write(readPackageVersion() + "\n"); process.exit(0); }
  if (!args.id) { process.stdout.write(HELP); process.exit(1); }
  const libraryPath = args.library
    ? path.resolve(String(args.library))
    : path.join(SCRIPT_DIR, "..", "references", "prompt-library.md");
  if (!fs.existsSync(libraryPath)) die(`Prompt library not found: ${libraryPath}`);

  const markdown = fs.readFileSync(libraryPath, "utf8");
  const section = extractSection(markdown, args.id);
  const rendered = applySubstitutions(section, args.set);

  if (args.out) {
    const outPath = path.resolve(String(args.out));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, rendered.endsWith("\n") ? rendered : rendered + "\n");
    console.log(`Wrote ${outPath}`);
  } else {
    process.stdout.write(rendered.endsWith("\n") ? rendered : rendered + "\n");
  }
}

main();
