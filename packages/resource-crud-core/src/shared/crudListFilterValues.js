// The values a CRUD list filter holds: its types and their empty, UI, query and chip forms.
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  normalizeBoolean,
  normalizeCanonicalRecordIdText,
  normalizeUniqueTextList,
  normalizeText
} from "@jskit-ai/kernel/shared/support/normalize";

const CRUD_LIST_FILTER_TYPE_FLAG = "flag";
const CRUD_LIST_FILTER_TYPE_ENUM = "enum";
const CRUD_LIST_FILTER_TYPE_ENUM_MANY = "enumMany";
const CRUD_LIST_FILTER_TYPE_RECORD_ID = "recordId";
const CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY = "recordIdMany";
const CRUD_LIST_FILTER_TYPE_DATE = "date";
const CRUD_LIST_FILTER_TYPE_DATE_RANGE = "dateRange";
const CRUD_LIST_FILTER_TYPE_NUMBER_RANGE = "numberRange";
const CRUD_LIST_FILTER_TYPE_PRESENCE = "presence";

const CRUD_LIST_FILTER_TYPES = Object.freeze([
  CRUD_LIST_FILTER_TYPE_FLAG,
  CRUD_LIST_FILTER_TYPE_ENUM,
  CRUD_LIST_FILTER_TYPE_ENUM_MANY,
  CRUD_LIST_FILTER_TYPE_RECORD_ID,
  CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY,
  CRUD_LIST_FILTER_TYPE_DATE,
  CRUD_LIST_FILTER_TYPE_DATE_RANGE,
  CRUD_LIST_FILTER_TYPE_NUMBER_RANGE,
  CRUD_LIST_FILTER_TYPE_PRESENCE
]);

const CRUD_LIST_FILTER_PRESENCE_PRESENT = "present";
const CRUD_LIST_FILTER_PRESENCE_MISSING = "missing";
const CRUD_LIST_FILTER_PRESENCE_OPTIONS = Object.freeze([
  Object.freeze({
    value: CRUD_LIST_FILTER_PRESENCE_PRESENT,
    label: "Present"
  }),
  Object.freeze({
    value: CRUD_LIST_FILTER_PRESENCE_MISSING,
    label: "Missing"
  })
]);
const CRUD_LIST_FILTER_INVALID_VALUES_REJECT = "reject";
const CRUD_LIST_FILTER_INVALID_VALUES_DISCARD = "discard";
const CRUD_LIST_FILTER_INVALID_VALUES_MODES = Object.freeze([
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD
]);
const INVALID_CRUD_LIST_FILTER_QUERY_VALUE = Symbol("invalidCrudListFilterQueryValue");
const DATE_FILTER_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function parseCrudListRangeQueryExpression(value = null) {
  const sourceValue = Array.isArray(value) ? value[0] : value;
  if (sourceValue == null) {
    return null;
  }

  const normalized = typeof sourceValue === "number"
    ? String(sourceValue)
    : normalizeText(sourceValue);
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf("..");
  if (separatorIndex < 0) {
    return deepFreeze({
      exact: true,
      start: normalized,
      end: normalized
    });
  }

  const start = normalizeText(normalized.slice(0, separatorIndex));
  const end = normalizeText(normalized.slice(separatorIndex + 2));
  if (!start && !end) {
    return null;
  }

  return deepFreeze({
    exact: false,
    start,
    end
  });
}

function formatCrudListRangeQueryExpression(startValue = "", endValue = "", { collapseExact = false } = {}) {
  const start = normalizeText(startValue);
  const end = normalizeText(endValue);
  if (!start && !end) {
    return "";
  }

  if (collapseExact === true && start && end && start === end) {
    return start;
  }

  return `${start}..${end}`;
}

function normalizeCrudListFilterInvalidValues(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (CRUD_LIST_FILTER_INVALID_VALUES_MODES.includes(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `Unsupported CRUD list filter invalidValues mode "${value}". Expected one of: ${CRUD_LIST_FILTER_INVALID_VALUES_MODES.join(", ")}.`
  );
}

function firstCrudListFilterValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isPrimitiveCrudListFilterInput(value) {
  const valueType = typeof value;
  return valueType === "string" || valueType === "number" || valueType === "boolean";
}

function isPrimitiveOrPrimitiveArrayCrudListFilterInput(value) {
  if (Array.isArray(value)) {
    return value.every((entry) => isPrimitiveCrudListFilterInput(entry));
  }

  return isPrimitiveCrudListFilterInput(value);
}

function normalizeDateFilterText(value) {
  const normalized = normalizeText(firstCrudListFilterValue(value));
  if (!normalized || !DATE_FILTER_PATTERN.test(normalized)) {
    return "";
  }

  return normalized;
}

function normalizeCanonicalRecordIdList(value) {
  return normalizeUniqueTextList(value, {
    acceptSingle: true
  })
    .map((entry) => normalizeCanonicalRecordIdText(entry, { fallback: "" }))
    .filter(Boolean);
}

function normalizeFiniteFilterNumber(value) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = typeof value === "number"
    ? value
    : Number(normalizeText(firstCrudListFilterValue(value)));
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeAllowedFilterTextValue(value, allowedValues = new Set()) {
  const normalized = normalizeText(firstCrudListFilterValue(value));
  if (!normalized || !allowedValues.has(normalized)) {
    return "";
  }

  return normalized;
}

function normalizeAllowedFilterTextValues(value, allowedValues = new Set()) {
  return normalizeUniqueTextList(value, {
    acceptSingle: true
  }).filter((entry) => allowedValues.has(entry));
}

function resolveCrudListFilterAllowedValues(filter = {}) {
  return new Set(
    (Array.isArray(filter.options) ? filter.options : [])
      .map((entry) => normalizeText(entry?.value))
      .filter(Boolean)
  );
}

function normalizeCrudListDateRangeUiValue(rawValue) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
    ? rawValue
    : null;
  if (source) {
    return {
      from: normalizeDateFilterText(source.from),
      to: normalizeDateFilterText(source.to)
    };
  }

  const parsed = parseCrudListRangeQueryExpression(rawValue);
  return {
    from: normalizeDateFilterText(parsed?.start),
    to: normalizeDateFilterText(parsed?.end)
  };
}

function normalizeCrudListNumberRangeUiValue(rawValue) {
  const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
    ? rawValue
    : null;
  if (source) {
    return {
      min: normalizeText(source.min),
      max: normalizeText(source.max)
    };
  }

  const parsed = parseCrudListRangeQueryExpression(rawValue);
  return {
    min: normalizeText(parsed?.start),
    max: normalizeText(parsed?.end)
  };
}

function createCrudListFilterEmptyValue(filter = {}) {
  if (normalizeCrudListFilterType(filter.type) === CRUD_LIST_FILTER_TYPE_FLAG) {
    return false;
  }
  if (isCrudListFilterMultiValue(filter)) {
    return [];
  }
  if (normalizeCrudListFilterType(filter.type) === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return {
      from: "",
      to: ""
    };
  }
  if (normalizeCrudListFilterType(filter.type) === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return {
      min: "",
      max: ""
    };
  }

  return "";
}

function createCrudListFilterInitialValue(filter = {}) {
  if (!Object.hasOwn(filter, "defaultValue")) {
    return createCrudListFilterEmptyValue(filter);
  }

  return normalizeCrudListFilterUiValue(filter, filter.defaultValue);
}

function isCrudListFilterMultiValue(filter = {}) {
  const type = normalizeCrudListFilterType(filter.type);
  return type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY;
}

function isCrudListFilterStructuredValue(filter = {}) {
  const type = normalizeCrudListFilterType(filter.type);
  return type === CRUD_LIST_FILTER_TYPE_DATE_RANGE || type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE;
}

function normalizeCrudListFilterUiValue(filter = {}, rawValue) {
  const type = normalizeCrudListFilterType(filter.type);

  if (type === CRUD_LIST_FILTER_TYPE_FLAG) {
    return rawValue === true;
  }

  if (type === CRUD_LIST_FILTER_TYPE_ENUM) {
    return normalizeAllowedFilterTextValue(rawValue, resolveCrudListFilterAllowedValues(filter));
  }

  if (type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    return normalizeAllowedFilterTextValue(rawValue, new Set([
      CRUD_LIST_FILTER_PRESENCE_PRESENT,
      CRUD_LIST_FILTER_PRESENCE_MISSING
    ]));
  }

  if (type === CRUD_LIST_FILTER_TYPE_ENUM_MANY) {
    return normalizeAllowedFilterTextValues(rawValue, resolveCrudListFilterAllowedValues(filter));
  }

  if (type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    return normalizeCanonicalRecordIdText(rawValue, { fallback: "" }) || "";
  }

  if (type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    return normalizeCanonicalRecordIdList(rawValue);
  }

  if (type === CRUD_LIST_FILTER_TYPE_DATE) {
    return normalizeDateFilterText(rawValue);
  }

  if (type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return normalizeCrudListDateRangeUiValue(rawValue);
  }

  if (type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return normalizeCrudListNumberRangeUiValue(rawValue);
  }

  return normalizeText(rawValue);
}

function matchCrudListFilterValues(currentValue, expectedValue) {
  const currentList = Array.isArray(currentValue) ? [...currentValue].sort() : [];
  const expectedList = Array.isArray(expectedValue) ? [...expectedValue].sort() : [];
  if (currentList.length !== expectedList.length) {
    return false;
  }

  return currentList.every((entry, index) => entry === expectedList[index]);
}

function areCrudListFilterUiValuesEqual(filter = {}, currentValue, expectedValue) {
  const normalizedCurrentValue = normalizeCrudListFilterUiValue(filter, currentValue);
  const normalizedExpectedValue = normalizeCrudListFilterUiValue(filter, expectedValue);

  if (isCrudListFilterMultiValue(filter)) {
    return matchCrudListFilterValues(normalizedCurrentValue, normalizedExpectedValue);
  }

  if (normalizeCrudListFilterType(filter.type) === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return (
      normalizeText(normalizedCurrentValue?.from) === normalizeText(normalizedExpectedValue?.from) &&
      normalizeText(normalizedCurrentValue?.to) === normalizeText(normalizedExpectedValue?.to)
    );
  }

  if (normalizeCrudListFilterType(filter.type) === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return (
      normalizeText(normalizedCurrentValue?.min) === normalizeText(normalizedExpectedValue?.min) &&
      normalizeText(normalizedCurrentValue?.max) === normalizeText(normalizedExpectedValue?.max)
    );
  }

  return normalizedCurrentValue === normalizedExpectedValue;
}

function formatCrudListFilterQueryValue(filter = {}, value) {
  const type = normalizeCrudListFilterType(filter.type);

  if (type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return formatCrudListRangeQueryExpression(value?.from, value?.to, {
      collapseExact: true
    });
  }

  if (type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return formatCrudListRangeQueryExpression(value?.min, value?.max, {
      collapseExact: true
    });
  }

  return value;
}

function rejectInvalidCrudListFilterValue({ invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT } = {}) {
  return invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD
    ? null
    : INVALID_CRUD_LIST_FILTER_QUERY_VALUE;
}

function normalizeCrudListDateRangeQueryValue(value) {
  const parsed = parseCrudListRangeQueryExpression(firstCrudListFilterValue(value));
  if (!parsed) {
    return undefined;
  }

  const from = normalizeDateFilterText(parsed.start);
  const to = normalizeDateFilterText(parsed.end);

  if (parsed.exact) {
    if (!from) {
      return undefined;
    }

    return {
      from,
      to: from
    };
  }

  if (!from && !to) {
    return undefined;
  }

  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
  };
}

function normalizeCrudListNumberRangeQueryValue(value) {
  const parsed = parseCrudListRangeQueryExpression(firstCrudListFilterValue(value));
  if (!parsed) {
    return undefined;
  }

  const min = normalizeFiniteFilterNumber(parsed.start);
  const max = normalizeFiniteFilterNumber(parsed.end);

  if (parsed.exact) {
    if (min == null) {
      return undefined;
    }

    return {
      min,
      max: min
    };
  }

  if (min == null && max == null) {
    return undefined;
  }

  return {
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {})
  };
}

function parseCrudListFilterMultiQueryValue(value, normalizeEntry, { invalidValues }) {
  const normalizedEntries = (Array.isArray(value) ? value : [value]).map(normalizeEntry);
  const acceptedValues = Array.from(new Set(normalizedEntries.filter(Boolean)));

  if (invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD) {
    return acceptedValues.length > 0 ? acceptedValues : null;
  }

  return acceptedValues.length > 0 && normalizedEntries.every(Boolean)
    ? acceptedValues
    : INVALID_CRUD_LIST_FILTER_QUERY_VALUE;
}

function parseCrudListFilterQueryValue(
  filter = {},
  value,
  { invalidValues = CRUD_LIST_FILTER_INVALID_VALUES_REJECT } = {}
) {
  const type = normalizeCrudListFilterType(filter.type);
  const allowedValues = resolveCrudListFilterAllowedValues(filter);

  if (type === CRUD_LIST_FILTER_TYPE_FLAG) {
    if (value !== null && value !== "" && !isPrimitiveCrudListFilterInput(value)) {
      return rejectInvalidCrudListFilterValue({ invalidValues });
    }
  } else if (isCrudListFilterMultiValue(filter)) {
    if (!isPrimitiveOrPrimitiveArrayCrudListFilterInput(value)) {
      return rejectInvalidCrudListFilterValue({ invalidValues });
    }
  } else if (!isPrimitiveCrudListFilterInput(value)) {
    return rejectInvalidCrudListFilterValue({ invalidValues });
  }

  if (type === CRUD_LIST_FILTER_TYPE_FLAG) {
    if (value === null || value === "") {
      return true;
    }

    try {
      return normalizeBoolean(firstCrudListFilterValue(value));
    } catch {
      return rejectInvalidCrudListFilterValue({ invalidValues });
    }
  }

  if (type === CRUD_LIST_FILTER_TYPE_ENUM) {
    return normalizeAllowedFilterTextValue(value, allowedValues) || rejectInvalidCrudListFilterValue({ invalidValues });
  }

  if (type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    return normalizeAllowedFilterTextValue(value, new Set([
      CRUD_LIST_FILTER_PRESENCE_PRESENT,
      CRUD_LIST_FILTER_PRESENCE_MISSING
    ])) || rejectInvalidCrudListFilterValue({ invalidValues });
  }

  if (type === CRUD_LIST_FILTER_TYPE_ENUM_MANY) {
    return parseCrudListFilterMultiQueryValue(
      value,
      (entry) => normalizeAllowedFilterTextValue(entry, allowedValues),
      { invalidValues }
    );
  }

  if (type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    return normalizeCanonicalRecordIdText(firstCrudListFilterValue(value), {
      fallback: ""
    }) || rejectInvalidCrudListFilterValue({ invalidValues });
  }

  if (type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    return parseCrudListFilterMultiQueryValue(
      value,
      (entry) => normalizeCanonicalRecordIdText(entry, { fallback: "" }),
      { invalidValues }
    );
  }

  if (type === CRUD_LIST_FILTER_TYPE_DATE) {
    return normalizeDateFilterText(value) || rejectInvalidCrudListFilterValue({ invalidValues });
  }

  if (type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    const normalized = normalizeCrudListDateRangeQueryValue(value);
    if (invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD) {
      return normalized || null;
    }
    return normalized || INVALID_CRUD_LIST_FILTER_QUERY_VALUE;
  }

  if (type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    const normalized = normalizeCrudListNumberRangeQueryValue(value);
    if (invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD) {
      return normalized || null;
    }
    return normalized || INVALID_CRUD_LIST_FILTER_QUERY_VALUE;
  }

  return INVALID_CRUD_LIST_FILTER_QUERY_VALUE;
}

function hasCrudListFilterUiValue(filter = {}, rawValue) {
  const normalizedValue = normalizeCrudListFilterUiValue(filter, rawValue);
  const type = normalizeCrudListFilterType(filter.type);

  if (type === CRUD_LIST_FILTER_TYPE_FLAG) {
    return normalizedValue === true;
  }

  if (isCrudListFilterMultiValue(filter)) {
    return Array.isArray(normalizedValue) && normalizedValue.length > 0;
  }

  if (type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return Boolean(normalizeText(normalizedValue?.from) || normalizeText(normalizedValue?.to));
  }

  if (type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return Boolean(normalizeText(normalizedValue?.min) || normalizeText(normalizedValue?.max));
  }

  return Boolean(normalizeText(normalizedValue));
}

function listCrudListFilterChipValues(filter = {}, rawValue) {
  const normalizedValue = normalizeCrudListFilterUiValue(filter, rawValue);

  if (!hasCrudListFilterUiValue(filter, normalizedValue)) {
    return [];
  }

  if (isCrudListFilterMultiValue(filter)) {
    return Array.isArray(normalizedValue) ? normalizedValue : [];
  }

  return [normalizedValue];
}

function formatCrudListFilterDefaultChipLabel(filter = {}, rawValue, { resolveAtomicValue = null } = {}) {
  const normalizedValue = normalizeCrudListFilterUiValue(filter, rawValue);
  const type = normalizeCrudListFilterType(filter.type);
  const resolveAtomicLabel = typeof resolveAtomicValue === "function"
    ? resolveAtomicValue
    : (value) => String(value || "");

  if (type === CRUD_LIST_FILTER_TYPE_FLAG) {
    return filter.label;
  }

  if (
    type === CRUD_LIST_FILTER_TYPE_ENUM ||
    type === CRUD_LIST_FILTER_TYPE_PRESENCE ||
    type === CRUD_LIST_FILTER_TYPE_RECORD_ID
  ) {
    return `${filter.label}: ${resolveAtomicLabel(normalizedValue, filter)}`;
  }

  if (type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    const atomicValue = Array.isArray(normalizedValue)
      ? normalizedValue[0] || ""
      : normalizeText(normalizedValue);
    return `${filter.label}: ${resolveAtomicLabel(atomicValue, filter)}`;
  }

  if (type === CRUD_LIST_FILTER_TYPE_DATE) {
    return `${filter.label}: ${normalizedValue}`;
  }

  if (type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    if (normalizedValue?.from && normalizedValue?.to) {
      return `${filter.label}: ${normalizedValue.from} to ${normalizedValue.to}`;
    }
    if (normalizedValue?.from) {
      return `${filter.label}: from ${normalizedValue.from}`;
    }
    return `${filter.label}: to ${normalizedValue?.to || ""}`;
  }

  if (type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    if (normalizedValue?.min && normalizedValue?.max) {
      return `${filter.label}: ${normalizedValue.min} to ${normalizedValue.max}`;
    }
    if (normalizedValue?.min) {
      return `${filter.label}: min ${normalizedValue.min}`;
    }
    return `${filter.label}: max ${normalizedValue?.max || ""}`;
  }

  return filter.label;
}

function normalizeCrudListFilterType(value = "") {
  const normalized = normalizeText(value);
  if (CRUD_LIST_FILTER_TYPES.includes(normalized)) {
    return normalized;
  }

  throw new TypeError(`Unsupported CRUD list filter type "${value}".`);
}

export {
  CRUD_LIST_FILTER_TYPE_FLAG,
  CRUD_LIST_FILTER_TYPE_ENUM,
  CRUD_LIST_FILTER_TYPE_ENUM_MANY,
  CRUD_LIST_FILTER_TYPE_RECORD_ID,
  CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY,
  CRUD_LIST_FILTER_TYPE_DATE,
  CRUD_LIST_FILTER_TYPE_DATE_RANGE,
  CRUD_LIST_FILTER_TYPE_NUMBER_RANGE,
  CRUD_LIST_FILTER_TYPE_PRESENCE,
  CRUD_LIST_FILTER_TYPES,
  CRUD_LIST_FILTER_PRESENCE_PRESENT,
  CRUD_LIST_FILTER_PRESENCE_MISSING,
  CRUD_LIST_FILTER_PRESENCE_OPTIONS,
  CRUD_LIST_FILTER_INVALID_VALUES_REJECT,
  CRUD_LIST_FILTER_INVALID_VALUES_DISCARD,
  INVALID_CRUD_LIST_FILTER_QUERY_VALUE,
  normalizeCrudListFilterInvalidValues,
  parseCrudListRangeQueryExpression,
  formatCrudListRangeQueryExpression,
  createCrudListFilterEmptyValue,
  createCrudListFilterInitialValue,
  isCrudListFilterMultiValue,
  isCrudListFilterStructuredValue,
  normalizeCrudListFilterUiValue,
  areCrudListFilterUiValuesEqual,
  hasCrudListFilterUiValue,
  listCrudListFilterChipValues,
  formatCrudListFilterDefaultChipLabel,
  formatCrudListFilterQueryValue,
  parseCrudListFilterQueryValue,
  normalizeCrudListFilterType
};
