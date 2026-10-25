import { computed, ref } from "vue";
import { defineCrudListRowActions } from "../rowActions.js";
import {
  normalizeListActionKey,
  resolveListActionBaseContext,
  resolveListRecordId
} from "../support/crudListActionSupport.js";

function createExecutionKey(actionKey = "", recordId = "", index = 0) {
  return [
    actionKey,
    recordId || `index-${index}`
  ].join(":");
}

function useCrudListRowActions(actions = [], {
  resolveRecordId = null,
  resolveContext = null
} = {}) {
  const normalizedActions = defineCrudListRowActions(actions);
  const executingKeys = ref([]);
  const hasActions = computed(() => normalizedActions.length > 0);

  function getRecordId(record = {}, index = 0) {
    return resolveListRecordId(record, index, resolveRecordId);
  }

  function createActionContext(action = {}, record = {}, index = 0) {
    return {
      ...resolveListActionBaseContext(resolveContext),
      action,
      record,
      index,
      recordId: getRecordId(record, index)
    };
  }

  function findAction(actionOrKey = "") {
    const actionKey = normalizeListActionKey(actionOrKey);
    return normalizedActions.find((action) => action.key === actionKey) || null;
  }

  function resolveActionFlag(action = {}, flagKey = "", record = {}, index = 0, fallback = false) {
    const flag = action?.[flagKey];
    if (typeof flag === "function") {
      return Boolean(flag(createActionContext(action, record, index)));
    }
    if (flag === undefined || flag === null) {
      return fallback;
    }
    return Boolean(flag);
  }

  function isActionVisible(actionOrKey = "", record = {}, index = 0) {
    const action = findAction(actionOrKey);
    return action ? resolveActionFlag(action, "visible", record, index, true) : false;
  }

  function isActionExecuting(actionOrKey = "", record = {}, index = 0) {
    const action = findAction(actionOrKey);
    if (!action) {
      return false;
    }

    const executionKey = createExecutionKey(action.key, getRecordId(record, index), index);
    return executingKeys.value.includes(executionKey);
  }

  function isActionLoading(actionOrKey = "", record = {}, index = 0) {
    const action = findAction(actionOrKey);
    if (!action) {
      return false;
    }

    return isActionExecuting(action, record, index) ||
      resolveActionFlag(action, "loading", record, index, false);
  }

  function isActionDisabled(actionOrKey = "", record = {}, index = 0) {
    const action = findAction(actionOrKey);
    if (!action || !isActionVisible(action, record, index) || !action.run) {
      return true;
    }

    return isActionLoading(action, record, index) ||
      resolveActionFlag(action, "disabled", record, index, false);
  }

  function visibleActionsFor(record = {}, index = 0) {
    return normalizedActions.filter((action) => isActionVisible(action, record, index));
  }

  function hasVisibleActionsFor(record = {}, index = 0) {
    return visibleActionsFor(record, index).length > 0;
  }

  async function execute(actionOrKey = "", record = {}, index = 0) {
    const action = findAction(actionOrKey);
    if (!action || typeof action.run !== "function" || isActionDisabled(action, record, index)) {
      return null;
    }

    const executionKey = createExecutionKey(action.key, getRecordId(record, index), index);
    executingKeys.value = [...executingKeys.value, executionKey];
    try {
      return await action.run(createActionContext(action, record, index));
    } finally {
      executingKeys.value = executingKeys.value.filter((key) => key !== executionKey);
    }
  }

  return Object.freeze({
    actions: normalizedActions,
    hasActions,
    executingKeys,
    getRecordId,
    findAction,
    isActionVisible,
    isActionDisabled,
    isActionLoading,
    isActionExecuting,
    visibleActionsFor,
    hasVisibleActionsFor,
    execute
  });
}

export { useCrudListRowActions };
