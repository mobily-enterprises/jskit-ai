import { normalizeOpaqueId, normalizeText, normalizeUniqueTextList } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizeCrudLookupNamespace,
  resolveCrudLookupApiPathFromNamespace,
  normalizeCrudLookupContainerKey,
  resolveCrudLookupContainerKey
} from "@jskit-ai/kernel/shared/support/crudLookup";
import { normalizeCrudLookupApiPath } from "./lookupPathSupport.js";

const DEFAULT_LOOKUP_INCLUDE = "*";
const DEFAULT_LOOKUP_MAX_DEPTH = 3;
const MAX_LOOKUP_MAX_DEPTH = 10;

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

  const namespace =
    normalizeCrudLookupNamespace(relation.namespace) ||
    normalizeCrudLookupNamespace(relation.apiPath);
  if (!namespace) {
    return null;
  }
  const explicitApiPath = normalizeCrudLookupApiPath(relation.apiPath);
  const apiPath = explicitApiPath || resolveCrudLookupApiPathFromNamespace(namespace);

  const valueKey = normalizeText(relation.valueKey) || "id";

  return {
    key,
    relation: {
      kind: "lookup",
      namespace,
      apiPath,
      valueKey,
      hydrateOnList: relation.hydrateOnList !== false,
      hydrateOnView: relation.hydrateOnView !== false
    }
  };
}

function normalizeLookupDefaultInclude(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return DEFAULT_LOOKUP_INCLUDE;
  }

  if (normalized.toLowerCase() === "none") {
    return "none";
  }

  return normalized;
}

function normalizeLookupMaxDepth(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_LOOKUP_MAX_DEPTH;
  }

  return Math.min(parsed, MAX_LOOKUP_MAX_DEPTH);
}

function resolveLookupRuntimeDefaults(resource = {}) {
  const lookupContract = resource?.contract?.lookup;
  if (
    lookupContract !== undefined &&
    lookupContract !== null &&
    (typeof lookupContract !== "object" || Array.isArray(lookupContract))
  ) {
    throw new TypeError("crud lookup runtime requires resource.contract.lookup to be an object when provided.");
  }

  return {
    defaultInclude: normalizeLookupDefaultInclude(lookupContract?.defaultInclude),
    maxDepth: normalizeLookupMaxDepth(lookupContract?.maxDepth)
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

  const containerKey = resolveCrudLookupContainerKey(resource, {
    context: "crud lookup runtime container key"
  });
  const defaults = resolveLookupRuntimeDefaults(resource);

  return {
    containerKey,
    defaultInclude: defaults.defaultInclude,
    maxDepth: defaults.maxDepth,
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

function normalizeIncludePaths(include, { defaultInclude = DEFAULT_LOOKUP_INCLUDE } = {}) {
  const sourceInclude = normalizeText(include);
  const normalizedInclude = sourceInclude || normalizeLookupDefaultInclude(defaultInclude);
  if (!normalizedInclude || normalizedInclude.toLowerCase() === "none") {
    return [];
  }

  const tokens = normalizeUniqueTextList(normalizedInclude.split(","));
  const paths = [];

  for (const token of tokens) {
    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
      continue;
    }

    if (normalizedToken.toLowerCase() === "none") {
      return [];
    }

    const segments = normalizedToken
      .split(".")
      .map((entry) => normalizeText(entry))
      .filter(Boolean);

    if (segments.length > 0) {
      paths.push(segments);
    }
  }

  return paths;
}

function resolveChildIncludeFromPaths(paths = []) {
  const entries = Array.isArray(paths) ? paths : [];
  const pathKeys = new Set();
  let includesAll = false;

  for (const path of entries) {
    if (!Array.isArray(path) || path.length < 1) {
      continue;
    }

    const normalizedPath = path
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
    if (normalizedPath.length < 1) {
      continue;
    }
    if (normalizedPath[0] === "*") {
      includesAll = true;
      continue;
    }
    pathKeys.add(normalizedPath.join("."));
  }

  if (includesAll) {
    return "*";
  }
  if (pathKeys.size < 1) {
    return "none";
  }
  return [...pathKeys].join(",");
}

function buildLookupHydrationPlan(
  runtime = {},
  include,
  {
    mode = "list",
    context = "crudRepository",
    includeWasExplicit = false
  } = {}
) {
  const entries = Array.isArray(runtime?.entries) ? runtime.entries : [];
  if (entries.length < 1) {
    return {
      entries: [],
      childIncludeByKey: {}
    };
  }

  const includePaths = normalizeIncludePaths(include, {
    defaultInclude: runtime?.defaultInclude
  });
  if (includePaths.length < 1) {
    return {
      entries: [],
      childIncludeByKey: {}
    };
  }

  const shouldHydrateByMode = mode === "view"
    ? (entry) => entry?.relation?.hydrateOnView !== false
    : (entry) => entry?.relation?.hydrateOnList !== false;

  const selectedByKey = new Map();
  function ensureSelection(entry = null) {
    if (!entry) {
      return null;
    }

    if (!includeWasExplicit && !shouldHydrateByMode(entry)) {
      return null;
    }

    if (!selectedByKey.has(entry.key)) {
      selectedByKey.set(entry.key, {
        entry,
        childPaths: [],
        childPathSet: new Set()
      });
    }

    return selectedByKey.get(entry.key);
  }

  function appendChildPath(selection, segments = []) {
    const sourceSegments = Array.isArray(segments) ? segments : [];
    if (sourceSegments.length < 1) {
      return;
    }

    const normalizedSegments = sourceSegments
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
    if (normalizedSegments.length < 1) {
      return;
    }

    const pathKey = normalizedSegments.join(".");
    if (selection.childPathSet.has(pathKey)) {
      return;
    }

    selection.childPathSet.add(pathKey);
    selection.childPaths.push(normalizedSegments);
  }

  for (const pathSegments of includePaths) {
    const [head, ...tail] = pathSegments;
    if (!head) {
      continue;
    }

    if (head === "*") {
      const wildcardTail = tail.length > 0 ? tail : ["*"];
      for (const entry of entries) {
        const selection = ensureSelection(entry);
        if (!selection) {
          continue;
        }
        appendChildPath(selection, wildcardTail);
      }
      continue;
    }

    const entry = runtime?.byKey?.[head] || null;
    if (!entry) {
      throw new Error(`${context} include references unknown lookup key "${head}".`);
    }

    const selection = ensureSelection(entry);
    if (!selection) {
      continue;
    }

    if (tail.length > 0) {
      appendChildPath(selection, tail);
    }
  }

  const selectedEntries = [];
  const childIncludeByKey = {};
  for (const selection of selectedByKey.values()) {
    selectedEntries.push(selection.entry);
    childIncludeByKey[selection.entry.key] = resolveChildIncludeFromPaths(selection.childPaths);
  }

  return {
    entries: selectedEntries,
    childIncludeByKey
  };
}

function resolveLookupProviderResolver(repositoryOptions = {}, callOptions = {}, { context = "crudRepository" } = {}) {
  const resolver = callOptions?.resolveLookupProvider || repositoryOptions?.resolveLookupProvider;
  if (typeof resolver !== "function") {
    throw new TypeError(`${context} requires resolveLookupProvider(relation) to hydrate lookups.`);
  }
  return resolver;
}

function resolveLookupDepthRuntime(runtime = {}, repositoryOptions = {}, callOptions = {}) {
  const maxDepth = normalizeLookupMaxDepth(
    callOptions?.lookupMaxDepth ?? repositoryOptions?.lookupMaxDepth ?? runtime?.maxDepth
  );

  const parsedDepth = Number(callOptions?.lookupDepth);
  const depth = Number.isInteger(parsedDepth) && parsedDepth >= 0 ? parsedDepth : 0;

  return {
    depth,
    maxDepth
  };
}

function buildLookupGroupKey(relation = {}) {
  return `${relation.namespace}::${relation.valueKey}`;
}

function normalizeLookupRelationValues(records = [], entries = [], childIncludeByKey = {}) {
  const byGroup = new Map();
  for (const entry of entries) {
    const relation = entry.relation;
    const groupKey = buildLookupGroupKey(relation);
    if (!byGroup.has(groupKey)) {
      byGroup.set(groupKey, {
        relation,
        entries: [],
        values: [],
        childIncludes: new Set()
      });
    }

    const group = byGroup.get(groupKey);
    group.entries.push(entry);
    group.childIncludes.add(normalizeText(childIncludeByKey?.[entry.key]) || "none");
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

function resolveGroupChildInclude(group = {}) {
  const sourceIncludes = group?.childIncludes instanceof Set ? [...group.childIncludes] : [];
  const includeSet = new Set();
  let includeAll = false;

  for (const includeValue of sourceIncludes) {
    const normalized = normalizeText(includeValue);
    if (!normalized || normalized.toLowerCase() === "none") {
      continue;
    }

    if (normalized === "*") {
      includeAll = true;
      continue;
    }

    for (const token of normalizeUniqueTextList(normalized.split(","))) {
      if (token === "*") {
        includeAll = true;
        continue;
      }
      includeSet.add(token);
    }
  }

  if (includeAll) {
    return "*";
  }
  if (includeSet.size < 1) {
    return "none";
  }
  return [...includeSet].join(",");
}

function normalizeLookupProvider(provider, relation = {}, { context = "crudRepository" } = {}) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error(`${context} could not resolve lookup provider for namespace "${relation.namespace}".`);
  }
  if (typeof provider.listByIds !== "function") {
    throw new Error(`${context} lookup provider for namespace "${relation.namespace}" must expose listByIds(ids, options).`);
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

  const depthRuntime = resolveLookupDepthRuntime(runtime, repositoryOptions, callOptions);
  if (depthRuntime.depth >= depthRuntime.maxDepth) {
    return sourceRecords;
  }

  const lookupContainerKey = normalizeCrudLookupContainerKey(runtime?.containerKey, {
    context: `${runtime?.context || "crudRepository"} lookup runtime container key`
  });

  const lookupPlan = buildLookupHydrationPlan(runtime, include, {
    mode,
    context: runtime?.context || "crudRepository",
    includeWasExplicit: normalizeText(include).length > 0
  });
  const selectedEntries = lookupPlan.entries;
  if (selectedEntries.length < 1) {
    return sourceRecords;
  }

  const resolveLookupProvider = resolveLookupProviderResolver(repositoryOptions, callOptions, {
    context: runtime?.context || "crudRepository"
  });

  const relationGroups = normalizeLookupRelationValues(sourceRecords, selectedEntries, lookupPlan.childIncludeByKey);
  const groupRecordMaps = new Map();
  for (const group of relationGroups.values()) {
    if (group.values.length < 1) {
      groupRecordMaps.set(buildLookupGroupKey(group.relation), new Map());
      continue;
    }

    const provider = normalizeLookupProvider(resolveLookupProvider(group.relation), group.relation, {
      context: runtime?.context || "crudRepository"
    });
    const childInclude = resolveGroupChildInclude(group);
    const groupRecords = await provider.listByIds(group.values, {
      ...callOptions,
      include: childInclude,
      lookupDepth: depthRuntime.depth + 1,
      lookupMaxDepth: depthRuntime.maxDepth,
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
      baseRecord[lookupContainerKey] &&
      typeof baseRecord[lookupContainerKey] === "object" &&
      !Array.isArray(baseRecord[lookupContainerKey])
        ? baseRecord[lookupContainerKey]
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
      [lookupContainerKey]: nextLookups
    };
  });
}

export {
  createCrudLookupRuntime,
  hydrateCrudLookupRecords
};
