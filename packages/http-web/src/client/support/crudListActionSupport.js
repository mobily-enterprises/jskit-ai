import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function defineCrudListActions(actions, { name, createAction }) {
  if (!Array.isArray(actions)) {
    throw new TypeError(`${name} requires an array.`);
  }

  const normalizedActions = [];
  const seenKeys = new Set();

  actions.forEach((rawAction, index) => {
    if (!rawAction || typeof rawAction !== "object" || Array.isArray(rawAction)) {
      return;
    }

    const key = normalizeText(rawAction.key || rawAction.id || `action-${index + 1}`);
    const label = normalizeText(rawAction.label || rawAction.title);
    if (!key || !label || seenKeys.has(key)) {
      return;
    }

    seenKeys.add(key);
    normalizedActions.push(Object.freeze(createAction(rawAction, { key, label })));
  });

  return Object.freeze(normalizedActions);
}

function normalizeListActionKey(actionOrKey = "") {
  return normalizeText(
    actionOrKey && typeof actionOrKey === "object"
      ? actionOrKey.key
      : actionOrKey
  );
}

function resolveListRecordId(record = {}, index = 0, resolveRecordId = null) {
  const resolvedId = typeof resolveRecordId === "function"
    ? resolveRecordId(record, index)
    : record?.id ?? record?.attributes?.id ?? index;
  return normalizeText(resolvedId);
}

function resolveListActionBaseContext(resolveContext = null) {
  const baseContext = typeof resolveContext === "function" ? resolveContext() : {};
  return baseContext && typeof baseContext === "object" && !Array.isArray(baseContext) ? baseContext : {};
}

export {
  defineCrudListActions,
  normalizeListActionKey,
  resolveListRecordId,
  resolveListActionBaseContext
};
