import { computed, reactive, toRef } from "vue";
import { normalizeText, normalizeUniqueTextList } from "@jskit-ai/kernel/shared/support/normalize";
import {
  defineCrudListFilters,
  resolveCrudListFilterOptionLabel,
  CRUD_LIST_FILTER_TYPE_FLAG,
  CRUD_LIST_FILTER_TYPE_ENUM,
  CRUD_LIST_FILTER_TYPE_ENUM_MANY,
  CRUD_LIST_FILTER_TYPE_RECORD_ID,
  CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY,
  CRUD_LIST_FILTER_TYPE_DATE,
  CRUD_LIST_FILTER_TYPE_DATE_RANGE,
  CRUD_LIST_FILTER_TYPE_NUMBER_RANGE,
  CRUD_LIST_FILTER_TYPE_PRESENCE
} from "@jskit-ai/kernel/shared/support/crudListFilters";

function normalizeFunctionMap(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const normalized = {};

  for (const [key, entry] of Object.entries(source)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey || typeof entry !== "function") {
      continue;
    }

    normalized[normalizedKey] = entry;
  }

  return Object.freeze(normalized);
}

function createInitialFilterValue(filter = {}) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    return false;
  }
  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    return [];
  }
  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    return reactive({
      from: "",
      to: ""
    });
  }
  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    return reactive({
      min: "",
      max: ""
    });
  }

  return "";
}

function normalizePresetEntries(presets = []) {
  const source = Array.isArray(presets) ? presets : [];
  const normalized = [];
  const seenKeys = new Set();

  for (const rawPreset of source) {
    if (!rawPreset || typeof rawPreset !== "object" || Array.isArray(rawPreset)) {
      continue;
    }

    const key = normalizeText(rawPreset.key);
    const label = normalizeText(rawPreset.label);
    if (!key || !label || seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);

    normalized.push(Object.freeze({
      key,
      label,
      values: rawPreset.values && typeof rawPreset.values === "object" && !Array.isArray(rawPreset.values)
        ? rawPreset.values
        : {}
    }));
  }

  return Object.freeze(normalized);
}

function normalizePresetFilterValue(filter = {}, rawValue) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    return rawValue === true;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    const allowedValues = filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE
      ? new Set((filter.options || []).map((entry) => entry.value))
      : null;
    const normalizedList = normalizeUniqueTextList(rawValue, {
      acceptSingle: true
    });
    if (!allowedValues) {
      return normalizedList;
    }

    return normalizedList.filter((entry) => allowedValues.has(entry));
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? rawValue
      : {};
    return {
      from: normalizeText(source.from),
      to: normalizeText(source.to)
    };
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    const source = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? rawValue
      : {};
    return {
      min: normalizeText(source.min),
      max: normalizeText(source.max)
    };
  }

  const normalized = normalizeText(rawValue);
  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM || filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE) {
    const allowedValues = new Set((filter.options || []).map((entry) => entry.value));
    return allowedValues.has(normalized) ? normalized : "";
  }

  return normalized;
}

function resetFilterValue(values, filter = {}) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    values[filter.key] = false;
    return;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
    values[filter.key] = [];
    return;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    values[filter.key].from = "";
    values[filter.key].to = "";
    return;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    values[filter.key].min = "";
    values[filter.key].max = "";
    return;
  }

  values[filter.key] = "";
}

function applyPresetFilterValue(values, filter = {}, rawValue) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE || filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    const nextValue = normalizePresetFilterValue(filter, rawValue);
    Object.assign(values[filter.key], nextValue);
    return;
  }

  values[filter.key] = normalizePresetFilterValue(filter, rawValue);
}

function createQueryParams(values, filterEntries = []) {
  const queryParams = {};

  for (const filter of filterEntries) {
    if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
      queryParams[filter.fromKey] = toRef(values[filter.key], "from");
      queryParams[filter.toKey] = toRef(values[filter.key], "to");
      continue;
    }

    if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
      queryParams[filter.minKey] = toRef(values[filter.key], "min");
      queryParams[filter.maxKey] = toRef(values[filter.key], "max");
      continue;
    }

    queryParams[filter.queryKey] = toRef(values, filter.key);
  }

  return Object.freeze(queryParams);
}

function resolveAtomicValueLabel(filter = {}, value = "", labelResolvers = {}) {
  const customResolver = labelResolvers[filter.key];
  if (typeof customResolver === "function") {
    const customLabel = normalizeText(customResolver(value, filter));
    if (customLabel) {
      return customLabel;
    }
  }

  return resolveCrudListFilterOptionLabel(filter, value, {
    fallback: String(value || "")
  });
}

function defaultChipLabel(filter = {}, value, labelResolvers = {}) {
  if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
    return filter.label;
  }

  if (
    filter.type === CRUD_LIST_FILTER_TYPE_ENUM ||
    filter.type === CRUD_LIST_FILTER_TYPE_PRESENCE ||
    filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID
  ) {
    return `${filter.label}: ${resolveAtomicValueLabel(filter, value, labelResolvers)}`;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE) {
    return `${filter.label}: ${value}`;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE) {
    if (value?.from && value?.to) {
      return `${filter.label}: ${value.from} to ${value.to}`;
    }
    if (value?.from) {
      return `${filter.label}: from ${value.from}`;
    }
    return `${filter.label}: to ${value?.to || ""}`;
  }

  if (filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
    if (value?.min && value?.max) {
      return `${filter.label}: ${value.min} to ${value.max}`;
    }
    if (value?.min) {
      return `${filter.label}: min ${value.min}`;
    }
    return `${filter.label}: max ${value?.max || ""}`;
  }

  return filter.label;
}

function useCrudListFilters(definitions = {}, { labelResolvers = {}, chipLabels = {}, presets = [] } = {}) {
  const filters = defineCrudListFilters(definitions);
  const filterEntries = Object.values(filters);
  const normalizedLabelResolvers = normalizeFunctionMap(labelResolvers);
  const normalizedChipLabels = normalizeFunctionMap(chipLabels);
  const normalizedPresets = normalizePresetEntries(presets);
  const values = reactive({});
  const options = {};

  for (const filter of filterEntries) {
    values[filter.key] = createInitialFilterValue(filter);
    if (Array.isArray(filter.options) && filter.options.length > 0) {
      options[filter.key] = filter.options;
    }
  }

  const queryParams = createQueryParams(values, filterEntries);

  const activeChips = computed(() => {
    const chips = [];

    for (const filter of filterEntries) {
      const customChipLabel = normalizedChipLabels[filter.key];
      const rawValue = values[filter.key];

      if (filter.type === CRUD_LIST_FILTER_TYPE_FLAG) {
        if (rawValue === true) {
          chips.push({
            id: filter.key,
            filterKey: filter.key,
            label: normalizeText(customChipLabel?.(rawValue, filter, values))
              || normalizeText(filter.chipLabel?.(rawValue, filter, values))
              || defaultChipLabel(filter, rawValue, normalizedLabelResolvers)
          });
        }
        continue;
      }

      if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
        for (const value of Array.isArray(rawValue) ? rawValue : []) {
          chips.push({
            id: `${filter.key}:${value}`,
            filterKey: filter.key,
            value,
            label: normalizeText(customChipLabel?.(value, filter, values))
              || normalizeText(filter.chipLabel?.(value, filter, values))
              || `${filter.label}: ${resolveAtomicValueLabel(filter, value, normalizedLabelResolvers)}`
          });
        }
        continue;
      }

      if (filter.type === CRUD_LIST_FILTER_TYPE_DATE_RANGE || filter.type === CRUD_LIST_FILTER_TYPE_NUMBER_RANGE) {
        const hasValue = Boolean(rawValue?.from || rawValue?.to || rawValue?.min || rawValue?.max);
        if (!hasValue) {
          continue;
        }

        chips.push({
          id: filter.key,
          filterKey: filter.key,
          label: normalizeText(customChipLabel?.(rawValue, filter, values))
            || normalizeText(filter.chipLabel?.(rawValue, filter, values))
            || defaultChipLabel(filter, rawValue, normalizedLabelResolvers)
        });
        continue;
      }

      if (!normalizeText(rawValue)) {
        continue;
      }

      chips.push({
        id: filter.key,
        filterKey: filter.key,
        label: normalizeText(customChipLabel?.(rawValue, filter, values))
          || normalizeText(filter.chipLabel?.(rawValue, filter, values))
          || defaultChipLabel(filter, rawValue, normalizedLabelResolvers)
      });
    }

    return chips;
  });

  const hasActiveFilters = computed(() => activeChips.value.length > 0);

  function clearFilter(filterKey = "") {
    const filter = filters[normalizeText(filterKey)];
    if (!filter) {
      return;
    }

    resetFilterValue(values, filter);
  }

  function clearFilters() {
    for (const filter of filterEntries) {
      resetFilterValue(values, filter);
    }
  }

  function clearChip(chip = {}) {
    const filter = filters[normalizeText(chip.filterKey)];
    if (!filter) {
      return;
    }

    if (filter.type === CRUD_LIST_FILTER_TYPE_ENUM_MANY || filter.type === CRUD_LIST_FILTER_TYPE_RECORD_ID_MANY) {
      values[filter.key] = (Array.isArray(values[filter.key]) ? values[filter.key] : [])
        .filter((entry) => entry !== chip.value);
      return;
    }

    resetFilterValue(values, filter);
  }

  function toggle(filterKey = "") {
    const filter = filters[normalizeText(filterKey)];
    if (!filter || filter.type !== CRUD_LIST_FILTER_TYPE_FLAG) {
      return;
    }

    values[filter.key] = !values[filter.key];
  }

  function applyPreset(presetKey = "", { mode = "replace" } = {}) {
    const preset = normalizedPresets.find((entry) => entry.key === normalizeText(presetKey));
    if (!preset) {
      return;
    }

    if (mode !== "merge") {
      clearFilters();
    }

    for (const filter of filterEntries) {
      if (!Object.hasOwn(preset.values, filter.key)) {
        continue;
      }

      applyPresetFilterValue(values, filter, preset.values[filter.key]);
    }
  }

  return Object.freeze({
    filters,
    values,
    queryParams,
    options: Object.freeze(options),
    presets: normalizedPresets,
    activeChips,
    hasActiveFilters,
    clearFilter,
    clearFilters,
    clearChip,
    toggle,
    applyPreset
  });
}

export { useCrudListFilters };
