import path from "node:path";
import { pathToFileURL } from "node:url";

const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DATE_FORMATS = new Set(["date", "date-time", "time"]);
const ALLOWED_OPERATIONS = new Set(["list", "view"]);

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
    throw new Error('ui-generator option "operations" must include at least one value: list or view.');
  }

  const unique = new Set();
  for (const operation of operations) {
    if (!ALLOWED_OPERATIONS.has(operation)) {
      throw new Error(
        'ui-generator option "operations" supports only: list, view, list,view.'
      );
    }
    unique.add(operation);
  }

  return unique;
}

function resolveResourceModulePath(appRoot, resourceFile) {
  const normalizedFile = normalizeText(resourceFile);
  if (!normalizedFile) {
    throw new Error("ui-generator requires option \"resource-file\".");
  }
  if (path.isAbsolute(normalizedFile)) {
    throw new Error("ui-generator option \"resource-file\" must be a path relative to app root.");
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
    throw new Error("ui-generator option \"resource-file\" must stay within app root.");
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
  const type = normalizedType.toLowerCase();
  const format = normalizeText(source.format).toLowerCase();

  return {
    type,
    format
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

function stringifyLiteral(value) {
  return JSON.stringify(String(value || ""));
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
        `                <td>{{ formatFieldValue(${toAccessorExpression("record", field.key)}, ${stringifyLiteral(field.type)}, ${stringifyLiteral(field.format)}) }}</td>`
    )
    .join("\n");
}

function buildViewColumns(fields) {
  return fields
    .map(
      (field) => `            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">${escapeHtml(field.label)}</div>
              <div class="text-body-1">{{ formatFieldValue(${toAccessorExpression("record", field.key)}, ${stringifyLiteral(field.type)}, ${stringifyLiteral(field.format)}) }}</div>
            </v-col>`
    )
    .join("\n");
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

  return toAccessorExpression("record", preferred.key);
}

async function buildUiTemplateContext({ appRoot, options } = {}) {
  const selectedOperations = parseOperationsOption(options);
  const resource = await loadResourceDefinition({ appRoot, options });
  const listOperation = requireOperation(resource, "list");
  const viewOperation = requireOperation(resource, "view");

  const listOutputSchema = requireOutputSchema(listOperation, "list");
  const viewOutputSchema = requireOutputSchema(viewOperation, "view");

  const listFields = createFieldDefinitions(resolveListItemProperties(listOutputSchema));
  const viewFields = createFieldDefinitions(requireObjectProperties(viewOutputSchema, "operations.view output"));
  const resolvedRecordIdExpression = resolveRecordIdExpression(listFields);

  const dataColumnCount = Math.max(listFields.length, 1);
  const primaryField =
    viewFields.find((field) => field.key !== "id" && field.type === "string" && !DATE_FORMATS.has(field.format)) ||
    viewFields[0] ||
    { key: "id", type: "string", format: "" };

  return {
    __JSKIT_UI_LIST_HEADER_COLUMNS__: buildListHeaderColumns(listFields),
    __JSKIT_UI_LIST_ROW_COLUMNS__: buildListRowColumns(listFields),
    __JSKIT_UI_LIST_DATA_COLUMN_COUNT__: String(dataColumnCount),
    __JSKIT_UI_LIST_RECORD_ID_EXPR__: resolvedRecordIdExpression,
    __JSKIT_UI_VIEW_COLUMNS__: buildViewColumns(viewFields),
    __JSKIT_UI_VIEW_PRIMARY_ACCESSOR__: toAccessorExpression("record.value", primaryField.key),
    __JSKIT_UI_VIEW_PRIMARY_TYPE__: stringifyLiteral(primaryField.type),
    __JSKIT_UI_VIEW_PRIMARY_FORMAT__: stringifyLiteral(primaryField.format),
    __JSKIT_UI_HAS_LIST_ROUTE__: selectedOperations.has("list") ? "true" : "false"
  };
}

export { buildUiTemplateContext };
