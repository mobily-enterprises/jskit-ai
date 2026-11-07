import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeOwnerKey(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "bigint") {
    return String(value);
  }

  return String(value).trim();
}

function readParentId(record) {
  return record?.id;
}

// The children are read with the page's own options: its context, which scopes the read, and its transaction.
function passCallOptions({ callOptions = {} } = {}) {
  return callOptions;
}

/**
 * The children are read with one filter that lists every owner id, which the child table
 * accepts only when it declares that filter as an "in" search. Without it, json-rest-api
 * answers a validation error on the filter; name the declaration that fixes it.
 * @param {unknown} error
 * @param {string} context
 * @param {string} childForeignKey
 */
function explainForeignKeyFilterError(error, context, childForeignKey) {
  const field = `queryParams.filters.${childForeignKey}`;
  if (error?.code !== "REST_API_VALIDATION" || !error.details?.fields?.includes(field)) {
    return error;
  }
  return new TypeError(
    `${context} reads the children of a page with one ${childForeignKey} filter listing every owner id, ` +
    `which the child table refused (${error.message}). Declare the filter in the child table resource's schema, ` +
    `${childForeignKey}: { ..., search: { type: "array", filterOperator: "in" } }, or in its owns entry, ` +
    `searchSchema: { ${childForeignKey}: { type: "array", actualField: "${childForeignKey}", filterOperator: "in" } }.`,
    { cause: error }
  );
}

function resolveListChildrenHandler(options = {}, { context = "createHooksToCollectChildren" } = {}) {
  // readable-check: allow method-probe - input validation: an application passes listChildren() or a childRepository to read through
  if (typeof options.listChildren === "function") {
    return options.listChildren;
  }

  const childRepository = options.childRepository;
  const childListMethod = normalizeText(options.childListMethod);
  const childForeignKey = normalizeText(options.childForeignKey);
  if (!childRepository || typeof childRepository !== "object" || Array.isArray(childRepository)) {
    throw new TypeError(
      `${context} requires listChildren(ids, options, ctx) or childRepository.`
    );
  }

  if (!childListMethod) {
    // readable-check: allow method-probe - input validation: the child table's repository, a CRUD feature's handle, must read with queryAll()
    if (typeof childRepository.queryAll !== "function") {
      throw new TypeError(`${context} requires childRepository.queryAll to be a function, or a childListMethod.`);
    }
    if (!childForeignKey) {
      throw new TypeError(`${context} requires childForeignKey when it reads childRepository.queryAll.`);
    }
    // Every child of the page's owners in one read through the child table's own repository.
    return async (ids = [], childCallOptions = {}) => {
      try {
        return await childRepository.queryAll({ filters: { [childForeignKey]: ids } }, childCallOptions);
      } catch (error) {
        throw explainForeignKeyFilterError(error, context, childForeignKey);
      }
    };
  }

  const listChildren = childRepository[childListMethod];
  // readable-check: allow method-probe - input validation: the named childListMethod must be a method of childRepository
  if (typeof listChildren !== "function") {
    throw new TypeError(`${context} requires childRepository.${childListMethod} to be a function.`);
  }

  if (childListMethod === "listByForeignIds" && !childForeignKey) {
    throw new TypeError(`${context} requires childForeignKey when using childRepository.listByForeignIds.`);
  }

  return (ids = [], childCallOptions = {}, hookContext = {}) => {
    if (childForeignKey) {
      return listChildren.call(childRepository, ids, childForeignKey, childCallOptions, hookContext);
    }
    return listChildren.call(childRepository, ids, childCallOptions, hookContext);
  };
}

function resolveGetChildOwnerId(options = {}, { context = "createHooksToCollectChildren" } = {}) {
  // readable-check: allow method-probe - input validation: an application passes getChildOwnerId() or the key that holds the owner id
  if (typeof options.getChildOwnerId === "function") {
    return options.getChildOwnerId;
  }

  const childOwnerIdKey = normalizeText(options.childOwnerIdKey);
  const childForeignKey = normalizeText(options.childForeignKey);
  const ownerKey = childOwnerIdKey || childForeignKey;
  if (!ownerKey) {
    throw new TypeError(`${context} requires childOwnerIdKey, childForeignKey, or getChildOwnerId.`);
  }

  return (child = {}) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      return undefined;
    }
    if (childOwnerIdKey && Object.hasOwn(child, childOwnerIdKey)) {
      return child[childOwnerIdKey];
    }
    return child[ownerKey];
  };
}

function resolveChildrenContainerKey(hookContext = {}, options = {}) {
  const explicitContainerKey = normalizeText(options.lookupContainerKey);
  if (explicitContainerKey) {
    return explicitContainerKey;
  }

  const runtimeContainerKey = normalizeText(hookContext.runtime?.lookup?.containerKey);
  if (runtimeContainerKey) {
    return runtimeContainerKey;
  }

  return "lookups";
}

/**
 * Hooks that load the children of a page of records in one call (afterQuery) and attach each record's
 * children to it (transformReturnedRecord).
 * @param {object} options
 * @param {string} options.childKey The key the children are attached under.
 * @param {string} [options.context] The name errors give the hooks.
 * @param {(ids: unknown[], callOptions: object, hookContext: object) => Promise<object[]>} [options.listChildren]
 *   Lists the children of the owner ids; otherwise childRepository does.
 * @param {object} [options.childRepository] The child table's repository: without childListMethod, its
 *   queryAll() reads the children whose childForeignKey is one of the owner ids, as a CRUD feature's repository does.
 *   The child table must declare that filter as an "in" search, e.g. in its schema
 *   `ownerId: { type: "integer", search: { type: "array", filterOperator: "in" } }`; the first read says so otherwise.
 * @param {string} [options.childListMethod] A repository method to call instead, with the owner ids, childForeignKey
 *   when it is given, the call options and the hook context.
 * @param {string} [options.childForeignKey]
 * @param {(child: object, hookContext: object) => unknown} [options.getChildOwnerId]
 *   Reads a child's owner id; otherwise childOwnerIdKey or childForeignKey names it.
 * @param {string} [options.childOwnerIdKey]
 * @param {(record: object, hookContext: object) => unknown} [options.getParentId] Reads a record's id.
 * @param {(value: unknown) => string} [options.normalizeOwnerKey] Turns an owner id into a map key.
 * @param {(input: { callOptions: object, records: object[], ownerIds: unknown[], context: object }) => object} [options.buildChildCallOptions]
 *   The options the children are listed with; by default the page's own call options, untouched: its context and
 *   transaction.
 * @param {(record: object, children: object[], hookContext: object) => object} [options.attachChildren]
 *   Returns the record with its children; by default under childKey in the lookup container, or on
 *   the record itself when attachToLookupContainer is false.
 * @param {symbol | string} [options.stateMapKey]
 * @param {boolean} [options.attachToLookupContainer]
 * @param {string} [options.lookupContainerKey]
 */
function createHooksToCollectChildren(options = {}) {
  const context = normalizeText(options.context) || "createHooksToCollectChildren";
  const childKey = normalizeText(options.childKey);
  if (!childKey) {
    throw new TypeError(`${context} requires childKey.`);
  }

  const listChildren = resolveListChildrenHandler(options, {
    context
  });
  const {
    getParentId = readParentId,
    normalizeOwnerKey: normalizeCollectionOwnerKey = normalizeOwnerKey,
    buildChildCallOptions = passCallOptions,
    attachChildren = attachChildrenToRecord
  } = options;
  const getChildOwnerId = resolveGetChildOwnerId(options, {
    context
  });
  const stateMapKey = options.stateMapKey || Symbol(`crud.children.${childKey}`);
  const attachToLookupContainer = options.attachToLookupContainer !== false;

  function attachChildrenToRecord(record, children = [], hookContext = {}) {
    if (!attachToLookupContainer) {
      return {
        ...record,
        [childKey]: children
      };
    }

    const containerKey = resolveChildrenContainerKey(hookContext, options);
    const sourceContainer = record?.[containerKey];
    const normalizedContainer =
      sourceContainer && typeof sourceContainer === "object" && !Array.isArray(sourceContainer)
        ? sourceContainer
        : {};

    return {
      ...record,
      [containerKey]: {
        ...normalizedContainer,
        [childKey]: children
      }
    };
  }

  async function afterQuery(records = [], ctx = {}) {
    const normalizedRecords = Array.isArray(records) ? records : [];
    const ownerIds = [];
    const seenOwnerKeys = new Set();

    for (const record of normalizedRecords) {
      const ownerId = getParentId(record, ctx);
      const ownerKey = normalizeCollectionOwnerKey(ownerId);
      if (!ownerKey || seenOwnerKeys.has(ownerKey)) {
        continue;
      }

      seenOwnerKeys.add(ownerKey);
      ownerIds.push(ownerId);
    }

    const state = ctx.state && typeof ctx.state === "object" ? ctx.state : null;
    if (!state) {
      throw new TypeError(`${context} requires ctx.state object.`);
    }

    if (ownerIds.length < 1) {
      state[stateMapKey] = new Map();
      return;
    }

    const childCallOptions = buildChildCallOptions({
      callOptions: ctx.callOptions || {},
      records: normalizedRecords,
      ownerIds,
      context: ctx
    });
    const children = await listChildren(ownerIds, childCallOptions, ctx);
    if (!Array.isArray(children)) {
      throw new TypeError(`${context} listChildren must return an array.`);
    }

    const childrenByOwnerKey = new Map();
    for (const child of children) {
      const childOwnerId = getChildOwnerId(child, ctx);
      const childOwnerKey = normalizeCollectionOwnerKey(childOwnerId);
      if (!childOwnerKey) {
        continue;
      }

      const currentList = childrenByOwnerKey.get(childOwnerKey);
      if (currentList) {
        currentList.push(child);
        continue;
      }

      childrenByOwnerKey.set(childOwnerKey, [child]);
    }

    state[stateMapKey] = childrenByOwnerKey;
  }

  function transformReturnedRecord(record = {}, ctx = {}) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return record;
    }

    const state = ctx.state && typeof ctx.state === "object" ? ctx.state : null;
    const childrenByOwnerKey = state ? state[stateMapKey] : null;
    const ownerKey = normalizeCollectionOwnerKey(getParentId(record, ctx));
    const children = ownerKey && childrenByOwnerKey instanceof Map
      ? (childrenByOwnerKey.get(ownerKey) || [])
      : [];

    return attachChildren(record, children, ctx);
  }

  return Object.freeze({
    afterQuery,
    transformReturnedRecord
  });
}

export { createHooksToCollectChildren };
