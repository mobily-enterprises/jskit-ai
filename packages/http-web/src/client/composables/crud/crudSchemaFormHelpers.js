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

function isNullableFormField(field = {}) {
  return field?.nullable === true;
}

function isLookupFormField(field = {}) {
  return field?.component === "lookup" || field?.relation?.kind === "lookup";
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

  const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/u);
  if (twentyFourHourMatch) {
    const hours = Number(twentyFourHourMatch[1]);
    const minutes = Number(twentyFourHourMatch[2]);
    const seconds = Number(twentyFourHourMatch[3] || 0);
    if (
      hours >= 0 && hours <= 23 &&
      minutes >= 0 && minutes <= 59 &&
      seconds >= 0 && seconds <= 59
    ) {
      const secondsValue = twentyFourHourMatch[3]
        ? `:${padDateTimePart(seconds)}${twentyFourHourMatch[4] || ""}`
        : "";
      return `${padDateTimePart(hours)}:${padDateTimePart(minutes)}${secondsValue}`;
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

  const sourceText = typeof value === "string" ? value.trim() : "";
  const sourceFraction = sourceText.match(/T\d{2}:\d{2}:\d{2}\.(\d+)/u)?.[1] || "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const minuteValue = [
    date.getFullYear(),
    padDateTimePart(date.getMonth() + 1),
    padDateTimePart(date.getDate())
  ].join("-") + `T${padDateTimePart(date.getHours())}:${padDateTimePart(date.getMinutes())}`;
  if (sourceFraction && !/^0+$/u.test(sourceFraction)) {
    return `${minuteValue}:${padDateTimePart(date.getSeconds())}.${sourceFraction}`;
  }

  const milliseconds = date.getMilliseconds();
  if (milliseconds > 0) {
    return `${minuteValue}:${padDateTimePart(date.getSeconds())}.${String(milliseconds).padStart(3, "0")}`;
  }
  if (date.getSeconds() > 0) {
    return `${minuteValue}:${padDateTimePart(date.getSeconds())}`;
  }
  return minuteValue;
}

function toDateInputValue(value) {
  if (value == null || value === "") {
    return "";
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? String(value)
      : value.toISOString().slice(0, 10);
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return "";
  }

  const calendarDateMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/u);
  if (calendarDateMatch) {
    const calendarDate = calendarDateMatch[1];
    const parsedCalendarDate = new Date(`${calendarDate}T00:00:00.000Z`);
    if (
      !Number.isNaN(parsedCalendarDate.getTime()) &&
      parsedCalendarDate.toISOString().slice(0, 10) === calendarDate
    ) {
      return calendarDate;
    }
  }

  return normalized;
}

function applyDateTimePrecision(isoValue, temporalPrecision) {
  if (!Number.isInteger(temporalPrecision) || temporalPrecision < 0) {
    return isoValue;
  }

  const match = String(isoValue || "").match(/^(.*?)(?:\.(\d+))?Z$/u);
  if (!match?.[2]) {
    return isoValue;
  }

  const fraction = match[2];
  if (fraction.length <= temporalPrecision) {
    return isoValue;
  }

  const excess = fraction.slice(temporalPrecision);
  if (!/^0+$/u.test(excess)) {
    return isoValue;
  }

  const retained = fraction.slice(0, temporalPrecision);
  return `${match[1]}${retained ? `.${retained}` : ""}Z`;
}

function toIsoUtcDateTimeValue(value, temporalPrecision) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }

  const sourceFraction = normalized.match(/T\d{2}:\d{2}:\d{2}\.(\d+)/u)?.[1] || "";
  const dateIsoValue = date.toISOString();
  const preciseIsoValue = sourceFraction
    ? dateIsoValue.replace(/\.\d{3}Z$/u, `.${sourceFraction}Z`)
    : dateIsoValue;
  return applyDateTimePrecision(preciseIsoValue, temporalPrecision);
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
    return isNullableFormField(field) ? null : false;
  }

  if (isNullableFormField(field) && isLookupFormField(field)) {
    return null;
  }

  return "";
}

function shouldSerializeClearedFieldAsNull(field = {}) {
  if (field?.nullable !== true) {
    return false;
  }

  if (isLookupFormField(field)) {
    return true;
  }

  const fieldType = resolveFormFieldType(field);
  const fieldFormat = resolveFormFieldFormat(field);

  return (
    fieldType === "integer" ||
    fieldType === "number" ||
    fieldFormat === "date" ||
    fieldFormat === "date-time" ||
    fieldFormat === "time"
  );
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
    const clearAsNull = shouldSerializeClearedFieldAsNull(field);
    const rawValue = sourceModel[fieldKey];

    if (fieldType === "boolean") {
      payload[fieldKey] = rawValue == null && isNullableFormField(field)
        ? null
        : Boolean(rawValue);
      continue;
    }

    if (fieldType === "integer" || fieldType === "number") {
      const normalizedValue = String(rawValue ?? "").trim();
      if (!normalizedValue) {
        if (clearAsNull) {
          payload[fieldKey] = null;
        }
        continue;
      }

      const parsedNumber = Number(normalizedValue);
      payload[fieldKey] = Number.isFinite(parsedNumber)
        ? (fieldType === "integer" ? Math.trunc(parsedNumber) : parsedNumber)
        : rawValue;
      continue;
    }

    if (rawValue == null) {
      if (clearAsNull) {
        payload[fieldKey] = null;
      }
      continue;
    }

    if (isLookupFormField(field)) {
      const normalizedLookupValue = String(rawValue).trim();
      if (!normalizedLookupValue) {
        if (clearAsNull) {
          payload[fieldKey] = null;
        }
        continue;
      }

      payload[fieldKey] = normalizedLookupValue;
      continue;
    }

    if (fieldFormat === "date") {
      const normalizedValue = String(rawValue).trim();
      if (!normalizedValue) {
        if (clearAsNull) {
          payload[fieldKey] = null;
        }
        continue;
      }

      payload[fieldKey] = normalizedValue;
      continue;
    }

    if (fieldFormat === "date-time") {
      const normalizedValue = toIsoUtcDateTimeValue(rawValue, field.temporalPrecision);
      if (!normalizedValue) {
        if (clearAsNull) {
          payload[fieldKey] = null;
        }
        continue;
      }

      payload[fieldKey] = normalizedValue;
      continue;
    }

    if (fieldFormat === "time") {
      const normalizedValue = toTimeInputValue(rawValue);
      if (!normalizedValue) {
        if (clearAsNull) {
          payload[fieldKey] = null;
        }
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
      targetModel[fieldKey] = rawValue == null && isNullableFormField(field)
        ? null
        : Boolean(rawValue);
      continue;
    }

    if (fieldType === "integer" || fieldType === "number") {
      targetModel[fieldKey] = rawValue == null ? "" : String(rawValue);
      continue;
    }

    if (fieldFormat === "date") {
      targetModel[fieldKey] = toDateInputValue(rawValue);
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

    if (isLookupFormField(field)) {
      targetModel[fieldKey] = rawValue == null ? null : String(rawValue);
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

export {
  normalizeCrudFormFields,
  createCrudFormModel,
  buildCrudFormPayload,
  applyCrudPayloadToForm,
  resolveCrudRouteBoundFieldValues,
  applyCrudRouteBoundFieldValues,
  resolveCrudFieldErrors
};
