# Scripts

Deterministic helpers for tasks the LLM would otherwise re-derive every session. Node 18+ ESM, zero dependencies (stdlib only). Run with `node scripts/<name>.mjs --help`.

| Script | Purpose |
|---|---|
| `window_math.mjs` | Normalise a bad window to UTC and produce same-tz comparators (yesterday/last-week) and a slice grid. |
| `render_prompt.mjs` | Substitute placeholders (e.g. `[CLIENT]`) into any prompt in `references/prompt-library.md`. |
| `validate_context.mjs` | Fail-fast check that `audit-context.yaml` has the required fields and well-formed windows. |
| `score_alert.mjs` | Score a single alert (or `--batch` an array) against the rubric in `references/alert-threshold-audit.md`. |
| `score_dashboard.mjs` | Score a single dashboard (or `--batch`) against the rubric in `references/dashboard-audit.md`. |
| `render_report.mjs` | Render `findings.json` + `audit-context.yaml` into the populated `audit-report.md`. |

## General principles

- Pure functions where possible — no MCP calls. The skill calls MCP; the scripts shape data.
- JSON in, JSON or markdown out. Stable formats.
- `--help` on every script.
- Exit non-zero with a useful message on bad input. Never silently succeed with empty output.

## Example flows

Validate context before starting:

```bash
node scripts/validate_context.mjs --context ./audit-context.yaml
```

Render a master prompt with substitutions:

```bash
node scripts/render_prompt.mjs --id master \
  --set CLIENT=AcmeRetail --set GRAFANA_URL=https://grafana.acme.com \
  --set ORG_ID=42 --set TIMEZONE=America/Sao_Paulo
```

Compute comparison windows for a bad incident window:

```bash
node scripts/window_math.mjs \
  --start 2026-05-10T14:00:00-03:00 \
  --end   2026-05-10T16:30:00-03:00 \
  --tz America/Sao_Paulo
```

Score a single alert (paste its rule JSON):

```bash
node scripts/score_alert.mjs --alert ./alert.json
```

Render the final report:

```bash
node scripts/render_report.mjs \
  --context ./audit-context.yaml \
  --findings ./findings.json \
  --template ../assets/templates/audit-report.md \
  --out ./audit-report.md
```
