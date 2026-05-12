#!/usr/bin/env node
// observability-auditor — CLI surface for the @elven-observability/observability-auditor-skill
// package. Exposes the skill manifest, prompt rendering, template export, and
// passthrough to the deterministic scripts in skill/observability-auditor/scripts/.
//
// Also installed under the legacy name `mcp-observability-auditor` for users who
// installed v1.0/v1.1 — both commands point to this same file (alias planned for
// removal in v2.0).
//
// Exit codes:
//   0  ok
//   1  usage error
//   2  data error (invalid input, schema fail, missing file)
//
// All script subcommands inherit the script's own exit code.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillName = "observability-auditor";
const LEGACY_SKILL_NAME = "mcp-observability-auditor";  // v1.0/v1.1 install path
const skillDir = path.join(rootDir, "skill", skillName);
const manifestPath = path.join(skillDir, "assets", "manifest.json");
const skillFile = path.join(skillDir, "SKILL.md");
const pkgPath = path.join(rootDir, "package.json");

const FRONTMATTER_LIMIT = 1024; // agentskills.io spec.

function isLegacyBinName() {
  // True when the user invoked us via the deprecated `mcp-observability-auditor` alias.
  const invoked = path.basename(process.argv[1] || "");
  return invoked.startsWith("mcp-observability-auditor");
}

function maybeLegacyHint() {
  if (isLegacyBinName()) {
    const dim = process.stdout.isTTY && process.env.NO_COLOR === undefined ? "\x1b[2m" : "";
    const rst = process.stdout.isTTY && process.env.NO_COLOR === undefined ? "\x1b[0m" : "";
    process.stderr.write(`${dim}note: 'mcp-observability-auditor' is a deprecated alias. Use 'observability-auditor' going forward (the alias will be removed in v2.0).${rst}\n`);
  }
}

function usage() {
  return `Observability Auditor — Elven Works observability audit skill.

First time? Run:  observability-auditor welcome

Usage:
  observability-auditor [--version | --help | welcome]
  observability-auditor list [--json]
  observability-auditor playbooks [--json]
  observability-auditor prompts [--json]
  observability-auditor templates [list|export] [--dest dir] [--force] [--dry-run]
  observability-auditor schemas [--json]
  observability-auditor scripts [list] [--json]
  observability-auditor show <id>                           # playbook | template | script | schema id
  observability-auditor show prompt:<id>                    # disambiguate when an id exists in both
  observability-auditor show playbook:<id>
  observability-auditor prompt [id] [--client X] [--org-id X] [--grafana-url X] [--timezone X] [--set KEY=VALUE] [--output file]
  observability-auditor export-templates [--dest dir] [--force] [--dry-run]
  observability-auditor install-skill [--dest ~/.agents/skills] [--force] [--dry-run]
  observability-auditor window --start <ISO> --end <ISO> [--tz <IANA>] [--slice <m>] [--json]
  observability-auditor validate-context --context <file> [--strict] [--schema <file>] [--no-schema]
  observability-auditor score-alert (--alert <file> | --batch <file>|- | --inline <json>)
  observability-auditor score-dashboard (--dashboard <file> | --batch <file>|- | --inline <json>)
  observability-auditor render-report --findings <file> [--context <file>] [--template <file>] [--out <file>]
  observability-auditor render-prompt --id <prompt-id> [--set KEY=VALUE ...] [--out <file>]
  observability-auditor redact [--in <file>] [--out <file>] [--hash]
  observability-auditor doctor [--strict]

Examples:
  observability-auditor prompt incident-timeline --client AcmeRetail --org-id 123 --timezone America/Sao_Paulo
  observability-auditor show playbook:app-deep-dive
  observability-auditor show prompt:app-deep-dive
  observability-auditor window --start 2026-05-10T14:00-03:00 --end 2026-05-10T16:30-03:00 --tz America/Sao_Paulo
  observability-auditor install-skill --force
`;
}

function bail(message, code = 1) {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(code);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { bail(`Invalid JSON ${file}: ${e.message}`, 2); }
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) bail(`Manifest not found: ${manifestPath}`, 2);
  return readJson(manifestPath);
}

function readPackageVersion() {
  if (!fs.existsSync(pkgPath)) return "0.0.0";
  try { return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || "0.0.0"; }
  catch { return "0.0.0"; }
}

function expandHome(input) {
  if (!input) return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function parseArgs(argv) {
  const options = { set: [] };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const [namePart, inlineValue] = raw.split(/=(.*)/s, 2);
    const name = toCamel(namePart);
    let value = inlineValue;

    if (value === undefined) {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        value = next;
        index += 1;
      } else {
        value = true;
      }
    }

    if (name === "set") {
      options.set.push(String(value));
    } else {
      options[name] = value;
    }
  }

  return { options, positional };
}

function allEntries(manifest) {
  return [
    ...manifest.playbooks.map((entry) => ({ ...entry, kind: "playbook" })),
    ...(manifest.templates || []).map((entry) => ({ ...entry, kind: "template" })),
    ...(manifest.schemas || []).map((entry) => ({ ...entry, kind: "schema" })),
    ...(manifest.profiles || []).map((entry) => ({ ...entry, kind: "profile" })),
    ...(manifest.scripts || []).map((entry) => ({ ...entry, kind: "script" })),
    ...manifest.prompts.map((entry) => ({
      ...entry,
      title: `Prompt: ${entry.id}`,
      description: `Prompt section ${entry.heading}`,
      kind: "prompt"
    }))
  ];
}

function resolveEntryFile(entry) {
  return path.join(skillDir, entry.file);
}

function findEntry(manifest, id) {
  // Namespace-aware lookup. "playbook:app-deep-dive" or "prompt:app-deep-dive"
  // disambiguates when an id exists in both. Plain "app-deep-dive" returns the
  // first match in the canonical order: playbook → template → schema → profile
  // → script → prompt — and prints a hint if ambiguous.
  const allowedKinds = ["playbook", "template", "schema", "profile", "script", "prompt"];
  let kindFilter = null;
  let bareId = id;
  if (id.includes(":")) {
    const [k, rest] = id.split(":", 2);
    if (allowedKinds.includes(k)) { kindFilter = k; bareId = rest; }
  }
  const entries = allEntries(manifest).filter((e) => e.id === bareId && (!kindFilter || e.kind === kindFilter));
  if (entries.length === 0) return null;
  if (entries.length > 1 && !kindFilter) {
    process.stderr.write(`Note: id "${bareId}" exists as ${entries.map((e) => e.kind).join(" + ")}; defaulting to ${entries[0].kind}. Use ${entries.map((e) => `${e.kind}:${bareId}`).join(" / ")} to disambiguate.\n`);
  }
  return entries[0];
}

function printList(manifest, json = false) {
  if (json) {
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
    return;
  }

  const HAS_TTY = process.stdout && process.stdout.isTTY;
  const C = HAS_TTY && process.env.NO_COLOR === undefined;
  const bold = C ? "\x1b[1m" : "";
  const dim  = C ? "\x1b[2m" : "";
  const cyan = C ? "\x1b[36m" : "";
  const rst  = C ? "\x1b[0m" : "";

  // ─── Tasks (use cases) ─────────────────────────────────────────────────────
  process.stdout.write(`${bold}🎯  What you can do${rst}\n`);
  process.stdout.write(`  ${cyan}Org-wide audit${rst}          ${dim}—${rst} inventory, label drift, blind spots, top alerts/dashboards\n`);
  process.stdout.write(`  ${cyan}App deep-dive${rst}           ${dim}—${rst} one service: traffic → errors → latency → deps → biz\n`);
  process.stdout.write(`  ${cyan}Incident timeline${rst}       ${dim}—${rst} bad vs good window, recovery taxonomy\n`);
  process.stdout.write(`  ${cyan}Alert threshold audit${rst}   ${dim}—${rst} score 0–5 vs real baseline (p50/p95/p99)\n`);
  process.stdout.write(`  ${cyan}Dashboard audit${rst}         ${dim}—${rst} usefulness during incidents, query hygiene\n`);
  process.stdout.write(`  ${cyan}SLO design${rst}              ${dim}—${rst} multi-burn-rate, traffic-floor, error-budget policy\n`);

  // ─── Workflow commands grouped by phase ───────────────────────────────────
  process.stdout.write(`\n${bold}🚦  CLI commands by phase${rst}\n`);
  process.stdout.write(`  ${dim}1. Setup${rst}    ${cyan}welcome  doctor  install-skill  list${rst}\n`);
  process.stdout.write(`  ${dim}2. Bootstrap${rst} ${cyan}export-templates  validate-context  window${rst}\n`);
  process.stdout.write(`  ${dim}3. Score${rst}    ${cyan}score-alert  score-dashboard${rst}  ${dim}(human-friendly by default; --json for CI)${rst}\n`);
  process.stdout.write(`  ${dim}4. Report${rst}   ${cyan}render-report  redact${rst}\n`);
  process.stdout.write(`  ${dim}5. Inspect${rst}  ${cyan}show <id>  prompt <id>${rst}  ${dim}(see the playbooks/prompts the agent loads)${rst}\n`);

  // ─── Inventory below the fold ─────────────────────────────────────────────
  process.stdout.write(`\n${bold}📚  Playbooks${rst}  ${dim}(load via 'show playbook:<id>')${rst}\n`);
  for (const p of manifest.playbooks) {
    process.stdout.write(`  ${p.id.padEnd(28)} ${dim}${p.description}${rst}\n`);
  }

  process.stdout.write(`\n${bold}💬  Prompts${rst}  ${dim}(render with 'prompt <id> --client X ...')${rst}\n`);
  for (const pr of manifest.prompts) process.stdout.write(`  ${pr.id}\n`);

  process.stdout.write(`\n${bold}📋  Templates${rst}  ${dim}(copy with 'export-templates')${rst}\n`);
  for (const t of manifest.templates) {
    process.stdout.write(`  ${t.id.padEnd(20)} ${dim}${t.title}${rst}\n`);
  }

  if (Array.isArray(manifest.schemas) && manifest.schemas.length > 0) {
    process.stdout.write(`\n${bold}🧾  JSON Schemas${rst}  ${dim}(used by validate-context and the test suite)${rst}\n`);
    for (const s of manifest.schemas) {
      process.stdout.write(`  ${s.id.padEnd(28)} ${dim}${s.title}${rst}\n`);
    }
  }

  if (Array.isArray(manifest.profiles) && manifest.profiles.length > 0) {
    process.stdout.write(`\n${bold}🪪  Profiles${rst}  ${dim}(opinionated defaults you can import into your context)${rst}\n`);
    for (const pf of manifest.profiles) {
      process.stdout.write(`  ${pf.id.padEnd(20)} ${dim}${pf.title}${rst}\n`);
    }
  }

  if (Array.isArray(manifest.scripts) && manifest.scripts.length > 0) {
    process.stdout.write(`\n${bold}🛠   Scripts${rst}  ${dim}(deterministic helpers — zero deps)${rst}\n`);
    for (const sc of manifest.scripts) {
      process.stdout.write(`  ${sc.id.padEnd(20)} ${dim}${sc.description}${rst}\n`);
    }
  }

  process.stdout.write(`\n${dim}Tip: 'observability-auditor welcome' for the 30-second intro.${rst}\n`);
}

function printSimple(items, json) {
  if (json) { process.stdout.write(JSON.stringify(items, null, 2) + "\n"); return; }
  for (const item of items || []) {
    process.stdout.write(`${(item.id || "").padEnd(20)} ${item.title || item.heading || ""}\n`);
  }
}

function extractHeading(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) bail(`Heading not found in prompt library: ${heading}`, 2);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n").trimStart();
}

function substitutionMap(options) {
  const map = {
    CLIENT: options.client,
    GRAFANA_URL: options.grafanaUrl,
    ORG_ID: options.orgId,
    TIMEZONE: options.timezone,
    ENVIRONMENTS: options.environments,
    SERVICES: options.services,
    TIME_WINDOW: options.timeWindow,
    BUSINESS_QUESTION: options.businessQuestion,
    SERVICE_NAME: options.serviceName,
    ENVIRONMENT: options.environment,
    START: options.start,
    END: options.end,
    BASELINE_WINDOW: options.baselineWindow,
    BAD_WINDOW: options.badWindow,
    GOOD_WINDOW: options.goodWindow,
    BUSINESS_SYMPTOM: options.businessSymptom,
    CLIENT_OR_ORG: options.clientOrOrg
  };

  for (const pair of options.set ?? []) {
    const splitAt = pair.indexOf("=");
    if (splitAt <= 0) bail(`Invalid --set value "${pair}". Use --set KEY=VALUE.`, 1);
    const key = pair.slice(0, splitAt).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    map[key] = pair.slice(splitAt + 1);
  }

  return Object.fromEntries(Object.entries(map).filter(([, value]) => value !== undefined && value !== true));
}

function applySubstitutions(text, options) {
  let output = text;
  for (const [key, value] of Object.entries(substitutionMap(options))) {
    output = output.replaceAll(`[${key}]`, String(value));
  }
  return output;
}

function writeOrPrint(text, outputPath) {
  if (!outputPath) {
    process.stdout.write(text.endsWith("\n") ? text : text + "\n");
    return;
  }
  const resolved = path.resolve(expandHome(outputPath));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, text.endsWith("\n") ? text : `${text}\n`);
  process.stderr.write(`Wrote ${resolved}\n`);
}

function copyFileChecked(source, destination, { force = false, dryRun = false } = {}) {
  if (fs.existsSync(destination) && !force) bail(`Destination exists: ${destination}. Use --force to overwrite.`, 1);
  if (dryRun) { process.stdout.write(`[dry-run] copy ${source} -> ${destination}\n`); return; }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyDirChecked(source, destination, { force = false, dryRun = false } = {}) {
  if (fs.existsSync(destination)) {
    if (!force) bail(`Destination exists: ${destination}. Use --force to overwrite.`, 1);
    if (!dryRun) fs.rmSync(destination, { recursive: true, force: true });
  }
  if (dryRun) { process.stdout.write(`[dry-run] copy directory ${source} -> ${destination}\n`); return; }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function commandShow(manifest, args) {
  const { positional } = parseArgs(args);
  const id = positional[0];
  if (!id) bail("Missing id. Example: observability-auditor show query-library", 1);

  const entry = findEntry(manifest, id);
  if (!entry) bail(`Unknown id: ${id}`, 1);

  const file = resolveEntryFile(entry);
  if (!fs.existsSync(file)) bail(`Backing file missing: ${file}`, 2);
  const text = fs.readFileSync(file, "utf8");
  if (entry.kind === "prompt") {
    process.stdout.write(extractHeading(text, entry.heading) + "\n");
  } else {
    process.stdout.write(text.endsWith("\n") ? text : text + "\n");
  }
}

function commandPrompt(manifest, args) {
  const { options, positional } = parseArgs(args);
  const id = positional[0] || "master";
  const entry = manifest.prompts.find((prompt) => prompt.id === id);
  if (!entry) bail(`Unknown prompt "${id}". Available: ${manifest.prompts.map((prompt) => prompt.id).join(", ")}`, 1);

  const text = fs.readFileSync(resolveEntryFile(entry), "utf8");
  const prompt = applySubstitutions(extractHeading(text, entry.heading), options);
  writeOrPrint(prompt, options.output);
}

function commandTemplates(manifest, subcommand, args) {
  const { options } = parseArgs(args);
  if (subcommand === "list" || subcommand === undefined) {
    if (options.json) { process.stdout.write(JSON.stringify(manifest.templates, null, 2) + "\n"); return; }
    for (const template of manifest.templates) {
      process.stdout.write(`${template.id.padEnd(20)} ${template.title}\n`);
    }
    return;
  }

  if (subcommand !== "export") bail(`Unknown templates command: ${subcommand || "(missing)"}`, 1);

  const dest = path.resolve(expandHome(options.dest || "./observability-audit"));
  for (const template of manifest.templates) {
    const source = resolveEntryFile(template);
    const target = path.join(dest, path.basename(template.file));
    copyFileChecked(source, target, { force: Boolean(options.force), dryRun: Boolean(options.dryRun) });
  }
  if (!options.dryRun) process.stdout.write(`Exported templates to ${dest}\n`);
}

function commandInstallSkill(args) {
  const { options } = parseArgs(args);
  const base = path.resolve(expandHome(options.dest || "~/.agents/skills"));
  const destination = path.basename(base) === skillName ? base : path.join(base, skillName);

  // Warn if v1.0/v1.1 left a `mcp-observability-auditor` directory next to the
  // new install — the agent would see two skills with overlapping triggers.
  const legacyDir = path.basename(base) === skillName
    ? path.join(path.dirname(base), LEGACY_SKILL_NAME)
    : path.join(base, LEGACY_SKILL_NAME);
  if (fs.existsSync(legacyDir)) {
    const dim = process.stdout.isTTY && process.env.NO_COLOR === undefined ? "\x1b[2m" : "";
    const yel = process.stdout.isTTY && process.env.NO_COLOR === undefined ? "\x1b[33m" : "";
    const rst = process.stdout.isTTY && process.env.NO_COLOR === undefined ? "\x1b[0m" : "";
    process.stderr.write(`${yel}⚠  Found a legacy install at ${legacyDir}${rst}\n`);
    process.stderr.write(`${dim}   This was the v1.0/v1.1 folder name. The new install will live at ${destination}.\n`);
    process.stderr.write(`   Remove the legacy folder so your agent doesn't load two skills:\n`);
    process.stderr.write(`     rm -rf "${legacyDir}"${rst}\n\n`);
  }

  copyDirChecked(skillDir, destination, { force: Boolean(options.force), dryRun: Boolean(options.dryRun) });
  if (!options.dryRun) process.stdout.write(`Installed skill to ${destination}\n`);
}

function extractFrontmatter(markdown) {
  if (!markdown.startsWith("---")) return null;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return null;
  return markdown.slice(0, end + 4); // includes opening "---" and closing "\n---"
}

function commandDoctor(manifest, args) {
  const { options } = parseArgs(args);
  const strict = Boolean(options.strict);
  const problems = [];

  // 1. Required files
  const required = [
    skillFile,
    path.join(skillDir, "agents", "openai.yaml"),
    manifestPath,
    ...manifest.playbooks.map(resolveEntryFile),
    ...(manifest.templates || []).map(resolveEntryFile),
    ...(manifest.schemas || []).map(resolveEntryFile),
    ...(manifest.profiles || []).map(resolveEntryFile),
    ...(manifest.scripts || []).map(resolveEntryFile)
  ];
  for (const file of required) if (!fs.existsSync(file)) problems.push(`missing file: ${file}`);

  // 2. Prompt headings exist
  for (const prompt of manifest.prompts) {
    const file = resolveEntryFile(prompt);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    const found = lines.some((l) => l.trim().toLowerCase() === `## ${prompt.heading}`.toLowerCase());
    if (!found) problems.push(`prompt heading missing: ${prompt.id} (## ${prompt.heading})`);
  }

  // 3. Every script has a Node shebang
  for (const script of manifest.scripts || []) {
    const file = resolveEntryFile(script);
    if (!fs.existsSync(file)) continue;
    const head = fs.readFileSync(file, "utf8").slice(0, 200);
    if (!head.startsWith("#!/usr/bin/env node")) problems.push(`script missing Node shebang: ${file}`);
  }

  // 4. SKILL.md frontmatter present and ≤ FRONTMATTER_LIMIT chars
  if (fs.existsSync(skillFile)) {
    const md = fs.readFileSync(skillFile, "utf8");
    const fm = extractFrontmatter(md);
    if (!fm) problems.push(`SKILL.md missing YAML frontmatter (--- ... ---)`);
    else {
      if (fm.length > FRONTMATTER_LIMIT) problems.push(`SKILL.md frontmatter is ${fm.length} chars (limit ${FRONTMATTER_LIMIT}) — see agentskills.io spec`);
      if (!/^name:\s*\S/m.test(fm)) problems.push(`SKILL.md frontmatter missing required field: name`);
      if (!/^description:\s*\S/m.test(fm)) problems.push(`SKILL.md frontmatter missing required field: description`);
      const nameLine = (fm.match(/^name:\s*(.+)$/m) || [])[1] || "";
      if (nameLine && !/^[A-Za-z0-9_\-]+$/.test(nameLine.trim())) {
        problems.push(`SKILL.md frontmatter name must be letters/numbers/hyphens only: ${nameLine.trim()}`);
      }
    }
  }

  // 5. JSON Schemas parse and self-describe
  for (const schema of manifest.schemas || []) {
    const file = resolveEntryFile(schema);
    if (!fs.existsSync(file)) continue;
    try {
      const obj = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!obj.$schema) problems.push(`schema missing $schema: ${file}`);
      if (!obj.title) problems.push(`schema missing title: ${file}`);
    } catch (e) {
      problems.push(`schema not valid JSON: ${file} (${e.message})`);
    }
  }

  // 6. findings.json template references a real schema
  const findingsTemplate = (manifest.templates || []).find((t) => t.id === "findings-json");
  if (findingsTemplate) {
    const file = resolveEntryFile(findingsTemplate);
    if (fs.existsSync(file)) {
      try {
        const obj = JSON.parse(fs.readFileSync(file, "utf8"));
        if (obj.$schema) {
          const resolved = path.resolve(path.dirname(file), obj.$schema);
          if (!fs.existsSync(resolved)) problems.push(`findings.json $schema not found: ${obj.$schema} (looked at ${resolved})`);
        }
      } catch (e) {
        problems.push(`findings.json not parseable: ${e.message}`);
      }
    }
  }

  // 7. evals.json is valid JSON with the expected top-level shape
  const evalsFile = path.join(rootDir, "evals", "evals.json");
  if (fs.existsSync(evalsFile)) {
    try {
      const evals = JSON.parse(fs.readFileSync(evalsFile, "utf8"));
      if (!Array.isArray(evals.evals)) problems.push(`evals/evals.json: "evals" array missing`);
      else for (const ev of evals.evals) {
        if (!ev.id || !ev.name || !ev.prompt) problems.push(`evals entry missing id/name/prompt: ${JSON.stringify(ev).slice(0, 60)}…`);
      }
    } catch (e) {
      problems.push(`evals/evals.json not parseable: ${e.message}`);
    }
  } else if (strict) {
    problems.push(`evals/evals.json missing (only required in --strict mode)`);
  }

  if (problems.length > 0) {
    process.stderr.write(`Doctor found ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    process.exit(2);
  }

  const HAS_TTY = process.stdout && process.stdout.isTTY;
  const C = HAS_TTY && process.env.NO_COLOR === undefined;
  const dim  = C ? "\x1b[2m" : "";
  const grn  = C ? "\x1b[32m" : "";
  const cyan = C ? "\x1b[36m" : "";
  const rst  = C ? "\x1b[0m" : "";

  process.stdout.write(
    `${grn}✓ Doctor OK${rst}: ${skillName} v${readPackageVersion()} — ${manifest.playbooks.length} playbooks, ` +
    `${manifest.prompts.length} prompts, ${manifest.templates.length} templates, ` +
    `${(manifest.schemas || []).length} schemas, ${(manifest.profiles || []).length} profiles, ` +
    `${(manifest.scripts || []).length} scripts.\n` +
    `\n${dim}Next:${rst}\n` +
    `  ${cyan}observability-auditor welcome${rst}              ${dim}# 30-second intro${rst}\n` +
    `  ${cyan}observability-auditor list${rst}                 ${dim}# see what's inside${rst}\n` +
    `  ${cyan}observability-auditor install-skill --dest ~/.claude/skills${rst}\n` +
    `                                                  ${dim}# enable the agent skill${rst}\n`
  );
}

function runScript(scriptId, args) {
  const manifest = readManifest();
  const entry = (manifest.scripts || []).find((s) => s.id === scriptId);
  if (!entry) bail(`Script not registered in manifest: ${scriptId}`, 1);
  const scriptFile = resolveEntryFile(entry);
  if (!fs.existsSync(scriptFile)) bail(`Script file missing: ${scriptFile}`, 2);
  const result = spawnSync(process.execPath, [scriptFile, ...args], { stdio: "inherit" });
  if (result.error) bail(`Failed to invoke ${scriptId}: ${result.error.message}`, 2);
  process.exit(result.status ?? 1);
}

function commandWelcome() {
  const HAS_TTY = process.stdout && process.stdout.isTTY;
  const NO_COLOR = process.env.NO_COLOR !== undefined || process.env.TERM === "dumb";
  const C = (HAS_TTY && !NO_COLOR);
  const bold = C ? "\x1b[1m" : "";
  const dim  = C ? "\x1b[2m" : "";
  const cyan = C ? "\x1b[36m" : "";
  const grn  = C ? "\x1b[32m" : "";
  const rst  = C ? "\x1b[0m" : "";

  const v = readPackageVersion();
  const lines = [
    "",
    `${bold}🛰  Observability Auditor Skill${rst} ${dim}v${v}${rst}`,
    "",
    `${grn}You're set.${rst} Two ways to use this — pick one:`,
    "",
    `${bold}1) 🤖  Talk to your agent (recommended)${rst}`,
    `   This package is also an Agent Skill for Claude Code / Codex / any MCP-aware agent.`,
    `   Install it once:`,
    `     ${cyan}observability-auditor install-skill --dest ~/.claude/skills${rst}`,
    `   (For Codex/Agent SDK use ${cyan}~/.agents/skills${rst} instead.)`,
    ``,
    `   Then in your agent just ask, in your own words, things like:`,
    `     ${dim}"audita os alertas do org 42 e me fala quais flapam"${rst}`,
    `     ${dim}"o que quebrou no checkout entre 14h e 16h ontem? read-only"${rst}`,
    `     ${dim}"recomenda SLOs para os 3 serviços críticos desse cliente"${rst}`,
    ``,
    `${bold}2) 🛠  Use the CLI directly${rst}`,
    `   Useful for batch jobs, CI, or when you want to score 50 alerts without burning tokens.`,
    ``,
    `   ${cyan}observability-auditor doctor${rst}              ${dim}# check the install${rst}`,
    `   ${cyan}observability-auditor list${rst}                ${dim}# see what's inside${rst}`,
    `   ${cyan}observability-auditor export-templates --dest ./my-audit${rst}`,
    `                                                  ${dim}# bootstrap an audit workspace${rst}`,
    `   ${cyan}observability-auditor score-alert --alert ./rule.json${rst}`,
    `                                                  ${dim}# score one rule with a 0–5 rubric${rst}`,
    `   ${cyan}observability-auditor render-report --findings ./findings.json \\${rst}`,
    `       ${cyan}--context ./audit-context.yaml --out ./report.md${rst}`,
    `                                                  ${dim}# build the client-facing markdown${rst}`,
    ``,
    `${bold}Need a worked example?${rst} See ${cyan}examples/${rst} inside the package for a fully-filled audit.`,
    `${bold}Want to see the skill content?${rst} Try ${cyan}observability-auditor show playbook:alert-threshold-audit${rst}.`,
    `${bold}Docs and source:${rst} https://github.com/elven-observability/observability-auditor-skill`,
    ""
  ];
  process.stdout.write(lines.join("\n"));
}

function main() {
  const [command = "help", ...args] = process.argv.slice(2);

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  if (command === "welcome" || command === "hi" || command === "hello") {
    commandWelcome();
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(readPackageVersion() + "\n");
    return;
  }

  const manifest = readManifest();

  if (command === "list" || command === "playbooks") {
    const { options } = parseArgs(args);
    printList(manifest, Boolean(options.json));
    return;
  }

  if (command === "prompts") {
    const { options } = parseArgs(args);
    printSimple(manifest.prompts, Boolean(options.json));
    return;
  }

  if (command === "schemas") {
    const { options } = parseArgs(args);
    printSimple(manifest.schemas || [], Boolean(options.json));
    return;
  }

  if (command === "profiles") {
    const { options } = parseArgs(args);
    printSimple(manifest.profiles || [], Boolean(options.json));
    return;
  }

  if (command === "scripts") {
    const [subcommand, ...rest] = args;
    if (subcommand === "list" || subcommand === undefined) {
      const { options } = parseArgs(rest);
      printSimple((manifest.scripts || []).map((s) => ({ id: s.id, title: s.file })), Boolean(options.json));
      return;
    }
    bail(`Unknown scripts command: ${subcommand}`, 1);
  }

  if (command === "show") { commandShow(manifest, args); return; }
  if (command === "prompt") { commandPrompt(manifest, args); return; }

  if (command === "templates") {
    const [subcommand, ...rest] = args;
    commandTemplates(manifest, subcommand, rest);
    return;
  }

  if (command === "export-templates") {
    commandTemplates(manifest, "export", args);
    return;
  }

  if (command === "install-skill") { commandInstallSkill(args); return; }
  if (command === "doctor") { commandDoctor(manifest, args); return; }

  // Script passthroughs — keep argv intact so flags reach the helper unchanged.
  if (command === "window") return runScript("window-math", args);
  if (command === "validate-context") return runScript("validate-context", args);
  if (command === "score-alert") return runScript("score-alert", args);
  if (command === "score-dashboard") return runScript("score-dashboard", args);
  if (command === "render-report") return runScript("render-report", args);
  if (command === "render-prompt") return runScript("render-prompt", args);
  if (command === "redact" || command === "redaction") return runScript("redaction", args);

  bail(`Unknown command: ${command}\n\n${usage()}`, 1);
}

main();
