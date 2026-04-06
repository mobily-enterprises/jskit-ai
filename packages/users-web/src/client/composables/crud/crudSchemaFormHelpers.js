import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { asPlainObject } from "../support/scopeHelpers.js";
import { toRouteParamValue } from "../support/routeTemplateHelpers.js";

const EMPTY_FIELD_ERROR_LIST = Object.freeze([]);
const fieldErrorListCache = new Map();

function resolveStableFieldErrorList(fieldKey, message) {
  if (!message) {
    return EMPTY_FIELD_ERROR_LIST;
  }

  const cacheKey = `${fieldKey}::${message}`;
  if (fieldErrorListCache.has(cacheKey)) {
    return fieldErrorListCache.get(cacheKey);
  }

  const nextValue = Object.freeze([message]);
  fieldErrorListCache.set(cacheKey, nextValue);
  return nextValue;
}

function normalizeCrudFormFields(fields = []) {
  const normalizedFields = [];
  const seenKeys = new Set();
  for (const field of Array.isArray(fields) ? fields : []) {
    const source = asPlainObject(field);
    const key = String(source.key || "").trim();
    if (!key || seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    normalizedFields.push({
      ...source,
      key
    });
  }

  return Object.freeze(normalizedFields);
}

function resolveFormFieldType(field = {}) {
  return String(field.type || "").trim().toLowerCase();
}

function resolveFormFieldFormat(field = {}) {
  return String(field.format || "").trim().toLowerCase();
}

function padDateTimePart(value) {
  return String(value).padStart(2, "0");
}

function normalizeTimeWhitespace(value) {
  return String(value ?? "").replaceAll(/\s+/gu, " ").trim();
}

function toTimeInputValue(value) {
  const normalized = normalizeTimeWhitespace(value);
  if (!normalized) {
    return "";
  }

  const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/u);
  if (twentyFourHourMatch) {
    const hours = Number(twentyFourHourMatch[1]);
    const minutes = Number(twentyFourHourMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${padDateTimePart(hours)}:${padDateTimePart(minutes)}`;
    }
    return normalized;
  }

  const meridiemMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)$/iu);
  if (!meridiemMatch) {
    return normalized;
  }

  const rawHours = Number(meridiemMatch[1]);
  const minutes = Number(meridiemMatch[2]);
  if (rawHours < 1 || rawHours > 12 || minutes < 0 || minutes > 59) {
    return normalized;
  }

  let hours = rawHours % 12;
  if (String(meridiemMatch[3] || "").toLowerCase().startsWith("p")) {
    hours += 12;
  }

  return `${padDateTimePart(hours)}:${padDateTimePart(minutes)}`;
}

function toDateTimeLocalInputValue(value) {
  if (value == null || value === "") {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return [
    date.getFullYear(),
    padDateTimePart(date.getMonth() + 1),
    padDateTimePart(date.getDate())
  ].join("-") + `T${padDateTimePart(date.getHours())}:${padDateTimePart(date.getMinutes())}`;
}

function toIsoUtcDateTimeValue(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }

  return date.toISOString();
}

function resolveFormFieldInitialValue(field = {}) {
  if (Object.prototype.hasOwnProperty.call(field, "initialValue")) {
    return field.initialValue;
  }
  if (Object.prototype.hasOwnProperty.call(field, "defaultValue")) {
    return field.defaultValue;
  }

  const fieldType = resolveFormFieldType(field);
  if (fieldType === "boolean") {
    return false;
  }

  return "";
}

function createCrudFormModel(fields = []) {
  const model = {};
  for (const field of normalizeCrudFormFields(fields)) {
    model[field.key] = resolveFormFieldInitialValue(field);
  }

  return model;
}

function buildCrudFormPayload(fields = [], model = {}) {
  const payload = {};
  const sourceModel = asPlainObject(model);

  for (const field of normalizeCrudFormFields(fields)) {
    const fieldKey = field.key;
    const fieldType = resolveFormFieldType(field);
    const fieldFormat = resolveFormFieldFormat(field);
    const rawValue = sourceModel[fieldKey];

    if (fieldType === "boolean") {
      payload[fieldKey] = Boolean(rawValue);
      continue;
    }

    if (fieldType === "integer" || fieldType === "number") {
      const normalizedValue = String(rawValue ?? "").trim();
      if (!normalizedValue) {
        continue;
      }

      const parsedNumber = Number(normalizedValue);
      payload[fieldKey] = Number.isFinite(parsedNumber)
        ? (fieldType === "integer" ? Math.trunc(parsedNumber) : parsedNumber)
        : rawValue;
      continue;
    }

    if (rawValue == null) {
      continue;
    }

    if (fieldFormat === "date-time") {
      const normalizedValue = toIsoUtcDateTimeValue(rawValue);
      if (!normalizedValue) {
        continue;
      }

      payload[fieldKey] = normalizedValue;
      continue;
    }

    if (fieldFormat === "time") {
      const normalizedValue = toTimeInputValue(rawValue);
      if (!normalizedValue) {
        continue;
      }

      payload[fieldKey] = normalizedValue;
      continue;
    }

    payload[fieldKey] = rawValue;
  }

  return payload;
}

function applyCrudPayloadToForm(fields = [], model = {}, payload = {}) {
  const targetModel = asPlainObject(model);
  const sourcePayload = asPlainObject(payload);
  for (const field of normalizeCrudFormFields(fields)) {
    const fieldKey = field.key;
    const fieldType = resolveFormFieldType(field);
    const fieldFormat = resolveFormFieldFormat(field);
    const rawValue = sourcePayload[fieldKey];

    if (fieldType === "boolean") {
      targetModel[fieldKey] = Boolean(rawValue);
      continue;
    }

    if (fieldType === "integer" || fieldType === "number") {
      targetModel[fieldKey] = rawValue == null ? "" : String(rawValue);
      continue;
    }

    if (fieldFormat === "date-time") {
      targetModel[fieldKey] = toDateTimeLocalInputValue(rawValue);
      continue;
    }

    if (fieldFormat === "time") {
      targetModel[fieldKey] = toTimeInputValue(rawValue);
      continue;
    }

    targetModel[fieldKey] = rawValue == null ? "" : String(rawValue);
  }
}

function resolveCrudRouteBoundFieldValues(fields = [], routeParams = {}) {
  const sourceRouteParams = asPlainObject(routeParams);
  const values = {};

  for (const field of normalizeCrudFormFields(fields)) {
    const routeParamKey = String(field?.routeParamKey || "").trim();
    if (!routeParamKey) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(sourceRouteParams, routeParamKey)) {
      continue;
    }

    const routeValue = toRouteParamValue(sourceRouteParams[routeParamKey]);
    if (!routeValue) {
      continue;
    }
    values[field.key] = routeValue;
  }

  return values;
}

function applyCrudRouteBoundFieldValues(fields = [], target = {}, routeParams = {}) {
  const resolved = resolveCrudRouteBoundFieldValues(fields, routeParams);
  const destination = asPlainObject(target);
  for (const [key, value] of Object.entries(resolved)) {
    destination[key] = value;
  }
  return resolved;
}

function resolveCrudFieldErrors(fieldErrors = {}, fieldKey = "") {
  const key = String(fieldKey || "").trim();
  if (!key) {
    return [];
  }

  const source = asPlainObject(fieldErrors);
  const message = String(source[key] || "").trim();

  if (!message) {
    return resolveStableFieldErrorList(key, "");
  }

  return resolveStableFieldErrorList(key, message);
}

function parseCrudResourceOperationInput({
  resource = null,
  operationName = "",
  rawPayload = {},
  context = {}
} = {}) {
  const normalizedOperationName = String(operationName || "").trim();
  const operations = asPlainObject(asPlainObject(resource).operations);
  const operation = asPlainObject(operations[normalizedOperationName]);

  const parsed = validateOperationSection({
    operation,
    section: "bodyValidator",
    value: rawPayload,
    context
  });
  return parsed;
}

export {
  normalizeCrudFormFields,
  createCrudFormModel,
  buildCrudFormPayload,
  applyCrudPayloadToForm,
  resolveCrudRouteBoundFieldValues,
  applyCrudRouteBoundFieldValues,
  resolveCrudFieldErrors,
  parseCrudResourceOperationInput
};
