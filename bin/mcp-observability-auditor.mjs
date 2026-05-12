#!/usr/bin/env node
// mcp-observability-auditor — CLI surface for the @elven-observability/observability-auditor-skill
// package. Exposes the skill manifest, prompt rendering, template export, and
// passthrough to the deterministic scripts in skill/.../scripts/.
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
const skillName = "mcp-observability-auditor";
const skillDir = path.join(rootDir, "skill", skillName);
const manifestPath = path.join(skillDir, "assets", "manifest.json");
const skillFile = path.join(skillDir, "SKILL.md");
const pkgPath = path.join(rootDir, "package.json");

const FRONTMATTER_LIMIT = 1024; // agentskills.io spec.

function usage() {
  return `MCP Observability Auditor — Elven Works observability audit skill.

Usage:
  mcp-observability-auditor [--version | --help]
  mcp-observability-auditor list [--json]
  mcp-observability-auditor playbooks [--json]
  mcp-observability-auditor prompts [--json]
  mcp-observability-auditor templates [list|export] [--dest dir] [--force] [--dry-run]
  mcp-observability-auditor schemas [--json]
  mcp-observability-auditor scripts [list] [--json]
  mcp-observability-auditor show <id>                           # playbook | template | script | schema id
  mcp-observability-auditor show prompt:<id>                    # disambiguate when an id exists in both
  mcp-observability-auditor show playbook:<id>
  mcp-observability-auditor prompt [id] [--client X] [--org-id X] [--grafana-url X] [--timezone X] [--set KEY=VALUE] [--output file]
  mcp-observability-auditor export-templates [--dest dir] [--force] [--dry-run]
  mcp-observability-auditor install-skill [--dest ~/.agents/skills] [--force] [--dry-run]
  mcp-observability-auditor window --start <ISO> --end <ISO> [--tz <IANA>] [--slice <m>] [--json]
  mcp-observability-auditor validate-context --context <file> [--strict] [--schema <file>] [--no-schema]
  mcp-observability-auditor score-alert (--alert <file> | --batch <file>|- | --inline <json>)
  mcp-observability-auditor score-dashboard (--dashboard <file> | --batch <file>|- | --inline <json>)
  mcp-observability-auditor render-report --findings <file> [--context <file>] [--template <file>] [--out <file>]
  mcp-observability-auditor render-prompt --id <prompt-id> [--set KEY=VALUE ...] [--out <file>]
  mcp-observability-auditor redact [--in <file>] [--out <file>] [--hash]
  mcp-observability-auditor doctor [--strict]

Examples:
  mcp-observability-auditor prompt incident-timeline --client AcmeRetail --org-id 123 --timezone America/Sao_Paulo
  mcp-observability-auditor show playbook:app-deep-dive
  mcp-observability-auditor show prompt:app-deep-dive
  mcp-observability-auditor window --start 2026-05-10T14:00-03:00 --end 2026-05-10T16:30-03:00 --tz America/Sao_Paulo
  mcp-observability-auditor install-skill --force
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

  process.stdout.write("Playbooks\n");
  for (const playbook of manifest.playbooks) {
    process.stdout.write(`  ${playbook.id.padEnd(28)} ${playbook.description}\n`);
  }

  process.stdout.write("\nPrompts\n");
  for (const prompt of manifest.prompts) {
    process.stdout.write(`  ${prompt.id}\n`);
  }

  process.stdout.write("\nTemplates\n");
  for (const template of manifest.templates) {
    process.stdout.write(`  ${template.id.padEnd(20)} ${template.title}\n`);
  }

  if (Array.isArray(manifest.schemas) && manifest.schemas.length > 0) {
    process.stdout.write("\nSchemas\n");
    for (const schema of manifest.schemas) {
      process.stdout.write(`  ${schema.id.padEnd(28)} ${schema.title}\n`);
    }
  }

  if (Array.isArray(manifest.profiles) && manifest.profiles.length > 0) {
    process.stdout.write("\nProfiles\n");
    for (const profile of manifest.profiles) {
      process.stdout.write(`  ${profile.id.padEnd(20)} ${profile.title}\n`);
    }
  }

  if (Array.isArray(manifest.scripts) && manifest.scripts.length > 0) {
    process.stdout.write("\nScripts\n");
    for (const script of manifest.scripts) {
      process.stdout.write(`  ${script.id.padEnd(20)} ${script.description}\n`);
    }
  }
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
  if (!id) bail("Missing id. Example: mcp-observability-auditor show query-library", 1);

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

  process.stdout.write(
    `Doctor OK: ${skillName} v${readPackageVersion()} — ${manifest.playbooks.length} playbooks, ` +
    `${manifest.prompts.length} prompts, ${manifest.templates.length} templates, ` +
    `${(manifest.schemas || []).length} schemas, ${(manifest.profiles || []).length} profiles, ` +
    `${(manifest.scripts || []).length} scripts.\n`
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

function main() {
  const [command = "help", ...args] = process.argv.slice(2);

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
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
