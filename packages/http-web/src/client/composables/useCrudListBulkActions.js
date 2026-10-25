import { computed, ref } from "vue";
import { defineCrudListBulkActions } from "../bulkActions.js";
import {
  normalizeListActionKey,
  resolveListActionBaseContext,
  resolveListRecordId
} from "../support/crudListActionSupport.js";

function useCrudListBulkActions(actions = [], {
  resolveRecordId = null,
  resolveContext = null
} = {}) {
  const normalizedActions = defineCrudListBulkActions(actions);
  const selectedIds = ref([]);
  const selectedRecordMap = new Map();
  const executingActionKey = ref("");

  const selectedCount = computed(() => selectedIds.value.length);
  const hasSelection = computed(() => selectedCount.value > 0);
  const hasActions = computed(() => normalizedActions.length > 0);

  function getRecordId(record = {}, index = 0) {
    return resolveListRecordId(record, index, resolveRecordId);
  }

  function setRecordSelected(record = {}, index = 0, selected = true) {
    const recordId = getRecordId(record, index);
    if (!recordId) {
      return;
    }

    const nextIds = new Set(selectedIds.value);
    if (selected) {
      nextIds.add(recordId);
      selectedRecordMap.set(recordId, record);
    } else {
      nextIds.delete(recordId);
      selectedRecordMap.delete(recordId);
    }

    selectedIds.value = Array.from(nextIds);
  }

  function isRecordSelected(record = {}, index = 0) {
    const recordId = getRecordId(record, index);
    return recordId ? selectedIds.value.includes(recordId) : false;
  }

  function setVisibleSelected(records = [], selected = true) {
    for (const [index, record] of (Array.isArray(records) ? records : []).entries()) {
      setRecordSelected(record, index, selected);
    }
  }

  function allVisibleSelected(records = []) {
    const visibleRecords = Array.isArray(records) ? records : [];
    return visibleRecords.length > 0 && visibleRecords.every((record, index) => isRecordSelected(record, index));
  }

  function someVisibleSelected(records = []) {
    return (Array.isArray(records) ? records : []).some((record, index) => isRecordSelected(record, index));
  }

  function clearSelection() {
    selectedIds.value = [];
    selectedRecordMap.clear();
  }

  function findAction(actionOrKey = "") {
    const actionKey = normalizeListActionKey(actionOrKey);
    return normalizedActions.find((action) => action.key === actionKey) || null;
  }

  function isActionExecuting(actionOrKey = "") {
    const actionKey = normalizeListActionKey(actionOrKey);
    return Boolean(actionKey && executingActionKey.value === actionKey);
  }

  function isActionDisabled(actionOrKey = "") {
    const action = findAction(actionOrKey);
    if (!action || !hasSelection.value || executingActionKey.value) {
      return true;
    }
    if (typeof action.disabled === "function") {
      return Boolean(action.disabled({
        selectedIds: selectedIds.value.slice(),
        selectedRecords: Array.from(selectedRecordMap.values()),
        action
      }));
    }
    return Boolean(action.disabled);
  }

  async function execute(actionOrKey = "") {
    const action = findAction(actionOrKey);
    if (!action || typeof action.run !== "function" || isActionDisabled(action)) {
      return null;
    }

    executingActionKey.value = action.key;
    try {
      return await action.run({
        ...resolveListActionBaseContext(resolveContext),
        action,
        ids: selectedIds.value.slice(),
        selectedIds: selectedIds.value.slice(),
        selectedRecords: Array.from(selectedRecordMap.values()),
        clearSelection
      });
    } finally {
      executingActionKey.value = "";
    }
  }

  return Object.freeze({
    actions: normalizedActions,
    selectedIds,
    selectedCount,
    hasActions,
    hasSelection,
    executingActionKey,
    setRecordSelected,
    isRecordSelected,
    setVisibleSelected,
    allVisibleSelected,
    someVisibleSelected,
    clearSelection,
    findAction,
    isActionDisabled,
    isActionExecuting,
    execute
  });
}

export { useCrudListBulkActions };
