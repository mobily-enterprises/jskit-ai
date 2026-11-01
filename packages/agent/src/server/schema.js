import { z } from "zod";

// A tool's input schema as the model is shown it. DeepSeek models get the limits of strings,
// numbers and arrays written into the field's description ("constraints: maximum length 200")
// instead of as JSON Schema keywords. This is the form every evaluation was measured with, so it
// stays exactly so. Input is still checked against the original schema.
const STRING_LIMITS = {
  minLength: (value) => `minimum length ${value}`,
  maxLength: (value) => `maximum length ${value}`,
  pattern: (value) => `input must match this regex ${value}`
};
const FORMATS = new Set(["email", "uri", "url", "uuid", "cuid", "emoji"]);
const NUMBER_LIMITS = {
  minimum: (value) => `greater than or equal to ${value}`,
  exclusiveMinimum: (value) => `greater than ${value}`,
  maximum: (value) => `lower than or equal to ${value}`,
  exclusiveMaximum: (value) => `lower than ${value}`,
  multipleOf: (value) => `multiple of ${value}`
};
const REWRAPPED = new Set(["object", "array", "string", "number", "integer"]);
// A whole number's implicit range isn't a limit anyone set.
const SAFE = Number.MAX_SAFE_INTEGER;
const ARRAY_LIMITS = {
  minItems: (value) => `minimum length ${value}`,
  maxItems: (value) => `maximum length ${value}`
};

function describe(node, constraints) {
  if (!constraints.length) return node;
  const { description, ...rest } = node;
  return { ...rest, description: `${description ? `${description}\n` : ""}constraints: ${constraints.join(", ")}` };
}

function rewrite(node) {
  if (Array.isArray(node)) return node.map(rewrite);
  if (!node || typeof node !== "object") return node;
  let out = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, typeof value === "object" ? rewrite(value) : value]));
  if (out.type === "string") {
    const constraints = [];
    // A format (email, url) stands for its own pattern.
    const formatted = FORMATS.has(out.format);
    for (const [key, value] of Object.entries(out)) {
      if (STRING_LIMITS[key]) {
        if (!(key === "pattern" && formatted)) constraints.push(STRING_LIMITS[key](value));
        delete out[key];
      } else if (key === "format" && formatted) {
        constraints.push(`a valid ${value === "uri" ? "url" : value}`);
        delete out[key];
      }
    }
    out = describe(out, constraints);
  } else if (out.type === "number" || out.type === "integer") {
    const constraints = [];
    for (const [key, value] of Object.entries(out)) {
      if (!NUMBER_LIMITS[key]) continue;
      if (out.type !== "integer" || Math.abs(value) !== SAFE) constraints.push(NUMBER_LIMITS[key](value));
      delete out[key];
    }
    out = describe(out, constraints);
  } else if (out.type === "object") {
    // An object of named fields is closed; one with no fields (a record) states that none is required.
    if (out.properties && !("additionalProperties" in out)) out.additionalProperties = false;
    // An optional text, number, list, object or either-or field with a description of its own is
    // written description first.
    const required = new Set(out.required || []);
    for (const [key, field] of Object.entries(out.properties || {})) {
      if (!required.has(key) && node.properties[key].description !== undefined && (REWRAPPED.has(field.type) || field.anyOf)) {
        const { description, ...rest } = field;
        out.properties[key] = { description, ...rest };
      }
    }
    if (!Object.keys(out.properties || {}).length) out.required ??= [];
  } else if (out.type === "array") {
    const constraints = [];
    for (const [key, value] of Object.entries(out)) {
      if (ARRAY_LIMITS[key]) {
        constraints.push(ARRAY_LIMITS[key](value));
        delete out[key];
      }
    }
    out = describe(out, constraints);
  }
  return out;
}

export function toolSchema(schema) {
  return rewrite(z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" }));
}
