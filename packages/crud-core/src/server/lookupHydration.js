import { normalizeOpaqueId, normalizeText, normalizeUniqueTextList } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeCrudLookupApiPath } from "./lookupPathSupport.js";

function normalizeLookupRelationEntry(entry = {}, outputKeys = new Set()) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const key = normalizeText(entry.key);
  if (!key || (outputKeys instanceof Set && !outputKeys.has(key))) {
    return null;
  }

  const relation = entry.relation;
  if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
    return null;
  }

  const relationKind = normalizeText(relation.kind).toLowerCase();
  if (relationKind !== "lookup") {
    return null;
  }

  const apiPath = normalizeCrudLookupApiPath(relation.apiPath);
  if (!apiPath) {
    return null;
  }

  const valueKey = normalizeText(relation.valueKey) || "id";

  return {
    key,
    relation: {
      kind: "lookup",
      apiPath,
      valueKey,
      hydrateOnList: relation.hydrateOnList !== false,
      hydrateOnView: relation.hydrateOnView !== false
    }
  };
}

function createCrudLookupRuntime(resource = {}, { outputKeys = [] } = {}) {
  const outputKeySet = new Set(
    (Array.isArray(outputKeys) ? outputKeys : [])
      .map((key) => normalizeText(key))
      .filter(Boolean)
  );

  const sourceEntries = Array.isArray(resource?.fieldMeta) ? resource.fieldMeta : [];
  const lookupEntries = [];
  const seenKeys = new Set();

  for (const entry of sourceEntries) {
    const normalizedEntry = normalizeLookupRelationEntry(entry, outputKeySet);
    if (!normalizedEntry) {
      continue;
    }

    if (seenKeys.has(normalizedEntry.key)) {
      continue;
    }
    seenKeys.add(normalizedEntry.key);
    lookupEntries.push(normalizedEntry);
  }

  const lookupEntryByKey = lookupEntries.reduce((accumulator, entry) => {
    accumulator[entry.key] = entry;
    return accumulator;
  }, {});

  return {
    entries: lookupEntries,
    byKey: lookupEntryByKey
  };
}

function normalizeLookupIdentifier(value) {
  const normalized = normalizeOpaqueId(value);
  if (normalized == null) {
    return "";
  }

  return normalizeText(normalized);
}

function parseLookupInclude(include) {
  const normalized = normalizeText(include);
  if (!normalized) {
    return {
      mode: "all",
      keys: []
    };
  }

  if (normalized.toLowerCase() === "none") {
    return {
      mode: "none",
      keys: []
    };
  }

  if (normalized === "*") {
    return {
      mode: "all",
      keys: []
    };
  }

  const keys = normalizeUniqueTextList(normalized.split(","));

  if (keys.length < 1) {
    return {
      mode: "all",
      keys: []
    };
  }

  if (keys.some((key) => key.toLowerCase() === "none")) {
    return {
      mode: "none",
      keys: []
    };
  }

  if (keys.some((key) => key === "*")) {
    return {
      mode: "all",
      keys: []
    };
  }

  return {
    mode: "keys",
    keys
  };
}

function selectLookupEntries(runtime = {}, include, { mode = "list", context = "crudRepository" } = {}) {
  const entries = Array.isArray(runtime?.entries) ? runtime.entries : [];
  if (entries.length < 1) {
    return [];
  }

  const parsedInclude = parseLookupInclude(include);
  if (parsedInclude.mode === "none") {
    return [];
  }

  if (parsedInclude.mode === "keys") {
    const selected = [];
    for (const key of parsedInclude.keys) {
      const entry = runtime?.byKey?.[key] || null;
      if (!entry) {
        throw new Error(`${context} include references unknown lookup key "${key}".`);
      }
      selected.push(entry);
    }
    return selected;
  }

  const shouldHydrate = mode === "view"
    ? (entry) => entry?.relation?.hydrateOnView !== false
    : (entry) => entry?.relation?.hydrateOnList !== false;

  return entries.filter((entry) => shouldHydrate(entry));
}

function resolveLookupProviderResolver(repositoryOptions = {}, callOptions = {}, { context = "crudRepository" } = {}) {
  const resolver = callOptions?.resolveLookupProvider || repositoryOptions?.resolveLookupProvider;
  if (typeof resolver !== "function") {
    throw new TypeError(`${context} requires resolveLookupProvider(relation) to hydrate lookups.`);
  }
  return resolver;
}

function buildLookupGroupKey(relation = {}) {
  return `${relation.apiPath}::${relation.valueKey}`;
}

function normalizeLookupRelationValues(records = [], entries = []) {
  const byGroup = new Map();
  for (const entry of entries) {
    const relation = entry.relation;
    const groupKey = buildLookupGroupKey(relation);
    if (!byGroup.has(groupKey)) {
      byGroup.set(groupKey, {
        relation,
        entries: [],
        values: []
      });
    }

    const group = byGroup.get(groupKey);
    group.entries.push(entry);
  }

  for (const group of byGroup.values()) {
    const seen = new Set();
    for (const record of records) {
      for (const entry of group.entries) {
        const rawValue = record?.[entry.key];
        const normalized = normalizeLookupIdentifier(rawValue);
        if (!normalized || seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        group.values.push(rawValue);
      }
    }
  }

  return byGroup;
}

function normalizeLookupProvider(provider, relation = {}, { context = "crudRepository" } = {}) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error(`${context} could not resolve lookup provider for apiPath "${relation.apiPath}".`);
  }
  if (typeof provider.listByIds !== "function") {
    throw new Error(`${context} lookup provider for apiPath "${relation.apiPath}" must expose listByIds(ids, options).`);
  }
  return provider;
}

function buildLookupRecordMap(records = [], valueKey = "") {
  const lookupMap = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const lookupId = normalizeLookupIdentifier(record?.[valueKey]);
    if (!lookupId || lookupMap.has(lookupId)) {
      continue;
    }
    lookupMap.set(lookupId, record);
  }
  return lookupMap;
}

async function hydrateCrudLookupRecords(
  records = [],
  runtime = {},
  {
    include,
    mode = "list",
    repositoryOptions = {},
    callOptions = {}
  } = {}
) {
  const sourceRecords = Array.isArray(records) ? records : [];
  if (sourceRecords.length < 1) {
    return sourceRecords;
  }

  const selectedEntries = selectLookupEntries(runtime, include, {
    mode,
    context: runtime?.context || "crudRepository"
  });
  if (selectedEntries.length < 1) {
    return sourceRecords;
  }

  const resolveLookupProvider = resolveLookupProviderResolver(repositoryOptions, callOptions, {
    context: runtime?.context || "crudRepository"
  });

  const relationGroups = normalizeLookupRelationValues(sourceRecords, selectedEntries);
  const groupRecordMaps = new Map();
  for (const group of relationGroups.values()) {
    if (group.values.length < 1) {
      groupRecordMaps.set(buildLookupGroupKey(group.relation), new Map());
      continue;
    }

    const provider = normalizeLookupProvider(resolveLookupProvider(group.relation), group.relation, {
      context: runtime?.context || "crudRepository"
    });
    const groupRecords = await provider.listByIds(group.values, {
      ...callOptions,
      include: "none",
      valueKey: group.relation.valueKey
    });
    groupRecordMaps.set(
      buildLookupGroupKey(group.relation),
      buildLookupRecordMap(groupRecords, group.relation.valueKey)
    );
  }

  return sourceRecords.map((record) => {
    const baseRecord = record && typeof record === "object" && !Array.isArray(record) ? record : {};
    const existingLookups =
      baseRecord.lookups && typeof baseRecord.lookups === "object" && !Array.isArray(baseRecord.lookups)
        ? baseRecord.lookups
        : {};
    const nextLookups = { ...existingLookups };

    for (const entry of selectedEntries) {
      const relation = entry.relation;
      const lookupMap = groupRecordMaps.get(buildLookupGroupKey(relation)) || new Map();
      const lookupId = normalizeLookupIdentifier(baseRecord?.[entry.key]);
      if (!lookupId) {
        nextLookups[entry.key] = null;
        continue;
      }
      nextLookups[entry.key] = lookupMap.get(lookupId) || null;
    }

    return {
      ...baseRecord,
      lookups: nextLookups
    };
  });
}

export {
  createCrudLookupRuntime,
  hydrateCrudLookupRecords
};
