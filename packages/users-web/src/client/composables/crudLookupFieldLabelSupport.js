import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { asPlainObject } from "./scopeHelpers.js";

const LOOKUP_LABEL_COMPOSITION_CANDIDATES = Object.freeze([
  Object.freeze(["name", "surname"]),
  Object.freeze(["firstName", "surname"]),
  Object.freeze(["name"]),
  Object.freeze(["firstName"])
]);

function hasDisplayValue(value) {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return normalizeText(value).length > 0;
  }

  return true;
}

function resolveLookupItemLabel(item = {}, labelKey = "") {
  const source = asPlainObject(item);
  for (const candidate of LOOKUP_LABEL_COMPOSITION_CANDIDATES) {
    const parts = [];
    for (const key of candidate) {
      const part = normalizeText(source[key]);
      if (!part) {
        parts.length = 0;
        break;
      }
      parts.push(part);
    }
    if (parts.length === candidate.length) {
      return parts.join(" ");
    }
  }

  const normalizedLabelKey = normalizeText(labelKey);
  if (!normalizedLabelKey) {
    return "";
  }

  return normalizeText(source[normalizedLabelKey]);
}

function resolveLookupFieldDisplayValue(record = {}, field = {}) {
  const sourceRecord = asPlainObject(record);
  const key = normalizeText(field?.key);
  if (!key) {
    return "";
  }

  const relation = asPlainObject(field?.relation);
  const relationKind = normalizeText(relation.kind).toLowerCase();
  if (relationKind !== "lookup") {
    return sourceRecord[key];
  }

  const sourceLookups = asPlainObject(sourceRecord.lookups);
  const lookupRecord = asPlainObject(sourceLookups[key]);
  const lookupLabel = resolveLookupItemLabel(lookupRecord, relation.labelKey);
  if (lookupLabel) {
    return lookupLabel;
  }

  const valueKey = normalizeText(relation.valueKey) || "id";
  const lookupValue = lookupRecord[valueKey];
  if (hasDisplayValue(lookupValue)) {
    return lookupValue;
  }

  return sourceRecord[key];
}

export {
  resolveLookupItemLabel,
  resolveLookupFieldDisplayValue
};
