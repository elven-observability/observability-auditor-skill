#!/usr/bin/env node
// redaction.mjs — apply the redaction catalog from references/redaction-patterns.md
// to a chunk of text (stdin or --in <file>). Optional --hash flag replaces matched
// identifiers with sha256[:8] instead of the static replacement, useful when you
// need to count distinct values without exposing them.
//
// Exit codes:
//   0  ok (always — redaction never fails on bad content)
//   1  usage error
//   2  data error (unreadable file)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = `redaction.mjs — redact secrets/tokens/PII from text.

Usage:
  node scripts/redaction.mjs --in <file> [--out <file>] [--hash] [--keep-emails]
  echo "..." | node scripts/redaction.mjs [--hash]
  node scripts/redaction.mjs --list-patterns

Flags:
  --in           Path to input text. If omitted, reads stdin.
  --out          Path to output. If omitted, writes stdout.
  --hash         Replace matches with sha256[:8] instead of static placeholders.
  --keep-emails  Skip the email rule (treat emails as low-sensitivity for this run).
  --keep-ips     Skip the IPv4/IPv6 rules.
  --extra        Path to extra-patterns.json (array of { name, pattern, flags, replacement }).
  --list-patterns Print the built-in pattern catalog and exit.
  --version      Print version and exit.

Catalog matches references/redaction-patterns.md. The order is deliberate — broad
patterns (base64, long tokens) run last so they don't shadow specific rules.
`;

// Patterns are stored as { source, flags } strings so we can rebuild the RegExp
// on every replace() call and not accidentally inherit `lastIndex` state.
// (Defining as regex literals would also lose the `gi` flags we declare here.)
const CATALOG = [
  { name: "private-key-pem", flags: "g", source: "-----BEGIN [A-Z ]+PRIVATE KEY-----[\\s\\S]+?-----END [A-Z ]+PRIVATE KEY-----", replacement: "<private-key-redacted>" },
  { name: "ssh-private-key", flags: "g", source: "-----BEGIN OPENSSH PRIVATE KEY-----[\\s\\S]+?-----END OPENSSH PRIVATE KEY-----", replacement: "<ssh-key-redacted>" },
  { name: "jwt", flags: "g", source: "\\beyJ[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+", replacement: "<jwt-redacted>" },
  { name: "bearer", flags: "gi", source: "\\bbearer\\s+[A-Za-z0-9._\\-]+", replacement: "Bearer <redacted>" },
  { name: "http-basic", flags: "gi", source: "\\bbasic\\s+[A-Za-z0-9+/=]+", replacement: "Basic <redacted>" },
  { name: "aws-access-key", flags: "g", source: "\\bAKIA[0-9A-Z]{16}\\b", replacement: "<aws-access-key-redacted>" },
  { name: "github-pat", flags: "g", source: "\\bghp_[A-Za-z0-9]{20,}\\b", replacement: "<github-pat-redacted>" },
  { name: "slack-token", flags: "g", source: "\\bxox[abprs]-[A-Za-z0-9\\-]{10,}", replacement: "<slack-token-redacted>" },
  { name: "stripe-key", flags: "g", source: "\\b(sk|pk)_(live|test)_[A-Za-z0-9]{16,}\\b", replacement: "<stripe-key-redacted>" },
  { name: "anthropic-key", flags: "g", source: "\\bsk-(ant-)?[A-Za-z0-9_\\-]{20,}", replacement: "<api-key-redacted>" },
  { name: "url-api-key", flags: "gi", source: "([?&](api_key|apikey|token|access_token|key)=)[^&\\s]+", replacement: "$1<redacted>" },
  { name: "cookie-header", flags: "gi", source: "(cookie:\\s*)[^\\r\\n]+", replacement: "$1<cookies-redacted>" },
  { name: "cpf-br", flags: "g", source: "\\b\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}\\b", replacement: "<cpf-redacted>" },
  { name: "cnpj-br", flags: "g", source: "\\b\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}-\\d{2}\\b", replacement: "<cnpj-redacted>" },
  { name: "credit-card", flags: "g", source: "\\b(?:\\d[ \\-]?){13,16}\\b", replacement: "<pan-redacted>" },
  { name: "email", flags: "gi", source: "\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b", replacement: "<email-redacted>", skipFlag: "keep-emails" },
  { name: "ipv4", flags: "g", source: "\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b", replacement: "<ipv4-redacted>", skipFlag: "keep-ips" },
  { name: "ipv6", flags: "g", source: "\\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\\b", replacement: "<ipv6-redacted>", skipFlag: "keep-ips" },
  // Long base64-ish blobs LAST so we don't eat shorter, more specific matches.
  { name: "long-base64", flags: "g", source: "\\b[A-Za-z0-9+/]{40,}={0,2}\\b", replacement: "<base64-redacted>" }
];

function makeRegex(rule) {
  return new RegExp(rule.source, rule.flags || "g");
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

function bail(msg, code) {
  process.stderr.write(msg.endsWith("\n") ? msg : `${msg}\n`);
  process.exit(code);
}

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, "..", "..", "..", "package.json"), "utf8")).version || "0.0.0";
  } catch { return "0.0.0"; }
}

function hashShort(s) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

export function redact(text, options = {}) {
  let rules = CATALOG.filter((r) => !(r.skipFlag && options[r.skipFlag]));
  if (Array.isArray(options.extraRules)) {
    rules = rules.concat(options.extraRules.map((r) => ({
      name: r.name,
      source: typeof r.pattern === "string" ? r.pattern : r.pattern.source,
      flags: r.flags || (r.pattern instanceof RegExp ? r.pattern.flags : "g"),
      replacement: r.replacement,
      skipFlag: r.skipFlag
    })));
  }
  const stats = {};
  let output = text;
  for (const r of rules) {
    const re = makeRegex(r);
    if (options.hash) {
      output = output.replace(re, (match) => {
        stats[r.name] = (stats[r.name] || 0) + 1;
        return `<${r.name}:${hashShort(match)}>`;
      });
    } else {
      let count = 0;
      const replaceRe = makeRegex(r);
      output = output.replace(replaceRe, (...args) => {
        count += 1;
        // `args` is [match, ...captureGroups, offset, original]; passing it to
        // String#replace's callback semantics — we just need $1 expansion.
        return String(r.replacement).replace(/\$(\d)/g, (_, n) => args[Number(n)] ?? "");
      });
      if (count > 0) stats[r.name] = count;
    }
  }
  return { text: output, stats };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { process.stdout.write(HELP); process.exit(0); }
  if (args.version) { process.stdout.write(readPackageVersion() + "\n"); process.exit(0); }
  if (args["list-patterns"]) {
    process.stdout.write(JSON.stringify(CATALOG.map(({ name, source, flags, replacement }) => ({
      name, pattern: source, flags, replacement
    })), null, 2) + "\n");
    process.exit(0);
  }

  let text;
  if (args.in) {
    const p = path.resolve(String(args.in));
    if (!fs.existsSync(p)) bail(`Input not found: ${p}`, 1);
    try { text = fs.readFileSync(p, "utf8"); }
    catch (e) { bail(`Cannot read ${p}: ${e.message}`, 2); }
  } else {
    text = await readStdin();
  }

  let extraRules;
  if (args.extra) {
    const p = path.resolve(String(args.extra));
    if (!fs.existsSync(p)) bail(`Extra patterns file not found: ${p}`, 1);
    try { extraRules = JSON.parse(fs.readFileSync(p, "utf8")); }
    catch (e) { bail(`Invalid JSON in ${p}: ${e.message}`, 2); }
  }

  const opts = {
    hash: Boolean(args.hash),
    "keep-emails": Boolean(args["keep-emails"]),
    "keep-ips": Boolean(args["keep-ips"]),
    extraRules
  };
  const { text: out, stats } = redact(text, opts);

  if (args.out) {
    const op = path.resolve(String(args.out));
    fs.mkdirSync(path.dirname(op), { recursive: true });
    fs.writeFileSync(op, out);
    process.stderr.write(`Wrote ${op}\n`);
  } else {
    process.stdout.write(out);
  }

  const summary = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(", ");
  if (summary) process.stderr.write(`redactions: ${summary}\n`);
}

// Only run main() when invoked directly (allow importing redact() from tests).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith("redaction.mjs")) {
  main().catch((err) => bail(String(err && err.stack || err), 2));
}
