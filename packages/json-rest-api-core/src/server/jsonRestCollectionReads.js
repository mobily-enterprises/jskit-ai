import { isPlainJsonRestObject } from "./jsonRestValues.js";

/**
 * The context one json-rest-api call works in: a copy of the caller's, with its
 * visibility context and scope values copied too, since json-rest-api writes an
 * operation's working state into the context it is given.
 * @param {object | null | undefined} [context]
 */
function createJsonRestContext(context = null) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }

  const nextContext = {
    ...context
  };

  if (context.visibilityContext && typeof context.visibilityContext === "object" && !Array.isArray(context.visibilityContext)) {
    nextContext.visibilityContext = {
      ...context.visibilityContext
    };
  }

  if (context.scopeValues && typeof context.scopeValues === "object" && !Array.isArray(context.scopeValues)) {
    nextContext.scopeValues = {
      ...context.scopeValues
    };
  }

  return nextContext;
}

function extractJsonRestCollectionRows(payload) {
  if (!isPlainJsonRestObject(payload) || !Array.isArray(payload.data)) {
    throw new TypeError("json-rest-api collection response must contain a data array.");
  }
  return payload.data;
}

// Every-row reads ask for pages this large, so each page's row policy and
// linkage checks run once per 1,000 rows instead of once per queryMaxLimit.
const EVERY_ROW_PAGE_SIZE = 1000;

// Hands each cursor page of an every-row read to onPage; see queryAllJsonRestCollectionRows.
async function readEveryJsonRestCollectionPage(resource, { queryParams, ...params }, context, { caller, onPage }) {
  if (Object.hasOwn(queryParams, "page") || Object.hasOwn(queryParams, "sort")) {
    throw new TypeError(`${caller} pages in id order itself, so queryParams cannot name a page or sort.`);
  }

  const size = Math.max(EVERY_ROW_PAGE_SIZE, resource.vars.queryMaxLimit || 0);
  let after = null;
  do {
    const payload = await resource.query(
      {
        ...params,
        pageSizeLimit: size,
        queryParams: {
          ...queryParams,
          sort: ["id"],
          page: after ? { size, after } : { size }
        }
      },
      createJsonRestContext(context)
    );
    onPage(payload);
    const pagination = payload.meta?.pagination;
    after = pagination?.hasMore === true ? pagination.cursor.next : null;
  } while (after);
}

/**
 * Every row a resource query matches, for server code that needs them all: a
 * query without a page returns only the resource's first page, 20 rows by
 * default. It reads cursor pages in id order until json-rest-api reports no
 * more, so no row is skipped or repeated between pages; callers sort the rows
 * themselves. Pages are 1,000 rows, or the resource's `queryMaxLimit` when that
 * is larger, through json-rest-api's server-only `pageSizeLimit` (2.4.0 and
 * later); an earlier json-rest-api ignores it and caps each page at
 * `queryMaxLimit`, and the loop still returns every row. Each page runs with
 * the caller's params, its transaction among them, and its own copy of the
 * context, since json-rest-api keeps an operation's working state in the
 * context it is given.
 * @param {import("./types.js").JsonRestResource} resource One of `api.resources`.
 * @param {{ queryParams: object, transaction?: object | null, format?: "plain" | "jsonapi" }} params
 *   resource.query()'s params, with no `queryParams.page` or `queryParams.sort`.
 * @param {object | null | undefined} context The execution context, as createJsonRestContext() takes it.
 * @returns {Promise<object[]>}
 */
async function queryAllJsonRestCollectionRows(resource, params, context) {
  const rows = [];
  await readEveryJsonRestCollectionPage(resource, params, context, {
    caller: "queryAllJsonRestCollectionRows",
    onPage: (payload) => rows.push(...extractJsonRestCollectionRows(payload))
  });
  return rows;
}

/**
 * Every row a resource query matches as one JSON:API collection document,
 * `{ data, included }`, for server code that reads related records through
 * `include`: queryAllJsonRestCollectionRows' rows as `data`, and the records
 * every page included, each once, in the order first seen. `included` is
 * absent when no page included any.
 * @param {import("./types.js").JsonRestResource} resource One of `api.resources`.
 * @param {{ queryParams: object, transaction?: object | null }} params
 *   resource.query()'s params, with no `queryParams.page` or `queryParams.sort`; the format is "jsonapi".
 * @param {object | null | undefined} context The execution context, as createJsonRestContext() takes it.
 * @returns {Promise<{ data: object[], included?: object[] }>}
 */
async function queryAllJsonRestCollectionDocument(resource, params, context) {
  const data = [];
  const included = new Map();
  await readEveryJsonRestCollectionPage(resource, { ...params, format: "jsonapi" }, context, {
    caller: "queryAllJsonRestCollectionDocument",
    onPage(payload) {
      data.push(...extractJsonRestCollectionRows(payload));
      for (const record of Array.isArray(payload.included) ? payload.included : []) {
        const key = JSON.stringify([record.type, record.id]);
        if (!included.has(key)) {
          included.set(key, record);
        }
      }
    }
  });
  return included.size > 0 ? { data, included: [...included.values()] } : { data };
}

export {
  createJsonRestContext,
  extractJsonRestCollectionRows,
  queryAllJsonRestCollectionDocument,
  queryAllJsonRestCollectionRows
};
