<div align="center">

# 🛰️ Observability Auditor Skill

**Pergunte ao seu agente "o que quebrou ontem no checkout?" — receba um relatório executivo + evidência reproduzível, sem teatro.**

[![npm](https://img.shields.io/npm/v/@elven-observability/observability-auditor-skill.svg?color=cb3837&label=npm)](https://www.npmjs.com/package/@elven-observability/observability-auditor-skill)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-36%20passing-brightgreen)](./tests)
[![Skills Spec](https://img.shields.io/badge/agentskills.io-1.0-blueviolet)](https://agentskills.io/specification)
[![Read-only by default](https://img.shields.io/badge/read--only-by%20default-success)](./skill/mcp-observability-auditor/references/mcp-safety.md)

</div>

---

## TL;DR

Uma **Agent Skill** (Claude / Codex / qualquer agente que entenda MCP) + um **CLI Node sem dependências** que **audita stacks Grafana** (Mimir/Prometheus, Loki, Tempo, Pyroscope, ClickHouse, …) através de MCP, com regras de honestidade que recusam achismo:

- 🔒 **Read-only por padrão** — nenhum write em alerta/dashboard/incidente sem autorização explícita.
- 🧾 **Toda afirmação tem citação** — datasource, query, janela com timezone, observado, baseline, confiança, próxima validação.
- ⚖️ **Escala de confiança 3 níveis** com counter-test exigido para "high".
- 📜 **Redação automática** de Bearer/JWT/AWS/Stripe/cookies/CPF/CNPJ/PII.
- 📈 **2026-ready**: OTel semconv estável, exemplars, multi-window burn-rate, error-budget policy.

---

## Veja em 30 segundos

Você pede:

> 💬 *"Cliente AcmeRetail (org 42, TZ America/Sao_Paulo). Por que o checkout caiu entre 14:00 e 16:30 ontem? Read-only."*

A skill devolve:

```text
Between 2026-05-10T14:00:00-03:00 and 2026-05-10T16:30:00-03:00 (America/Sao_Paulo),
checkout completion rate dropped 42% (from 87% to 50%).

The strongest evidence indicates Postgres connection-pool exhaustion on
checkout-db, aligned with traffic burst from marketing campaign.
Confidence: high.

Top 3 actions:
1. Raise checkout-db max_connections 200→400  (owner: data-platform)
2. Add 14.4×/6× burn-rate alert on Checkout-SLO 99.5%/28d  (owner: checkout-platform)
3. Enable Tempo↔Mimir exemplars on http_server_request_duration_seconds (owner: platform-obs)

[+ timeline table, evidence ledger, scored alerts/dashboards,
   reproducible appendix with every query and deeplink]
```

Cada linha cita **datasource + query + window + observado + baseline + confiança + next validation**. Sem isso, não vira finding.

---

## Instalação

### 🤖 Como Agent Skill (no Claude Code / Codex)

```bash
npx @elven-observability/observability-auditor-skill install-skill --dest ~/.claude/skills
# ou para Codex / Agent SDK:
npx @elven-observability/observability-auditor-skill install-skill --dest ~/.agents/skills
```

Pronto. Abra seu agente e mande "audita o checkout do cliente X" — ele já carrega a skill sozinho.

### 💻 Como CLI

```bash
npm install -g @elven-observability/observability-auditor-skill
mcp-observability-auditor --version
mcp-observability-auditor doctor
```

Ou sem instalar nada:

```bash
npx @elven-observability/observability-auditor-skill list
```

---

## Quickstart em 3 passos

```bash
# 1️⃣  Exporta os templates pra dentro do seu cliente/projeto
mcp-observability-auditor export-templates --dest ./meu-audit

# 2️⃣  Preenche audit-context.yaml (cliente, org_id, timezone, janelas) e valida
cd ./meu-audit
mcp-observability-auditor validate-context --context ./audit-context.yaml --strict

# 3️⃣  No agente, executa o prompt master e deixa ele dirigir o MCP
mcp-observability-auditor prompt master \
  --client AcmeRetail --org-id 42 \
  --grafana-url https://grafana.acme.com --timezone America/Sao_Paulo
```

No final você roda:

```bash
mcp-observability-auditor render-report \
  --findings ./findings.json --context ./audit-context.yaml \
  --out ./audit-report.md
```

E entrega o **markdown executivo + técnico** pro cliente.

---

## Casos de uso típicos (prompts que funcionam)

| Pergunta | O que a skill faz |
|---|---|
| *"O que quebrou ontem no checkout do cliente X entre 14h e 16h?"* | Normaliza janela em TZ, monta `bad/good/baseline`, walka traffic → errors → p95 → deps → biz, entrega timeline + leading hypothesis com counter-test. |
| *"Audita as alert rules do org 42 — quais ficam, quais ajusta, quais deleta."* | Rubrica 0–5 por alerta, threshold validado contra p50/p95/p99 do baseline, recomendação concreta (keep/tune/delete/split/replace). |
| *"Esses 6 dashboards do folder Checkout — quais ajudam num incidente, quais são teatro?"* | Score por dashboard, flagga "All" defaults, counter-on-gauge, links faltando para logs/traces, recomendações por painel. |
| *"Recomenda SLOs para payment-svc, auth-svc e checkout-svc (200/30/5 rps)."* | SLO inventory por serviço, multi-window burn-rate, **traffic-floor guard** para o serviço de baixa carga, error-budget policy 4-tiers. |
| *"Cria um alerta e silencia o de CPU enquanto investigo."* | **Recusa** sem autorização explícita echoando UIDs. Mostra o body proposto + diff + rollback antes de qualquer write. |

Todos esses prompts estão em [`evals/evals.json`](./evals/evals.json) — você pode rodar contra o seu MCP real pra validar.

---

## O que vem dentro

```
observability-auditor-skill/
├── bin/                            CLI (mcp-observability-auditor / observability-auditor)
├── evals/evals.json                6 prompts pt-BR realistas
├── tests/                          36 testes node:test
└── skill/mcp-observability-auditor/
    ├── SKILL.md                    router enxuto (761 chars frontmatter, CSO-compliant)
    ├── references/                 13 playbooks
    │   ├── preflight-readonly.md
    │   ├── mcp-safety.md           🆕 allowlist + protocolo de write
    │   ├── redaction-patterns.md   🆕 catálogo regex (Bearer/JWT/AWS/CPF/…)
    │   ├── org-discovery.md
    │   ├── app-deep-dive.md
    │   ├── incident-timeline.md
    │   ├── alert-threshold-audit.md
    │   ├── dashboard-audit.md
    │   ├── slo-best-practices-2026.md  🆕 OTel-stable + exemplars + error-budget
    │   ├── query-library.md            🆕 OTel semconv + HTTP client + DB + exemplars
    │   ├── mcp-tool-catalog.md
    │   ├── anti-patterns.md
    │   └── report-template.md
    ├── assets/
    │   ├── manifest.json           tudo que o CLI expõe
    │   ├── templates/              audit-context.yaml, audit-report.md, findings.json, evidence-ledger.yaml
    │   ├── schemas/                🆕 4 JSON Schemas 2020-12
    │   └── profiles/elven.yaml     🆕 defaults Elven (label model, datasources)
    └── scripts/                    7 helpers determinísticos (zero deps)
        ├── window_math.mjs         normaliza janela + baselines + slice grid
        ├── validate_context.mjs    schema + lint
        ├── score_alert.mjs         rubrica 0–5 com 5-step priority
        ├── score_dashboard.mjs     idem
        ├── render_report.mjs       findings.json → audit-report.md
        ├── render_prompt.mjs       substitui [PLACEHOLDERS] em prompts
        ├── redaction.mjs           🆕 aplica catálogo (--hash preserva distinct-count)
        └── lib/
            ├── yaml_subset.mjs     loader YAML zero-dep
            └── schema_check.mjs    validator JSON Schema zero-dep
```

---

## Cheat sheet — CLI

<details>
<summary><b>Clique para abrir a lista completa de comandos</b></summary>

```text
mcp-observability-auditor [--version | --help]
mcp-observability-auditor list [--json]
mcp-observability-auditor playbooks | prompts | templates | schemas | profiles | scripts [--json]
mcp-observability-auditor show <id>                                # auto-resolve com hint
mcp-observability-auditor show playbook:<id> | prompt:<id> | profile:<id>    # explícito
mcp-observability-auditor prompt [id] [--client X] [--org-id X] [--timezone X] [--set KEY=VALUE …] [--output file]
mcp-observability-auditor export-templates [--dest dir] [--force] [--dry-run]
mcp-observability-auditor install-skill [--dest ~/.agents/skills] [--force] [--dry-run]
mcp-observability-auditor window --start <ISO> --end <ISO> [--tz <IANA>] [--slice <m>] [--json]
mcp-observability-auditor validate-context --context <file> [--strict] [--schema <file>] [--no-schema]
mcp-observability-auditor score-alert (--alert <file> | --batch <file>|- | --inline <json>)
mcp-observability-auditor score-dashboard (--dashboard <file> | --batch <file>|- | --inline <json>)
mcp-observability-auditor render-report --findings <file> [--context <file>] [--template <file>] [--out <file>]
mcp-observability-auditor render-prompt --id <prompt-id> [--set KEY=VALUE …] [--out <file>]
mcp-observability-auditor redact [--in <file>] [--out <file>] [--hash] [--keep-emails] [--keep-ips] [--extra <file>]
mcp-observability-auditor doctor [--strict]
```

**Exit codes** consistentes em todos os scripts: `0` ok · `1` usage error · `2` data/validation error. Todo script responde a `--version` e `--help`.

</details>

---

## Honesty contract

A skill se recusa a fazer estas coisas, mesmo sob pressão:

- ❌ Inventar nomes de métricas / fabricar valores
- ❌ Filtrar por label sem provar que ele existe (`list_*_label_names` primeiro, sempre)
- ❌ Chamar `root cause` sem ≥2 sinais corroborantes + counter-test que rodou
- ❌ Mutar produção sem autorização explícita echoando UID/escopo
- ❌ Esconder cobertura faltando atrás de "no issues found"
- ❌ Vazar token, cookie, JWT, AWS key, PII no relatório (catálogo de redação aplicado)

Em compensação, **toda** afirmação no relatório vem com:

```yaml
datasource: mimir-prod
tool_or_query: histogram_quantile(0.95, sum by (le, service_name)(rate(...)))
time_range: 2026-05-10T14:00:00-03:00 → 2026-05-10T16:30:00-03:00
filters: { service_name: checkout, environment: prod }
observed: p95 = 850ms
baseline_or_comparator: same-hour-yesterday p95 = 12ms
confidence: high
counter_test: db p95 stayed flat → upstream caller (refutado: db saltou no mesmo minuto)
next_validation: <cheapest query that would falsify this finding>
```

Detalhes em [`references/anti-patterns.md`](./skill/mcp-observability-auditor/references/anti-patterns.md).

---

## Compatibilidade

| Categoria | Compatível |
|---|---|
| **Agents** | Claude Code, Claude Desktop, Codex CLI, Claude Agent SDK, qualquer runtime que carregue `SKILL.md` |
| **MCP servers** | `mcp-grafana`, `EOAdmin`, `ElvenGrafana`, `EO-MCP-WEVY`, qualquer Grafana-MCP-compatible |
| **Backends** | Mimir, Prometheus, Loki, Tempo, Pyroscope, ClickHouse-OTel, Elasticsearch (Lucene/DSL), Grafana Incident, Grafana OnCall, Sift |
| **Auto-instrumentation** | OTel SDK ≥1.27 (stable), Beyla, manual semconv |
| **Node** | ≥18 (testado em 18 / 20 / 22) |

---

## Desenvolvimento

```bash
git clone https://github.com/elven-observability/observability-auditor-skill
cd observability-auditor-skill
npm install
npm test            # 36 tests, ~2s
npm run doctor      # valida o skill manifest inteiro
npm run lint        # node --check em cada .mjs
npm run pack:dry    # preview do tarball npm
```

Quer adicionar um playbook ou helper? Veja [CONTRIBUTING.md](./CONTRIBUTING.md). Resumo: zero deps, ESM, todos os scripts respondem a `--help` / `--version`, exit codes consistentes.

---

## Roadmap

- [ ] **Adapters MCP** — adaptador first-class para `mcp-grafana`, Datadog MCP, New Relic MCP.
- [ ] **`audit-context.json`** alternativo ao YAML (já suportado, mas precisa de doc dedicada).
- [ ] **Web UI** opcional pra explorar `findings.json` (provavelmente em outro pacote).
- [ ] **AI evals** automatizados rodando os 6 prompts em `evals/` contra um Grafana MCP mock.

Sugestões: abra uma issue ou um PR — o tom da skill é "boring beats clever".

---

## Licença

[MIT](./LICENSE) © Elven Observability — feito com 💚 pelo time de plataforma.

Quer usar fora da Elven? Vai em frente. Crédito é bem-vindo mas não obrigatório.
