// pretty.mjs — human-friendly terminal output for score-alert and score-dashboard.
//
// Color-aware (respects NO_COLOR + tty detection). Falls back to plain text when
// stdout isn't a terminal so it pipes cleanly into other tools without ANSI noise.

const HAS_TTY = process.stdout && process.stdout.isTTY;
const COLOR_OFF = process.env.NO_COLOR !== undefined || process.env.TERM === "dumb";
const COLOR = HAS_TTY && !COLOR_OFF;

const STYLE = {
  reset: COLOR ? "\x1b[0m"  : "",
  bold:  COLOR ? "\x1b[1m"  : "",
  dim:   COLOR ? "\x1b[2m"  : "",
  red:   COLOR ? "\x1b[31m" : "",
  green: COLOR ? "\x1b[32m" : "",
  yellow:COLOR ? "\x1b[33m" : "",
  blue:  COLOR ? "\x1b[34m" : "",
  cyan:  COLOR ? "\x1b[36m" : "",
  grey:  COLOR ? "\x1b[90m" : ""
};

const PRIORITY_STYLE = {
  critical: { color: STYLE.red,    icon: "🔴", label: "critical" },
  high:     { color: STYLE.red,    icon: "🟠", label: "high"     },
  medium:   { color: STYLE.yellow, icon: "🟡", label: "medium"   },
  low:      { color: STYLE.cyan,   icon: "🔵", label: "low"      },
  info:     { color: STYLE.green,  icon: "🟢", label: "info"     }
};

function bar(score) {
  // visual progress bar for the 0-5 score; quarter-point granularity.
  const filled = Math.round(score * 4);   // 0..20
  const total = 20;
  const ch = "█";
  const empty = "·";
  const colorFor =
    score >= 4 ? STYLE.green :
    score >= 3 ? STYLE.cyan  :
    score >= 2 ? STYLE.yellow :
                 STYLE.red;
  return `${colorFor}${ch.repeat(filled)}${STYLE.grey}${empty.repeat(total - filled)}${STYLE.reset}`;
}

function box(text, width = 78) {
  const top    = "┌" + "─".repeat(width - 2) + "┐";
  const bottom = "└" + "─".repeat(width - 2) + "┘";
  const lines = text.split("\n").map((l) => {
    // pad/truncate to fit, ignoring ANSI sequences
    const visible = l.replace(/\x1b\[[0-9;]*m/g, "");
    const pad = Math.max(0, width - 4 - visible.length);
    return `│ ${l}${" ".repeat(pad)} │`;
  });
  return [top, ...lines, bottom].join("\n");
}

function reasonIcon(reason) {
  if (/will flap|below baseline|above baseline p99|fired AFTER|missing required/i.test(reason)) return "❌";
  if (/missing label|missing annotation|missing owner|no client variable|no log link|no trace link|no alert link/i.test(reason)) return "⚠️ ";
  if (/cause-type alert on a user-facing|noDataState=OK/i.test(reason)) return "❌";
  if (/All|counter directly|percentile on a gauge|panels missing units|too many panels|top panel is not user-facing/i.test(reason)) return "⚠️ ";
  if (/threshold in p95–p99|reasonable|user-facing/i.test(reason)) return "✅";
  if (/^note:/i.test(reason)) return "ℹ️ ";
  return "·";
}

export function renderScoredAlert(scored) {
  const { uid, title, score, priority, recommendation, reasons = [] } = scored;
  const prio = PRIORITY_STYLE[priority] || PRIORITY_STYLE.medium;
  const header = `${STYLE.bold}${title}${STYLE.reset} ${STYLE.grey}(${uid || "no-uid"})${STYLE.reset}`;
  const scoreLine = `Score: ${STYLE.bold}${score} / 5${STYLE.reset}   ${bar(score)}`;
  const prioLine = `Priority: ${prio.color}${STYLE.bold}${prio.icon} ${prio.label}${STYLE.reset}   ${STYLE.dim}${recommendation}${STYLE.reset}`;
  const reasonBlock = reasons.length === 0
    ? "  (no issues found)"
    : reasons.map((r) => `  ${reasonIcon(r)} ${r}`).join("\n");
  return `${box(`${header}\n${scoreLine}\n${prioLine}`)}\n${reasonBlock}\n`;
}

export function renderScoredDashboard(scored) {
  const { uid, title, score, priority, recommendation,
          primary_question, strengths = [], gaps = [] } = scored;
  const prio = PRIORITY_STYLE[priority] || PRIORITY_STYLE.medium;
  const header = `${STYLE.bold}${title}${STYLE.reset} ${STYLE.grey}(${uid || "no-uid"})${STYLE.reset}`;
  const scoreLine = `Score: ${STYLE.bold}${score} / 5${STYLE.reset}   ${bar(score)}`;
  const prioLine = `Priority: ${prio.color}${STYLE.bold}${prio.icon} ${prio.label}${STYLE.reset}   ${STYLE.dim}${recommendation}${STYLE.reset}`;
  const lines = [header, scoreLine, prioLine];
  if (primary_question) lines.push(`${STYLE.dim}Primary panel:${STYLE.reset} ${primary_question || "(none)"}`);
  const top = box(lines.join("\n"));
  const strengthBlock = strengths.length ? strengths.map((s) => `  ✅ ${s}`).join("\n") : "  (none reported)";
  const gapBlock = gaps.length ? gaps.map((g) => `  ⚠️  ${g}`).join("\n") : "  (none)";
  return `${top}\nStrengths:\n${strengthBlock}\nGaps:\n${gapBlock}\n`;
}

export function renderBatchSummary(items, kind) {
  // One-line summary table for batch mode.
  const cols = [
    { key: "title", header: "title", width: 40 },
    { key: "score", header: "score", width: 5, align: "right" },
    { key: "priority", header: "priority", width: 9 },
    { key: "recommendation", header: "recommendation", width: 22 }
  ];
  const header = cols.map((c) => pad(c.header, c.width, c.align)).join("  ");
  const sep = cols.map((c) => "─".repeat(c.width)).join("  ");
  const rows = items.map((it) => cols.map((c) => {
    const v = it[c.key];
    if (c.key === "priority") {
      const prio = PRIORITY_STYLE[v] || PRIORITY_STYLE.medium;
      return pad(`${prio.icon} ${prio.label}`, c.width + (COLOR ? 0 : 0));
    }
    return pad(String(v ?? ""), c.width, c.align);
  }).join("  "));
  const total = items.length;
  const byPrio = items.reduce((acc, it) => { acc[it.priority] = (acc[it.priority] || 0) + 1; return acc; }, {});
  const summary = `${STYLE.bold}Scored ${total} ${kind}${total === 1 ? "" : "s"}${STYLE.reset}  ` +
    Object.entries(byPrio)
      .map(([p, n]) => `${(PRIORITY_STYLE[p] || PRIORITY_STYLE.medium).icon} ${n} ${p}`)
      .join("  ");
  return [summary, "", header, sep, ...rows, ""].join("\n");
}

function pad(s, w, align = "left") {
  const visible = String(s).replace(/\x1b\[[0-9;]*m/g, "");
  if (visible.length > w) return visible.slice(0, w - 1) + "…";
  const pad = " ".repeat(w - visible.length);
  return align === "right" ? pad + s : s + pad;
}
