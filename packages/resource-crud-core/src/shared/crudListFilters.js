// CRUD list filter definitions: defineCrudListFilters and the option, lookup and query-key
// helpers over its definitions. It also exports the filter values from crudListFilterValues.js.
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  normalizeText,
  normalizeObject
} from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizeCrudLookupApiPath,
  normalizeCrudLookupNamespace,
  resolveCrudLookupApiPathFromNamespace
} from "./crudLookup.js";
import {
  CRUD_LIST_FILTER_TYPE_ENUM,
  CRUD_LIST_FILTER_TYPE_ENUM_MANY,
  CRUD_LIST_FILTER_TYPE_DATE_RANGE,
  CRUD_LIST_FILTER_TYPE_NUMBER_RANGE,
  CRUD_LIST_FILTER_TYPE_PRESENCE,
  CRUD_LIST_FILTER_PRESENCE_PRESENT,
  CRUD_LIST_FILTER_PRESENCE_MISSING,
  CRUD_LIST_FILTER_PRESENCE_OPTIONS,
  normalizeCrudListFilterUiValue,
  normalizeCrudListFilterType
} from "./crudListFilterValues.js";

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
  const hasDefaultValue = Object.hasOwn(source, "defaultValue");
  const defaultValue = hasDefaultValue
    ? deepFreeze(normalizeCrudListFilterUiValue({
        type,
        options
      }, source.defaultValue))
    : undefined;

  if (type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    if (normalizeText(source.fromKey) || normalizeText(source.toKey)) {
      throw new TypeError(`CRUD list filter "${key}" uses unsupported split range keys. Use queryKey.`);
    }
  }

  if (type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    if (normalizeText(source.minKey) || normalizeText(source.maxKey)) {
      throw new TypeError(`CRUD list filter "${key}" uses unsupported split range keys. Use queryKey.`);
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
    meta,
    ...(hasDefaultValue ? { defaultValue } : {})
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
  parseCrudListFilterQueryValue
} from "./crudListFilterValues.js";

export {
  defineCrudListFilters,
  resolveCrudListFilterQueryKeys,
  resolveCrudListFilterOptionLabel
};
