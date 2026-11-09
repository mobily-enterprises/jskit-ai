import { RestApiValidationError } from "json-rest-api";
import { detectDialectFromClient } from "@jskit-ai/database-runtime/shared";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

// A search filter of an `owns` entry may read other tables through their owners' join sources: its `joinSources` name,
// by alias, which owner answers each (an owner API the feature requires, or one of its own handles), and its
// `applyFilter` gets `joinSource(alias)`, the caller's scoped rows of that table under the alias, for a whereExists or
// a whereNotExists tied to its own row. json-rest-api calls applyFilter synchronously, as Knex compiles the statement,
// while a join source is built asynchronously in the caller's scope, so a filtering hook builds the join sources the
// read's filters use first, from the call's own options, and applyFilter takes a fresh copy of one each time it asks.

// The call options a handle's json-rest-api context carries for the join sources its filters build: the caller's
// context and transaction, as the caller passed them. Module-private, so nothing but a handle sets it.
const CALL_OPTIONS = Symbol("jskit.resources.callOptions");
// The join sources a read's filters use, built by the filtering hook: by resource name, filter and alias.
const PREPARED_SOURCES = Symbol("jskit.resources.filterJoinSources");
const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/u;
// The reads that choose rows to write or lock: on MySQL and MariaDB they read another table from the transaction's
// snapshot without locking it, as json-rest-api refuses for a filter on another table's field.
const SELECTING_PURPOSES = new Set(["bulk-write", "lock", "claim"]);

/**
 * A handle call's json-rest-api context, carrying the call's own options (its context and transaction) for the join
 * sources its filters build.
 * @param {Record<PropertyKey, unknown>} jsonRestContext The context createJsonRestContext built for the call.
 * @param {{ context?: object | null, trx?: object | null }} options
 */
function withCallOptions(jsonRestContext, options) {
  jsonRestContext[CALL_OPTIONS] = Object.freeze({ context: options.context ?? null, trx: options.trx ?? null });
  return jsonRestContext;
}

/**
 * The owns entry's search schema as json-rest-api takes it, and the filters in it that read join sources. Each such
 * filter's `joinSources` is checked here, at startup, and taken out; its applyFilter is wrapped so that it receives
 * `joinSource(alias)` beside json-rest-api's tools. The table resource's own search (its searchSchema and its fields'
 * `search` records) names no feature, so a filter there that names join sources is a TypeError.
 * @param {string} featureId
 * @param {{ name: string, searchSchema?: unknown, schema?: Record<string, any> }} resource The table resource.
 * @param {unknown} searchSchema The owns entry's searchSchema extra.
 * @returns {{ searchSchema: unknown, declared: Array<[string, Readonly<Record<string, Function>>]> }}
 */
function filterJoinSources(featureId, resource, searchSchema) {
  const resourceName = resource.name;
  const shared = [
    ...Object.entries(isRecord(resource.searchSchema) ? resource.searchSchema : {}),
    ...Object.entries(resource.schema ?? {}).filter(([, field]) => isRecord(field?.search)).map(([field, { search }]) => [field, search])
  ];
  for (const [filter, entry] of shared) {
    if (isRecord(entry) && entry.joinSources !== undefined) {
      throw new TypeError(
        `Feature "${featureId}" filter "${filter}" of "${resourceName}" names joinSources in the table resource, which names no ` +
          "feature to answer them; give the filter in the owns entry's searchSchema, whose feature's requires and handles do."
      );
    }
  }
  if (!isRecord(searchSchema)) {
    return { searchSchema, declared: [] };
  }
  const declared = [];
  const entries = Object.entries(searchSchema).map(([filter, entry]) => {
    if (!isRecord(entry) || entry.joinSources === undefined) {
      return [filter, entry];
    }
    const { joinSources, ...rest } = entry;
    const label = `Feature "${featureId}" filter "${filter}" of "${resourceName}"`;
    if (!isRecord(joinSources) || Object.keys(joinSources).length < 1) {
      throw new TypeError(`${label} joinSources must name each join source by its alias: { alias: ({ requires, owned }) => owner }.`);
    }
    for (const [alias, pick] of Object.entries(joinSources)) {
      if (!ALIAS.test(alias)) {
        throw new TypeError(`${label} names the join source "${alias}", which is no alias: letters, digits and _, not first a digit.`);
      }
      // readable-check: allow method-probe - input validation: each join source is the owner's picker
      if (typeof pick !== "function") {
        throw new TypeError(`${label} join source "${alias}" must be a function answering its owner: ({ requires, owned }) => owner.`);
      }
    }
    // readable-check: allow method-probe - input validation: a filter that reads join sources applies them itself
    if (typeof rest.applyFilter !== "function" || rest.oneOf !== undefined) {
      throw new TypeError(`${label} reads join sources, so it takes an applyFilter(query, value, { column, joinSource }) and no oneOf.`);
    }
    declared.push([filter, Object.freeze({ ...joinSources })]);
    return [filter, { ...rest, applyFilter: preparedFilter(resourceName, filter, rest.applyFilter) }];
  });
  return { searchSchema: declared.length > 0 ? Object.fromEntries(entries) : searchSchema, declared };
}

/**
 * A filter's applyFilter as json-rest-api calls it: the owner's, given `joinSource(alias)`, which answers a fresh copy
 * of the join source the filtering hook built for this read, `{ query, column }`, each time it is called.
 * @param {string} resourceName
 * @param {string} filter
 * @param {Function} applyFilter The owner's.
 */
function preparedFilter(resourceName, filter, applyFilter) {
  return function applyJoinSourceFilter(query, value, tools) {
    const prepared = tools?.context?.[PREPARED_SOURCES]?.get(resourceName)?.get(filter);
    if (!prepared) {
      throw new TypeError(`${resourceName} filter "${filter}" reads join sources, which only a read through its handle builds.`);
    }
    const joinSource = (alias) => {
      const source = prepared.get(alias);
      if (!source) {
        throw new TypeError(`${resourceName} filter "${filter}" names no join source "${alias}"; it names ${[...prepared.keys()].join(", ")}.`);
      }
      return Object.freeze({
        query: source.query.clone(),
        column: source.column
      });
    };
    return applyFilter.call(this, query, value, { ...tools, joinSource });
  };
}

/**
 * The json-rest-api hooks of a resource whose filters read join sources: one filtering hook, before json-rest-api's
 * own filters, that builds the join sources of each such filter the read uses, in the caller's scope (the call's own
 * context and transaction, which its handle carries), through the owner each names. On MySQL and MariaDB a read that
 * chooses rows to write or lock (patchWhere, deleteWhere, lockWhere, claim) refuses such a filter, whose join sources
 * those databases read from the transaction's snapshot without locking them.
 * @param {object} dependencies
 * @param {string} dependencies.resourceName
 * @param {ReadonlyArray<[string, Readonly<Record<string, Function>>]>} dependencies.declared The filters that read join
 *   sources, each with its join sources' pickers.
 * @param {(pick: Function) => unknown} dependencies.ownerOf The owner a picker names, given the feature's requires and
 *   its own handles.
 */
function joinSourceHooks({ resourceName, declared, ownerOf }) {
  async function buildFilterJoinSources({ context }) {
    const state = context?.knexQuery;
    if (state?.scopeName !== resourceName || !isRecord(state.filters)) {
      return;
    }
    const used = declared.filter(([filter]) => state.filters[filter] !== undefined);
    if (used.length < 1) {
      return;
    }
    if (SELECTING_PURPOSES.has(state.queryPurpose) && detectDialectFromClient(state.db) === "mysql") {
      const [filter] = used[0];
      const message = `${context.method} on '${resourceName}' filters "${filter}" through another table's join source, which MySQL and ` +
        "MariaDB read from the transaction snapshot without locking it; filter on the row's own columns instead, for example " +
        "on a link after locking its targets with lockMany()";
      throw new RestApiValidationError(message, { fields: ["filters"], violations: [{ field: "filters", rule: "selection_cross_table", message }] });
    }
    const callOptions = context[CALL_OPTIONS];
    if (!callOptions) {
      throw new TypeError(`${resourceName} filter "${used[0][0]}" reads join sources, which only a read through its handle builds.`);
    }
    const options = { context: callOptions.context, trx: callOptions.trx };
    context[PREPARED_SOURCES] ??= new Map();
    const byFilter = new Map();
    for (const [filter, sources] of used) {
      const byAlias = new Map();
      for (const [alias, pick] of Object.entries(sources)) {
        const owner = /** @type {{ joinSource?: Function } | null | undefined} */ (ownerOf(pick));
        // readable-check: allow method-probe - input validation: the picked owner answers join sources
        if (typeof owner?.joinSource !== "function") {
          throw new TypeError(`${resourceName} filter "${filter}" join source "${alias}" names no owner with joinSource({ alias }, options).`);
        }
        byAlias.set(alias, await owner.joinSource({ alias }, options));
      }
      byFilter.set(filter, byAlias);
    }
    context[PREPARED_SOURCES].set(resourceName, byFilter);
  }

  return {
    knexQueryFiltering: {
      functionName: "jskitFilterJoinSources",
      beforeFunction: "polymorphicFiltersHook",
      handler: buildFilterJoinSources
    }
  };
}

export { filterJoinSources, joinSourceHooks, withCallOptions };
