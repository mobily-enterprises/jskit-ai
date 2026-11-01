import { isRecord, normalizeOpaqueId, normalizeText, normalizeUniqueTextList } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeVisibilityContext } from "@jskit-ai/kernel/shared/support/visibility";
import {
  normalizeCrudLookupApiPath,
  normalizeCrudLookupNamespace,
  resolveCrudLookupApiPathFromNamespace,
  resolveCrudLookupContainerKey
} from "@jskit-ai/resource-crud-core/shared/crudLookup";
import { buildCrudFieldContractMap } from "@jskit-ai/resource-crud-core/shared/crudFieldContract";
import { normalizeLookupOwnershipFilter } from "../lookupPathSupport.js";

const DEFAULT_LOOKUP_INCLUDE = "*";
const DEFAULT_LOOKUP_MAX_DEPTH = 3;
const MAX_LOOKUP_MAX_DEPTH = 10;

/** @typedef {ReturnType<typeof buildCrudLookupRuntime>} LookupRuntime */

function normalizeLookupRelationEntry(entry, outputKeys) {
  if (!isRecord(entry)) {
    return null;
  }

  const key = normalizeText(entry.key);
  if (!key) {
    return null;
  }

  const relation = entry.relation;
  if (!isRecord(relation)) {
    return null;
  }

  const relationKind = normalizeText(relation.kind).toLowerCase();
  if (relationKind !== "lookup" && relationKind !== "collection") {
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

  if (relationKind === "lookup") {
    if (!outputKeys.has(key)) {
      return null;
    }
    const valueKey = normalizeText(relation.valueKey) || "id";

    return Object.freeze({
      key,
      relation: Object.freeze({
        kind: "lookup",
        namespace,
        apiPath,
        valueKey,
        hydrateOnList: relation.hydrateOnList !== false,
        hydrateOnView: relation.hydrateOnView !== false
      })
    });
  }

  const foreignKey = normalizeText(relation.foreignKey);
  if (!foreignKey) {
    return null;
  }

  const parentValueKey = normalizeText(relation.parentValueKey) || "id";
  if (!outputKeys.has(parentValueKey)) {
    return null;
  }

  return Object.freeze({
    key,
    relation: Object.freeze({
      kind: "collection",
      namespace,
      apiPath,
      foreignKey,
      parentValueKey,
      hydrateOnList: relation.hydrateOnList !== false,
      hydrateOnView: relation.hydrateOnView !== false
    })
  });
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

function resolveLookupRuntimeDefaults(resource) {
  const lookupContract = resource.contract?.lookup;
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

/**
 * A resource's lookup relations, resolved once: the error context, the
 * resource's namespace and lookup container key, the default include and
 * depth, and each lookup entry, in order and by key.
 * @param {import("../types.js").CrudResourceDefinition} resource
 * @param {{ outputKeys: readonly string[], context: string }} options
 */
function buildCrudLookupRuntime(resource, { outputKeys, context }) {
  const outputKeySet = new Set(outputKeys);

  const sourceEntries = Object.values(buildCrudFieldContractMap(resource, {
    context: "crud lookup runtime field contract"
  }));
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
  const namespace =
    normalizeCrudLookupNamespace(resource.namespace) ||
    normalizeCrudLookupNamespace(resource.apiPath);
  const defaults = resolveLookupRuntimeDefaults(resource);

  return Object.freeze({
    context,
    namespace,
    containerKey,
    defaultInclude: defaults.defaultInclude,
    maxDepth: defaults.maxDepth,
    entries: Object.freeze(lookupEntries),
    byKey: Object.freeze(lookupEntryByKey)
  });
}

function normalizeLookupIdentifier(value) {
  return normalizeOpaqueId(value, { fallback: "" });
}

/**
 * @param {unknown} include
 * @param {string} defaultInclude The lookup runtime's normalized default include.
 */
function normalizeIncludePaths(include, defaultInclude) {
  const normalizedInclude = normalizeText(include) || defaultInclude;
  if (normalizedInclude.toLowerCase() === "none") {
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

/** @param {string[][]} paths Normalized include paths below one lookup. */
function resolveChildIncludeFromPaths(paths) {
  const pathKeys = new Set();
  let includesAll = false;

  for (const path of paths) {
    if (path.length < 1) {
      continue;
    }
    if (path[0] === "*") {
      includesAll = true;
      continue;
    }

    pathKeys.add(path.join("."));
  }

  if (includesAll) {
    return "*";
  }
  if (pathKeys.size < 1) {
    return "none";
  }
  return [...pathKeys].join(",");
}

function shouldHydrateByMode(entry, mode) {
  const relation = entry.relation;
  if (mode === "view") {
    return relation.hydrateOnView !== false;
  }
  return relation.hydrateOnList !== false;
}

/**
 * @param {LookupRuntime} runtime
 * @param {unknown} include
 * @param {{ mode: string, includeWasExplicit: boolean, skippedNamespaces: Set<string> }} options
 */
function buildLookupHydrationPlan(runtime, include, { mode, includeWasExplicit, skippedNamespaces }) {
  const { context, entries } = runtime;
  const includePaths = normalizeIncludePaths(include, runtime.defaultInclude);
  if (includePaths.length < 1) {
    return {
      entries: [],
      childIncludeByKey: {}
    };
  }

  if (entries.length < 1) {
    const wildcardOnlyInclude = includePaths.every((pathSegments) => pathSegments[0] === "*");
    if (includeWasExplicit === true && wildcardOnlyInclude !== true) {
      throw new Error(`${context} include requires lookups, but the resource declares no lookup relations.`);
    }
    return {
      entries: [],
      childIncludeByKey: {}
    };
  }

  const selectedEntries = [];
  const childIncludeByKey = {};
  const seenKeys = new Set();

  function appendEntry(entry, childPaths) {
    if (seenKeys.has(entry.key)) {
      return;
    }

    if (!includeWasExplicit && !shouldHydrateByMode(entry, mode)) {
      return;
    }

    if (skippedNamespaces.has(entry.relation.namespace)) {
      return;
    }

    seenKeys.add(entry.key);
    selectedEntries.push(entry);
    childIncludeByKey[entry.key] = resolveChildIncludeFromPaths(childPaths);
  }

  const includeAll = includePaths.some((segments) => segments[0] === "*");
  if (includeAll) {
    for (const entry of entries) {
      appendEntry(entry, [["*"]]);
    }
  }

  for (const pathSegments of includePaths) {
    const [head, ...tail] = pathSegments;
    if (head === "*") {
      continue;
    }

    const entry = runtime.byKey[head];
    if (!entry) {
      throw new Error(`${context} include references unknown lookup key "${head}".`);
    }

    appendEntry(
      entry,
      tail.length > 0
        ? [tail]
        : []
    );
  }

  return {
    entries: selectedEntries,
    childIncludeByKey
  };
}

function resolveLookupResolver(repositoryOptions, callOptions, { context }) {
  const resolver = callOptions.resolveLookup || repositoryOptions.resolveLookup;
  // readable-check: allow method-probe - input validation: the application passes resolveLookup(relation) in its options
  if (typeof resolver !== "function") {
    throw new TypeError(`${context} requires resolveLookup(relation) to hydrate lookups.`);
  }
  return resolver;
}

function resolveLookupDepthRuntime(runtime, repositoryOptions, callOptions) {
  const maxDepth = normalizeLookupMaxDepth(
    callOptions.lookupMaxDepth ?? repositoryOptions.lookupMaxDepth ?? runtime.maxDepth
  );

  const parsedDepth = Number(callOptions.lookupDepth);
  const depth = Number.isInteger(parsedDepth) && parsedDepth >= 0 ? parsedDepth : 0;

  return {
    depth,
    maxDepth
  };
}

function buildLookupGroupKey(relation) {
  if (relation.kind === "collection") {
    return `collection::${relation.namespace}::${relation.foreignKey}::${relation.parentValueKey}`;
  }
  return `lookup::${relation.namespace}::${relation.valueKey}`;
}

function normalizeLookupRelationValues(records, entries, childIncludeByKey) {
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
    group.childIncludes.add(normalizeText(childIncludeByKey[entry.key]) || "none");
  }

  for (const group of byGroup.values()) {
    const seen = new Set();
    for (const record of records) {
      for (const entry of group.entries) {
        const relation = entry.relation;
        const rawValue = relation.kind === "collection"
          ? record[relation.parentValueKey]
          : record[entry.key];
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

function resolveGroupChildInclude(group) {
  const includeSet = new Set();
  let includeAll = false;

  for (const includeValue of group.childIncludes) {
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

function normalizeLookup(provider, relation, { context }) {
  // readable-check: allow method-probe - input validation: an application's resolveLookup must return a provider object
  if (!isRecord(provider)) {
    throw new Error(`${context} could not resolve lookup "${relation.namespace}".`);
  }
  // readable-check: allow method-probe - input validation: an application's resolveLookup must return a provider with listByIds()
  if (typeof provider.listByIds !== "function") {
    throw new Error(`${context} lookup "${relation.namespace}" must expose listByIds(ids, options).`);
  }
  return provider;
}

function resolveLookupVisibilityContext(provider, relation, callOptions, { context }) {
  const parentVisibilityContext = normalizeVisibilityContext(callOptions.visibilityContext);
  const lookupOwnershipFilter = normalizeLookupOwnershipFilter(provider.ownershipFilter, {
    context: `${context} lookup ownershipFilter`
  });

  if (!lookupOwnershipFilter) {
    if (parentVisibilityContext.visibility !== "public") {
      throw new Error(
        `${context} lookup "${relation.namespace}" must declare ownershipFilter when parent visibility is "${parentVisibilityContext.visibility}".`
      );
    }
    return callOptions.visibilityContext;
  }

  const nextVisibilityContext = {
    visibility: lookupOwnershipFilter
  };
  if (lookupOwnershipFilter === "workspace" || lookupOwnershipFilter === "workspace_user") {
    nextVisibilityContext.scopeOwnerId = parentVisibilityContext.scopeOwnerId;
  }
  if (lookupOwnershipFilter === "user" || lookupOwnershipFilter === "workspace_user") {
    nextVisibilityContext.userId = parentVisibilityContext.userId;
  }

  return nextVisibilityContext;
}

function buildLookupRecordMap(records, valueKey) {
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

function buildLookupCollectionMap(records, foreignKey) {
  const collectionMap = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const ownerId = normalizeLookupIdentifier(record?.[foreignKey]);
    if (!ownerId) {
      continue;
    }
    const currentRecords = collectionMap.get(ownerId);
    if (currentRecords) {
      currentRecords.push(record);
      continue;
    }
    collectionMap.set(ownerId, [record]);
  }
  return collectionMap;
}

function resolveLookupVisitedNamespaces(runtime, callOptions) {
  const namespaces = [];
  const seen = new Set();

  function appendNamespace(value) {
    const normalized = normalizeCrudLookupNamespace(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    namespaces.push(normalized);
  }

  const sourceVisitedNamespaces = Array.isArray(callOptions.lookupVisitedNamespaces)
    ? callOptions.lookupVisitedNamespaces
    : [];
  for (const namespace of sourceVisitedNamespaces) {
    appendNamespace(namespace);
  }
  appendNamespace(runtime.namespace);

  return namespaces;
}

/**
 * Records with their lookups hydrated under the lookup container key, up to the lookup depth.
 * @param {object[]} records
 * @param {LookupRuntime} runtime
 * @param {{ include: unknown, mode: "list" | "view", repositoryOptions: object, callOptions: object }} options
 */
async function hydrateCrudLookupRecords(records, runtime, { include, mode, repositoryOptions, callOptions }) {
  const { context, containerKey: lookupContainerKey } = runtime;
  if (records.length < 1) {
    return records;
  }

  const depthRuntime = resolveLookupDepthRuntime(runtime, repositoryOptions, callOptions);
  if (depthRuntime.depth >= depthRuntime.maxDepth) {
    return records;
  }

  const visitedNamespaces = resolveLookupVisitedNamespaces(runtime, callOptions);

  const lookupPlan = buildLookupHydrationPlan(runtime, include, {
    mode,
    includeWasExplicit: normalizeText(include).length > 0,
    skippedNamespaces: new Set(visitedNamespaces)
  });
  const selectedEntries = lookupPlan.entries;
  if (selectedEntries.length < 1) {
    return records;
  }

  const resolveLookup = resolveLookupResolver(repositoryOptions, callOptions, { context });

  const relationGroups = normalizeLookupRelationValues(records, selectedEntries, lookupPlan.childIncludeByKey);
  const groupRecordMaps = new Map();
  for (const group of relationGroups.values()) {
    if (group.values.length < 1) {
      groupRecordMaps.set(buildLookupGroupKey(group.relation), new Map());
      continue;
    }

    const provider = normalizeLookup(resolveLookup(group.relation), group.relation, { context });
    const childVisibilityContext = resolveLookupVisibilityContext(provider, group.relation, callOptions, { context });
    const childInclude = resolveGroupChildInclude(group);
    const groupValueKey = group.relation.kind === "collection"
      ? group.relation.foreignKey
      : group.relation.valueKey;
    const groupRecords = await provider.listByIds(group.values, {
      ...callOptions,
      visibilityContext: childVisibilityContext,
      include: childInclude,
      lookupDepth: depthRuntime.depth + 1,
      lookupMaxDepth: depthRuntime.maxDepth,
      lookupVisitedNamespaces: visitedNamespaces,
      valueKey: groupValueKey
    });
    groupRecordMaps.set(
      buildLookupGroupKey(group.relation),
      group.relation.kind === "collection"
        ? buildLookupCollectionMap(groupRecords, group.relation.foreignKey)
        : buildLookupRecordMap(groupRecords, group.relation.valueKey)
    );
  }

  return records.map((record) => {
    const baseRecord = isRecord(record) ? record : {};
    const existingLookups = isRecord(baseRecord[lookupContainerKey])
      ? baseRecord[lookupContainerKey]
      : {};
    const nextLookups = { ...existingLookups };

    for (const entry of selectedEntries) {
      const relation = entry.relation;
      const lookupMap = groupRecordMaps.get(buildLookupGroupKey(relation)) || new Map();
      if (relation.kind === "collection") {
        const ownerId = normalizeLookupIdentifier(baseRecord[relation.parentValueKey]);
        nextLookups[entry.key] = ownerId ? (lookupMap.get(ownerId) || []) : [];
        continue;
      }
      const lookupId = normalizeLookupIdentifier(baseRecord[entry.key]);
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
  buildCrudLookupRuntime,
  hydrateCrudLookupRecords
};
