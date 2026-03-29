import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizeCrudLookupApiPath,
  normalizeCrudLookupContainerKey
} from "@jskit-ai/kernel/shared/support/crudLookup";
import { useList } from "./useList.js";
import {
  resolveLookupItemLabel,
  resolveLookupFieldDisplayValue
} from "./crudLookupFieldLabelSupport.js";
import { asPlainObject } from "./scopeHelpers.js";

function normalizeQueryKeyPrefix(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function isSameLookupValue(left, right) {
  if (left === right) {
    return true;
  }

  return String(left ?? "") === String(right ?? "");
}

function normalizeLookupValue(value) {
  if (value == null) {
    return "";
  }

  return String(value);
}

function createSelectedLookupItem(selectedValue, selectedRecord = {}, entry = {}) {
  if (selectedValue == null || selectedValue === "") {
    return null;
  }

  const sourceRecord = asPlainObject(selectedRecord);
  const sourceLookups = asPlainObject(sourceRecord[entry.lookupContainerKey]);
  const hydratedLookup = asPlainObject(sourceLookups[entry.fieldKey]);
  const hydratedValue = hydratedLookup[entry.valueKey];
  const value = normalizeLookupValue(
    hydratedValue == null || hydratedValue === "" ? selectedValue : hydratedValue
  );
  if (!value) {
    return null;
  }

  const displayValue = resolveLookupFieldDisplayValue(
    {
      [entry.fieldKey]: value,
      [entry.lookupContainerKey]: {
        [entry.fieldKey]: hydratedLookup
      }
    },
    {
      key: entry.fieldKey,
      relation: entry.relation
    }
  );
  const label = displayValue == null || displayValue === "" ? value : displayValue;
  return {
    value,
    label: String(label ?? "")
  };
}

function createCrudLookupFieldRuntime({
  formFields = [],
  adapter = null,
  recordIdParam = "recordId",
  queryKeyPrefix = [],
  placementSourcePrefix = "",
  lookupContainerKey = "lookups"
} = {}) {
  const runtimes = new Map();
  const normalizedRecordIdParam = normalizeText(recordIdParam) || "recordId";
  const normalizedPlacementSourcePrefix = normalizeText(placementSourcePrefix);
  const normalizedQueryKeyPrefix = normalizeQueryKeyPrefix(queryKeyPrefix);
  const defaultLookupContainerKey = normalizeCrudLookupContainerKey(lookupContainerKey, {
    context: "createCrudLookupFieldRuntime lookupContainerKey"
  });

  for (const field of Array.isArray(formFields) ? formFields : []) {
    const key = normalizeText(field?.key);
    const rawRelation = field?.relation;
    if (!key || !rawRelation || typeof rawRelation !== "object" || Array.isArray(rawRelation) || runtimes.has(key)) {
      continue;
    }

    const relationKind = normalizeText(rawRelation.kind).toLowerCase();
    const apiPath = normalizeCrudLookupApiPath(rawRelation.apiPath);
    if (relationKind !== "lookup" || !apiPath) {
      continue;
    }
    const valueKey = normalizeText(rawRelation.valueKey);
    const labelKey = normalizeText(rawRelation.labelKey);
    const relationLookupContainerKey = normalizeCrudLookupContainerKey(rawRelation.containerKey, {
      defaultValue: defaultLookupContainerKey,
      context: `createCrudLookupFieldRuntime formFields["${key}"].relation.containerKey`
    });
    if (!valueKey) {
      continue;
    }

    const runtime = useList({
      adapter: adapter || undefined,
      apiSuffix: apiPath,
      queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
        ...normalizedQueryKeyPrefix,
        key,
        String(surfaceId || ""),
        String(workspaceSlug || "")
      ],
      search: {
        enabled: true,
        mode: "query",
        queryParam: "q"
      },
      placementSource: normalizedPlacementSourcePrefix
        ? `${normalizedPlacementSourcePrefix}.${key}`
        : `crud.lookup.${key}`,
      fallbackLoadError: `Unable to load lookup options (${apiPath}).`,
      recordIdParam: normalizedRecordIdParam,
      recordIdSelector: (item = {}) => item[valueKey],
      viewUrlTemplate: "",
      editUrlTemplate: ""
    });

    runtimes.set(key, Object.freeze({
      runtime,
      fieldKey: key,
      lookupContainerKey: relationLookupContainerKey,
      valueKey,
      labelKey,
      relation: Object.freeze({
        kind: "lookup",
        containerKey: relationLookupContainerKey,
        valueKey,
        ...(labelKey ? { labelKey } : {})
      })
    }));
  }

  function resolveLookupItems(fieldKey = "", options = {}) {
    const key = normalizeText(fieldKey);
    const entry = runtimes.get(key);
    if (!entry) {
      return [];
    }

    const items = (Array.isArray(entry.runtime.items) ? entry.runtime.items : []).map((item = {}) => {
      const value = normalizeLookupValue(item?.[entry.valueKey]);
      const resolvedLabel = resolveLookupItemLabel(item, entry.labelKey);
      const label = resolvedLabel || value;
      return {
        value,
        label: String(label ?? "")
      };
    });

    const selectedItem = createSelectedLookupItem(
      options?.selectedValue,
      options?.selectedRecord,
      entry
    );
    if (!selectedItem) {
      return items;
    }

    if (items.some((item) => isSameLookupValue(item?.value, selectedItem.value))) {
      return items;
    }

    return [selectedItem, ...items];
  }

  function resolveLookupLoading(fieldKey = "") {
    const key = normalizeText(fieldKey);
    const entry = runtimes.get(key);
    if (!entry) {
      return false;
    }

    return Boolean(entry.runtime.isInitialLoading || entry.runtime.isFetching || entry.runtime.isRefetching);
  }

  function resolveLookupSearch(fieldKey = "") {
    const key = normalizeText(fieldKey);
    const entry = runtimes.get(key);
    if (!entry) {
      return "";
    }

    return String(entry.runtime.searchQuery || "");
  }

  function setLookupSearch(fieldKey = "", searchValue = "") {
    const key = normalizeText(fieldKey);
    const entry = runtimes.get(key);
    if (!entry) {
      return;
    }

    entry.runtime.searchQuery = String(searchValue || "");
  }

  return Object.freeze({
    resolveLookupItems,
    resolveLookupLoading,
    resolveLookupSearch,
    setLookupSearch
  });
}

export { createCrudLookupFieldRuntime };
