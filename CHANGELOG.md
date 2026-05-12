# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-05-12

Polish release focused on first-impression — what your colleagues see the first time they run the CLI or browse the source.

### Added
- **`welcome` command** — 30-second intro for first-run users, with the two ways to use the package (talk to your agent · use the CLI) and a copy-pasteable example for each.
- **`examples/` directory** — a fully-worked audit (`audit-context.yaml` + `alerts.json` + `findings.json` + the rendered `audit-report.md`) that you can `cp -r` to bootstrap a real client audit. Ships in the npm tarball.
- **Human-friendly output by default** in `score-alert` and `score-dashboard`:
  - ASCII box with title, score bar (colored by 5-step bucket), priority icon, recommendation.
  - Reasons annotated with ❌ / ⚠️ / ✅ / ℹ️ glyphs.
  - Batch mode renders a one-line-per-rule summary table plus a priority count header.
  - `--json` flag preserves the legacy machine-readable shape for CI / jq pipelines.
- **`scripts/lib/pretty.mjs`** — shared pretty-printer (color-aware, respects `NO_COLOR`, falls back to plain text when stdout isn't a TTY).
- **`list` command reorganised**:
  - Top: "🎯 What you can do" — six tasks the skill solves, in plain language.
  - Middle: "🚦 CLI commands by phase" — Setup / Bootstrap / Score / Report / Inspect.
  - Bottom: the full inventory of playbooks, prompts, templates, schemas, profiles, scripts.
- **`doctor` next-steps hint** — after the OK line, the CLI suggests the three commands the user is most likely to need next.

### Fixed
- (None — this is an additive minor.)

### Test suite
- 36 → 40 tests. New coverage:
  - score-alert default output is the pretty box (no JSON).
  - score-dashboard default output shows Strengths / Gaps.
  - `welcome` command prints the friendly intro with both modes.
  - `list` includes "What you can do" and "CLI commands by phase" sections.
- Existing JSON-shape tests updated to use `--json` explicitly.

## [1.0.0] — 2026-05-12

First production release under the `@elven-observability/observability-auditor-skill` npm scope. The CLI surface, manifest, and JSON Schemas are now considered the public API.

### Added
- **`references/mcp-safety.md`** — canonical MCP allowlist, hard-block list, and step-by-step write authorisation protocol. The `SKILL.md` Hard Rule #9 now references it explicitly.
- **`references/redaction-patterns.md`** + **`scripts/redaction.mjs`** — secret/token/PII regex catalog (Bearer, JWT, AWS/GH/Stripe/Anthropic keys, cookies, CPF/CNPJ, IPv4/IPv6, base64 blobs) with a `--hash` mode that preserves distinct-count without exposing values.
- **JSON Schema 2020-12 contracts** under `assets/schemas/`:
  - `audit-context.schema.json`
  - `findings.schema.json`
  - `scored-alert.schema.json`
  - `scored-dashboard.schema.json`
- **`scripts/lib/schema_check.mjs`** — zero-dependency JSON Schema validator (subset covering `type`, `required`, `enum`, `oneOf`/`anyOf`/`allOf`/`not`, `$ref` to `$defs`, `pattern`, `format`, numeric/string constraints, array `items`, `additionalProperties`).
- **`scripts/lib/yaml_subset.mjs`** — zero-dependency YAML loader supporting scalar keys, nested maps, block sequences with inline-map items, flow-style single-line lists, comments, **lazy reification** (a `foo:` placeholder becomes `[]` the first time a `- ` child appears).
- **`assets/profiles/elven.yaml`** — optional Elven Works LGTM defaults (canonical label model, datasource names, allowlist, common trigger phrases).
- **CLI namespace disambiguation**: `show playbook:<id>` / `show prompt:<id>` / `show profile:<id>` resolve the previous collision when an id existed in both kinds.
- **CLI `--version`** at the top level and on every script (reads from `package.json`).
- **CLI `doctor` deep checks**: SKILL.md frontmatter `≤1024` chars (agentskills.io spec), valid YAML+JSON, all referenced files present, prompt headings exist, every script has the Node shebang, every JSON Schema parses, `evals.json` structurally valid.
- **`scripts/redaction.mjs` + `redact` CLI subcommand** with the same exit-code convention as the rest.
- **Test suite expanded** from 9 to 36 tests (CLI + library) covering: frontmatter limits, namespace disambiguation, schema validation pass/fail, YAML lazy reification, flow-style lists, alert/dashboard rubric edge cases, redaction (static & hash), template export, install-skill, profile lookup.
- **GitHub Actions CI** matrix (Node 18 / 20 / 22).
- `CONTRIBUTING.md`, `LICENSE` (MIT), `.npmignore`.

### Changed
- **Package renamed** from `mcp-observability-auditor` to `@elven-observability/observability-auditor-skill` (scoped). The two CLI binaries (`mcp-observability-auditor` and `observability-auditor`) remain stable so existing install instructions keep working.
- **License**: `UNLICENSED` → `MIT`.
- **`SKILL.md`**:
  - Frontmatter is now `≤1024` characters and CSO-compliant (description focuses on triggering conditions only — no workflow summary).
  - Hard Rule #5 (redaction) references the new catalog.
  - Hard Rule #9 (MCP safety contract) added.
  - Hard Rule #10 (prefer OTel-stable semantic conventions) added.
  - Router table now includes `mcp-safety.md` and `redaction-patterns.md`.
  - Self-check expanded to verify write authorisations.
- **`references/slo-best-practices-2026.md`** — rewritten with the OTel 1.27 stable semantic-conventions table (`service.name`, `deployment.environment.name`, `http.server.request.duration`, `db.client.operation.duration`, `k8s.cluster.name`), exemplars guidance, Adaptive Metrics guidance, synthetic monitoring notes, and an **error-budget policy** template (4 tiers: green / yellow / orange / red, owners and required responses).
- **`references/query-library.md`** — added OTel old-vs-stable quick-reference table, HTTP client and `db.client.operation.duration` queries, exemplars section, spanmetrics, and ClickHouse OTel-logs schema.
- **`scripts/score_alert.mjs` and `scripts/score_dashboard.mjs`**: priority bucket bug fixed (was duplicating `high`); new 5-step ladder `critical / high / medium / low / info`.
- **All scripts**: exit codes aligned (`0` ok, `1` usage error, `2` data/validation error), shared `--version` and `--help`, error output on stderr.
- **`scripts/render_report.mjs`** uses the new shared YAML loader (handles inline maps under block sequences, flow lists, URLs containing colons).
- **`scripts/validate_context.mjs`** now runs **schema + lint** layers; `--schema <file>` overrides the default; `--no-schema` reverts to legacy lint-only.
- **`findings.json` template** points to the canonical `../schemas/findings.schema.json` (was a dangling path).
- **`audit-report.md` template** now escapes the literal `{{placeholders}}` in the HTML comment so it survives rendering.
- **Manifest** (`assets/manifest.json`) now lists `playbooks`, `prompts`, `templates`, **`schemas`**, **`profiles`**, `scripts` — and the CLI surfaces each group.

### Fixed
- `score_alert.mjs` and `score_dashboard.mjs` priority ladder duplicated `high`. Now five distinct buckets.
- YAML loader treated `foo:` with empty value as a map even when the child was a `- ` list. Lazy reification fixes that.
- `findEntry` in the CLI returned the first kind silently when an id existed in both `playbook` and `prompt` (e.g. `app-deep-dive`); now it prints a hint and accepts a `kind:id` form.
- `validate_context.mjs` exit codes were inconsistent with other scripts (`2` vs `1`); now standardised across the project.

## [0.2.0] — 2026-05-11

Internal pre-release. Skill + CLI + initial scripts + 9-test baseline.

## [0.1.0] — 2026-05-08

Initial scaffolding.
