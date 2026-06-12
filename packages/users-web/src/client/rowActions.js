import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeCrudListRowAction(rawAction = {}, index = 0) {
  if (!rawAction || typeof rawAction !== "object" || Array.isArray(rawAction)) {
    return null;
  }

  const key = normalizeText(rawAction.key || rawAction.id || `action-${index + 1}`);
  const label = normalizeText(rawAction.label || rawAction.title);
  if (!key || !label) {
    return null;
  }

  return Object.freeze({
    key,
    label,
    icon: normalizeText(rawAction.icon),
    color: normalizeText(rawAction.color, { fallback: "primary" }),
    run: typeof rawAction.run === "function" ? rawAction.run : null,
    visible: rawAction.visible,
    disabled: rawAction.disabled,
    loading: rawAction.loading
  });
}

function defineCrudListRowActions(actions = []) {
  if (!Array.isArray(actions)) {
    throw new TypeError("defineCrudListRowActions requires an array.");
  }

  const normalizedActions = [];
  const seenKeys = new Set();

  actions.forEach((rawAction, index) => {
    const action = normalizeCrudListRowAction(rawAction, index);
    if (!action || seenKeys.has(action.key)) {
      return;
    }

    seenKeys.add(action.key);
    normalizedActions.push(action);
  });

  return Object.freeze(normalizedActions);
}

export { defineCrudListRowActions };
