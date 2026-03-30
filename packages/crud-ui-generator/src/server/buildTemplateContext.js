import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  discoverShellOutletTargetsFromVueSource,
  normalizeShellOutletTargetId
} from "@jskit-ai/kernel/shared/support/shellLayoutTargets";
import {
  normalizeText,
  requireOption,
  loadResourceDefinition,
  requireOperation,
  resolveOperationRealtimeEvents,
  requireOutputSchema,
  requireBodySchema,
  requireObjectProperties,
  resolveListItemProperties,
  resolveLookupContainerKey,
  buildResourceFieldMetaMap,
  createFieldDefinitions,
  createFormFieldDefinitions,
  resolveNearestParentRouteParamKey,
  buildListHeaderColumns,
  buildListRowColumns,
  buildViewColumns,
  buildFormColumns,
  renderObjectPushLines,
  resolveRecordChangedEventName,
  resolveRecordIdExpression
} from "./resourceSupport.js";

const ALLOWED_OPERATIONS = new Set(["list", "view", "new", "edit"]);
const DEFAULT_LIST_HIDDEN_FIELD_KEYS = new Set(["createdAt", "updatedAt"]);
const DEFAULT_SHELL_LAYOUT_FILE = "src/components/ShellLayout.vue";

function resolveMenuPlacementTargetById(targets = [], targetId = "") {
  const entries = Array.isArray(targets) ? targets : [];
  const normalizedTargetId = normalizeShellOutletTargetId(targetId);
  if (!normalizedTargetId) {
    return null;
  }

  return entries.find((entry) => normalizeShellOutletTargetId(entry?.id) === normalizedTargetId) || null;
}

function describeMenuPlacementTargets(targets = []) {
  return (Array.isArray(targets) ? targets : [])
    .map((entry) => normalizeShellOutletTargetId(entry?.id))
    .filter(Boolean)
    .join(", ");
}

async function resolveMenuPlacementTarget({ appRoot, options, hasListOperation } = {}) {
  if (hasListOperation !== true) {
    return null;
  }

  const routePath = normalizeText(options?.["route-path"]);
  if (!routePath || routePath.includes("[")) {
    return null;
  }

  const requestedPlacementOption = normalizeText(options?.placement);
  const requestedPlacementTargetId = normalizeShellOutletTargetId(requestedPlacementOption);
  if (requestedPlacementOption && !requestedPlacementTargetId) {
    throw new Error('ui-generator option "placement" must be in "host:position" format.');
  }

  const shellLayoutPath = path.join(String(appRoot || ""), DEFAULT_SHELL_LAYOUT_FILE);
  let shellLayoutSource = "";
  try {
    shellLayoutSource = await readFile(shellLayoutPath, "utf8");
  } catch {
    throw new Error(
      `ui-generator could not read ${DEFAULT_SHELL_LAYOUT_FILE}. ` +
      'Define ShellOutlet targets in ShellLayout.vue or pass "--placement host:position".'
    );
  }

  const discoveredTargets = discoverShellOutletTargetsFromVueSource(shellLayoutSource, {
    context: DEFAULT_SHELL_LAYOUT_FILE
  });
  const targets = Array.isArray(discoveredTargets.targets) ? discoveredTargets.targets : [];
  if (targets.length < 1) {
    throw new Error(
      `ui-generator could not find any <ShellOutlet host="..." position="..."> targets in ${DEFAULT_SHELL_LAYOUT_FILE}.`
    );
  }

  if (requestedPlacementTargetId) {
    const requestedTarget = resolveMenuPlacementTargetById(targets, requestedPlacementTargetId);
    if (!requestedTarget) {
      const availableTargets = describeMenuPlacementTargets(targets);
      throw new Error(
        `ui-generator option "placement" target "${requestedPlacementTargetId}" is not declared in ` +
        `${DEFAULT_SHELL_LAYOUT_FILE}. Available targets: ${availableTargets || "<none>"}.`
      );
    }
    return requestedTarget;
  }

  const defaultTarget = resolveMenuPlacementTargetById(targets, discoveredTargets.defaultTargetId);
  if (defaultTarget) {
    return defaultTarget;
  }

  const availableTargets = describeMenuPlacementTargets(targets);
  throw new Error(
    `ui-generator could not resolve a default ShellOutlet target from ${DEFAULT_SHELL_LAYOUT_FILE}. ` +
    `Set one outlet as default (e.g. <ShellOutlet host="shell-layout" position="primary-menu" default />) ` +
    `or pass "--placement host:position". Available targets: ${availableTargets || "<none>"}.`
  );
}

function parseOperationsOption(options) {
  const rawValue = requireOption(options, "operations");
  const operations = rawValue
    .split(",")
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);
  if (operations.length < 1) {
    throw new Error('ui-generator option "operations" must include at least one value: list, view, new, or edit.');
  }

  const unique = new Set();
  for (const operation of operations) {
    if (!ALLOWED_OPERATIONS.has(operation)) {
      throw new Error('ui-generator option "operations" supports only: list, view, new, edit.');
    }
    unique.add(operation);
  }

  return unique;
}

function parseDisplayFieldsOption(options) {
  const rawValue = normalizeText(options?.["display-fields"]);
  if (!rawValue) {
    return Object.freeze([]);
  }

  const fieldKeys = rawValue
    .split(",")
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
  if (fieldKeys.length < 1) {
    throw new Error('ui-generator option "display-fields" must include at least one field key.');
  }

  const unique = [];
  const seen = new Set();
  for (const fieldKey of fieldKeys) {
    if (seen.has(fieldKey)) {
      continue;
    }

    seen.add(fieldKey);
    unique.push(fieldKey);
  }

  return Object.freeze(unique);
}

function resolveResourceNamespaceOption(options = {}) {
  const rawApiPath = normalizeText(options?.["api-path"]);
  const apiPathSegments = rawApiPath
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .split("/")
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

  const apiPathNamespace = normalizeText(apiPathSegments[apiPathSegments.length - 1]);
  const fallbackNamespace = normalizeText(options?.namespace).toLowerCase();
  const resolvedNamespace = normalizeText(apiPathNamespace || fallbackNamespace || "crud").toLowerCase();
  if (!resolvedNamespace) {
    throw new Error('ui-generator could not resolve namespace from "api-path" or "namespace".');
  }

  return resolvedNamespace;
}

function validateDisplayFieldsForOperation(selectedFieldKeys, fields, operationName) {
  const selectedFields = Array.isArray(selectedFieldKeys) ? selectedFieldKeys : [];
  if (selectedFields.length < 1) {
    return;
  }

  const availableFieldKeys = new Set(
    (Array.isArray(fields) ? fields : [])
      .map((field) => normalizeText(field?.key))
      .filter(Boolean)
  );

  const invalidFieldKeys = selectedFields.filter((fieldKey) => !availableFieldKeys.has(fieldKey));
  if (invalidFieldKeys.length < 1) {
    return;
  }

  throw new Error(
    `ui-generator option "display-fields" includes unsupported field(s) for operations.${operationName}: ${invalidFieldKeys.join(", ")}.`
  );
}

function filterDisplayFields(selectedFieldKeys, fields) {
  const selectedFields = Array.isArray(selectedFieldKeys) ? selectedFieldKeys : [];
  const availableFields = Array.isArray(fields) ? fields : [];
  if (selectedFields.length < 1) {
    return availableFields;
  }

  const selectedFieldSet = new Set(selectedFields);
  return availableFields.filter((field) => {
    if (field?.hidden === true) {
      return true;
    }
    return selectedFieldSet.has(normalizeText(field?.key));
  });
}

function filterDefaultHiddenListFields(selectedFieldKeys, fields) {
  const selectedFields = Array.isArray(selectedFieldKeys) ? selectedFieldKeys : [];
  const availableFields = Array.isArray(fields) ? fields : [];
  if (selectedFields.length > 0) {
    return availableFields;
  }

  return availableFields.filter((field) => !DEFAULT_LIST_HIDDEN_FIELD_KEYS.has(normalizeText(field?.key)));
}

function ensureFields(fields, fallbackFields = createFieldDefinitions({})) {
  const normalizedFields = Array.isArray(fields) ? fields : [];
  if (normalizedFields.length > 0) {
    return normalizedFields;
  }

  return fallbackFields;
}

async function buildUiTemplateContext({ appRoot, options } = {}) {
  const selectedOperations = parseOperationsOption(options);
  const selectedDisplayFields = parseDisplayFieldsOption(options);
  const resourceNamespace = resolveResourceNamespaceOption(options);

  const hasListOperation = selectedOperations.has("list");
  const hasViewOperation = selectedOperations.has("view");
  const hasNewOperation = selectedOperations.has("new");
  const hasEditOperation = selectedOperations.has("edit");

  const resource = await loadResourceDefinition({ appRoot, options, context: "ui-generator" });
  const defaultRecordChangedEvent = resolveRecordChangedEventName(resourceNamespace);
  const parentRouteParamKey = resolveNearestParentRouteParamKey(options?.["route-path"], {
    recordIdParam: options?.["id-param"]
  });
  const lookupContainerKey = resolveLookupContainerKey(resource, {
    context: "ui-generator"
  });
  const fieldMetaMap = buildResourceFieldMetaMap(resource);
  let listRealtimeEvents = [defaultRecordChangedEvent];

  let listFieldsAll = [];
  if (hasListOperation) {
    const listOperation = requireOperation(resource, "list", { context: "ui-generator" });
    const listOutputSchema = requireOutputSchema(listOperation, "list", { context: "ui-generator" });
    listRealtimeEvents = resolveOperationRealtimeEvents(listOperation, {
      defaultEvents: [defaultRecordChangedEvent],
      context: "ui-generator operations.list.realtime"
    });
    listFieldsAll = createFieldDefinitions(resolveListItemProperties(listOutputSchema, { context: "ui-generator" }), {
      fieldMetaMap,
      lookupContainerKey
    });
    validateDisplayFieldsForOperation(selectedDisplayFields, listFieldsAll, "list");
  }

  let viewFieldsAll = [];
  if (hasViewOperation) {
    const viewOperation = requireOperation(resource, "view", { context: "ui-generator" });
    const viewOutputSchema = requireOutputSchema(viewOperation, "view", { context: "ui-generator" });
    viewFieldsAll = createFieldDefinitions(
      requireObjectProperties(viewOutputSchema, "operations.view output", { context: "ui-generator" }),
      {
        fieldMetaMap,
        lookupContainerKey
      }
    );
    validateDisplayFieldsForOperation(selectedDisplayFields, viewFieldsAll, "view");
  }

  let createFieldsAll = [];
  if (hasNewOperation) {
    const createOperation = requireOperation(resource, "create", { context: "ui-generator" });
    const createBodySchema = requireBodySchema(createOperation, "create", { context: "ui-generator" });
    createFieldsAll = createFormFieldDefinitions(
      requireObjectProperties(createBodySchema, "operations.create body", { context: "ui-generator" }),
      {
        fieldMetaMap,
        lookupContainerKey,
        parentRouteParamKey
      }
    );
    validateDisplayFieldsForOperation(selectedDisplayFields, createFieldsAll, "create");
  }

  let editFieldsAll = [];
  if (hasEditOperation) {
    const patchOperation = requireOperation(resource, "patch", { context: "ui-generator" });
    const patchBodySchema = requireBodySchema(patchOperation, "patch", { context: "ui-generator" });
    editFieldsAll = createFormFieldDefinitions(
      requireObjectProperties(patchBodySchema, "operations.patch body", { context: "ui-generator" }),
      {
        fieldMetaMap,
        lookupContainerKey,
        parentRouteParamKey
      }
    );
    validateDisplayFieldsForOperation(selectedDisplayFields, editFieldsAll, "patch");
  }

  const listFields = hasListOperation
    ? filterDisplayFields(
      selectedDisplayFields,
      filterDefaultHiddenListFields(selectedDisplayFields, ensureFields(listFieldsAll))
    )
    : createFieldDefinitions({});
  const viewFields = hasViewOperation
    ? filterDisplayFields(selectedDisplayFields, ensureFields(viewFieldsAll))
    : createFieldDefinitions({});
  const createFields = hasNewOperation
    ? filterDisplayFields(selectedDisplayFields, createFieldsAll)
    : [];
  const editFields = hasEditOperation
    ? filterDisplayFields(selectedDisplayFields, editFieldsAll)
    : [];

  const recordIdFields =
    listFieldsAll.length > 0
      ? listFieldsAll
      : viewFieldsAll.length > 0
        ? viewFieldsAll
        : editFieldsAll.length > 0
          ? editFieldsAll
          : createFieldDefinitions({});
  const menuPlacementTarget = await resolveMenuPlacementTarget({
    appRoot,
    options,
    hasListOperation
  });

  return {
    __JSKIT_UI_LIST_HEADER_COLUMNS__: buildListHeaderColumns(listFields),
    __JSKIT_UI_LIST_ROW_COLUMNS__: buildListRowColumns(listFields),
    __JSKIT_UI_LIST_REALTIME_EVENTS__: JSON.stringify(listRealtimeEvents),
    __JSKIT_UI_LIST_RECORD_ID_EXPR__: resolveRecordIdExpression(recordIdFields),
    __JSKIT_UI_VIEW_COLUMNS__: buildViewColumns(viewFields),
    __JSKIT_UI_RECORD_CHANGED_EVENT__: JSON.stringify(defaultRecordChangedEvent),
    __JSKIT_UI_HAS_LIST_ROUTE__: hasListOperation ? "true" : "false",
    __JSKIT_UI_HAS_VIEW_ROUTE__: hasViewOperation ? "true" : "false",
    __JSKIT_UI_HAS_NEW_ROUTE__: hasNewOperation ? "true" : "false",
    __JSKIT_UI_HAS_EDIT_ROUTE__: hasEditOperation ? "true" : "false",
    __JSKIT_UI_CREATE_FORM_COLUMNS__: buildFormColumns(createFields),
    __JSKIT_UI_EDIT_FORM_COLUMNS__: buildFormColumns(editFields),
    __JSKIT_UI_CREATE_FORM_FIELDS__: JSON.stringify(createFields),
    __JSKIT_UI_EDIT_FORM_FIELDS__: JSON.stringify(editFields),
    __JSKIT_UI_CREATE_FORM_FIELD_PUSH_LINES__: renderObjectPushLines("UI_CREATE_FORM_FIELDS", createFields),
    __JSKIT_UI_EDIT_FORM_FIELD_PUSH_LINES__: renderObjectPushLines("UI_EDIT_FORM_FIELDS", editFields),
    __JSKIT_UI_MENU_PLACEMENT_HOST__: normalizeText(menuPlacementTarget?.host),
    __JSKIT_UI_MENU_PLACEMENT_POSITION__: normalizeText(menuPlacementTarget?.position)
  };
}

export { buildUiTemplateContext };
