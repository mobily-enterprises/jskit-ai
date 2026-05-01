import path from "node:path";
import { resolveCrudRecordChangedEvent } from "@jskit-ai/resource-crud-core/shared/crudNamespaceSupport";
import {
  checkCrudLookupFormControl,
  isCrudRuntimeOutputOnlyFieldKey
} from "@jskit-ai/crud-core/shared/crudFieldSupport";
import { importFreshModuleFromAbsolutePath } from "@jskit-ai/kernel/server/support";
import {
  normalizeCrudLookupApiPath,
  normalizeCrudLookupNamespace,
  normalizeCrudLookupContainerKey,
  resolveCrudLookupApiPathFromNamespace,
  resolveCrudLookupContainerKey
} from "@jskit-ai/kernel/shared/support/crudLookup";
import { buildCrudFieldContractMap } from "@jskit-ai/kernel/shared/support/crudFieldContract";
import { normalizeSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const JSON_REST_TRANSPORT_EXTENSION_KEY = "x-json-rest-schema";

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

async function loadResourceDefinition({
  appRoot,
  options = {},
  context = "ui-generator"
} = {}) {
  const resourceFile = requireOption(options, "resource-file", { context });
  const resourceModulePath = resolveResourceModulePath(appRoot, resourceFile, { context });

  let moduleNamespace = null;
  try {
    moduleNamespace = await importFreshModuleFromAbsolutePath(resourceModulePath);
  } catch (error) {
    throw new Error(
      `${context} could not load resource file "${resourceFile}": ${String(error?.message || error || "unknown error")}`
    );
  }

  const resource = moduleNamespace?.resource;
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new Error(
      `${context} could not find named export "resource" in "${resourceFile}".`
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

function resolveOperationTransportSchema(definition, {
  context = "ui-generator",
  defaultMode = "replace",
  label = "schema definition"
} = {}) {
  const normalized = normalizeSchemaDefinition(definition, {
    context: `${context} ${label}`,
    defaultMode
  });
  if (!normalized?.schema) {
    throw new Error(`${context} ${label} is missing schema.`);
  }

  return normalized.schema.toJsonSchema({
    mode: normalized.mode
  });
}

function requireOutputSchema(operation, operationName, { context = "ui-generator" } = {}) {
  const output = operation?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error(`${context} resource operations.${operationName} is missing output.`);
  }

  return resolveOperationTransportSchema(output, {
    context,
    defaultMode: "replace",
    label: `resource operations.${operationName}.output`
  });
}

function requireBodySchema(operation, operationName, { context = "ui-generator" } = {}) {
  const body = operation?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${context} resource operations.${operationName} is missing body.`);
  }

  return resolveOperationTransportSchema(body, {
    context,
    defaultMode: operationName === "create" ? "create" : "patch",
    label: `resource operations.${operationName}.body`
  });
}

function requireObjectProperties(schema, contextLabel, { context = "ui-generator", rootSchema = schema } = {}) {
  const resolvedSchema = resolveObjectSchema(schema, contextLabel, {
    context,
    rootSchema
  });
  const properties = resolvedSchema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error(`${context} expected ${contextLabel} to be an object schema with properties.`);
  }

  return properties;
}

function resolveListItemProperties(listOutputSchema, { context = "ui-generator" } = {}) {
  const listProperties = requireObjectProperties(listOutputSchema, "operations.list output", {
    context,
    rootSchema: listOutputSchema
  });
  const itemsSchema = listProperties.items;
  if (!itemsSchema || typeof itemsSchema !== "object" || Array.isArray(itemsSchema)) {
    throw new Error(`${context} expected operations.list output schema to include object items schema.`);
  }

  const itemSchema = Array.isArray(itemsSchema.items) ? itemsSchema.items[0] : itemsSchema.items;
  if (!itemSchema || typeof itemSchema !== "object" || Array.isArray(itemSchema)) {
    throw new Error(`${context} expected operations.list output schema items.items to be an object schema.`);
  }

  return requireObjectProperties(itemSchema, "operations.list output items", {
    context,
    rootSchema: listOutputSchema
  });
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

function decodeJsonPointerSegment(segment = "") {
  return String(segment || "")
    .replace(/~1/g, "/")
    .replace(/~0/g, "~");
}

function resolveSchemaReference(ref = "", rootSchema = {}, { context = "ui-generator", contextLabel = "schema" } = {}) {
  const normalizedRef = normalizeText(ref);
  if (!normalizedRef.startsWith("#/")) {
    throw new Error(`${context} expected ${contextLabel} to use an internal schema reference.`);
  }

  const segments = normalizedRef
    .slice(2)
    .split("/")
    .map((segment) => decodeJsonPointerSegment(segment))
    .filter(Boolean);

  let current = rootSchema;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, segment)) {
      throw new Error(`${context} could not resolve ${contextLabel} reference "${normalizedRef}".`);
    }
    current = current[segment];
  }

  return current;
}

function resolveObjectSchema(
  schema = {},
  contextLabel,
  { context = "ui-generator", rootSchema = schema } = {}
) {
  const source = resolveUnionSchemaVariant(schema);
  if (source?.properties && typeof source.properties === "object" && !Array.isArray(source.properties)) {
    return source;
  }

  const refCandidate = normalizeText(source?.$ref) || normalizeText(source?.allOf?.[0]?.$ref);
  if (refCandidate) {
    return resolveObjectSchema(
      resolveSchemaReference(refCandidate, rootSchema, {
        context,
        contextLabel
      }),
      contextLabel,
      {
        context,
        rootSchema
      }
    );
  }

  return source;
}

function resolveJsonRestCastType(schema = {}) {
  const source = schema && typeof schema === "object" && !Array.isArray(schema) ? schema : {};
  return normalizeText(source?.[JSON_REST_TRANSPORT_EXTENSION_KEY]?.castType).toLowerCase();
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
  const castType = resolveJsonRestCastType(source) || resolveJsonRestCastType(schema);
  let format = normalizeText(source?.format).toLowerCase();
  if (!format) {
    if (castType === "date") {
      format = "date";
    } else if (castType === "datetime") {
      format = "date-time";
    } else if (castType === "time") {
      format = "time";
    }
  }

  return {
    type: schemaType,
    format,
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

function isSupportedSelectOptionValue(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function toSelectOptionLabel(value) {
  if (typeof value === "string") {
    const normalizedValue = normalizeText(value);
    return normalizedValue ? toFieldLabel(normalizedValue) : "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function toSelectOptionIdentity(value) {
  return `${typeof value}:${String(value)}`;
}

function normalizeFieldUiOptions(rawOptions, { context = "resource field ui.options" } = {}) {
  if (rawOptions === undefined || rawOptions === null) {
    return [];
  }
  if (!Array.isArray(rawOptions)) {
    throw new Error(`${context} must be an array of { value, label? } entries.`);
  }

  const options = [];
  const seenValues = new Set();
  for (const [index, rawEntry] of rawOptions.entries()) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      throw new Error(`${context}[${index}] must be an object.`);
    }

    const value = rawEntry.value;
    if (!isSupportedSelectOptionValue(value)) {
      throw new Error(`${context}[${index}].value must be a string, number, or boolean.`);
    }

    const identity = toSelectOptionIdentity(value);
    if (seenValues.has(identity)) {
      continue;
    }
    seenValues.add(identity);

    const explicitLabel = normalizeText(rawEntry.label);
    const fallbackLabel = toSelectOptionLabel(value);
    options.push({
      value,
      label: explicitLabel || fallbackLabel || String(value)
    });
  }

  return options;
}

function stripLookupIdSuffix(key = "") {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) {
    return "";
  }

  if (normalizedKey.endsWith("Id") && normalizedKey.length > 2) {
    return normalizedKey.slice(0, -2);
  }
  if (/[_\-.]id$/iu.test(normalizedKey)) {
    return normalizedKey.replace(/[_\-.]id$/iu, "");
  }

  return normalizedKey;
}

function resolveFieldLabel(key = "", relation = null) {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) {
    return "Field";
  }

  const relationKind = normalizeText(relation?.kind).toLowerCase();
  if (relationKind === "lookup") {
    const lookupLabelKey = stripLookupIdSuffix(normalizedKey);
    if (lookupLabelKey) {
      return toFieldLabel(lookupLabelKey);
    }
  }

  return toFieldLabel(normalizedKey);
}

function extractDynamicRouteParamKeys(routePath = "") {
  const sourcePath = String(routePath || "").trim();
  if (!sourcePath) {
    return [];
  }

  const keys = [];
  const seenKeys = new Set();
  const bracketPattern = /\[([A-Za-z][A-Za-z0-9_]*)\]/g;
  const colonPattern = /:([A-Za-z][A-Za-z0-9_]*)/g;

  let match = null;
  while ((match = bracketPattern.exec(sourcePath)) != null) {
    const key = normalizeText(match[1]);
    if (!key || seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    keys.push(key);
  }
  while ((match = colonPattern.exec(sourcePath)) != null) {
    const key = normalizeText(match[1]);
    if (!key || seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    keys.push(key);
  }

  return keys;
}

function resolveNearestParentRouteParamKey(routePath = "", { recordIdParam = "recordId" } = {}) {
  const normalizedRecordIdParam = normalizeText(recordIdParam) || "recordId";
  const dynamicParamKeys = extractDynamicRouteParamKeys(routePath);
  if (dynamicParamKeys.length < 1) {
    return "";
  }

  const filteredParamKeys = dynamicParamKeys.filter((key) => key !== "workspaceSlug" && key !== normalizedRecordIdParam);
  return filteredParamKeys[filteredParamKeys.length - 1] || "";
}

function normalizeLookupRelation(relation = {}) {
  if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
    return null;
  }

  const kind = normalizeText(relation.kind).toLowerCase();
  const relationNamespace = normalizeCrudLookupNamespace(relation.namespace);
  const relationApiPathNamespace = normalizeCrudLookupNamespace(relation.apiPath);
  const sourcePathNamespace = normalizeCrudLookupNamespace(relation?.source?.path);
  const targetResource = normalizeText(relation.targetResource);
  const targetResourceNamespace = targetResource ? normalizeCrudLookupNamespace(targetResource) : "";
  const namespace =
    relationNamespace ||
    relationApiPathNamespace ||
    sourcePathNamespace ||
    targetResourceNamespace;
  if (kind !== "lookup" || !namespace) {
    return null;
  }

  const defaultApiPath = resolveCrudLookupApiPathFromNamespace(namespace);
  const explicitApiPath = normalizeCrudLookupApiPath(relation.apiPath);
  const normalized = {
    kind: "lookup",
    namespace,
    valueKey: normalizeText(relation.valueKey) || "id"
  };
  if (explicitApiPath && explicitApiPath !== defaultApiPath) {
    normalized.apiPath = explicitApiPath;
  }
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
  const surfaceId = normalizeSurfaceId(relation.surfaceId);
  if (surfaceId) {
    normalized.surfaceId = surfaceId;
  }
  return normalized;
}

function buildResourceFieldContractMap(resource = {}) {
  const map = {};
  const entries = Object.values(buildCrudFieldContractMap(resource, {
    context: "crud ui resource field contract"
  }));
  for (const rawEntry of entries) {
    const key = normalizeText(rawEntry?.key);
    if (!key) {
      continue;
    }

    const nextEntry = { key };
    const relation = normalizeLookupRelation(rawEntry.relation);
    const fieldUiOptions = normalizeFieldUiOptions(rawEntry?.ui?.options, {
      context: `resource schema field "${key}" ui.options`
    });
    if (relation) {
      nextEntry.relation = relation;
      const formControl = checkCrudLookupFormControl(rawEntry?.ui?.formControl, {
        context: `resource schema field "${key}" ui.formControl`,
        defaultValue: "autocomplete"
      });
      if (formControl) {
        nextEntry.ui = {
          formControl
        };
      }
    }
    if (fieldUiOptions.length > 0) {
      nextEntry.ui = {
        ...(nextEntry.ui || {}),
        options: fieldUiOptions
      };
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

function toLookupRelation(fieldContractMap = {}, fieldKey = "", { lookupContainerKey = "lookups" } = {}) {
  const key = normalizeText(fieldKey);
  if (!key) {
    return null;
  }

  const relation = normalizeLookupRelation(fieldContractMap?.[key]?.relation);
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

function buildDefaultNullableBooleanOptions() {
  return [
    { label: "Unset", value: null },
    { label: "Yes", value: true },
    { label: "No", value: false }
  ];
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function createFieldDefinitions(properties = {}, { fieldContractMap = {}, lookupContainerKey = "lookups" } = {}) {
  const fields = [];

  for (const [rawKey, schema] of Object.entries(properties)) {
    const key = normalizeText(rawKey);
    if (!key || isCrudRuntimeOutputOnlyFieldKey(key, { lookupContainerKey })) {
      continue;
    }

    const schemaType = resolveSchemaType(schema);
    const relation = toLookupRelation(fieldContractMap, key, { lookupContainerKey });
    fields.push({
      key,
      label: resolveFieldLabel(key, relation),
      type: schemaType.type,
      format: schemaType.format,
      relation
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

function createFormFieldDefinitions(
  properties = {},
  {
    fieldContractMap = {},
    lookupContainerKey = "lookups",
    parentRouteParamKey = ""
  } = {}
) {
  const fields = [];
  const normalizedParentRouteParamKey = normalizeText(parentRouteParamKey);

  for (const [rawKey, schema] of Object.entries(properties)) {
    const key = normalizeText(rawKey);
    if (!key || isCrudRuntimeOutputOnlyFieldKey(key, { lookupContainerKey })) {
      continue;
    }

    const schemaType = resolveSchemaType(schema);
    const relation = toLookupRelation(fieldContractMap, key, { lookupContainerKey });
    const fieldUiOptions = Array.isArray(fieldContractMap?.[key]?.ui?.options)
      ? fieldContractMap[key].ui.options
      : [];
    const schemaEnumValues = Array.isArray(schemaType.schema?.enum) ? schemaType.schema.enum : [];
    if (!relation && schemaEnumValues.length > 0 && fieldUiOptions.length < 1) {
      throw new Error(
        `resource form field "${key}" defines schema enum values but is missing schema ui.options metadata.`
      );
    }
    const selectOptions = relation
      ? []
      : (
          fieldUiOptions.length > 0
            ? fieldUiOptions
            : (
                schemaType.type === "boolean" && schemaType.nullable === true
                  ? buildDefaultNullableBooleanOptions()
                  : []
              )
        );
    const lookupFormControl = relation
      ? checkCrudLookupFormControl(fieldContractMap?.[key]?.ui?.formControl, {
          context: `resource schema field "${key}" ui.formControl`,
          defaultValue: "autocomplete"
        })
      : "";
    const fieldDefinition = {
      key,
      label: resolveFieldLabel(key, relation),
      type: schemaType.type || "string",
      format: schemaType.format || "",
      nullable: schemaType.nullable,
      relation,
      inputType: resolveFormInputType(schemaType.type, schemaType.format),
      component: selectOptions.length > 0
        ? "select"
        : resolveFormFieldComponent(schemaType.type, relation),
      maxLength: toPositiveInteger(schemaType.schema?.maxLength)
    };
    if (selectOptions.length > 0) {
      fieldDefinition.options = selectOptions;
    }
    if (normalizedParentRouteParamKey && key === normalizedParentRouteParamKey) {
      fieldDefinition.hidden = true;
      fieldDefinition.routeParamKey = normalizedParentRouteParamKey;
    }
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

function serializeTemplateBindingValue(value) {
  return JSON.stringify(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "\\u0027");
}

function renderTemplateJsStringLiteral(value) {
  return `'${String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")}'`;
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
      if (field?.hidden === true) {
        return "";
      }

      const label = escapeHtml(field?.label || toFieldLabel(key));
      const formAccessor = toAccessorExpression("formState", key);
      const fieldKeyLiteral = renderTemplateJsStringLiteral(key);
      const fieldErrorExpression = `resolveFieldErrors(${fieldKeyLiteral})`;
      const component = normalizeText(field?.component).toLowerCase();
      if (component === "switch") {
        return `              <v-col cols="12" md="6">
                <v-switch
                  v-model="${formAccessor}"
                  label="${label}"
                  color="primary"
                  hide-details="auto"
                  :disabled="addEdit.isFieldLocked"
                  :error-messages="${fieldErrorExpression}"
                />
              </v-col>`;
      }

      if (component === "select") {
        const selectOptions = Array.isArray(field?.options) ? field.options : [];
        return `              <v-col cols="12" md="6">
                <v-select
                  v-model="${formAccessor}"
                  label="${label}"
                  variant="outlined"
                  density="comfortable"
                  :items="${serializeTemplateBindingValue(selectOptions)}"
                  item-title="label"
                  item-value="value"
                  :disabled="addEdit.isFieldLocked"
                  :clearable="${field.nullable === true ? "true" : "false"}"
                  :error-messages="${fieldErrorExpression}"
                />
              </v-col>`;
      }

      if (component === "lookup") {
        const lookupFormControl = field?.lookupFormControl === "select" ? "select" : "autocomplete";
        const useAutocomplete = lookupFormControl !== "select";
        const lookupComponentTag = useAutocomplete ? "v-autocomplete" : "v-select";
        const lookupAttributeLines = [
          `                  :items="resolveLookupItems(${fieldKeyLiteral}, { selectedValue: ${formAccessor}, selectedRecord: addEdit.resource.data })"`
        ];
        if (useAutocomplete) {
          lookupAttributeLines.push(
            `                  :search="resolveLookupSearch(${fieldKeyLiteral})"`,
            `                  @update:search="setLookupSearch(${fieldKeyLiteral}, $event)"`
          );
        }
        lookupAttributeLines.push(
          `                  item-title="label"`,
          `                  item-value="value"`
        );
        if (useAutocomplete) {
          lookupAttributeLines.push("                  no-filter");
        }
        return `              <v-col cols="12" md="6">
                <${lookupComponentTag}
                  v-model="${formAccessor}"
                  label="${label}"
                  variant="outlined"
                  density="comfortable"
                  autocomplete="off"
${lookupAttributeLines.join("\n")}
                  :loading="resolveLookupLoading(${fieldKeyLiteral})"
                  :disabled="addEdit.isFieldLocked"
                  :clearable="${field.nullable === true ? "true" : "false"}"
                  :error-messages="${fieldErrorExpression}"
                />
              </v-col>`;
      }

      const inputType = normalizeText(field?.inputType) || "text";
      const maxLength = Number.isInteger(field?.maxLength) && field.maxLength > 0
        ? String(field.maxLength)
        : "undefined";
      return `              <v-col cols="12" md="6">
                <v-text-field
                  v-model="${formAccessor}"
                  label="${label}"
                  type="${escapeHtml(inputType)}"
                  variant="outlined"
                  density="comfortable"
                  :maxlength="${maxLength}"
                  :readonly="addEdit.isFieldLocked"
                  :error-messages="${fieldErrorExpression}"
                />
              </v-col>`;
    })
    .filter(Boolean)
    .join("\n");
}

function resolveRecordIdFieldKey(fields = []) {
  const normalizedFields = Array.isArray(fields) ? fields : [];
  const preferred =
    normalizedFields.find((field) => normalizeText(field?.key).toLowerCase() === "id") ||
    normalizedFields.find((field) => {
      const key = normalizeText(field?.key).toLowerCase();
      return key.endsWith("id") || key.endsWith("_id") || key.endsWith("-id");
    }) ||
    normalizedFields[0] ||
    { key: "id" };

  return normalizeText(preferred?.key) || "id";
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
  return toAccessorExpression("item", resolveRecordIdFieldKey(fields));
}

export {
  normalizeText,
  requireOption,
  resolveResourceModulePath,
  loadResourceDefinition,
  requireOperation,
  resolveOperationRealtimeEvents,
  requireOutputSchema,
  requireBodySchema,
  requireObjectProperties,
  resolveListItemProperties,
  resolveLookupContainerKey,
  buildResourceFieldContractMap,
  createFieldDefinitions,
  createFormFieldDefinitions,
  resolveNearestParentRouteParamKey,
  buildListHeaderColumns,
  buildListRowColumns,
  buildViewColumns,
  buildFormColumns,
  resolveRecordIdFieldKey,
  renderObjectPushLines,
  resolveCrudRecordChangedEvent as resolveRecordChangedEventName,
  resolveRecordIdExpression
};
