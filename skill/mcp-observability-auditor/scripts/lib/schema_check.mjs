// schema_check.mjs — zero-dependency JSON Schema 2020-12 validator (subset).
//
// Supports the features actually used by this skill's schemas:
//   - type (string, number, integer, boolean, array, object, null) + arrays of types
//   - required, additionalProperties (true | false), properties, patternProperties (none used)
//   - enum, const
//   - minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf
//   - pattern (regex), format (date-time, uri — best-effort)
//   - items (single schema), minItems, maxItems, uniqueItems
//   - oneOf, anyOf, allOf, not
//   - $ref to local $defs (#/$defs/Name) inside the same document
//   - default values are *ignored* (this is a checker, not a populator)
//
// Returns { valid: boolean, errors: [{ instancePath, schemaPath, message }] }.
//
// This file is intentionally small and audited every release. Anything weird
// goes here so the rest of the codebase stays dependency-free.

export function validate(instance, schema, opts = {}) {
  const ctx = {
    root: schema,
    errors: [],
    opts: { strictFormat: false, ...opts }
  };
  walk(instance, schema, "", "", ctx);
  return { valid: ctx.errors.length === 0, errors: ctx.errors };
}

function err(ctx, instancePath, schemaPath, message) {
  ctx.errors.push({ instancePath: instancePath || "/", schemaPath, message });
}

function resolveRef(ref, ctx) {
  // Supports only local references "#/path/to/node".
  if (!ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node = ctx.root;
  for (const p of parts) {
    if (node && typeof node === "object" && p in node) node = node[p];
    else return null;
  }
  return node;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value; // "string" | "number" | "boolean" | "object" | "undefined"
}

function matchesType(value, allowed) {
  const types = Array.isArray(allowed) ? allowed : [allowed];
  const actual = typeOf(value);
  for (const t of types) {
    if (t === "number" && (actual === "integer" || actual === "number")) return true;
    if (t === actual) return true;
  }
  return false;
}

function checkFormat(value, format) {
  if (typeof value !== "string") return true;
  if (format === "date-time") return !Number.isNaN(Date.parse(value));
  if (format === "uri") return /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]+$/.test(value);
  if (format === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  return true; // unknown format — pass quietly unless strictFormat
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && typeof a === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function walk(value, schema, instancePath, schemaPath, ctx) {
  if (schema === true || schema === undefined) return;
  if (schema === false) { err(ctx, instancePath, schemaPath, "schema is false (always fails)"); return; }

  if (typeof schema !== "object" || schema === null) return;

  if (schema.$ref) {
    const target = resolveRef(schema.$ref, ctx);
    if (!target) { err(ctx, instancePath, schemaPath, `unresolved $ref: ${schema.$ref}`); return; }
    walk(value, target, instancePath, schemaPath + "/$ref", ctx);
    return;
  }

  // type
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    err(ctx, instancePath, schemaPath + "/type",
      `expected type ${JSON.stringify(schema.type)}, got ${typeOf(value)}`);
    return;
  }

  // enum / const
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value))) {
    err(ctx, instancePath, schemaPath + "/enum",
      `value ${JSON.stringify(value)} is not in enum`);
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    err(ctx, instancePath, schemaPath + "/const",
      `value ${JSON.stringify(value)} !== const ${JSON.stringify(schema.const)}`);
  }

  // strings
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      err(ctx, instancePath, schemaPath + "/minLength", `length ${value.length} < minLength ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      err(ctx, instancePath, schemaPath + "/maxLength", `length ${value.length} > maxLength ${schema.maxLength}`);
    if (typeof schema.pattern === "string") {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) err(ctx, instancePath, schemaPath + "/pattern", `does not match pattern ${schema.pattern}`);
    }
    if (typeof schema.format === "string" && !checkFormat(value, schema.format))
      err(ctx, instancePath, schemaPath + "/format", `not a valid ${schema.format}`);
  }

  // numbers
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      err(ctx, instancePath, schemaPath + "/minimum", `${value} < ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum)
      err(ctx, instancePath, schemaPath + "/maximum", `${value} > ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum)
      err(ctx, instancePath, schemaPath + "/exclusiveMinimum", `${value} <= ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum)
      err(ctx, instancePath, schemaPath + "/exclusiveMaximum", `${value} >= ${schema.exclusiveMaximum}`);
    if (typeof schema.multipleOf === "number") {
      const ratio = value / schema.multipleOf;
      if (!Number.isFinite(ratio) || Math.abs(ratio - Math.round(ratio)) > 1e-9)
        err(ctx, instancePath, schemaPath + "/multipleOf", `${value} not a multiple of ${schema.multipleOf}`);
    }
  }

  // arrays
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      err(ctx, instancePath, schemaPath + "/minItems", `length ${value.length} < minItems ${schema.minItems}`);
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      err(ctx, instancePath, schemaPath + "/maxItems", `length ${value.length} > maxItems ${schema.maxItems}`);
    if (schema.uniqueItems) {
      const seen = [];
      for (const item of value) {
        if (seen.some((s) => deepEqual(s, item))) {
          err(ctx, instancePath, schemaPath + "/uniqueItems", `duplicate item`);
          break;
        }
        seen.push(item);
      }
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i += 1) {
        walk(value[i], schema.items, `${instancePath}/${i}`, schemaPath + "/items", ctx);
      }
    }
  }

  // objects
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (!(k in value)) err(ctx, instancePath, schemaPath + "/required",
          `missing required property: ${k}`);
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in value) walk(value[k], sub, `${instancePath}/${k}`, `${schemaPath}/properties/${k}`, ctx);
      }
    }
    if (schema.additionalProperties === false) {
      const declared = new Set(Object.keys(schema.properties || {}));
      for (const k of Object.keys(value)) {
        if (!declared.has(k))
          err(ctx, instancePath, schemaPath + "/additionalProperties",
            `additional property not allowed: ${k}`);
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      const declared = new Set(Object.keys(schema.properties || {}));
      for (const [k, v] of Object.entries(value)) {
        if (!declared.has(k)) walk(v, schema.additionalProperties, `${instancePath}/${k}`,
          `${schemaPath}/additionalProperties`, ctx);
      }
    }
  }

  // combinators
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((s, i) => walk(value, s, instancePath, `${schemaPath}/allOf/${i}`, ctx));
  }
  if (Array.isArray(schema.anyOf)) {
    const before = ctx.errors.length;
    const matched = schema.anyOf.some((s) => {
      const tmpCtx = { ...ctx, errors: [] };
      walk(value, s, instancePath, `${schemaPath}/anyOf`, tmpCtx);
      return tmpCtx.errors.length === 0;
    });
    if (!matched) {
      ctx.errors.splice(before); // drop sub-errors, emit single anyOf failure
      err(ctx, instancePath, schemaPath + "/anyOf", "value did not match any anyOf branch");
    }
  }
  if (Array.isArray(schema.oneOf)) {
    let matchCount = 0;
    for (const s of schema.oneOf) {
      const tmpCtx = { ...ctx, errors: [] };
      walk(value, s, instancePath, `${schemaPath}/oneOf`, tmpCtx);
      if (tmpCtx.errors.length === 0) matchCount += 1;
    }
    if (matchCount !== 1) err(ctx, instancePath, schemaPath + "/oneOf",
      `matched ${matchCount} oneOf branches (expected exactly 1)`);
  }
  if (schema.not !== undefined) {
    const tmpCtx = { ...ctx, errors: [] };
    walk(value, schema.not, instancePath, `${schemaPath}/not`, tmpCtx);
    if (tmpCtx.errors.length === 0) err(ctx, instancePath, schemaPath + "/not",
      "value matched 'not' schema");
  }
}

export function formatErrors(errors, limit = 20) {
  return errors.slice(0, limit).map((e) => `  ${e.instancePath}: ${e.message}`).join("\n");
}
