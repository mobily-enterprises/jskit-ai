import { deepFreeze } from "./deepFreeze.js";
import {
  normalizeBoolean,
  normalizeCanonicalRecordIdText,
  normalizeUniqueTextList,
  normalizeText,
  normalizeObject
} from "./normalize.js";
import {
  normalizeCrudLookupApiPath,
  normalizeCrudLookupNamespace,
  resolveCrudLookupApiPathFromNamespace
} from "./crudLookup.js";

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

function createCrudListFilterInitialValue(filter = {}) {
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
    const values = Array.isArray(value) ? value : [value];
    const normalizedValues = normalizeAllowedFilterTextValues(value, allowedValues);

    if (invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD) {
      return normalizedValues.length > 0 ? normalizedValues : null;
    }

    return normalizedValues.length > 0 && normalizedValues.length === values.length
      ? normalizedValues
      : INVALID_CRUD_LIST_FILTER_QUERY_VALUE;
  }

  if (type === CRUD_LIST_FILTER_TYPE_RECORD_ID) {
    return normalizeCanonicalRecordIdText(firstCrudListFilterValue(value), {
      fallback: ""
    }) || rejectInvalidCrudListFilterValue({ invalidValues });
  }

  if (type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    const values = Array.isArray(value) ? value : [value];
    const normalizedValues = normalizeCanonicalRecordIdList(value);

    if (invalidValues === CRUD_LIST_FILTER_INVALID_VALUES_DISCARD) {
      return normalizedValues.length > 0 ? normalizedValues : null;
    }

    return normalizedValues.length > 0 && normalizedValues.length === values.length
      ? normalizedValues
      : INVALID_CRUD_LIST_FILTER_QUERY_VALUE;
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

function normalizeCrudListFilterOption(rawOption = null, { context = "filter option" } = {}) {
  const source = typeof rawOption === "string"
    ? { value: rawOption }
    : normalizeObject(rawOption);
  const value = normalizeText(source.value);
  if (!value) {
    throw new TypeError(`${context} requires value.`);
  }

  return Object.freeze({
    value,
    label: normalizeText(source.label) || value
  });
}

function normalizeCrudListFilterOptions(rawOptions = [], { context = "filter options" } = {}) {
  const source = Array.isArray(rawOptions) ? rawOptions : [];
  const options = [];
  const seenValues = new Set();

  for (const rawOption of source) {
    const option = normalizeCrudListFilterOption(rawOption, { context });
    if (seenValues.has(option.value)) {
      continue;
    }

    seenValues.add(option.value);
    options.push(option);
  }

  return Object.freeze(options);
}

function normalizeCrudListFilterPresenceOptions(rawOptions = []) {
  const sourceOptions = normalizeCrudListFilterOptions(rawOptions, {
    context: "presence filter options"
  });
  if (sourceOptions.length < 1) {
    return CRUD_LIST_FILTER_PRESENCE_OPTIONS;
  }

  const optionMap = new Map(sourceOptions.map((entry) => [entry.value, entry]));
  const presentOption = optionMap.get(CRUD_LIST_FILTER_PRESENCE_PRESENT);
  const missingOption = optionMap.get(CRUD_LIST_FILTER_PRESENCE_MISSING);
  if (!presentOption || !missingOption) {
    throw new TypeError('Presence filter options must contain both "present" and "missing" values.');
  }

  return Object.freeze([
    presentOption,
    missingOption
  ]);
}

function normalizeCrudListFilterLookup(rawLookup = null) {
  if (rawLookup == null) {
    return null;
  }
  if (!rawLookup || typeof rawLookup !== "object" || Array.isArray(rawLookup)) {
    throw new TypeError("CRUD list filter lookup must be an object.");
  }
  const source = normalizeObject(rawLookup);

  const namespace = normalizeCrudLookupNamespace(source.namespace);
  const explicitApiPath = normalizeCrudLookupApiPath(source.apiSuffix || source.apiPath);
  const apiSuffix = explicitApiPath || resolveCrudLookupApiPathFromNamespace(namespace);
  const labelKey = normalizeText(source.labelKey);
  const valueKey = normalizeText(source.valueKey) || "id";

  return Object.freeze({
    ...(namespace ? { namespace } : {}),
    ...(apiSuffix ? { apiSuffix } : {}),
    ...(labelKey ? { labelKey } : {}),
    valueKey
  });
}

function resolveCrudListFilterOptionSet(rawDefinition = {}, type = "") {
  if (type === CRUD_LIST_FILTER_TYPE_ENUM || type === CRUD_LIST_FILTER_TYPE_ENUM_MANY) {
    const options = normalizeCrudListFilterOptions(rawDefinition.options, {
      context: `${type} filter options`
    });
    if (options.length < 1) {
      throw new TypeError(`${type} filters require at least one option.`);
    }
    return options;
  }

  if (type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    return normalizeCrudListFilterPresenceOptions(rawDefinition.options);
  }

  return Object.freeze([]);
}

function resolveCrudListFilterQueryKeys(definition = {}) {
  return Object.freeze([normalizeText(definition.queryKey)].filter(Boolean));
}

function resolveCrudListFilterOptionLabel(definition = {}, value = "", { fallback = "" } = {}) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return normalizeText(fallback);
  }

  const options = Array.isArray(definition?.options) ? definition.options : [];
  const optionLabel = options.find((entry) => entry?.value === normalizedValue)?.label;
  return normalizeText(optionLabel) || normalizeText(fallback) || normalizedValue;
}

function normalizeCrudListFilterDefinition(rawKey = "", rawDefinition = null) {
  const key = normalizeText(rawKey);
  if (!key) {
    throw new TypeError("CRUD list filter definitions require non-empty keys.");
  }

  if (!rawDefinition || typeof rawDefinition !== "object" || Array.isArray(rawDefinition)) {
    throw new TypeError(`CRUD list filter "${key}" must be an object.`);
  }
  const source = normalizeObject(rawDefinition);

  const type = normalizeCrudListFilterType(source.type);
  const label = normalizeText(source.label) || key;
  const options = resolveCrudListFilterOptionSet(source, type);
  const lookup = normalizeCrudListFilterLookup(source.lookup);
  const chipLabel = typeof source.chipLabel === "function" ? source.chipLabel : null;
  const ui = source.ui && typeof source.ui === "object" && !Array.isArray(source.ui)
    ? deepFreeze({ ...source.ui })
    : null;
  const meta = source.meta && typeof source.meta === "object" && !Array.isArray(source.meta)
    ? deepFreeze({ ...source.meta })
    : null;

  if (type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    if (normalizeText(source.fromKey) || normalizeText(source.toKey)) {
      throw new TypeError(`CRUD list filter "${key}" uses unsupported legacy range keys. Use queryKey.`);
    }
  }

  if (type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    if (normalizeText(source.minKey) || normalizeText(source.maxKey)) {
      throw new TypeError(`CRUD list filter "${key}" uses unsupported legacy range keys. Use queryKey.`);
    }
  }

  return Object.freeze({
    key,
    type,
    label,
    queryKey: normalizeText(source.queryKey) || key,
    options,
    lookup,
    chipLabel,
    ui,
    meta
  });
}

function defineCrudListFilters(definitions = {}) {
  if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) {
    throw new TypeError("defineCrudListFilters requires an object.");
  }
  const source = normalizeObject(definitions);

  const normalized = {};
  const seenFilterKeys = new Set();
  const seenQueryKeys = new Map();

  for (const [rawKey, rawDefinition] of Object.entries(source)) {
    const filter = normalizeCrudListFilterDefinition(rawKey, rawDefinition);
    if (seenFilterKeys.has(filter.key)) {
      throw new TypeError(`Duplicate CRUD list filter key "${filter.key}".`);
    }
    seenFilterKeys.add(filter.key);

    for (const queryKey of resolveCrudListFilterQueryKeys(filter)) {
      const seenBy = seenQueryKeys.get(queryKey);
      if (seenBy) {
        throw new TypeError(`CRUD list filters "${seenBy}" and "${filter.key}" both use query key "${queryKey}".`);
      }
      seenQueryKeys.set(queryKey, filter.key);
    }

    normalized[filter.key] = filter;
  }

  return deepFreeze(normalized);
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
  defineCrudListFilters,
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
  resolveCrudListFilterQueryKeys,
  resolveCrudListFilterOptionLabel
};
