import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { useList } from "./useList.js";

function normalizeQueryKeyPrefix(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
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
    const targetResource = normalizeText(rawRelation.targetResource);
    if (relationKind !== "lookup" || !targetResource) {
      continue;
    }
    const valueKey = normalizeText(rawRelation.valueKey);
    const labelKey = normalizeText(rawRelation.labelKey);
    if (!valueKey || !labelKey) {
      continue;
    }

    const runtime = useList({
      adapter: adapter || undefined,
      apiSuffix: `/crud/${targetResource}`,
      queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
        ...normalizedQueryKeyPrefix,
        key,
        String(surfaceId || ""),
        String(workspaceSlug || "")
      ],
      placementSource: normalizedPlacementSourcePrefix
        ? `${normalizedPlacementSourcePrefix}.${key}`
        : `crud.lookup.${key}`,
      fallbackLoadError: `Unable to load ${targetResource} options.`,
      recordIdParam: normalizedRecordIdParam,
      recordIdSelector: (item = {}) => item[valueKey],
      viewUrlTemplate: "",
      editUrlTemplate: ""
    });

    runtimes.set(key, Object.freeze({
      runtime,
      valueKey,
      labelKey
    }));
  }

  function resolveLookupItems(fieldKey = "") {
    const key = normalizeText(fieldKey);
    const entry = runtimes.get(key);
    if (!entry) {
      return [];
    }

    return (Array.isArray(entry.runtime.items) ? entry.runtime.items : []).map((item = {}) => {
      const value = item?.[entry.valueKey];
      const label = item?.[entry.labelKey];
      return {
        value: value ?? "",
        label: String(label ?? value ?? "")
      };
    });
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
