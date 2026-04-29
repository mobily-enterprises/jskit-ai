import { computed, reactive } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  defineCrudListFilters,
  createCrudListFilterInitialValue,
  isCrudListFilterMultiValue,
  isCrudListFilterStructuredValue,
  normalizeCrudListFilterUiValue,
  areCrudListFilterUiValuesEqual,
  listCrudListFilterChipValues,
  formatCrudListFilterDefaultChipLabel,
  formatCrudListFilterQueryValue,
  resolveCrudListFilterOptionLabel,
  CRUD_LIST_FILTER_TYPE_FLAG
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

    const values = rawPreset.values && typeof rawPreset.values === "object" && !Array.isArray(rawPreset.values)
      ? rawPreset.values
      : {};
    const resolveValues = typeof rawPreset.resolveValues === "function"
      ? rawPreset.resolveValues
      : null;

    normalized.push(Object.freeze({
      key,
      label,
      values,
      resolveValues
    }));
  }

  return Object.freeze(normalized);
}

function resolvePresetValues(preset = {}, { values = {}, filters = {} } = {}) {
  const rawValues = typeof preset.resolveValues === "function"
    ? preset.resolveValues({
        values,
        filters,
        presetKey: preset.key,
        preset
      })
    : preset.values;

  return rawValues && typeof rawValues === "object" && !Array.isArray(rawValues)
    ? rawValues
    : {};
}

function createRuntimeFilterValue(filter = {}) {
  const initialValue = createCrudListFilterInitialValue(filter);
  return isCrudListFilterStructuredValue(filter)
    ? reactive(initialValue)
    : initialValue;
}

function assignFilterValue(values, filter = {}, rawValue) {
  const normalizedValue = normalizeCrudListFilterUiValue(filter, rawValue);

  if (!isCrudListFilterStructuredValue(filter)) {
    values[filter.key] = normalizedValue;
    return;
  }

  if (values[filter.key] && typeof values[filter.key] === "object" && !Array.isArray(values[filter.key])) {
    Object.assign(values[filter.key], normalizedValue);
    return;
  }

  values[filter.key] = reactive(normalizedValue);
}

function resetFilterValue(values, filter = {}) {
  assignFilterValue(values, filter, createCrudListFilterInitialValue(filter));
}

function applyPresetFilterValue(values, filter = {}, rawValue) {
  assignFilterValue(values, filter, rawValue);
}

function createQueryParams(values, filterEntries = []) {
  const queryParams = {};

  for (const filter of filterEntries) {
    queryParams[filter.queryKey] = computed({
      get() {
        return formatCrudListFilterQueryValue(
          filter,
          normalizeCrudListFilterUiValue(filter, values[filter.key])
        );
      },
      set(nextValue) {
        assignFilterValue(values, filter, nextValue);
      }
    });
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

function useCrudListFilters(definitions = {}, { labelResolvers = {}, chipLabels = {}, presets = [] } = {}) {
  const filters = defineCrudListFilters(definitions);
  const filterEntries = Object.values(filters);
  const normalizedLabelResolvers = normalizeFunctionMap(labelResolvers);
  const normalizedChipLabels = normalizeFunctionMap(chipLabels);
  const normalizedPresets = normalizePresetEntries(presets);
  const values = reactive({});
  const options = {};

  for (const filter of filterEntries) {
    values[filter.key] = createRuntimeFilterValue(filter);
    if (Array.isArray(filter.options) && filter.options.length > 0) {
      options[filter.key] = filter.options;
    }
  }

  const queryParams = createQueryParams(values, filterEntries);

  const activeChips = computed(() => {
    const chips = [];

    for (const filter of filterEntries) {
      const customChipLabel = normalizedChipLabels[filter.key];
      const chipValues = listCrudListFilterChipValues(filter, values[filter.key]);

      for (const chipValue of chipValues) {
        chips.push({
          id: isCrudListFilterMultiValue(filter) ? `${filter.key}:${chipValue}` : filter.key,
          filterKey: filter.key,
          ...(isCrudListFilterMultiValue(filter) ? { value: chipValue } : {}),
          label: normalizeText(customChipLabel?.(chipValue, filter, values))
            || normalizeText(filter.chipLabel?.(chipValue, filter, values))
            || formatCrudListFilterDefaultChipLabel(filter, chipValue, {
              resolveAtomicValue(value) {
                return resolveAtomicValueLabel(filter, value, normalizedLabelResolvers);
              }
            })
        });
      }
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

    if (isCrudListFilterMultiValue(filter)) {
      assignFilterValue(
        values,
        filter,
        (Array.isArray(values[filter.key]) ? values[filter.key] : [])
          .filter((entry) => entry !== chip.value)
      );
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

    const presetValues = resolvePresetValues(preset, {
      values,
      filters
    });

    if (mode !== "merge") {
      clearFilters();
    }

    for (const filter of filterEntries) {
      if (!Object.hasOwn(presetValues, filter.key)) {
        continue;
      }

      applyPresetFilterValue(values, filter, presetValues[filter.key]);
    }
  }

  function matchesPreset(presetKey = "") {
    const preset = normalizedPresets.find((entry) => entry.key === normalizeText(presetKey));
    if (!preset) {
      return false;
    }

    const presetValues = resolvePresetValues(preset, {
      values,
      filters
    });
    let matchedFilter = false;

    for (const filter of filterEntries) {
      if (!Object.hasOwn(presetValues, filter.key)) {
        continue;
      }

      matchedFilter = true;
      if (!areCrudListFilterUiValuesEqual(filter, values[filter.key], presetValues[filter.key])) {
        return false;
      }
    }

    return matchedFilter;
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
    applyPreset,
    matchesPreset
  });
}

export { useCrudListFilters };
