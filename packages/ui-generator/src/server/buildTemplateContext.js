import path from "node:path";
import { pathToFileURL } from "node:url";

const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DATE_FORMATS = new Set(["date", "date-time", "time"]);
const ALLOWED_OPERATIONS = new Set(["list", "view", "new", "edit"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function requireOption(options, optionName) {
  const value = normalizeText(options?.[optionName]);
  if (!value) {
    throw new Error(`ui-generator requires option "${optionName}".`);
  }

  return value;
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

function resolveResourceModulePath(appRoot, resourceFile) {
  const normalizedFile = normalizeText(resourceFile);
  if (!normalizedFile) {
    throw new Error('ui-generator requires option "resource-file".');
  }
  if (path.isAbsolute(normalizedFile)) {
    throw new Error('ui-generator option "resource-file" must be a path relative to app root.');
  }

  const appRootAbsolute = path.resolve(String(appRoot || ""));
  if (!appRootAbsolute) {
    throw new Error("ui-generator template context requires appRoot.");
  }

  const absolutePath = path.resolve(appRootAbsolute, normalizedFile);
  const relativePath = path.relative(appRootAbsolute, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('ui-generator option "resource-file" must stay within app root.');
  }

  return absolutePath;
}

async function loadResourceDefinition({ appRoot, options }) {
  const resourceFile = requireOption(options, "resource-file");
  const resourceExport = normalizeText(options?.["resource-export"]) || "crudResource";
  const resourceModulePath = resolveResourceModulePath(appRoot, resourceFile);

  let moduleNamespace = null;
  try {
    moduleNamespace = await import(`${pathToFileURL(resourceModulePath).href}?t=${Date.now()}_${Math.random()}`);
  } catch (error) {
    throw new Error(
      `ui-generator could not load resource file "${resourceFile}": ${String(error?.message || error || "unknown error")}`
    );
  }

  const resource = moduleNamespace?.[resourceExport];
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new Error(
      `ui-generator could not find resource export "${resourceExport}" in "${resourceFile}".`
    );
  }

  return resource;
}

function requireOperation(resource, operationName) {
  const operations = resource?.operations;
  if (!operations || typeof operations !== "object" || Array.isArray(operations)) {
    throw new Error("ui-generator resource must expose operations.");
  }

  const operation = operations[operationName];
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Error(`ui-generator resource is missing operations.${operationName}.`);
  }

  return operation;
}

function requireOutputSchema(operation, operationName) {
  const outputValidator = operation?.outputValidator;
  if (!outputValidator || typeof outputValidator !== "object" || Array.isArray(outputValidator)) {
    throw new Error(`ui-generator resource operations.${operationName} is missing outputValidator.`);
  }

  const schema = outputValidator.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`ui-generator resource operations.${operationName}.outputValidator is missing schema.`);
  }

  return schema;
}

function requireBodySchema(operation, operationName) {
  const bodyValidator = operation?.bodyValidator;
  if (!bodyValidator || typeof bodyValidator !== "object" || Array.isArray(bodyValidator)) {
    throw new Error(`ui-generator resource operations.${operationName} is missing bodyValidator.`);
  }

  const schema = bodyValidator.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`ui-generator resource operations.${operationName}.bodyValidator is missing schema.`);
  }

  return schema;
}

function requireObjectProperties(schema, contextLabel) {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error(`ui-generator expected ${contextLabel} to be an object schema with properties.`);
  }

  return properties;
}

function resolveListItemProperties(listOutputSchema) {
  const listProperties = requireObjectProperties(listOutputSchema, "operations.list output");
  const itemsSchema = listProperties.items;
  if (!itemsSchema || typeof itemsSchema !== "object" || Array.isArray(itemsSchema)) {
    throw new Error("ui-generator expected operations.list output schema to include object items schema.");
  }

  const itemSchema = Array.isArray(itemsSchema.items) ? itemsSchema.items[0] : itemsSchema.items;
  if (!itemSchema || typeof itemSchema !== "object" || Array.isArray(itemSchema)) {
    throw new Error("ui-generator expected operations.list output schema items.items to be an object schema.");
  }

  return requireObjectProperties(itemSchema, "operations.list output items");
}

function resolveSchemaType(schema) {
  const source = schema && typeof schema === "object" && !Array.isArray(schema) ? schema : {};
  const rawType = source.type;
  const normalizedType = Array.isArray(rawType)
    ? normalizeText(rawType.find((entry) => normalizeText(entry).toLowerCase() !== "null"))
    : normalizeText(rawType);

  return {
    type: normalizedType.toLowerCase(),
    format: normalizeText(source.format).toLowerCase(),
    schema: source
  };
}

function toFieldLabel(key) {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) {
    return "Field";
  }

  const words = normalizedKey
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .split(/\s+/)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
  if (words.length < 1) {
    return "Field";
  }

  return words
    .map((entry) => `${entry.slice(0, 1).toUpperCase()}${entry.slice(1)}`)
    .join(" ");
}

function createFieldDefinitions(properties = {}) {
  const fields = [];

  for (const [rawKey, schema] of Object.entries(properties)) {
    const key = normalizeText(rawKey);
    if (!key) {
      continue;
    }

    const schemaType = resolveSchemaType(schema);
    fields.push({
      key,
      label: toFieldLabel(key),
      type: schemaType.type,
      format: schemaType.format
    });
  }

  if (fields.length > 0) {
    return fields;
  }

  return [
    {
      key: "id",
      label: "Id",
      type: "string",
      format: ""
    }
  ];
}

function toAccessorExpression(baseName, fieldKey) {
  const key = normalizeText(fieldKey);
  if (!key) {
    return baseName;
  }
  if (JS_IDENTIFIER_PATTERN.test(key)) {
    return `${baseName}.${key}`;
  }

  return `${baseName}[${JSON.stringify(key)}]`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildListHeaderColumns(fields) {
  return fields
    .map((field) => `                <th>${escapeHtml(field.label)}</th>`)
    .join("\n");
}

function buildListRowColumns(fields) {
  return fields
    .map(
      (field) =>
        `                <td>{{ ${toAccessorExpression("record", field.key)} }}</td>`
    )
    .join("\n");
}

function buildViewColumns(fields) {
  return fields
    .map(
      (field) => `            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">${escapeHtml(field.label)}</div>
              <div class="text-body-1">{{ ${toAccessorExpression("record", field.key)} }}</div>
            </v-col>`
    )
    .join("\n");
}

function resolveRecordChangedEventName(namespace = "") {
  const normalizedNamespace = normalizeText(namespace).toLowerCase();
  if (!normalizedNamespace) {
    return "";
  }

  return `${normalizedNamespace.replace(/-/g, "_")}.record.changed`;
}

function resolveRecordIdExpression(fields) {
  const normalizedFields = Array.isArray(fields) ? fields : [];
  const preferred =
    normalizedFields.find((field) => normalizeText(field?.key).toLowerCase() === "id") ||
    normalizedFields.find((field) => {
      const key = normalizeText(field?.key).toLowerCase();
      return key.endsWith("id") || key.endsWith("_id") || key.endsWith("-id");
    }) ||
    normalizedFields[0] ||
    { key: "id" };

  return toAccessorExpression("item", preferred.key);
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
  return availableFields.filter((field) => selectedFieldSet.has(normalizeText(field?.key)));
}

function resolveFormInputType(fieldType, fieldFormat) {
  if (fieldType === "integer" || fieldType === "number") {
    return "number";
  }

  if (DATE_FORMATS.has(fieldFormat)) {
    return "date";
  }

  return "text";
}

function resolveFormFieldComponent(fieldType) {
  if (fieldType === "boolean") {
    return "switch";
  }

  return "text";
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function createFormFieldDefinitions(properties = {}) {
  const fields = [];

  for (const [rawKey, schema] of Object.entries(properties)) {
    const key = normalizeText(rawKey);
    if (!key) {
      continue;
    }

    const schemaType = resolveSchemaType(schema);
    fields.push({
      key,
      label: toFieldLabel(key),
      type: schemaType.type || "string",
      format: schemaType.format || "",
      inputType: resolveFormInputType(schemaType.type, schemaType.format),
      component: resolveFormFieldComponent(schemaType.type),
      maxLength: toPositiveInteger(schemaType.schema?.maxLength)
    });
  }

  return fields;
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

  const resource = await loadResourceDefinition({ appRoot, options });

  let listFieldsAll = [];
  if (hasListOperation) {
    const listOperation = requireOperation(resource, "list");
    const listOutputSchema = requireOutputSchema(listOperation, "list");
    listFieldsAll = createFieldDefinitions(resolveListItemProperties(listOutputSchema));
    validateDisplayFieldsForOperation(selectedDisplayFields, listFieldsAll, "list");
  }

  let viewFieldsAll = [];
  if (hasViewOperation) {
    const viewOperation = requireOperation(resource, "view");
    const viewOutputSchema = requireOutputSchema(viewOperation, "view");
    viewFieldsAll = createFieldDefinitions(requireObjectProperties(viewOutputSchema, "operations.view output"));
    validateDisplayFieldsForOperation(selectedDisplayFields, viewFieldsAll, "view");
  }

  let createFieldsAll = [];
  if (hasNewOperation) {
    const createOperation = requireOperation(resource, "create");
    const createBodySchema = requireBodySchema(createOperation, "create");
    createFieldsAll = createFormFieldDefinitions(requireObjectProperties(createBodySchema, "operations.create body"));
    validateDisplayFieldsForOperation(selectedDisplayFields, createFieldsAll, "create");
  }

  let editFieldsAll = [];
  if (hasEditOperation) {
    const patchOperation = requireOperation(resource, "patch");
    const patchBodySchema = requireBodySchema(patchOperation, "patch");
    editFieldsAll = createFormFieldDefinitions(requireObjectProperties(patchBodySchema, "operations.patch body"));
    validateDisplayFieldsForOperation(selectedDisplayFields, editFieldsAll, "patch");
  }

  const listFields = hasListOperation
    ? filterDisplayFields(selectedDisplayFields, ensureFields(listFieldsAll))
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

  return {
    __JSKIT_UI_LIST_HEADER_COLUMNS__: buildListHeaderColumns(listFields),
    __JSKIT_UI_LIST_ROW_COLUMNS__: buildListRowColumns(listFields),
    __JSKIT_UI_LIST_DATA_COLUMN_COUNT__: String(Math.max(listFields.length, 1)),
    __JSKIT_UI_LIST_RECORD_ID_EXPR__: resolveRecordIdExpression(recordIdFields),
    __JSKIT_UI_VIEW_COLUMNS__: buildViewColumns(viewFields),
    __JSKIT_UI_RECORD_CHANGED_EVENT__: JSON.stringify(resolveRecordChangedEventName(resourceNamespace)),
    __JSKIT_UI_HAS_LIST_ROUTE__: hasListOperation ? "true" : "false",
    __JSKIT_UI_HAS_VIEW_ROUTE__: hasViewOperation ? "true" : "false",
    __JSKIT_UI_HAS_NEW_ROUTE__: hasNewOperation ? "true" : "false",
    __JSKIT_UI_HAS_EDIT_ROUTE__: hasEditOperation ? "true" : "false",
    __JSKIT_UI_CREATE_FORM_FIELDS__: JSON.stringify(createFields),
    __JSKIT_UI_EDIT_FORM_FIELDS__: JSON.stringify(editFields)
  };
}

export { buildUiTemplateContext };
