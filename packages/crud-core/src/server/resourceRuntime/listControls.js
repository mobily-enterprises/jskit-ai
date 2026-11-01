import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  normalizeCrudListLimit
} from "../repositorySupport.js";

const LIST_ORDER_DIRECTION_ASC = "asc";
const LIST_ORDER_DIRECTION_DESC = "desc";
const LIST_ORDER_NULLS_FIRST = "first";
const LIST_ORDER_NULLS_LAST = "last";
const ORDERED_LIST_CURSOR_VALUE_TYPE_KEY = "__jskitCursorValueType";
const ORDERED_LIST_CURSOR_VALUE_KEY = "value";
const ORDERED_LIST_CURSOR_VALUE_TYPE_DATE = "date";

/**
 * @param {unknown} searchColumns The list options' searchColumns, when given.
 * @param {readonly string[]} fallbackColumns The resource's string columns.
 */
function normalizeSearchColumns(searchColumns, fallbackColumns) {
  const normalizedConfiguredColumns = (Array.isArray(searchColumns) ? searchColumns : [])
    .map((columnName) => normalizeText(columnName))
    .filter(Boolean);

  if (normalizedConfiguredColumns.length > 0) {
    return Object.freeze([...new Set(normalizedConfiguredColumns)]);
  }

  return fallbackColumns;
}

function normalizeListOrderDirection(value = LIST_ORDER_DIRECTION_ASC) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return LIST_ORDER_DIRECTION_ASC;
  }
  if (normalized === LIST_ORDER_DIRECTION_ASC || normalized === LIST_ORDER_DIRECTION_DESC) {
    return normalized;
  }

  throw new TypeError(`crudRepository list.orderBy direction must be "${LIST_ORDER_DIRECTION_ASC}" or "${LIST_ORDER_DIRECTION_DESC}".`);
}

function normalizeListOrderNulls(value = LIST_ORDER_NULLS_LAST) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return LIST_ORDER_NULLS_LAST;
  }
  if (normalized === LIST_ORDER_NULLS_FIRST || normalized === LIST_ORDER_NULLS_LAST) {
    return normalized;
  }

  throw new TypeError(`crudRepository list.orderBy nulls must be "${LIST_ORDER_NULLS_FIRST}" or "${LIST_ORDER_NULLS_LAST}".`);
}

function normalizeListOrderBy(orderBy, { idColumn }) {
  const sourceEntries = Array.isArray(orderBy)
    ? orderBy
    : orderBy === null || orderBy === undefined
      ? []
      : [orderBy];
  const normalizedOrderBy = [];
  const seenColumns = new Set();

  for (const rawEntry of sourceEntries) {
    const sourceEntry = typeof rawEntry === "string"
      ? { column: rawEntry }
      : rawEntry;
    if (!isRecord(sourceEntry)) {
      throw new TypeError("crudRepository list.orderBy entries must be objects or column strings.");
    }

    const column = normalizeText(sourceEntry.column);
    if (!column) {
      throw new TypeError("crudRepository list.orderBy entries require column.");
    }
    if (seenColumns.has(column)) {
      continue;
    }

    seenColumns.add(column);
    normalizedOrderBy.push(
      Object.freeze({
        column,
        direction: normalizeListOrderDirection(sourceEntry.direction),
        nulls: normalizeListOrderNulls(sourceEntry.nulls)
      })
    );
  }

  if (normalizedOrderBy.length > 0 && !seenColumns.has(idColumn)) {
    normalizedOrderBy.push(
      Object.freeze({
        column: idColumn,
        direction: normalizedOrderBy[normalizedOrderBy.length - 1].direction,
        nulls: LIST_ORDER_NULLS_LAST
      })
    );
  }

  return Object.freeze(normalizedOrderBy);
}

/**
 * A repository's list controls, from its list options: the default and maximum
 * page size, the search columns and the order.
 * @param {object} list The repository options' list, when given.
 * @param {readonly string[]} fallbackSearchColumns
 * @param {{ idColumn: string }} keys The id column that breaks order ties.
 */
function resolveListRuntimeConfig(list = {}, fallbackSearchColumns, { idColumn }) {
  const parsedMaxLimit = Number(list.maxLimit);
  const normalizedMaxLimit = Number.isInteger(parsedMaxLimit) && parsedMaxLimit > 0
    ? parsedMaxLimit
    : MAX_LIST_LIMIT;
  const normalizedDefaultLimit = normalizeCrudListLimit(list.defaultLimit, {
    fallback: DEFAULT_LIST_LIMIT,
    max: normalizedMaxLimit
  });

  return Object.freeze({
    defaultLimit: normalizedDefaultLimit,
    maxLimit: normalizedMaxLimit,
    searchColumns: normalizeSearchColumns(list.searchColumns, fallbackSearchColumns),
    orderBy: normalizeListOrderBy(list.orderBy, { idColumn })
  });
}

function encodeOrderedListCursorValue(value = null) {
  if (value instanceof Date) {
    return {
      [ORDERED_LIST_CURSOR_VALUE_TYPE_KEY]: ORDERED_LIST_CURSOR_VALUE_TYPE_DATE,
      [ORDERED_LIST_CURSOR_VALUE_KEY]: value.toISOString()
    };
  }

  return value === undefined ? null : value;
}

function decodeOrderedListCursorValue(value = null) {
  if (!isRecord(value)) {
    return value === undefined ? null : value;
  }

  const valueType = normalizeText(value[ORDERED_LIST_CURSOR_VALUE_TYPE_KEY]).toLowerCase();
  if (!valueType) {
    return value;
  }
  if (valueType !== ORDERED_LIST_CURSOR_VALUE_TYPE_DATE) {
    return value;
  }

  const normalizedValue = normalizeText(value[ORDERED_LIST_CURSOR_VALUE_KEY]);
  if (!normalizedValue) {
    throw new TypeError("Ordered list cursor date values require a non-empty value.");
  }

  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Ordered list cursor date values must be valid dates.");
  }

  return date;
}

/**
 * @param {unknown} row
 * @param {ReadonlyArray<{ column: string }>} orderBy The runtime's list order.
 */
function encodeOrderedListCursor(row, orderBy) {
  if (!isRecord(row) || orderBy.length < 1) {
    return null;
  }

  const values = orderBy.map(({ column }) => (
    Object.hasOwn(row, column) && row[column] !== undefined
      ? encodeOrderedListCursorValue(row[column])
      : null
  ));

  return Buffer.from(JSON.stringify({ values }), "utf8").toString("base64url");
}

function decodeOrderedListCursor(cursor, orderBy) {
  const normalizedCursor = normalizeText(cursor);
  if (!normalizedCursor || orderBy.length < 1) {
    return null;
  }

  try {
    const decoded = Buffer.from(normalizedCursor, "base64url").toString("utf8");
    const payload = JSON.parse(decoded);
    const values = Array.isArray(payload?.values) ? payload.values : null;
    if (!values || values.length !== orderBy.length) {
      throw new AppError(400, "Invalid cursor.", {
        code: "INVALID_CURSOR"
      });
    }

    return values.map((value) => decodeOrderedListCursorValue(value));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(400, "Invalid cursor.", {
      code: "INVALID_CURSOR"
    });
  }
}

function applyOrderedListCursorEquality(query, descriptor = {}, value = null) {
  if (value === null) {
    query.whereNull(descriptor.column);
    return;
  }

  query.where(descriptor.column, value);
}

function applyOrderedListCursorAfterBranch(query, descriptor = {}, value = null) {
  const operator = descriptor.direction === LIST_ORDER_DIRECTION_DESC ? "<" : ">";

  if (value === null) {
    if (descriptor.nulls === LIST_ORDER_NULLS_FIRST) {
      query.whereNotNull(descriptor.column);
      return true;
    }

    return false;
  }

  if (descriptor.nulls === LIST_ORDER_NULLS_LAST) {
    query.where((branchQuery) => {
      branchQuery.where(descriptor.column, operator, value);
      branchQuery.orWhereNull(descriptor.column);
    });
    return true;
  }

  query.where(descriptor.column, operator, value);
  return true;
}

function canApplyOrderedListCursorAfterBranch(descriptor = {}, value = null) {
  return !(value === null && descriptor.nulls === LIST_ORDER_NULLS_LAST);
}

function appendOrderedListCursorBranches(query, orderBy = [], cursorValues = [], index = 0, { useOr = false } = {}) {
  const descriptor = orderBy[index];
  if (!descriptor) {
    return false;
  }

  let addedBranch = false;
  const currentValue = cursorValues[index] ?? null;

  if (canApplyOrderedListCursorAfterBranch(descriptor, currentValue)) {
    const afterMethod = useOr === true ? "orWhere" : "where";
    query[afterMethod]((afterQuery) => {
      applyOrderedListCursorAfterBranch(afterQuery, descriptor, currentValue);
    });
    addedBranch = true;
  }

  if (index >= orderBy.length - 1) {
    return addedBranch;
  }

  const equalityMethod = useOr === true || addedBranch === true ? "orWhere" : "where";
  query[equalityMethod]((equalQuery) => {
    applyOrderedListCursorEquality(equalQuery, descriptor, currentValue);
    equalQuery.where((nestedQuery) => {
      appendOrderedListCursorBranches(nestedQuery, orderBy, cursorValues, index + 1);
    });
  });
  return true;
}

/**
 * @param {object} query
 * @param {{ orderBy: ReadonlyArray<object>, cursor: unknown }} list The runtime's list order and the query's cursor.
 */
function applyOrderedListCursorFilter(query, { orderBy, cursor }) {
  const cursorValues = decodeOrderedListCursor(cursor, orderBy);
  if (!cursorValues) {
    return query;
  }

  return query.where((cursorQuery) => {
    appendOrderedListCursorBranches(cursorQuery, orderBy, cursorValues);
  });
}

function applyOrderedListControls(dbQuery, orderBy) {
  let nextQuery = dbQuery;
  for (const descriptor of orderBy) {
    nextQuery = nextQuery.orderByRaw(
      descriptor.nulls === LIST_ORDER_NULLS_FIRST
        ? "?? is null desc"
        : "?? is null asc",
      [descriptor.column]
    );
    nextQuery = nextQuery.orderBy(descriptor.column, descriptor.direction);
  }

  return nextQuery;
}

/**
 * @param {object} dbQuery
 * @param {{ idColumn: string, limit: number, orderBy: ReadonlyArray<object> }} controls
 */
function enforceCrudRepositoryListControls(dbQuery, { idColumn, limit, orderBy }) {
  const nextQuery = dbQuery.clearOrder().clear("limit");

  if (orderBy.length > 0) {
    return applyOrderedListControls(nextQuery, orderBy)
      .limit(limit);
  }

  return nextQuery
    .orderBy(idColumn, "asc")
    .limit(limit);
}

export {
  resolveListRuntimeConfig,
  encodeOrderedListCursor,
  applyOrderedListCursorFilter,
  enforceCrudRepositoryListControls
};
