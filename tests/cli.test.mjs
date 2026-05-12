import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(rootDir, "bin", "observability-auditor.mjs");
const skillDir = path.join(rootDir, "skill", "observability-auditor");

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    input: options.input
  });
}

function tempPath(name) {
  return path.join(os.tmpdir(), `mcp-obs-auditor-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${name}`);
}

test("doctor validates packaged skill (incl. scripts, schemas, profiles)", () => {
  const result = run(["doctor"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Doctor OK/);
  assert.match(result.stdout, /scripts/);
  assert.match(result.stdout, /schemas/);
  assert.match(result.stdout, /profiles/);
});

test("--version prints package.json version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0, result.stderr);
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  assert.equal(result.stdout.trim(), pkg.version);
});

test("list --json returns manifest groups (playbooks/prompts/templates/schemas/profiles/scripts)", () => {
  const result = run(["list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.ok(manifest.playbooks.length >= 13, "at least 13 playbooks (with mcp-safety + redaction-patterns)");
  assert.ok(manifest.prompts.some((p) => p.id === "incident-timeline"));
  assert.ok(manifest.templates.some((t) => t.id === "evidence-ledger"));
  assert.ok(Array.isArray(manifest.scripts) && manifest.scripts.length >= 7, "at least 7 scripts (with redaction)");
  assert.ok(Array.isArray(manifest.schemas) && manifest.schemas.length >= 4, "at least 4 JSON schemas");
  assert.ok(Array.isArray(manifest.profiles) && manifest.profiles.some((p) => p.id === "elven"));
  assert.ok(manifest.playbooks.some((p) => p.id === "mcp-safety"));
  assert.ok(manifest.playbooks.some((p) => p.id === "redaction-patterns"));
  assert.ok(manifest.playbooks.some((p) => p.id === "anti-patterns"));
});

test("scripts list exposes the helper inventory", () => {
  const result = run(["scripts", "list", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const scripts = JSON.parse(result.stdout);
  const ids = scripts.map((s) => s.id).sort();
  assert.deepEqual(ids, [
    "redaction",
    "render-prompt",
    "render-report",
    "score-alert",
    "score-dashboard",
    "validate-context",
    "window-math"
  ].sort());
});

test("prompt replaces known placeholders", () => {
  const result = run(["prompt", "master", "--client", "AcmeRetail", "--org-id", "123", "--timezone", "America/Sao_Paulo"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /client: "AcmeRetail"/);
  assert.match(result.stdout, /org_id: "123"/);
  assert.match(result.stdout, /timezone: "America\/Sao_Paulo"/);
});

test("show surfaces a reference page (playbook by default)", () => {
  const result = run(["show", "mcp-tool-catalog"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MCP Tool Catalog/);
  assert.match(result.stdout, /list_datasources/);
});

test("show disambiguation: playbook: vs prompt: for app-deep-dive", () => {
  const playbook = run(["show", "playbook:app-deep-dive"]);
  assert.equal(playbook.status, 0, playbook.stderr);
  assert.match(playbook.stdout, /# Application Deep Dive/);

  const prompt = run(["show", "prompt:app-deep-dive"]);
  assert.equal(prompt.status, 0, prompt.stderr);
  assert.match(prompt.stdout, /Analyze `\[SERVICE_NAME\]`/);

  // Plain "app-deep-dive" yields the playbook (first kind) and prints a hint on stderr.
  const plain = run(["show", "app-deep-dive"]);
  assert.equal(plain.status, 0);
  assert.match(plain.stdout, /# Application Deep Dive/);
  assert.match(plain.stderr, /exists as.*playbook.*prompt/);
});

test("show profile:elven returns the Elven profile YAML", () => {
  const result = run(["show", "profile:elven"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /profile: "elven"/);
  assert.match(result.stdout, /service_name/);
});

test("show with unknown id exits 1", () => {
  const result = run(["show", "no-such-thing"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown id/);
});

test("unknown command exits 1 with usage", () => {
  const result = run(["totally-not-a-command"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command/);
  assert.match(result.stderr, /Usage:/);
});

test("window subcommand computes baselines and slice grid", () => {
  const result = run([
    "window",
    "--start", "2026-05-10T14:00:00-03:00",
    "--end", "2026-05-10T16:30:00-03:00",
    "--tz", "America/Sao_Paulo",
    "--json"
  ]);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.target.timezone, "America/Sao_Paulo");
  assert.equal(out.target.start_utc, "2026-05-10T17:00:00.000Z");
  assert.equal(out.target.end_utc, "2026-05-10T19:30:00.000Z");
  // 2.5h window falls in the 1–4h band → 5-minute slices (see incident-timeline.md).
  assert.equal(out.slice_minutes, 5);
  assert.equal(out.baselines.length, 2);
  assert.equal(out.baselines[0].label, "yesterday-same-window");
  assert.equal(out.baselines[1].label, "last-week-same-window");
  assert.ok(out.slices.length >= 10);
});

test("validate-context: schema + lint pass on populated YAML", () => {
  const good = tempPath("ctx-good.yaml");
  fs.writeFileSync(good, [
    `client: "Acme"`,
    `grafana_url: "https://g.acme.com"`,
    `org_id: 1`,
    `timezone: "UTC"`,
    `operation_mode: "read_only"`,
    `environments: ["prod"]`,
    `services: ["checkout"]`,
    `baseline_windows:`,
    `  - label: "yesterday"`,
    `    start: "2026-05-09T14:00:00Z"`,
    `    end: "2026-05-09T16:00:00Z"`,
    `labels:`,
    `  service: "service_name"`
  ].join("\n") + "\n");
  const okResult = run(["validate-context", "--context", good, "--strict"]);
  assert.equal(okResult.status, 0, okResult.stderr || okResult.stdout);
  assert.match(okResult.stdout, /OK: context valid/);
  fs.unlinkSync(good);
});

test("validate-context: rejects bad operation_mode and missing required fields", () => {
  const bad = tempPath("ctx-bad.yaml");
  fs.writeFileSync(bad, `client: ""\ngrafana_url: ""\norg_id: 1\noperation_mode: "go_wild"\n`);
  const result = run(["validate-context", "--context", bad]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing required field: client/);
  assert.match(result.stderr, /operation_mode/);
  fs.unlinkSync(bad);
});

test("validate-context: schema catches invalid grafana_url (no http(s) scheme)", () => {
  const bad = tempPath("ctx-bad-url.yaml");
  fs.writeFileSync(bad, `client: "X"\ngrafana_url: "ftp://x.com"\norg_id: 1\ntimezone: "UTC"\noperation_mode: "read_only"\n`);
  const result = run(["validate-context", "--context", bad]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /grafana_url|http/);
  fs.unlinkSync(bad);
});

test("score-alert flags a poorly configured rule (--json opt-in)", () => {
  const rule = {
    uid: "a1",
    title: "Checkout 5xx",
    datasource: "mimir-prod",
    query: "rate(http_server_request_duration_seconds_count{service_name=\"checkout\",http_response_status_code=~\"5..\"}[5m])",
    threshold: 0.05,
    for: "0m",
    noDataState: "OK",
    labels: { severity: "critical", service_name: "checkout", environment: "prod" },
    annotations: { summary: "Checkout 5xx high" },
    baseline: { p50: 0.001, p95: 0.01, p99: 0.03 }
  };
  const result = run(["score-alert", "--inline", JSON.stringify(rule), "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const scored = JSON.parse(result.stdout);
  assert.ok(scored.score <= 2, `expected low score, got ${scored.score}`);
  assert.ok(scored.reasons.some((r) => /for is 0/.test(r)));
  assert.ok(scored.reasons.some((r) => /above baseline p99/.test(r)));
  assert.match(scored.recommendation, /delete or replace|rewrite/);
  assert.ok(["critical", "high"].includes(scored.priority), `expected critical|high priority, got ${scored.priority}`);
});

test("score-alert default output is human-friendly (no JSON)", () => {
  const rule = {
    uid: "a1", title: "Checkout 5xx", threshold: 0.05, for: "0m", noDataState: "OK",
    labels: { severity: "critical", service_name: "checkout", environment: "prod" },
    annotations: { summary: "x" },
    baseline: { p50: 0.001, p95: 0.01, p99: 0.03 }
  };
  // spawnSync inherits a non-tty stdout, so the pretty renderer skips ANSI.
  const result = run(["score-alert", "--inline", JSON.stringify(rule)]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Score: .* \/ 5/);
  assert.match(result.stdout, /Priority:/);
  // Reasons surface as bullets with ❌/⚠️/ℹ️ markers (not raw JSON).
  assert.doesNotMatch(result.stdout, /^\{[\s\S]*"score":/);
});

test("score-dashboard default output is human-friendly", () => {
  const dashboard = {
    uid: "d1",
    title: "Checkout overview",
    variables: [{ name: "service", current: "All" }],
    links: [],
    panels: [{ title: "Total requests", isCounter: true, query: "http_requests_total" }]
  };
  const result = run(["score-dashboard", "--inline", JSON.stringify(dashboard)]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Score:/);
  assert.match(result.stdout, /Strengths:/);
  assert.match(result.stdout, /Gaps:/);
});

test("welcome command prints the friendly intro", () => {
  const result = run(["welcome"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Observability Auditor Skill/);
  assert.match(result.stdout, /Talk to your agent|Use the CLI/);
  assert.match(result.stdout, /install-skill/);
});

test("list groups commands by phase + lists every manifest section", () => {
  const result = run(["list"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /What you can do/);
  assert.match(result.stdout, /CLI commands by phase/);
  assert.match(result.stdout, /Playbooks/);
  assert.match(result.stdout, /Prompts/);
  assert.match(result.stdout, /Templates/);
  assert.match(result.stdout, /Schemas/);
  assert.match(result.stdout, /Profiles/);
  assert.match(result.stdout, /Scripts/);
});

test("score-alert: well-tuned rule earns ≥4 and 'info' or 'low' priority", () => {
  const rule = {
    uid: "good-1",
    title: "Checkout 5xx (good)",
    datasource: "mimir-prod",
    query: "rate(...)",
    threshold: 0.015,
    for: "5m",
    noDataState: "Alerting",
    labels: {
      severity: "critical",
      service_name: "checkout",
      environment: "prod",
      team: "checkout-platform",
      alert_type: "symptom"
    },
    annotations: {
      summary: "Checkout 5xx burning SLO",
      description: "5xx ratio exceeds threshold for 5m",
      impact: "Users cannot complete checkout — revenue impact",
      runbook_url: "https://runbooks.example.com/checkout-5xx",
      dashboard_url: "https://grafana.example.com/d/checkout",
      validation_query: "sum(rate(...))",
      suggested_first_action: "Check dependency p95"
    },
    baseline: { p50: 0.001, p95: 0.01, p99: 0.02 }
  };
  const result = run(["score-alert", "--inline", JSON.stringify(rule), "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const scored = JSON.parse(result.stdout);
  assert.ok(scored.score >= 4, `expected good score ≥4, got ${scored.score}`);
  assert.ok(["info", "low"].includes(scored.priority), `expected info|low priority, got ${scored.priority}`);
});

test("score-dashboard --json penalises 'All' defaults, missing links, counter-on-gauge", () => {
  const dashboard = {
    uid: "d1",
    title: "Checkout overview",
    variables: [
      { name: "service", current: "All" },
      { name: "environment", current: "prod" }
    ],
    links: [],
    panels: [
      { title: "Total requests", isCounter: true, query: "http_requests_total" }
    ]
  };
  const result = run(["score-dashboard", "--inline", JSON.stringify(dashboard), "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const scored = JSON.parse(result.stdout);
  assert.ok(scored.score <= 4, `expected reduced score, got ${scored.score}`);
  assert.ok(scored.gaps.some((g) => /no client variable/.test(g)));
  assert.ok(scored.gaps.some((g) => /All/.test(g)));
  assert.ok(scored.gaps.some((g) => /counter directly/.test(g)));
  assert.ok(["critical", "high", "medium", "low", "info"].includes(scored.priority));
});

test("render-report fills the template from findings.json + context YAML", () => {
  const findings = {
    client: "Acme",
    timezone: "UTC",
    time_range: { start: "2026-05-01T00:00:00Z", end: "2026-05-01T01:00:00Z" },
    recovery_taxonomy: "traffic-drop",
    summary: {
      business_symptom: "checkout error rate spiked",
      leading_finding: "DB pool saturated",
      residual_risk: "Tempo coverage missing",
      leading_confidence: "medium",
      top_actions: ["raise pool", "add SLO", "page on symptom"]
    },
    findings: [],
    recommendations: []
  };
  const findingsFile = tempPath("findings.json");
  fs.writeFileSync(findingsFile, JSON.stringify(findings));
  const outFile = tempPath("audit-report.md");
  const result = run(["render-report", "--findings", findingsFile, "--out", outFile]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const md = fs.readFileSync(outFile, "utf8");
  assert.match(md, /Observability Audit — Acme/);
  assert.match(md, /checkout error rate spiked/);
  assert.match(md, /DB pool saturated/);
  assert.match(md, /raise pool/);
  // The doctored comment is preserved, not auto-replaced.
  assert.match(md, /scripts\/render_report\.mjs replaces every double-curly placeholder/);
  fs.unlinkSync(findingsFile);
  fs.unlinkSync(outFile);
});

test("redact: scrubs JWT, AWS key, Stripe key, CPF, IPv4, email", () => {
  const input = JSON.stringify({
    auth: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturepartabcdef",
    aws_key: "AKIAIOSFODNN7EXAMPLE",
    stripe: "sk_live_abcdefghijklmnop1234",
    cpf: "123.456.789-00",
    ip: "192.168.1.1",
    email: "user@example.com"
  });
  const result = run(["redact"], { input });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /eyJhbGciOiJIUzI1NiJ9/);
  assert.doesNotMatch(result.stdout, /AKIAIOSFODNN7EXAMPLE/);
  assert.doesNotMatch(result.stdout, /sk_live_abcdefghijklmnop1234/);
  assert.doesNotMatch(result.stdout, /123\.456\.789-00/);
  assert.doesNotMatch(result.stdout, /192\.168\.1\.1/);
  assert.doesNotMatch(result.stdout, /user@example\.com/);
  assert.match(result.stdout, /<jwt-redacted>/);
  assert.match(result.stdout, /<aws-access-key-redacted>/);
  assert.match(result.stdout, /<stripe-key-redacted>/);
});

test("redact --hash preserves distinct-count without exposing values", () => {
  const input = "user a@b.com and user a@b.com and user c@d.com";
  const result = run(["redact", "--hash"], { input });
  assert.equal(result.status, 0);
  // Same email -> same hash; different email -> different hash.
  const hashes = [...result.stdout.matchAll(/<email:([0-9a-f]{8})>/g)].map((m) => m[1]);
  assert.equal(hashes.length, 3);
  assert.equal(hashes[0], hashes[1]);
  assert.notEqual(hashes[0], hashes[2]);
});

test("install-skill copies the skill tree to a temp dest", () => {
  const dest = tempPath("install-target");
  const result = run(["install-skill", "--dest", dest]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(path.join(dest, "observability-auditor", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(dest, "observability-auditor", "assets", "schemas", "audit-context.schema.json")));
  fs.rmSync(dest, { recursive: true, force: true });
});

test("export-templates writes all template files to a destination", () => {
  const dest = tempPath("templates-out");
  const result = run(["export-templates", "--dest", dest]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const name of ["audit-context.yaml", "audit-report.md", "findings.json", "evidence-ledger.yaml"]) {
    assert.ok(fs.existsSync(path.join(dest, name)), `expected ${name}`);
  }
  fs.rmSync(dest, { recursive: true, force: true });
});

test("SKILL.md frontmatter is ≤ 1024 chars and uses only allowed name characters", () => {
  const md = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  assert.ok(md.startsWith("---"));
  const end = md.indexOf("\n---", 3);
  assert.notEqual(end, -1, "frontmatter must close with --- on its own line");
  const fm = md.slice(0, end + 4);
  assert.ok(fm.length <= 1024, `frontmatter is ${fm.length} chars (limit 1024)`);
  const name = (fm.match(/^name:\s*(.+)$/m) || [])[1];
  assert.ok(name, "name field required");
  assert.match(name.trim(), /^[A-Za-z0-9_\-]+$/, "name may contain only letters/numbers/hyphens");
});
