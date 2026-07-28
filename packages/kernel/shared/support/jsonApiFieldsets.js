import { deepFreeze } from "./deepFreeze.js";
import { normalizeText } from "./normalize.js";

function normalizeJsonApiFieldList(value = []) {
  const values = Array.isArray(value) ? value : [value];
  const fields = new Set();

  for (const entry of values) {
    const parts = typeof entry === "string" ? entry.split(",") : [entry];
    for (const part of parts) {
      const field = normalizeText(part);
      if (field) {
        fields.add(field);
      }
    }
  }

  return Object.freeze([...fields].sort((left, right) => left.localeCompare(right)));
}

function normalizeJsonApiFieldsets(value = {}, { primaryType = "" } = {}) {
  const normalizedPrimaryType = normalizeText(primaryType);
  let source = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    source = value;
  } else if (normalizedPrimaryType) {
    source = { [normalizedPrimaryType]: value };
  }
  const fieldsets = [];

  for (const [rawType, rawFields] of Object.entries(source)) {
    const type = normalizeText(rawType);
    const fields = normalizeJsonApiFieldList(rawFields);
    if (!type || fields.length < 1) {
      continue;
    }
    fieldsets.push([type, fields]);
  }

  return deepFreeze(
    Object.fromEntries(
      fieldsets.sort(([left], [right]) => left.localeCompare(right))
    )
  );
}

function buildJsonApiFieldsetsToken(value = {}) {
  const fieldsets = normalizeJsonApiFieldsets(value);
  return Object.keys(fieldsets).length > 0 ? JSON.stringify(fieldsets) : "";
}

export {
  normalizeJsonApiFieldList,
  normalizeJsonApiFieldsets,
  buildJsonApiFieldsetsToken
};
