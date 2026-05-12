// Unit tests for the deterministic libs that everything else depends on:
//   scripts/lib/yaml_subset.mjs
//   scripts/lib/schema_check.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const libDir = path.join(rootDir, "skill", "mcp-observability-auditor", "scripts", "lib");

const { loadYamlSubset, parseScalar } = await import(path.join(libDir, "yaml_subset.mjs"));
const { validate } = await import(path.join(libDir, "schema_check.mjs"));

test("yaml_subset: scalars and quoted strings", () => {
  const out = loadYamlSubset(`a: 1\nb: "two"\nc: 'three'\nd: true\ne: null\n`);
  assert.deepEqual(out, { a: 1, b: "two", c: "three", d: true, e: null });
});

test("yaml_subset: nested 2-space map", () => {
  const out = loadYamlSubset(`outer:\n  inner: 1\n  other: "x"\n`);
  assert.deepEqual(out, { outer: { inner: 1, other: "x" } });
});

test("yaml_subset: block sequence with inline-map items (lazy reification)", () => {
  // The container "baseline_windows:" has no explicit "[]"; the loader must
  // promote it to an array when the first "- " child appears.
  const yaml = `baseline_windows:
  - label: "yesterday"
    start: "2026-05-09T14:00:00Z"
    end: "2026-05-09T16:00:00Z"
  - label: "last-week"
    start: "2026-05-03T14:00:00Z"
    end: "2026-05-03T16:00:00Z"
`;
  const out = loadYamlSubset(yaml);
  assert.ok(Array.isArray(out.baseline_windows));
  assert.equal(out.baseline_windows.length, 2);
  assert.equal(out.baseline_windows[0].label, "yesterday");
  assert.equal(out.baseline_windows[1].end, "2026-05-03T16:00:00Z");
});

test("yaml_subset: flow-style single-line list", () => {
  const out = loadYamlSubset(`envs: ["prod", "staging", "hml"]\n`);
  assert.deepEqual(out.envs, ["prod", "staging", "hml"]);
});

test("yaml_subset: URLs with colons survive intact", () => {
  const out = loadYamlSubset(`grafana_url: "https://g.acme.com:443/path"\n`);
  assert.equal(out.grafana_url, "https://g.acme.com:443/path");
});

test("yaml_subset: comments preceded by whitespace are stripped, but # inside quotes is kept", () => {
  const out = loadYamlSubset(`a: "x # not a comment"   # this is a comment\nb: 2\n`);
  assert.equal(out.a, "x # not a comment");
  assert.equal(out.b, 2);
});

test("yaml_subset: nested map under a block-sequence inline-map", () => {
  const yaml = `services:
  - name: "checkout"
    labels:
      env: "prod"
      tier: "1"
  - name: "payment"
    labels:
      env: "prod"
`;
  const out = loadYamlSubset(yaml);
  assert.equal(out.services.length, 2);
  assert.equal(out.services[0].labels.env, "prod");
  assert.equal(out.services[0].labels.tier, "1");
  assert.equal(out.services[1].labels.env, "prod");
});

test("parseScalar: numeric coercion and booleans", () => {
  assert.equal(parseScalar("42"), 42);
  assert.equal(parseScalar("-3.14"), -3.14);
  assert.equal(parseScalar("true"), true);
  assert.equal(parseScalar("false"), false);
  assert.equal(parseScalar('"42"'), "42"); // quoted stays string
});

test("schema_check: passes a minimal valid context", () => {
  const schema = {
    type: "object",
    required: ["client", "org_id"],
    properties: {
      client: { type: "string", minLength: 1 },
      org_id: { oneOf: [{ type: "string" }, { type: "integer" }] }
    }
  };
  const { valid, errors } = validate({ client: "Acme", org_id: 42 }, schema);
  assert.equal(valid, true, JSON.stringify(errors));
});

test("schema_check: catches type mismatch with path", () => {
  const schema = { type: "object", properties: { n: { type: "integer" } } };
  const { valid, errors } = validate({ n: "not-a-number" }, schema);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.instancePath === "/n" && /type/.test(e.message)));
});

test("schema_check: enum and additionalProperties:false", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ["read_only", "write_requested", "restricted"] }
    }
  };
  const bad1 = validate({ mode: "go_wild" }, schema);
  assert.equal(bad1.valid, false);
  assert.ok(bad1.errors.some((e) => /enum/.test(e.message)));

  const bad2 = validate({ mode: "read_only", extra: 1 }, schema);
  assert.equal(bad2.valid, false);
  assert.ok(bad2.errors.some((e) => /additional property/.test(e.message)));
});

test("schema_check: $ref to local $defs", () => {
  const schema = {
    type: "object",
    properties: { w: { $ref: "#/$defs/window" } },
    $defs: {
      window: {
        type: "object",
        required: ["start", "end"],
        properties: {
          start: { type: "string" },
          end: { type: "string" }
        }
      }
    }
  };
  const ok = validate({ w: { start: "a", end: "b" } }, schema);
  assert.equal(ok.valid, true, JSON.stringify(ok.errors));
  const bad = validate({ w: { start: "a" } }, schema);
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => /missing required property: end/.test(e.message)));
});

test("schema_check: oneOf matches exactly one", () => {
  const schema = {
    oneOf: [
      { type: "string", minLength: 1 },
      { type: "integer", minimum: 0 }
    ]
  };
  assert.equal(validate("x", schema).valid, true);
  assert.equal(validate(7, schema).valid, true);
  assert.equal(validate(true, schema).valid, false);
});
