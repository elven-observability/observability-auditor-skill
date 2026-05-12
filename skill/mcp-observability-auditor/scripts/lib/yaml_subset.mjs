// yaml_subset.mjs — zero-dependency YAML loader for the subset used by this skill.
//
// Supports:
//   - scalar keys ("key: value"), with quoted strings
//   - nested 2-space maps
//   - block sequences with scalar OR inline-map items ("- key: value" with
//     subsequent indented sub-keys)
//   - flow-style single-line lists ("[a, b, c]") with quoted/numeric scalars
//   - comments preceded by whitespace (# stripped only when safe)
//   - lazy reification: "foo:" with empty value becomes {} by default, promoted
//     to [] the first time a "- " child appears
//
// Does NOT handle:
//   - YAML anchors / aliases
//   - flow-style maps ({ a: 1, b: 2 })
//   - multi-line strings (| or >)
//   - merge keys (<<:)
//   - tags (!!str)
//
// Throws on malformed input — callers wrap in try/catch and translate to their
// own exit-code convention.

export class YamlSubsetError extends Error {
  constructor(message) { super(message); this.name = "YamlSubsetError"; }
}

export function loadYamlSubset(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, node: root, parent: null, key: null, lazy: false }];

  function topFrame() { return stack[stack.length - 1]; }

  function promoteToArrayIfNeeded() {
    const top = topFrame();
    if (top.lazy && top.parent != null && top.key != null && !Array.isArray(top.node)) {
      const arr = [];
      top.parent[top.key] = arr;
      top.node = arr;
    }
  }

  for (let raw of lines) {
    raw = stripTrailingComment(raw).replace(/\s+$/, "");
    if (!raw.trim()) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.slice(indent);

    while (stack.length > 1 && indent <= topFrame().indent) stack.pop();
    const top = topFrame();
    const parent = top.node;

    if (line.startsWith("- ") || line === "-") {
      promoteToArrayIfNeeded();
      const owner = topFrame();
      if (!Array.isArray(owner.node)) {
        throw new YamlSubsetError(`YAML list item without an owning list: ${raw}`);
      }
      const item = line === "-" ? "" : line.slice(2).trim();
      if (item && /^[^"'#][^:]*:/.test(item)) {
        const colon = item.indexOf(":");
        const k = item.slice(0, colon).trim();
        const rest = item.slice(colon + 1).trim();
        const obj = {};
        owner.node.push(obj);
        if (rest === "" || rest === "[]" || rest === "{}") {
          const inner = rest === "[]" ? [] : {};
          obj[k] = inner;
          stack.push({ indent, node: obj, parent: null, key: null, lazy: false });
          stack.push({ indent: indent + 2, node: inner, parent: obj, key: k, lazy: rest === "" });
        } else {
          obj[k] = parseScalar(rest);
          stack.push({ indent, node: obj, parent: null, key: null, lazy: false });
        }
      } else {
        owner.node.push(item === "" ? null : parseScalar(item));
      }
      continue;
    }

    const colonAt = line.indexOf(":");
    if (colonAt === -1) throw new YamlSubsetError(`Cannot parse line: ${raw}`);
    const key = line.slice(0, colonAt).trim();
    const rest = line.slice(colonAt + 1).trim();

    if (rest === "" || rest === "[]" || rest === "{}") {
      const next = rest === "[]" ? [] : {};
      parent[key] = next;
      stack.push({ indent, node: next, parent, key, lazy: rest === "" });
    } else {
      parent[key] = parseScalar(rest);
    }
  }
  return root;
}

function stripTrailingComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === "#" && !inDouble && !inSingle && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, "");
    }
  }
  return line;
}

export function parseScalar(text) {
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) return text.slice(1, -1);
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1);
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d+\.\d+$/.test(text)) return Number(text);
  if (text.startsWith("[") && text.endsWith("]")) return parseFlowList(text.slice(1, -1));
  return text;
}

function parseFlowList(body) {
  if (body.trim() === "") return [];
  const out = [];
  let depth = 0;
  let inDouble = false;
  let inSingle = false;
  let buf = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '"' && !inSingle) { inDouble = !inDouble; buf += ch; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; buf += ch; continue; }
    if (!inDouble && !inSingle) {
      if (ch === "[" || ch === "{") depth += 1;
      else if (ch === "]" || ch === "}") depth -= 1;
      else if (ch === "," && depth === 0) {
        out.push(parseScalar(buf.trim()));
        buf = "";
        continue;
      }
    }
    buf += ch;
  }
  if (buf.trim() !== "") out.push(parseScalar(buf.trim()));
  return out;
}
