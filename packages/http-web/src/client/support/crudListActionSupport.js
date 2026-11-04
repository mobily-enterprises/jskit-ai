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

function selectListRecordId(record, index) {
  return record.id ?? record.attributes?.id ?? index;
}

function resolveListRecordId(record, index, resolveRecordId) {
  return normalizeText(resolveRecordId(record, index));
}

function resolveListActionBaseContext(resolveContext) {
  const baseContext = resolveContext();
  return baseContext && typeof baseContext === "object" && !Array.isArray(baseContext) ? baseContext : {};
}

// readable-check: allow method-probe - input validation: an action's disabled, visible and loading are each a value or a function of the action's context
function resolveListActionFlag(flag, resolveFlagContext) {
  return typeof flag === "function" ? flag(resolveFlagContext()) : flag;
}

export {
  defineCrudListActions,
  normalizeListActionKey,
  resolveListActionFlag,
  resolveListRecordId,
  resolveListActionBaseContext,
  selectListRecordId
};
