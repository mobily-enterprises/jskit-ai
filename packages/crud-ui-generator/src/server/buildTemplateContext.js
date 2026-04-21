import {
  requireCrudNamespace
} from "@jskit-ai/crud-core/shared/crudNamespaceSupport";
import {
  normalizePagesRelativeTargetRoot,
  resolvePageLinkTargetDetails,
  resolvePageTargetDetails
} from "@jskit-ai/kernel/server/support";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
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
  resolveRecordIdFieldKey,
  renderObjectPushLines,
  resolveRecordChangedEventName,
  resolveRecordIdExpression
} from "./resourceSupport.js";
import descriptor from "../../package.descriptor.mjs";

const DEFAULT_ALLOWED_OPERATIONS = Object.freeze(["list", "view", "new", "edit"]);
function resolveAllowedValues(schema = {}, fallbackValues = []) {
  const resolvedValues = [];
  const seen = new Set();
  for (const rawValue of Array.isArray(schema?.allowedValues) ? schema.allowedValues : []) {
    const value = normalizeText(typeof rawValue === "string" ? rawValue : rawValue?.value).toLowerCase();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    resolvedValues.push(value);
  }
  if (resolvedValues.length > 0) {
    return Object.freeze(resolvedValues);
  }
  return Object.freeze(
    (Array.isArray(fallbackValues) ? fallbackValues : [])
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean)
  );
}

const OPERATION_VALUES = resolveAllowedValues(descriptor?.options?.operations, DEFAULT_ALLOWED_OPERATIONS);
const ALLOWED_OPERATIONS = new Set(OPERATION_VALUES);
const DEFAULT_OPERATIONS = normalizeText(descriptor?.options?.operations?.defaultValue) || OPERATION_VALUES.join(",");
const DEFAULT_LIST_HIDDEN_FIELD_KEYS = new Set(["createdAt", "updatedAt"]);
const DEFAULT_FORM_COMPONENT_FILE = "CrudAddEditForm.vue";
const DEFAULT_FORM_FIELDS_FILE = "CrudAddEditFormFields.js";

function splitTextIntoWords(value = "") {
  const normalized = String(value || "")
    .replace(/^\[|\]$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s+/)
    .map((entry) => entry.toLowerCase())
    .filter(Boolean);
}

function wordsToKebab(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((entry) => String(entry || "").toLowerCase())
    .filter(Boolean)
    .join("-");
}

function wordsToTitle(words = []) {
  return (Array.isArray(words) ? words : [])
    .map((entry) => {
      const value = String(entry || "").toLowerCase();
      if (!value) {
        return "";
      }
      return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
    })
    .filter(Boolean)
    .join(" ");
}

function toSingularKebab(value = "") {
  const words = splitTextIntoWords(value);
  if (words.length < 1) {
    return "";
  }

  const nextWords = [...words];
  const lastIndex = nextWords.length - 1;
  const last = nextWords[lastIndex];
  if (last.endsWith("ies") && last.length > 3) {
    nextWords[lastIndex] = `${last.slice(0, -3)}y`;
  } else if (last.endsWith("sses") && last.length > 4) {
    nextWords[lastIndex] = last.slice(0, -2);
  } else if (last.endsWith("s") && !last.endsWith("ss") && last.length > 1) {
    nextWords[lastIndex] = last.slice(0, -1);
  }

  return wordsToKebab(nextWords);
}

function toPluralKebab(value = "") {
  const words = splitTextIntoWords(value);
  if (words.length < 1) {
    return "";
  }

  const nextWords = [...words];
  const lastIndex = nextWords.length - 1;
  const last = nextWords[lastIndex];
  if (last.endsWith("s")) {
    return wordsToKebab(nextWords);
  }
  if (/(x|z|ch|sh)$/i.test(last)) {
    nextWords[lastIndex] = `${last}es`;
  } else if (last.endsWith("y") && !/[aeiou]y$/i.test(last)) {
    nextWords[lastIndex] = `${last.slice(0, -1)}ies`;
  } else {
    nextWords[lastIndex] = `${last}s`;
  }

  return wordsToKebab(nextWords);
}

function toTitleFromKebab(value = "", fallback = "") {
  const words = splitTextIntoWords(value);
  if (words.length < 1) {
    return fallback;
  }
  return wordsToTitle(words);
}

function normalizeRelativeAppPath(value = "") {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "")
    .trim();
}

function requireTargetRootOption(options = {}) {
  const normalizedTargetRoot = normalizeRelativeAppPath(options?.["target-root"]);
  if (!normalizedTargetRoot) {
    throw new Error('crud-ui-generator requires option "target-root".');
  }
  return normalizePagesRelativeTargetRoot(normalizedTargetRoot, {
    context: "crud-ui-generator",
    label: 'option "target-root"'
  }).slice("src/pages/".length);
}

function resolveListTargetFile(targetRoot = "") {
  return `${normalizeRelativeAppPath(targetRoot)}/index.vue`;
}

function parseOperationsOption(options) {
  const rawValue = normalizeText(options?.operations) || DEFAULT_OPERATIONS;

  const operations = rawValue
    .split(",")
    .map((entry) => normalizeText(entry).toLowerCase())
    .filter(Boolean);
  if (operations.length < 1) {
    throw new Error('crud-ui-generator option "operations" must include at least one value: list, view, new, or edit.');
  }

  const unique = new Set();
  for (const operation of operations) {
    if (!ALLOWED_OPERATIONS.has(operation)) {
      throw new Error(`crud-ui-generator option "operations" supports only: ${OPERATION_VALUES.join(", ")}.`);
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
    throw new Error('crud-ui-generator option "display-fields" must include at least one field key.');
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
    `crud-ui-generator option "display-fields" includes unsupported field(s) for operations.${operationName}: ${invalidFieldKeys.join(", ")}.`
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

function hasLookupFormFields(fields = []) {
  return (Array.isArray(fields) ? fields : []).some((field) => normalizeText(field?.component).toLowerCase() === "lookup");
}

function buildLookupImportLine(fields = []) {
  return hasLookupFormFields(fields)
    ? 'import { createCrudLookupFieldRuntime } from "@jskit-ai/users-web/client/composables/crudLookupFieldRuntime";'
    : "";
}

function buildLookupRuntimeSetup(fields = [], {
  formFieldsVariable = "",
  resourceNamespace = "",
  mode = ""
} = {}) {
  if (!hasLookupFormFields(fields)) {
    return "";
  }

  const normalizedFormFieldsVariable = normalizeText(formFieldsVariable) || "UI_FORM_FIELDS";
  const normalizedResourceNamespace = normalizeText(resourceNamespace) || "resource";
  const normalizedMode = normalizeText(mode) || "new";

  return `const lookupFieldRuntime = createCrudLookupFieldRuntime({
  formFields: ${normalizedFormFieldsVariable},
  adapter: UI_OPERATION_ADAPTER || undefined,
  recordIdParam: UI_RECORD_ID_PARAM,
  lookupContainerKey: uiResource?.contract?.lookup?.containerKey,
  queryKeyPrefix: ["ui-generator", "${normalizedResourceNamespace}", "lookup", "${normalizedMode}"],
  placementSourcePrefix: "ui-generator.${normalizedResourceNamespace}.${normalizedMode}.lookup"
});
const {
  resolveLookupItems,
  resolveLookupLoading,
  resolveLookupSearch,
  setLookupSearch
} = lookupFieldRuntime;
`;
}

function buildLookupFormProps(fields = []) {
  if (!hasLookupFormFields(fields)) {
    return "";
  }

  return `    :resolve-lookup-items="resolveLookupItems"
    :resolve-lookup-loading="resolveLookupLoading"
    :resolve-lookup-search="resolveLookupSearch"
    :set-lookup-search="setLookupSearch"`;
}

function filterDefaultHiddenListFields(selectedFieldKeys, fields, { recordIdFieldKey = "" } = {}) {
  const selectedFields = Array.isArray(selectedFieldKeys) ? selectedFieldKeys : [];
  const availableFields = Array.isArray(fields) ? fields : [];
  if (selectedFields.length > 0) {
    return availableFields;
  }

  const hiddenFieldKeys = new Set(DEFAULT_LIST_HIDDEN_FIELD_KEYS);
  const normalizedRecordIdFieldKey = normalizeText(recordIdFieldKey);
  if (normalizedRecordIdFieldKey) {
    hiddenFieldKeys.add(normalizedRecordIdFieldKey);
  }

  return availableFields.filter((field) => !hiddenFieldKeys.has(normalizeText(field?.key)));
}

function ensureFields(fields, fallbackFields = createFieldDefinitions({})) {
  const normalizedFields = Array.isArray(fields) ? fields : [];
  if (normalizedFields.length > 0) {
    return normalizedFields;
  }

  return fallbackFields;
}

function resolveViewTitleFallbackFieldKey(fields = []) {
  const sourceFields = Array.isArray(fields) ? fields : [];
  for (const field of sourceFields) {
    if (normalizeText(field?.type).toLowerCase() !== "string") {
      continue;
    }

    const key = normalizeText(field?.key);
    if (key) {
      return key;
    }
  }

  return "";
}

function resolveResourceNamespace(resource = {}, pageTarget = {}, options = {}) {
  const explicitNamespace = normalizeText(options?.namespace).toLowerCase();
  if (explicitNamespace) {
    return explicitNamespace;
  }

  const resourceNamespace = normalizeText(resource?.namespace).toLowerCase();
  if (resourceNamespace) {
    return resourceNamespace;
  }

  const pageLeafNamespace = normalizeText(pageTarget?.pageLeafSegment).toLowerCase();
  if (pageLeafNamespace) {
    return pageLeafNamespace;
  }

  return "crud";
}

function resolveResourceLabels(namespace = "", pageTarget = {}) {
  const basePlural = toPluralKebab(namespace || pageTarget?.pageLeafSegment || "records") || "records";
  const singularSlug = toSingularKebab(basePlural) || "record";
  const pluralSlug = toPluralKebab(basePlural) || "records";

  return Object.freeze({
    singularSlug,
    pluralSlug,
    singularTitle: toTitleFromKebab(singularSlug, "Record"),
    pluralTitle: toTitleFromKebab(pluralSlug, "Records")
  });
}

function resolveTargetRootRelativeRoutePath(pageTarget = {}) {
  const visibleRouteSegments = Array.isArray(pageTarget?.visibleRouteSegments)
    ? pageTarget.visibleRouteSegments
    : [];
  return visibleRouteSegments.length > 0 ? `/${visibleRouteSegments.join("/")}` : "/";
}

function resolveMenuToPropLine(linkTo = "") {
  if (!linkTo) {
    return "";
  }
  return `      to: ${JSON.stringify(linkTo)},\n`;
}

function resolveCrudRelativePath(namespace = "") {
  return `/${requireCrudNamespace(namespace, {
    context: "crud-ui-generator resource namespace"
  })}`;
}

async function buildUiTemplateContext({ appRoot, options } = {}) {
  const targetRoot = requireTargetRootOption(options);
  const listTargetFile = resolveListTargetFile(targetRoot);
  const selectedOperations = parseOperationsOption(options);
  const selectedDisplayFields = parseDisplayFieldsOption(options);
  const pageTarget = await resolvePageTargetDetails({
    appRoot,
    targetFile: listTargetFile,
    context: "crud-ui-generator"
  });
  const resource = await loadResourceDefinition({ appRoot, options, context: "crud-ui-generator" });
  const resourceNamespace = resolveResourceNamespace(resource, pageTarget, options);
  const resourceLabels = resolveResourceLabels(resourceNamespace, pageTarget);
  const apiBasePath = resolveCrudRelativePath(resourceNamespace);
  const defaultRecordChangedEvent = resolveRecordChangedEventName(resourceNamespace);
  const parentRouteParamKey = resolveNearestParentRouteParamKey(resolveTargetRootRelativeRoutePath(pageTarget), {
    recordIdParam: options?.["id-param"]
  });
  const lookupContainerKey = resolveLookupContainerKey(resource, {
    context: "crud-ui-generator"
  });
  const fieldMetaMap = buildResourceFieldMetaMap(resource);

  const hasListOperation = selectedOperations.has("list");
  const hasViewOperation = selectedOperations.has("view");
  const hasNewOperation = selectedOperations.has("new");
  const hasEditOperation = selectedOperations.has("edit");

  let listRealtimeEvents = [defaultRecordChangedEvent];
  let listFieldsAll = [];
  if (hasListOperation) {
    const listOperation = requireOperation(resource, "list", { context: "crud-ui-generator" });
    const listOutputSchema = requireOutputSchema(listOperation, "list", { context: "crud-ui-generator" });
    listRealtimeEvents = resolveOperationRealtimeEvents(listOperation, {
      defaultEvents: [defaultRecordChangedEvent],
      context: "crud-ui-generator operations.list.realtime"
    });
    listFieldsAll = createFieldDefinitions(resolveListItemProperties(listOutputSchema, { context: "crud-ui-generator" }), {
      fieldMetaMap,
      lookupContainerKey
    });
    validateDisplayFieldsForOperation(selectedDisplayFields, listFieldsAll, "list");
  }

  let viewFieldsAll = [];
  if (hasViewOperation) {
    const viewOperation = requireOperation(resource, "view", { context: "crud-ui-generator" });
    const viewOutputSchema = requireOutputSchema(viewOperation, "view", { context: "crud-ui-generator" });
    viewFieldsAll = createFieldDefinitions(
      requireObjectProperties(viewOutputSchema, "operations.view output", { context: "crud-ui-generator" }),
      {
        fieldMetaMap,
        lookupContainerKey
      }
    );
    validateDisplayFieldsForOperation(selectedDisplayFields, viewFieldsAll, "view");
  }

  let createFieldsAll = [];
  if (hasNewOperation) {
    const createOperation = requireOperation(resource, "create", { context: "crud-ui-generator" });
    const createBodySchema = requireBodySchema(createOperation, "create", { context: "crud-ui-generator" });
    createFieldsAll = createFormFieldDefinitions(
      requireObjectProperties(createBodySchema, "operations.create body", { context: "crud-ui-generator" }),
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
    const patchOperation = requireOperation(resource, "patch", { context: "crud-ui-generator" });
    const patchBodySchema = requireBodySchema(patchOperation, "patch", { context: "crud-ui-generator" });
    editFieldsAll = createFormFieldDefinitions(
      requireObjectProperties(patchBodySchema, "operations.patch body", { context: "crud-ui-generator" }),
      {
        fieldMetaMap,
        lookupContainerKey,
        parentRouteParamKey
      }
    );
    validateDisplayFieldsForOperation(selectedDisplayFields, editFieldsAll, "patch");
  }

  const listRecordIdFieldKey = hasListOperation
    ? resolveRecordIdFieldKey(listFieldsAll)
    : "";

  const listFields = hasListOperation
    ? filterDisplayFields(
      selectedDisplayFields,
      filterDefaultHiddenListFields(selectedDisplayFields, ensureFields(listFieldsAll), {
        recordIdFieldKey: listRecordIdFieldKey
      })
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
  const viewTitleFallbackFieldKey = hasViewOperation
    ? resolveViewTitleFallbackFieldKey(viewFieldsAll)
    : "";
  const recordIdFields =
    listFieldsAll.length > 0
      ? listFieldsAll
      : viewFieldsAll.length > 0
        ? viewFieldsAll
        : editFieldsAll.length > 0
          ? editFieldsAll
          : createFieldDefinitions({});

  const pageLinkTarget = hasListOperation
    ? await resolvePageLinkTargetDetails({
      appRoot,
      pageTarget,
      targetFile: listTargetFile,
      placement: options?.["link-placement"],
      componentToken: options?.["link-component-token"],
      context: "crud-ui-generator"
    })
    : null;
  const menuMarker = hasListOperation
    ? `jskit:crud-ui-generator.page.link:${pageTarget.surfaceId}:${pageTarget.routeUrlSuffix}`
    : "";

  return {
    __JSKIT_UI_RESOURCE_IMPORT_PATH__: `/${normalizeRelativeAppPath(options?.["resource-file"])}`,
    __JSKIT_UI_RECORD_ID_PARAM__: normalizeText(options?.["id-param"]) || "recordId",
    __JSKIT_UI_API_BASE_URL__: apiBasePath,
    __JSKIT_UI_RESOURCE_NAMESPACE__: resourceNamespace,
    __JSKIT_UI_RESOURCE_SINGULAR_TITLE__: resourceLabels.singularTitle,
    __JSKIT_UI_RESOURCE_PLURAL_TITLE__: resourceLabels.pluralTitle,
    __JSKIT_UI_ROUTE_TITLE__: pageTarget.defaultName,
    __JSKIT_UI_FORM_COMPONENT_FILE__: DEFAULT_FORM_COMPONENT_FILE,
    __JSKIT_UI_FORM_FIELDS_FILE__: DEFAULT_FORM_FIELDS_FILE,
    __JSKIT_UI_SURFACE_ID__: pageTarget.surfaceId,
    __JSKIT_UI_LIST_HEADER_COLUMNS__: buildListHeaderColumns(listFields),
    __JSKIT_UI_LIST_ROW_COLUMNS__: buildListRowColumns(listFields),
    __JSKIT_UI_LIST_REALTIME_EVENTS__: JSON.stringify(listRealtimeEvents),
    __JSKIT_UI_LIST_RECORD_ID_EXPR__: resolveRecordIdExpression(recordIdFields),
    __JSKIT_UI_VIEW_COLUMNS__: buildViewColumns(viewFields),
    __JSKIT_UI_VIEW_TITLE_FALLBACK_FIELD_KEY__: JSON.stringify(viewTitleFallbackFieldKey),
    __JSKIT_UI_RECORD_CHANGED_EVENT__: JSON.stringify(defaultRecordChangedEvent),
    __JSKIT_UI_HAS_LIST_ROUTE__: hasListOperation ? "true" : "false",
    __JSKIT_UI_HAS_VIEW_ROUTE__: hasViewOperation ? "true" : "false",
    __JSKIT_UI_HAS_NEW_ROUTE__: hasNewOperation ? "true" : "false",
    __JSKIT_UI_HAS_EDIT_ROUTE__: hasEditOperation ? "true" : "false",
    __JSKIT_UI_LIST_PAGE_VIEW_URL__: JSON.stringify(hasViewOperation ? `./:${normalizeText(options?.["id-param"]) || "recordId"}` : ""),
    __JSKIT_UI_LIST_PAGE_EDIT_URL__: JSON.stringify(hasEditOperation ? `./:${normalizeText(options?.["id-param"]) || "recordId"}/edit` : ""),
    __JSKIT_UI_LIST_PAGE_NEW_URL__: JSON.stringify(hasNewOperation ? "./new" : ""),
    __JSKIT_UI_NEW_PAGE_LIST_URL__: JSON.stringify(hasListOperation ? ".." : ""),
    __JSKIT_UI_NEW_PAGE_VIEW_URL__: JSON.stringify(hasViewOperation ? `../:${normalizeText(options?.["id-param"]) || "recordId"}` : ""),
    __JSKIT_UI_EDIT_PAGE_LIST_URL__: JSON.stringify(hasListOperation ? "../.." : ""),
    __JSKIT_UI_EDIT_PAGE_VIEW_URL__: JSON.stringify(hasViewOperation ? ".." : ""),
    __JSKIT_UI_VIEW_PAGE_LIST_URL__: JSON.stringify(hasListOperation ? ".." : ""),
    __JSKIT_UI_VIEW_PAGE_EDIT_URL__: JSON.stringify(hasEditOperation ? "./edit" : ""),
    __JSKIT_UI_CREATE_FORM_COLUMNS__: buildFormColumns(createFields),
    __JSKIT_UI_EDIT_FORM_COLUMNS__: buildFormColumns(editFields),
    __JSKIT_UI_CREATE_FORM_FIELDS__: JSON.stringify(createFields),
    __JSKIT_UI_EDIT_FORM_FIELDS__: JSON.stringify(editFields),
    __JSKIT_UI_CREATE_FORM_FIELD_PUSH_LINES__: renderObjectPushLines("UI_CREATE_FORM_FIELDS", createFields),
    __JSKIT_UI_EDIT_FORM_FIELD_PUSH_LINES__: renderObjectPushLines("UI_EDIT_FORM_FIELDS", editFields),
    __JSKIT_UI_CREATE_LOOKUP_IMPORT_LINE__: buildLookupImportLine(createFields),
    __JSKIT_UI_EDIT_LOOKUP_IMPORT_LINE__: buildLookupImportLine(editFields),
    __JSKIT_UI_CREATE_LOOKUP_RUNTIME_SETUP__: buildLookupRuntimeSetup(createFields, {
      formFieldsVariable: "UI_CREATE_FORM_FIELDS",
      resourceNamespace,
      mode: "new"
    }),
    __JSKIT_UI_EDIT_LOOKUP_RUNTIME_SETUP__: buildLookupRuntimeSetup(editFields, {
      formFieldsVariable: "UI_EDIT_FORM_FIELDS",
      resourceNamespace,
      mode: "edit"
    }),
    __JSKIT_UI_CREATE_LOOKUP_FORM_PROPS__: buildLookupFormProps(createFields),
    __JSKIT_UI_EDIT_LOOKUP_FORM_PROPS__: buildLookupFormProps(editFields),
    __JSKIT_UI_MENU_MARKER__: menuMarker,
    __JSKIT_UI_MENU_PLACEMENT_ID__: String(pageLinkTarget?.pageTarget?.placementId || ""),
    __JSKIT_UI_MENU_PLACEMENT_TARGET__: String(pageLinkTarget?.placementTarget?.id || ""),
    __JSKIT_UI_MENU_COMPONENT_TOKEN__: String(pageLinkTarget?.componentToken || ""),
    __JSKIT_UI_MENU_WORKSPACE_SUFFIX__: String(pageLinkTarget?.pageTarget?.routeUrlSuffix || ""),
    __JSKIT_UI_MENU_NON_WORKSPACE_SUFFIX__: String(pageLinkTarget?.pageTarget?.routeUrlSuffix || ""),
    __JSKIT_UI_MENU_WHEN_LINE__: String(pageLinkTarget?.whenLine || ""),
    __JSKIT_UI_MENU_TO_PROP_LINE__: resolveMenuToPropLine(pageLinkTarget?.linkTo || ""),
    __JSKIT_UI_MENU_LABEL__: pageTarget.defaultName
  };
}

export { buildUiTemplateContext };
