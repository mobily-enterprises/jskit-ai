import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCrudRecordChangedEvent } from "@jskit-ai/crud-core/shared/crudNamespaceSupport";
import {
  checkCrudLookupFormControl,
  isCrudRuntimeOutputOnlyFieldKey
} from "@jskit-ai/crud-core/shared/crudFieldMetaSupport";
import {
  normalizeCrudLookupApiPath,
  normalizeCrudLookupContainerKey,
  resolveCrudLookupContainerKey
} from "@jskit-ai/kernel/shared/support/crudLookup";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function requireOption(options, optionName, { context = "ui-generator" } = {}) {
  const value = normalizeText(options?.[optionName]);
  if (!value) {
    throw new Error(`${context} requires option "${optionName}".`);
  }

  return value;
}

function resolveResourceModulePath(appRoot, resourceFile, { context = "ui-generator" } = {}) {
  const normalizedFile = normalizeText(resourceFile);
  if (!normalizedFile) {
    throw new Error(`${context} requires option "resource-file".`);
  }
  if (path.isAbsolute(normalizedFile)) {
    throw new Error(`${context} option "resource-file" must be a path relative to app root.`);
  }

  const appRootAbsolute = path.resolve(String(appRoot || ""));
  if (!appRootAbsolute) {
    throw new Error(`${context} requires appRoot.`);
  }

  const absolutePath = path.resolve(appRootAbsolute, normalizedFile);
  const relativePath = path.relative(appRootAbsolute, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${context} option "resource-file" must stay within app root.`);
  }

  return absolutePath;
}

function deriveDefaultResourceExport(resourceFile = "", { context = "ui-generator" } = {}) {
  const fileName = normalizeText(path.parse(String(resourceFile || "")).name);
  if (!fileName) {
    throw new Error(`${context} option "resource-export" is required when it cannot be derived from "resource-file".`);
  }

  return fileName;
}

async function loadResourceDefinition({
  appRoot,
  options = {},
  context = "ui-generator"
} = {}) {
  const resourceFile = requireOption(options, "resource-file", { context });
  const resourceExport = normalizeText(options?.["resource-export"]) || deriveDefaultResourceExport(resourceFile, { context });
  const resourceModulePath = resolveResourceModulePath(appRoot, resourceFile, { context });

  let moduleNamespace = null;
  try {
    moduleNamespace = await import(`${pathToFileURL(resourceModulePath).href}?t=${Date.now()}_${Math.random()}`);
  } catch (error) {
    throw new Error(
      `${context} could not load resource file "${resourceFile}": ${String(error?.message || error || "unknown error")}`
    );
  }

  const resource = moduleNamespace?.[resourceExport];
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new Error(
      `${context} could not find resource export "${resourceExport}" in "${resourceFile}".`
    );
  }

  return resource;
}

function requireOperation(resource, operationName, { context = "ui-generator" } = {}) {
  const operations = resource?.operations;
  if (!operations || typeof operations !== "object" || Array.isArray(operations)) {
    throw new Error(`${context} resource must expose operations.`);
  }

  const operation = operations[operationName];
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Error(`${context} resource is missing operations.${operationName}.`);
  }

  return operation;
}

function normalizeRealtimeEventList(events = []) {
  const sourceEvents = Array.isArray(events) ? events : [events];
  const uniqueEvents = [];
  const seen = new Set();

  for (const entry of sourceEvents) {
    const eventName = normalizeText(entry);
    if (!eventName || seen.has(eventName)) {
      continue;
    }
    seen.add(eventName);
    uniqueEvents.push(eventName);
  }

  return uniqueEvents;
}

function resolveOperationRealtimeEvents(
  operation = {},
  {
    defaultEvents = [],
    context = "ui-generator"
  } = {}
) {
  const fallbackEvents = normalizeRealtimeEventList(defaultEvents);
  const realtime = operation?.realtime;
  if (realtime === undefined || realtime === null) {
    return fallbackEvents;
  }
  if (realtime === false) {
    return [];
  }

  if (typeof realtime === "string") {
    return normalizeRealtimeEventList([realtime]);
  }

  if (!realtime || typeof realtime !== "object" || Array.isArray(realtime)) {
    throw new Error(`${context} operations realtime config must be false, string, or object.`);
  }

  const events = [];
  if (Object.hasOwn(realtime, "event")) {
    events.push(realtime.event);
  }
  if (Object.hasOwn(realtime, "events")) {
    if (!Array.isArray(realtime.events)) {
      throw new Error(`${context} operations realtime.events must be an array.`);
    }
    events.push(...realtime.events);
  }

  const normalizedEvents = normalizeRealtimeEventList(events);
  return normalizedEvents.length > 0 ? normalizedEvents : fallbackEvents;
}

function requireOutputSchema(operation, operationName, { context = "ui-generator" } = {}) {
  const outputValidator = operation?.outputValidator;
  if (!outputValidator || typeof outputValidator !== "object" || Array.isArray(outputValidator)) {
    throw new Error(`${context} resource operations.${operationName} is missing outputValidator.`);
  }

  const schema = outputValidator.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`${context} resource operations.${operationName}.outputValidator is missing schema.`);
  }

  return schema;
}

function requireBodySchema(operation, operationName, { context = "ui-generator" } = {}) {
  const bodyValidator = operation?.bodyValidator;
  if (!bodyValidator || typeof bodyValidator !== "object" || Array.isArray(bodyValidator)) {
    throw new Error(`${context} resource operations.${operationName} is missing bodyValidator.`);
  }

  const schema = bodyValidator.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`${context} resource operations.${operationName}.bodyValidator is missing schema.`);
  }

  return schema;
}

function requireObjectProperties(schema, contextLabel, { context = "ui-generator" } = {}) {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error(`${context} expected ${contextLabel} to be an object schema with properties.`);
  }

  return properties;
}

function resolveListItemProperties(listOutputSchema, { context = "ui-generator" } = {}) {
  const listProperties = requireObjectProperties(listOutputSchema, "operations.list output", { context });
  const itemsSchema = listProperties.items;
  if (!itemsSchema || typeof itemsSchema !== "object" || Array.isArray(itemsSchema)) {
    throw new Error(`${context} expected operations.list output schema to include object items schema.`);
  }

  const itemSchema = Array.isArray(itemsSchema.items) ? itemsSchema.items[0] : itemsSchema.items;
  if (!itemSchema || typeof itemSchema !== "object" || Array.isArray(itemSchema)) {
    throw new Error(`${context} expected operations.list output schema items.items to be an object schema.`);
  }

  return requireObjectProperties(itemSchema, "operations.list output items", { context });
}

function resolveUnionSchemaVariant(schema = {}) {
  const source = schema && typeof schema === "object" && !Array.isArray(schema) ? schema : {};
  const candidates = [];

  if (Array.isArray(source.anyOf)) {
    candidates.push(...source.anyOf);
  }
  if (Array.isArray(source.oneOf)) {
    candidates.push(...source.oneOf);
  }
  if (candidates.length < 1) {
    return source;
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }

    const rawType = candidate.type;
    const normalizedType = Array.isArray(rawType)
      ? normalizeText(rawType.find((entry) => normalizeText(entry).toLowerCase() !== "null"))
      : normalizeText(rawType);
    const type = normalizedType.toLowerCase();
    if (type && type !== "null") {
      return candidate;
    }
  }

  return source;
}

function resolveSchemaType(schema) {
  const source = resolveUnionSchemaVariant(schema);
  const rawType = source?.type;
  const normalizedType = Array.isArray(rawType)
    ? normalizeText(rawType.find((entry) => normalizeText(entry).toLowerCase() !== "null"))
    : normalizeText(rawType);

  const schemaType = normalizedType.toLowerCase();
  const hasNullableAnyOf = Array.isArray(schema?.anyOf)
    ? schema.anyOf.some((entry) => normalizeText(entry?.type).toLowerCase() === "null")
    : false;
  const hasNullableOneOf = Array.isArray(schema?.oneOf)
    ? schema.oneOf.some((entry) => normalizeText(entry?.type).toLowerCase() === "null")
    : false;
  const hasNullableType = Array.isArray(rawType)
    ? rawType.some((entry) => normalizeText(entry).toLowerCase() === "null")
    : false;

  return {
    type: schemaType,
    format: normalizeText(source.format).toLowerCase(),
    schema: source,
    nullable: hasNullableAnyOf || hasNullableOneOf || hasNullableType
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

function normalizeLookupRelation(relation = {}) {
  if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
    return null;
  }

  const kind = normalizeText(relation.kind).toLowerCase();
  const relationApiPath = normalizeCrudLookupApiPath(relation.apiPath);
  const sourcePath = normalizeCrudLookupApiPath(relation?.source?.path);
  const targetResource = normalizeText(relation.targetResource);
  const targetResourcePath = targetResource ? normalizeCrudLookupApiPath(`/${targetResource}`) : "";
  const apiPath = relationApiPath || sourcePath || targetResourcePath;
  if (kind !== "lookup" || !apiPath) {
    return null;
  }

  const normalized = {
    kind: "lookup",
    apiPath,
    valueKey: normalizeText(relation.valueKey) || "id"
  };
  const labelKey = normalizeText(relation.labelKey);
  if (labelKey) {
    normalized.labelKey = labelKey;
  }
  if (Object.hasOwn(relation, "containerKey")) {
    const containerKey = normalizeCrudLookupContainerKey(relation.containerKey, {
      defaultValue: "",
      context: "resource lookup relation containerKey"
    });
    if (containerKey) {
      normalized.containerKey = containerKey;
    }
  }
  return normalized;
}

function buildResourceFieldMetaMap(resource = {}) {
  const map = {};
  const entries = Array.isArray(resource?.fieldMeta) ? resource.fieldMeta : [];
  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }

    const key = normalizeText(rawEntry.key);
    if (!key) {
      continue;
    }

    const nextEntry = {
      key
    };
    const dbColumn = normalizeText(rawEntry.dbColumn);
    if (dbColumn) {
      nextEntry.dbColumn = dbColumn;
    }

    const relation = normalizeLookupRelation(rawEntry.relation);
    if (relation) {
      nextEntry.relation = relation;
      const formControl = checkCrudLookupFormControl(rawEntry?.ui?.formControl, {
        context: `resource.fieldMeta["${key}"].ui.formControl`,
        defaultValue: "autocomplete"
      });
      if (formControl) {
        nextEntry.ui = {
          formControl
        };
      }
    }

    map[key] = nextEntry;
  }

  return Object.freeze(map);
}

function resolveLookupContainerKey(resource = {}, { context = "ui-generator" } = {}) {
  return resolveCrudLookupContainerKey(resource, {
    context: `${context} resource.contract.lookup.containerKey`
  });
}

function toLookupRelation(fieldMetaMap = {}, fieldKey = "", { lookupContainerKey = "lookups" } = {}) {
  const key = normalizeText(fieldKey);
  if (!key) {
    return null;
  }

  const relation = normalizeLookupRelation(fieldMetaMap?.[key]?.relation);
  if (!relation) {
    return null;
  }

  const containerKey = normalizeCrudLookupContainerKey(lookupContainerKey, {
    context: `resource lookup relation "${key}" container key`
  });
  return {
    ...relation,
    containerKey
  };
}

function resolveFormInputType(fieldType, fieldFormat) {
  if (fieldType === "integer" || fieldType === "number") {
    return "number";
  }

  if (fieldFormat === "date-time") {
    return "datetime-local";
  }
  if (fieldFormat === "date") {
    return "date";
  }
  if (fieldFormat === "time") {
    return "time";
  }

  return "text";
}

function resolveFormFieldComponent(fieldType, relation = null) {
  if (relation?.kind === "lookup") {
    return "lookup";
  }

  if (fieldType === "boolean") {
    return "switch";
  }

  return "text";
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function createFieldDefinitions(properties = {}, { fieldMetaMap = {}, lookupContainerKey = "lookups" } = {}) {
  const fields = [];

  for (const [rawKey, schema] of Object.entries(properties)) {
    const key = normalizeText(rawKey);
    if (!key || isCrudRuntimeOutputOnlyFieldKey(key, { lookupContainerKey })) {
      continue;
    }

    const schemaType = resolveSchemaType(schema);
    fields.push({
      key,
      label: toFieldLabel(key),
      type: schemaType.type,
      format: schemaType.format,
      relation: toLookupRelation(fieldMetaMap, key, { lookupContainerKey })
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
      format: "",
      relation: null
    }
  ];
}

function createFormFieldDefinitions(properties = {}, { fieldMetaMap = {}, lookupContainerKey = "lookups" } = {}) {
  const fields = [];

  for (const [rawKey, schema] of Object.entries(properties)) {
    const key = normalizeText(rawKey);
    if (!key || isCrudRuntimeOutputOnlyFieldKey(key, { lookupContainerKey })) {
      continue;
    }

    const schemaType = resolveSchemaType(schema);
    const relation = toLookupRelation(fieldMetaMap, key, { lookupContainerKey });
    const lookupFormControl = relation
      ? checkCrudLookupFormControl(fieldMetaMap?.[key]?.ui?.formControl, {
          context: `resource.fieldMeta["${key}"].ui.formControl`,
          defaultValue: "autocomplete"
        })
      : "";
    const fieldDefinition = {
      key,
      label: toFieldLabel(key),
      type: schemaType.type || "string",
      format: schemaType.format || "",
      nullable: schemaType.nullable,
      relation,
      inputType: resolveFormInputType(schemaType.type, schemaType.format),
      component: resolveFormFieldComponent(schemaType.type, relation),
      maxLength: toPositiveInteger(schemaType.schema?.maxLength)
    };
    if (lookupFormControl) {
      fieldDefinition.lookupFormControl = lookupFormControl;
    }
    fields.push(fieldDefinition);
  }

  return fields;
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

function toOptionalAccessorExpression(baseName, fieldKey) {
  const key = normalizeText(fieldKey);
  if (!key) {
    return baseName;
  }
  if (JS_IDENTIFIER_PATTERN.test(key)) {
    return `${baseName}?.${key}`;
  }

  return `${baseName}?.[${JSON.stringify(key)}]`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildListHeaderColumns(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map((field) => `                <th>${escapeHtml(field.label)}</th>`)
    .join("\n");
}

function isLookupField(field = {}) {
  return normalizeText(field?.relation?.kind).toLowerCase() === "lookup";
}

function toLookupDisplayFieldDescriptor(field = {}) {
  const key = normalizeText(field?.key);
  if (!key) {
    return null;
  }

  return {
    key,
    relation: normalizeLookupRelation(field.relation)
  };
}

function toLookupDisplayFieldExpression(field = {}) {
  const descriptor = toLookupDisplayFieldDescriptor(field);
  if (!descriptor) {
    return "{}";
  }

  const relation = descriptor.relation && typeof descriptor.relation === "object" && !Array.isArray(descriptor.relation)
    ? descriptor.relation
    : null;
  if (!relation) {
    return `{ key: ${JSON.stringify(descriptor.key)} }`;
  }

  const relationParts = [
    `kind: ${JSON.stringify(normalizeText(relation.kind) || "lookup")}`,
    `valueKey: ${JSON.stringify(normalizeText(relation.valueKey) || "id")}`
  ];
  const labelKey = normalizeText(relation.labelKey);
  if (labelKey) {
    relationParts.push(`labelKey: ${JSON.stringify(labelKey)}`);
  }
  const containerKey = normalizeText(relation.containerKey);
  if (containerKey) {
    relationParts.push(`containerKey: ${JSON.stringify(containerKey)}`);
  }

  return `{ key: ${JSON.stringify(descriptor.key)}, relation: { ${relationParts.join(", ")} } }`;
}

function buildListRowColumns(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map((field) => {
      if (isLookupField(field)) {
        return `                <td>{{ records.resolveFieldDisplay(record, ${toLookupDisplayFieldExpression(field)}) }}</td>`;
      }

      return `                <td>{{ ${toAccessorExpression("record", field.key)} }}</td>`;
    })
    .join("\n");
}

function buildViewColumns(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map((field) => {
      const valueExpression = isLookupField(field)
        ? `view.resolveFieldDisplay(view.record, ${toLookupDisplayFieldExpression(field)})`
        : toOptionalAccessorExpression("view.record", field.key);

      return `            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">${escapeHtml(field.label)}</div>
              <div class="text-body-1">{{ ${valueExpression} }}</div>
            </v-col>`;
    })
    .join("\n");
}

function buildFormColumns(fields = []) {
  const normalizedFields = Array.isArray(fields) ? fields : [];
  return normalizedFields
    .map((field) => {
      const key = normalizeText(field?.key);
      if (!key) {
        return "";
      }

      const label = escapeHtml(field?.label || toFieldLabel(key));
      const formAccessor = toAccessorExpression("formRuntime.form", key);
      const fieldErrorExpression = `formRuntime.resolveFieldErrors(${JSON.stringify(key)})`;
      const component = normalizeText(field?.component).toLowerCase();
      if (component === "switch") {
        return `            <v-col cols="12" md="6">
              <v-switch
                v-model="${formAccessor}"
                label="${label}"
                color="primary"
                hide-details="auto"
                :disabled="
                  !formRuntime.addEdit.canSave ||
                  formRuntime.addEdit.isSaving ||
                  formRuntime.addEdit.isRefetching
                "
                :error-messages='${fieldErrorExpression}'
              />
            </v-col>`;
      }

      if (component === "lookup") {
        const lookupFormControl = field?.lookupFormControl === "select" ? "select" : "autocomplete";
        const useAutocomplete = lookupFormControl !== "select";
        const lookupComponentTag = useAutocomplete ? "v-autocomplete" : "v-select";
        const lookupSearchBindings = useAutocomplete
          ? `\n                :search='resolveLookupSearch(${JSON.stringify(key)})'\n                @update:search='setLookupSearch(${JSON.stringify(key)}, $event)'`
          : "";
        const lookupNoFilterLine = useAutocomplete ? "\n                no-filter" : "";
        return `            <v-col cols="12" md="6">
              <${lookupComponentTag}
                v-model="${formAccessor}"
                label="${label}"
                variant="outlined"
                density="comfortable"
                :items='resolveLookupItems(${JSON.stringify(key)}, { selectedValue: ${formAccessor}, selectedRecord: formRuntime.addEdit.resource.data })'
                ${lookupSearchBindings}
                item-title="label"
                item-value="value"
                ${lookupNoFilterLine}
                :loading='resolveLookupLoading(${JSON.stringify(key)})'
                :disabled="
                  !formRuntime.addEdit.canSave ||
                  formRuntime.addEdit.isSaving ||
                  formRuntime.addEdit.isRefetching
                "
                :clearable="${field.nullable === true ? "true" : "false"}"
                :error-messages='${fieldErrorExpression}'
              />
            </v-col>`;
      }

      const inputType = normalizeText(field?.inputType) || "text";
      const maxLength = Number.isInteger(field?.maxLength) && field.maxLength > 0
        ? String(field.maxLength)
        : "undefined";
      return `            <v-col cols="12" md="6">
              <v-text-field
                v-model="${formAccessor}"
                label="${label}"
                type="${escapeHtml(inputType)}"
                variant="outlined"
                density="comfortable"
                :maxlength="${maxLength}"
                :readonly="
                  !formRuntime.addEdit.canSave ||
                  formRuntime.addEdit.isSaving ||
                  formRuntime.addEdit.isRefetching
                "
                :error-messages='${fieldErrorExpression}'
              />
            </v-col>`;
    })
    .filter(Boolean)
    .join("\n");
}

function renderObjectPushLines(arrayName, entries = []) {
  const normalizedArrayName = normalizeText(arrayName);
  if (!normalizedArrayName) {
    return "";
  }

  const lines = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    lines.push(`${normalizedArrayName}.push(${JSON.stringify(entry, null, 2)});`);
  }

  return lines.join("\n\n");
}

function resolveRecordIdExpression(fields = []) {
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

export {
  normalizeText,
  requireOption,
  resolveResourceModulePath,
  deriveDefaultResourceExport,
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
  buildListHeaderColumns,
  buildListRowColumns,
  buildViewColumns,
  buildFormColumns,
  renderObjectPushLines,
  resolveCrudRecordChangedEvent as resolveRecordChangedEventName,
  resolveRecordIdExpression
};
