import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
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

function normalizeLookupApiPath(relation = {}) {
  if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
    return "";
  }

  const relationApiPath = normalizeText(relation.apiPath);
  if (relationApiPath) {
    return relationApiPath;
  }

  const sourcePath = normalizeText(relation?.source?.path);
  if (sourcePath) {
    return sourcePath;
  }

  const targetResource = normalizeText(relation.targetResource);
  if (targetResource) {
    return `/${targetResource}`;
  }

  return "";
}

function isSameLookupValue(left, right) {
  if (left === right) {
    return true;
  }

  return String(left ?? "") === String(right ?? "");
}

function createSelectedLookupItem(selectedValue, selectedRecord = {}, entry = {}) {
  if (selectedValue == null || selectedValue === "") {
    return null;
  }

  const sourceRecord = asPlainObject(selectedRecord);
  const hydratedLookup = asPlainObject(asPlainObject(sourceRecord.lookups)[entry.fieldKey]);
  const hydratedValue = hydratedLookup[entry.valueKey];
  const value = hydratedValue == null || hydratedValue === "" ? selectedValue : hydratedValue;
  if (value == null || value === "") {
    return null;
  }

  const displayValue = resolveLookupFieldDisplayValue(
    {
      [entry.fieldKey]: value,
      lookups: {
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
  placementSourcePrefix = ""
} = {}) {
  const runtimes = new Map();
  const normalizedRecordIdParam = normalizeText(recordIdParam) || "recordId";
  const normalizedPlacementSourcePrefix = normalizeText(placementSourcePrefix);
  const normalizedQueryKeyPrefix = normalizeQueryKeyPrefix(queryKeyPrefix);

  for (const field of Array.isArray(formFields) ? formFields : []) {
    const key = normalizeText(field?.key);
    const rawRelation = field?.relation;
    if (!key || !rawRelation || typeof rawRelation !== "object" || Array.isArray(rawRelation) || runtimes.has(key)) {
      continue;
    }

    const relationKind = normalizeText(rawRelation.kind).toLowerCase();
    const apiPath = normalizeLookupApiPath(rawRelation);
    if (relationKind !== "lookup" || !apiPath) {
      continue;
    }
    const valueKey = normalizeText(rawRelation.valueKey);
    const labelKey = normalizeText(rawRelation.labelKey);
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
      valueKey,
      labelKey,
      relation: Object.freeze({
        kind: "lookup",
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
      const value = item?.[entry.valueKey];
      const resolvedLabel = resolveLookupItemLabel(item, entry.labelKey);
      const label = resolvedLabel || value;
      return {
        value: value ?? "",
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

  return Object.freeze({
    resolveLookupItems,
    resolveLookupLoading
  });
}

export { createCrudLookupFieldRuntime };
