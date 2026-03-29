import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { asPlainObject } from "./scopeHelpers.js";
import { toRouteParamValue } from "./routeTemplateHelpers.js";

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
    const rawValue = sourcePayload[fieldKey];

    if (fieldType === "boolean") {
      targetModel[fieldKey] = Boolean(rawValue);
      continue;
    }

    if (fieldType === "integer" || fieldType === "number") {
      targetModel[fieldKey] = rawValue == null ? "" : String(rawValue);
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
    return [];
  }

  return [message];
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

  return validateOperationSection({
    operation,
    section: "bodyValidator",
    value: rawPayload,
    context
  });
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
