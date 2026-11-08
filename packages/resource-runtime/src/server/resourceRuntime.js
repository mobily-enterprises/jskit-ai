import { readOnlyQueryBuilder } from "json-rest-api";
import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { isTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { callerOf, createSystemContext } from "./contexts.js";
import { DuplicateOwnerError } from "./errors.js";
import { createResourceHandle } from "./resourceHandle.js";
import { resourceScopeOptions } from "./resourceHost.js";

const DEFAULT_REQUEST_ROW_LIMIT = 10000;
const DEFAULT_SERVER_PAGE_SIZE = 1000;
const ENTRY_KEYS = Object.freeze(["resource", "rowPolicy", "hooks", "acceptsContributions", "normalizeId", "queryFields", "searchSchema"]);
// Every table resource's datetime-utc fields are written as UTC database date-times.
const WRITE_SERIALIZERS = Object.freeze({ "datetime-utc": toDatabaseDateTimeUtc });

/**
 * One `owns` entry as `{ resource, ...serverOnlyExtras }`.
 * @param {unknown} entry
 * @param {string} featureId
 */
function ownedEntry(entry, featureId) {
  const normalized = isTableResource(entry) ? { resource: entry } : entry;
  if (!isRecord(normalized) || !isTableResource(normalized.resource)) {
    throw new TypeError(`Feature "${featureId}" owns entries must be table resources or { resource, ...extras } with a table resource.`);
  }
  for (const key of Object.keys(normalized)) {
    if (!ENTRY_KEYS.includes(key)) {
      throw new TypeError(`Feature "${featureId}" owns entry for "${normalized.resource.name}" does not take "${key}"; it takes ${ENTRY_KEYS.join(", ")}.`);
    }
  }
  const hooks = normalized.hooks === undefined ? {} : normalized.hooks;
  if (!isRecord(hooks) || Object.keys(hooks).some((key) => key !== "afterWrite")) {
    throw new TypeError(`Feature "${featureId}" hooks for "${normalized.resource.name}" take only afterWrite.`);
  }
  // readable-check: allow method-probe - input validation: a row policy is the owner's optional function
  if (normalized.rowPolicy !== undefined && typeof normalized.rowPolicy !== "function") {
    throw new TypeError(`Feature "${featureId}" rowPolicy for "${normalized.resource.name}" must be a function.`);
  }
  return Object.freeze({
    ...normalized,
    hooks: Object.freeze({ ...hooks })
  });
}

/**
 * The filters of a resource's search that read another table: each `actualField` or `oneOf` path
 * "resource.field" (or "a.b.field", whose last resource holds the field), as { filter, target, field }.
 * @param {Record<string, any>} scopeOptions The resource's json-rest-api scope options.
 */
function crossTableFilters(scopeOptions) {
  const declared = [
    ...Object.entries(scopeOptions.searchSchema || {}),
    ...Object.entries(scopeOptions.schema || {}).filter(([, field]) => isRecord(field?.search)).map(([name, field]) => [name, field.search])
  ];
  return declared.flatMap(([filter, entry]) => [entry?.actualField, ...(Array.isArray(entry?.oneOf) ? entry.oneOf : [])]
    .filter((path) => typeof path === "string" && path.includes("."))
    .map((path) => {
      const segments = path.split(".");
      return { filter, target: segments.at(-2), field: segments.at(-1) };
    }));
}

/**
 * Applies one row policy, the owner's or a contribution, inside its own
 * parenthesised group, so whatever it writes (an orWhere among it) only narrows
 * the rows ownership and the other policies left.
 * The policy writes to a recorder; its calls replay inside `query.where(...)`.
 * @param {Function} policy
 * @param {Record<string, any>} args
 */
async function applyGrouped(policy, args) {
  const calls = [];
  const recorder = new Proxy({}, {
    get(_target, method) {
      if (method === "then") {
        return undefined;
      }
      return (...callArgs) => {
        calls.push([method, callArgs]);
        return recorder;
      };
    }
  });
  const result = await policy({ ...args, query: recorder });
  if (result === true && calls.length > 0) {
    args.query.where(function contributedPredicates() {
      for (const [method, callArgs] of calls) {
        this[method](...callArgs);
      }
    });
  }
  return result;
}

/**
 * The resource runtime behind `runtime.resources`: features own their tables
 * through it (`own`), and a feature that declares a system scope gets its
 * system context factory from it (`declareSystemScope`).
 * @param {object} dependencies
 * @param {import("./types.js").RuntimeJsonRestApi} dependencies.api The host from createResourceHost.
 * @param {number} [dependencies.requestRowLimit] Rows queryAll() may read in a request context.
 * @param {number} [dependencies.serverPageSize] Page size of queryAll()'s reads.
 */
function createResourceRuntime({ api, requestRowLimit = DEFAULT_REQUEST_ROW_LIMIT, serverPageSize = DEFAULT_SERVER_PAGE_SIZE }) {
  const settings = Object.freeze({ requestRowLimit, serverPageSize });
  /** @type {Map<string, { featureId: string, resource: object, acceptsContributions: boolean, contributions: Function[] }>} */
  const ownedByName = new Map();
  /** @type {Map<string, string>} */
  const ownerByTable = new Map();
  // Cross-table filters whose target table no feature owns yet: they are checked when its owner owns it.
  const pendingCrossTableFilters = [];
  /** @type {Map<string, string>} The system scope each feature declared. */
  const scopeByFeature = new Map();

  function claim(featureId, resource) {
    const tableOwner = ownerByTable.get(resource.tableName);
    if (tableOwner) {
      throw new DuplicateOwnerError(`Feature "${featureId}" owns table "${resource.tableName}", which feature "${tableOwner}" already owns. One table has one owner.`);
    }
    if (ownedByName.has(resource.name) || api.resources[resource.name]) {
      throw new DuplicateOwnerError(`Feature "${featureId}" owns resource "${resource.name}", a name another feature already registered.`);
    }
  }

  // An owned table resource by name, or null: a handle shapes included records with it.
  function resourceNamed(name) {
    return ownedByName.get(name)?.resource ?? null;
  }

  // A SELECT-only builder over one of the feature's own tables, for a row policy's subqueries.
  function ownTableReader(featureId, db) {
    return function ownTable(name) {
      const owned = ownedByName.get(name);
      if (!owned || owned.featureId !== featureId) {
        throw new TypeError(`ownTable("${name}"): a row policy reads only its own feature's tables, which are ${[...ownedByName].filter(([, entry]) => entry.featureId === featureId).map(([ownedName]) => ownedName).join(", ")}.`);
      }
      return readOnlyQueryBuilder(db(owned.resource.tableName), { resourceType: name });
    };
  }

  // The owner's policy, then every contribution, each in its own group ANDed with ownership: a policy only narrows.
  // Each gets who the call runs for as `caller` (see callerOf).
  function composedRowPolicy(featureId, entry, contributions) {
    if (!entry.rowPolicy && !entry.acceptsContributions) {
      return undefined;
    }
    return async function ownedRowPolicy(args) {
      const caller = callerOf(args.context);
      if (entry.rowPolicy) {
        const result = await applyGrouped(entry.rowPolicy, { ...args, caller, ownTable: ownTableReader(featureId, args.db) });
        if (result !== true) {
          return result;
        }
      }
      for (const contribution of contributions) {
        const result = await applyGrouped(contribution.policy, { ...args, caller, ownTable: ownTableReader(contribution.featureId, args.db) });
        if (result !== true) {
          return result;
        }
      }
      return true;
    };
  }

  function contributeRowPolicy(featureId, name, policy) {
    const owned = ownedByName.get(name);
    if (!owned) {
      throw new TypeError(`Feature "${featureId}" contributes a row policy to "${name}", which no feature owns.`);
    }
    if (!owned.acceptsContributions) {
      throw new TypeError(`Feature "${featureId}" contributes a row policy to "${name}", whose owner "${owned.featureId}" does not accept contributions.`);
    }
    if (typeof policy !== "function") {
      throw new TypeError(`Feature "${featureId}" row policy for "${name}" must be a function.`);
    }
    owned.contributions.push(Object.freeze({ featureId, policy }));
  }

  /**
   * Refuses, at startup, a cross-table filter on a field json-rest-api cannot search: one its target resource does
   * not declare `indexed: true`, which json-rest-api otherwise refuses only at the first query. A filter whose
   * target no feature owns yet waits for it.
   * @param {ReadonlyArray<{ resource: Record<string, any> }>} entries The resources being owned now.
   * @param {ReadonlyArray<Record<string, any>>} scopes Their json-rest-api scope options, in the same order.
   */
  function checkCrossTableFilters(entries, scopes) {
    const owning = new Map(entries.map(({ resource }) => [resource.name, resource]));
    const targetNamed = (name) => owning.get(name) || ownedByName.get(name)?.resource;
    const filters = [
      ...pendingCrossTableFilters.splice(0),
      ...entries.flatMap(({ resource }, index) => crossTableFilters(scopes[index]).map((filter) => ({ ...filter, source: resource.name })))
    ];
    for (const filter of filters) {
      const target = targetNamed(filter.target);
      if (!target) {
        pendingCrossTableFilters.push(filter);
        continue;
      }
      if (target.schema?.[filter.field]?.indexed !== true) {
        throw new TypeError(
          `Table resource "${filter.source}" filters "${filter.filter}" on ${filter.target}.${filter.field}, which ` +
          `"${filter.target}" does not declare indexed: true. A cross-table filter reads another table by that field: ` +
          `give the field indexed: true and its column a database index, or filter on a field of "${filter.source}".`
        );
      }
    }
  }

  /**
   * Registers the feature as the one owner of each resource and answers their
   * handles, by resource name. The answer's contributeRowPolicy(name, policy)
   * narrows another feature's resource whose owner accepts contributions.
   * @param {string} featureId
   * @param {ReadonlyArray<object>} owns
   */
  async function own(featureId, owns) {
    const entries = owns.map((entry) => ownedEntry(entry, featureId));
    const names = new Set();
    for (const { resource } of entries) {
      if (names.has(resource.name)) {
        throw new DuplicateOwnerError(`Feature "${featureId}" lists resource "${resource.name}" twice.`);
      }
      names.add(resource.name);
      claim(featureId, resource);
    }
    const contributions = entries.map(() => []);
    const scopes = entries.map((entry, index) => resourceScopeOptions(entry.resource, {
      writeSerializers: WRITE_SERIALIZERS,
      normalizeId: entry.normalizeId,
      rowPolicy: composedRowPolicy(featureId, entry, contributions[index]),
      searchSchema: entry.searchSchema,
      queryFields: entry.queryFields
    }));
    checkCrossTableFilters(entries, scopes);
    const handles = {};
    for (const [index, entry] of entries.entries()) {
      const { resource } = entry;
      ownedByName.set(resource.name, {
        featureId,
        resource,
        acceptsContributions: entry.acceptsContributions === true,
        contributions: contributions[index]
      });
      ownerByTable.set(resource.tableName, featureId);
      await api.addResource(resource.name, scopes[index]);
      handles[resource.name] = createResourceHandle({ api, resource, hooks: entry.hooks, settings, resourceNamed });
    }
    Object.defineProperty(handles, "contributeRowPolicy", {
      value: (name, policy) => contributeRowPolicy(featureId, name, policy),
      enumerable: false
    });
    return Object.freeze(handles);
  }

  /** Every owned table, with its resource name and owning feature. */
  function ownedTables() {
    return [...ownedByName].map(([name, { featureId, resource }]) => Object.freeze({ name, tableName: resource.tableName, featureId }));
  }

  /**
   * Records that the feature works across every workspace and user, and answers its system context factory, the only
   * way to a system context: each call names its reason, so every place that skips the ownership scope says why. A
   * feature declares one scope; declaring it again answers another factory for it.
   * @param {string} featureId
   * @param {string} systemScope Why the feature works across every workspace and user.
   */
  function declareSystemScope(featureId, systemScope) {
    const scope = typeof systemScope === "string" ? systemScope.trim() : "";
    if (!scope) {
      throw new TypeError(`Feature "${featureId}" systemScope must say why it works across every workspace and user.`);
    }
    if (scopeByFeature.has(featureId) && scopeByFeature.get(featureId) !== scope) {
      throw new TypeError(`Feature "${featureId}" declares one system scope, and it already declared "${scopeByFeature.get(featureId)}".`);
    }
    scopeByFeature.set(featureId, scope);
    return function systemContext(reason) {
      if (typeof reason !== "string" || !reason.trim()) {
        throw new TypeError(`Feature "${featureId}" systemContext(reason) needs the reason this work reads or writes every workspace's rows.`);
      }
      return createSystemContext({ feature: featureId, systemScope: scope, reason: reason.trim() });
    };
  }

  /** Every feature that declared a system scope, with the scope. */
  function systemScopes() {
    return [...scopeByFeature].map(([featureId, systemScope]) => Object.freeze({ featureId, systemScope }));
  }

  return Object.freeze({
    own,
    ownedTables,
    declareSystemScope,
    systemScopes
  });
}

export { DEFAULT_REQUEST_ROW_LIMIT, DEFAULT_SERVER_PAGE_SIZE, createResourceRuntime };
