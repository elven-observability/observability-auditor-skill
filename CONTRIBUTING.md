# Contributing

Thanks for wanting to make the observability-auditor skill better. The skill is **process-first**: every change should make audits *more honest*, *more reproducible*, or *more boring*. If you find yourself adding cleverness, prefer a one-liner reference in `anti-patterns.md` instead.

## Setup

```bash
git clone https://github.com/elven-observability/observability-auditor-skill.git
cd observability-auditor-skill
npm install        # there are no runtime deps; this just hydrates dev deps if any are added
npm test           # 36 tests, ~2s
npm run doctor     # validates the packaged skill end-to-end
```

Node ≥18 required. Zero runtime dependencies is a design goal — please don't add `dependencies` to `package.json` without a strong case.

## Where to make changes

| Change | File / location |
|---|---|
| New playbook | `skill/mcp-observability-auditor/references/<name>.md` + entry in `assets/manifest.json` + router row in `SKILL.md` |
| New deterministic helper | `skill/mcp-observability-auditor/scripts/<name>.mjs` + entry in `assets/manifest.json` |
| Shared lib | `skill/mcp-observability-auditor/scripts/lib/<name>.mjs` (no deps; covered by `tests/lib.test.mjs`) |
| New CLI subcommand | `bin/mcp-observability-auditor.mjs` — keep exit codes consistent (`0` / `1` / `2`) |
| New JSON Schema | `skill/mcp-observability-auditor/assets/schemas/<name>.schema.json` |
| Template | `skill/mcp-observability-auditor/assets/templates/<name>.<ext>` |
| Profile (org-specific defaults) | `skill/mcp-observability-auditor/assets/profiles/<org>.yaml` |

## Hard rules for changes

1. **No new runtime dependency** without an issue first. The CLI must keep running on `node --no-warnings` with the Node stdlib only.
2. **Every script** must respond to `--version`, `--help`, and use exit codes `0` (ok) / `1` (usage error) / `2` (data/validation error).
3. **Every claim in a reference** should follow the same evidence rules the skill itself enforces (`anti-patterns.md`). Don't write "best practice" without citing the upstream source.
4. **SKILL.md frontmatter must stay ≤1024 chars** (`agentskills.io` spec) and the `description` field stays focused on *triggering conditions only* (CSO compliance).
5. **All write-side MCP tools belong to the hard-block list** (`mcp-safety.md`). Adding a new "read" tool is fine; promoting one to "auto-allow" requires a paragraph of reasoning in the PR description.

## Tests

Tests live in `tests/`:

- `tests/lib.test.mjs` — unit tests for `scripts/lib/yaml_subset.mjs` and `scripts/lib/schema_check.mjs`.
- `tests/cli.test.mjs` — end-to-end CLI tests, also covers each script via `mcp-observability-auditor <script-subcommand>`.

Run `npm test`. Add at least one test per new behaviour, plus a `doctor` check if the new behaviour adds files to the skill tree.

## CI

Pushes to `main` and pull requests run `npm run lint && npm test && npm run doctor` against Node 18, 20, and 22 in `.github/workflows/ci.yml`. The CI must pass before merge.

## Release process (maintainers)

1. Bump `version` in `package.json`.
2. Update `CHANGELOG.md` (Keep a Changelog format).
3. Run the full prepublish gate:
   ```bash
   npm run prepublishOnly
   ```
4. `npm publish` (scoped, public access is preconfigured).
5. Tag the commit: `git tag v$(node -p "require('./package.json').version") && git push --tags`.

## Style notes

- Match the surrounding code's style (zero deps, ESM, plain `node:` imports).
- Markdown references should open with a one-sentence "Use when…" and a "Mission" paragraph.
- Don't use emojis in references or `SKILL.md` (they survive copy-paste poorly in some agent UIs).
- Tables beat lists when the reader needs to scan. Lists beat tables when the reader needs to follow steps.

## Questions

Open an issue at [github.com/elven-observability/observability-auditor-skill/issues](https://github.com/elven-observability/observability-auditor-skill/issues) — or reach out internally via the Elven engineering channel.
