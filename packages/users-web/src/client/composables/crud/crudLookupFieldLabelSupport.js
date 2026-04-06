import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeCrudLookupContainerKey } from "@jskit-ai/kernel/shared/support/crudLookup";
import { asPlainObject } from "../support/scopeHelpers.js";

const LOOKUP_LABEL_COMPOSITION_CANDIDATES = Object.freeze([
  Object.freeze(["name", "surname"]),
  Object.freeze(["name", "lastName"]),
  Object.freeze(["firstName", "surname"]),
  Object.freeze(["firstName", "lastName"]),
  Object.freeze(["name"]),
  Object.freeze(["firstName"])
]);
const DEFAULT_RECORD_TITLE = "-";

function hasDisplayValue(value) {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return normalizeText(value).length > 0;
  }

  return true;
}

function resolveComposedLabel(source = {}, candidates = LOOKUP_LABEL_COMPOSITION_CANDIDATES) {
  for (const candidate of candidates) {
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

  return "";
}

function resolveLookupItemLabel(item = {}, labelKey = "") {
  const source = asPlainObject(item);
  const composedLabel = resolveComposedLabel(source);
  if (composedLabel) {
    return composedLabel;
  }

  const normalizedLabelKey = normalizeText(labelKey);
  if (!normalizedLabelKey) {
    return "";
  }

  return normalizeText(source[normalizedLabelKey]);
}

function resolveRecordTitle(record = {}, { fallbackKey = "", defaultValue = DEFAULT_RECORD_TITLE } = {}) {
  const source = asPlainObject(record);
  const composedLabel = resolveComposedLabel(source);
  if (composedLabel) {
    return composedLabel;
  }

  const normalizedFallbackKey = normalizeText(fallbackKey);
  if (normalizedFallbackKey) {
    const fallbackValue = normalizeText(source[normalizedFallbackKey]);
    if (fallbackValue) {
      return fallbackValue;
    }
  }

  const normalizedDefaultValue = normalizeText(defaultValue);
  return normalizedDefaultValue || DEFAULT_RECORD_TITLE;
}

function resolveLookupFieldDescriptor(field = {}, relationKind = "", valueKey = "", labelKey = "") {
  if (typeof field === "string") {
    return {
      key: normalizeText(field),
      relation: {
        kind: normalizeText(relationKind).toLowerCase(),
        valueKey: normalizeText(valueKey) || "id",
        labelKey: normalizeText(labelKey),
        containerKey: ""
      }
    };
  }

  const sourceField = asPlainObject(field);
  const relation = asPlainObject(sourceField.relation);
  return {
    key: normalizeText(sourceField.key),
    relation: {
      kind: normalizeText(relation.kind).toLowerCase(),
      valueKey: normalizeText(relation.valueKey) || "id",
      labelKey: normalizeText(relation.labelKey),
      containerKey: normalizeText(relation.containerKey)
    }
  };
}

function resolveLookupFieldDisplayValue(record = {}, field = {}, relationKind = "", valueKey = "", labelKey = "") {
  const sourceRecord = asPlainObject(record);
  const descriptor = resolveLookupFieldDescriptor(field, relationKind, valueKey, labelKey);
  const key = descriptor.key;
  if (!key) {
    return "";
  }

  if (descriptor.relation.kind !== "lookup") {
    return sourceRecord[key];
  }

  const lookupContainerKey = normalizeCrudLookupContainerKey(descriptor.relation.containerKey, {
    context: `lookup relation "${key}" containerKey`
  });
  const sourceLookups = asPlainObject(sourceRecord[lookupContainerKey]);
  const lookupRecord = asPlainObject(sourceLookups[key]);
  const lookupLabel = resolveLookupItemLabel(lookupRecord, descriptor.relation.labelKey);
  if (lookupLabel) {
    return lookupLabel;
  }

  const lookupValue = lookupRecord[descriptor.relation.valueKey];
  if (hasDisplayValue(lookupValue)) {
    return lookupValue;
  }

  return sourceRecord[key];
}

export {
  resolveLookupItemLabel,
  resolveLookupFieldDisplayValue,
  resolveRecordTitle
};
