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

function toDefaultChildCallOptions(callOptions = {}) {
  const nextOptions = {};
  if (Object.hasOwn(callOptions, "trx")) {
    nextOptions.trx = callOptions.trx;
  }
  if (Object.hasOwn(callOptions, "visibilityContext")) {
    nextOptions.visibilityContext = callOptions.visibilityContext;
  }

  return nextOptions;
}

function resolveListChildrenHandler(options = {}, { context = "createHooksToCollectChildren" } = {}) {
  if (typeof options.listChildren === "function") {
    return options.listChildren;
  }

  const childRepository = options.childRepository;
  const childListMethod = normalizeText(options.childListMethod) || "listByIds";
  const childForeignKey = normalizeText(options.childForeignKey);
  if (!childRepository || typeof childRepository !== "object" || Array.isArray(childRepository)) {
    throw new TypeError(
      `${context} requires listChildren(ids, options, ctx) or childRepository.`
    );
  }

  const listChildren = childRepository[childListMethod];
  if (typeof listChildren !== "function") {
    throw new TypeError(`${context} requires childRepository.${childListMethod} to be a function.`);
  }

  if (childListMethod === "listByIds") {
    if (!childForeignKey) {
      throw new TypeError(`${context} requires childForeignKey when using childRepository.listByIds.`);
    }

    return (ids = [], childCallOptions = {}, hookContext = {}) =>
      listChildren.call(childRepository, ids, {
        ...childCallOptions,
        valueKey: childForeignKey
      }, hookContext);
  }

  if (childListMethod === "listByForeignIds") {
    if (!childForeignKey) {
      throw new TypeError(`${context} requires childForeignKey when using childRepository.listByForeignIds.`);
    }

    return (ids = [], childCallOptions = {}, hookContext = {}) =>
      listChildren.call(childRepository, ids, childForeignKey, childCallOptions, hookContext);
  }

  return (ids = [], childCallOptions = {}, hookContext = {}) => {
    if (childForeignKey) {
      return listChildren.call(childRepository, ids, childForeignKey, childCallOptions, hookContext);
    }
    return listChildren.call(childRepository, ids, childCallOptions, hookContext);
  };
}

function resolveGetChildOwnerId(options = {}, { context = "createHooksToCollectChildren" } = {}) {
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

function resolveLookupContainerKey(record = {}, hookContext = {}, options = {}) {
  const explicitContainerKey = normalizeText(options.lookupContainerKey);
  if (explicitContainerKey) {
    return explicitContainerKey;
  }

  const runtimeContainerKey = normalizeText(hookContext?.runtime?.lookup?.containerKey);
  if (runtimeContainerKey) {
    return runtimeContainerKey;
  }

  if (Object.hasOwn(record, "lookups")) {
    return "lookups";
  }

  return "lookups";
}

function createHooksToCollectChildren(options = {}) {
  const context = normalizeText(options.context) || "createHooksToCollectChildren";
  const childKey = normalizeText(options.childKey);
  if (!childKey) {
    throw new TypeError(`${context} requires childKey.`);
  }

  const listChildren = resolveListChildrenHandler(options, {
    context
  });
  const getParentId = typeof options.getParentId === "function"
    ? options.getParentId
    : (record = {}) => record?.id;
  const getChildOwnerId = resolveGetChildOwnerId(options, {
    context
  });
  const normalizeCollectionOwnerKey = typeof options.normalizeOwnerKey === "function"
    ? options.normalizeOwnerKey
    : normalizeOwnerKey;
  const buildChildCallOptions = typeof options.buildChildCallOptions === "function"
    ? options.buildChildCallOptions
    : ({ callOptions = {} } = {}) => toDefaultChildCallOptions(callOptions);
  const stateMapKey = options.stateMapKey || Symbol(`crud.children.${childKey}`);
  const attachToLookupContainer = options.attachToLookupContainer !== false;
  const attachChildren = typeof options.attachChildren === "function"
    ? options.attachChildren
    : (record = {}, children = [], hookContext = {}) => {
      if (!attachToLookupContainer) {
        return {
          ...record,
          [childKey]: children
        };
      }

      const containerKey = resolveLookupContainerKey(record, hookContext, options);
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
    };

  return Object.freeze({
    async afterQuery(records = [], ctx = {}) {
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

      const state = ctx?.state && typeof ctx.state === "object" ? ctx.state : null;
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
    },

    transformReturnedRecord(record = {}, ctx = {}) {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        return record;
      }

      const state = ctx?.state && typeof ctx.state === "object" ? ctx.state : null;
      const childrenByOwnerKey = state ? state[stateMapKey] : null;
      const ownerKey = normalizeCollectionOwnerKey(getParentId(record, ctx));
      const children = ownerKey && childrenByOwnerKey instanceof Map
        ? (childrenByOwnerKey.get(ownerKey) || [])
        : [];

      return attachChildren(record, children, ctx);
    }
  });
}

export { createHooksToCollectChildren };
