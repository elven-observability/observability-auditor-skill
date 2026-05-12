# Examples

A worked, end-to-end audit you can read or replay. Numbers and names are illustrative — replace with your own.

## What's in here

| File | What it is |
|---|---|
| [`audit-context.yaml`](./audit-context.yaml) | Frame of the audit — client, org, timezone, windows, label model, allowlist. Filled out. |
| [`alerts.json`](./alerts.json) | Two alert rules ready to feed into `score-alert --batch`. |
| [`findings.json`](./findings.json) | Final audit output — leading hypothesis, evidence, blind spots, recommendations. |
| [`audit-report.md`](./audit-report.md) | The two-layer client report rendered from the two files above. |

## Replay it locally

```bash
# 1. Score the two example alerts (human-friendly output by default)
mcp-observability-auditor score-alert --batch ./alerts.json

# 2. Or as JSON for CI / jq pipelines
mcp-observability-auditor score-alert --batch ./alerts.json --json | jq '.[] | {title, score, priority}'

# 3. Render the final markdown report
mcp-observability-auditor render-report \
  --findings ./findings.json \
  --context ./audit-context.yaml \
  --out ./audit-report.regenerated.md

# 4. Compare with the committed version
diff ./audit-report.md ./audit-report.regenerated.md
```

## Use it as a template for a real audit

```bash
# Copy this folder to your client's worktree
cp -r examples/ ~/audits/acme-2026-05-12

cd ~/audits/acme-2026-05-12
$EDITOR audit-context.yaml         # change client/org/timezone/windows
mcp-observability-auditor validate-context --context ./audit-context.yaml --strict

# Now open Claude and ask it to drive the MCP audit using this context.
# When it produces a findings.json, render the final report:
mcp-observability-auditor render-report \
  --findings ./findings.json --context ./audit-context.yaml --out ./audit-report.md
```
