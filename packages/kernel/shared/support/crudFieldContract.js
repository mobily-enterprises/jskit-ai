import { normalizeSchemaDefinition } from "../validators/schemaDefinitions.js";
import { normalizeObject, normalizeText } from "./normalize.js";

const CRUD_FIELD_STORAGE_COLUMN = "column";
const CRUD_FIELD_STORAGE_VIRTUAL = "virtual";
const CRUD_FIELD_WRITE_SERIALIZER_DATETIME_UTC = "datetime-utc";
const CRUD_LOOKUP_FORM_CONTROL_AUTOCOMPLETE = "autocomplete";
const CRUD_LOOKUP_FORM_CONTROL_SELECT = "select";

function checkCrudLookupFormControl(
  value,
  {
    context = "crud field ui.formControl",
    defaultValue = CRUD_LOOKUP_FORM_CONTROL_AUTOCOMPLETE
  } = {}
) {
  const resolvedValue = value === undefined || value === null || value === "" ? defaultValue : value;
  if (resolvedValue === "") {
    return "";
  }

  if (
    resolvedValue === CRUD_LOOKUP_FORM_CONTROL_AUTOCOMPLETE ||
    resolvedValue === CRUD_LOOKUP_FORM_CONTROL_SELECT
  ) {
    return resolvedValue;
  }

  throw new Error(
    `${context} must be "${CRUD_LOOKUP_FORM_CONTROL_AUTOCOMPLETE}" or "${CRUD_LOOKUP_FORM_CONTROL_SELECT}". ` +
      `Received: ${JSON.stringify(resolvedValue)}.`
  );
}

function cloneStructuredFieldMetadata(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const normalized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }

    if (Array.isArray(entry)) {
      normalized[key] = entry.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? cloneStructuredFieldMetadata(item) || {}
          : item
      );
      continue;
    }

    if (entry && typeof entry === "object") {
      normalized[key] = cloneStructuredFieldMetadata(entry) || {};
      continue;
    }

    normalized[key] = entry;
  }

  return Object.keys(normalized).length > 0 ? Object.freeze(normalized) : null;
}

function resolveCrudFieldSchemaProperties(value, { context = "crud resource field definitions" } = {}) {
  if (value == null) {
    return {};
  }

  const normalized = normalizeSchemaDefinition(value, {
    context,
    defaultMode: "patch"
  });
  if (!normalized) {
    return {};
  }

  return normalizeObject(normalized.schema.getFieldDefinitions());
}

function normalizeCrudFieldStorageConfig(
  fieldDefinition = {},
  {
    context = "crud field storage",
    fieldKey = ""
  } = {}
) {
  const normalizedFieldKey = normalizeText(fieldKey);
  const actualField = normalizeText(fieldDefinition.actualField);
  const storage = fieldDefinition?.storage;

  if (storage === undefined || storage === null) {
    return Object.freeze({
      mode: CRUD_FIELD_STORAGE_COLUMN,
      column: actualField,
      writeSerializer: ""
    });
  }

  if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
    throw new TypeError(
      `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} must be an object when provided.`
    );
  }

  for (const storageKey of Object.keys(storage)) {
    if (storageKey !== "column" && storageKey !== "virtual" && storageKey !== "writeSerializer") {
      throw new Error(
        `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} does not support storage.${storageKey}.`
      );
    }
  }

  const column = normalizeText(storage.column) || actualField;
  const virtual = storage.virtual === true;
  const writeSerializer = normalizeText(storage.writeSerializer).toLowerCase();

  if (actualField && normalizeText(storage.column) && normalizeText(storage.column) !== actualField) {
    throw new Error(
      `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} actualField and storage.column must match when both are provided.`
    );
  }

  if (writeSerializer && writeSerializer !== CRUD_FIELD_WRITE_SERIALIZER_DATETIME_UTC) {
    throw new Error(
      `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} storage.writeSerializer must be ` +
        `"${CRUD_FIELD_WRITE_SERIALIZER_DATETIME_UTC}" when provided.`
    );
  }

  if (virtual && column) {
    throw new Error(
      `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} virtual fields cannot define actualField or storage.column.`
    );
  }

  if (virtual && writeSerializer) {
    throw new Error(
      `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} virtual fields cannot define storage.writeSerializer.`
    );
  }

  return Object.freeze({
    mode: virtual ? CRUD_FIELD_STORAGE_VIRTUAL : CRUD_FIELD_STORAGE_COLUMN,
    column,
    writeSerializer
  });
}

function mergeFieldContractEntry(target, source, { context = "crud field contract", fieldKey = "" } = {}) {
  if (!source || typeof source !== "object") {
    return target;
  }

  const next = target ? { ...target } : {};
  const normalizedFieldKey = normalizeText(fieldKey);

  const mergeScalar = (key) => {
    const value = normalizeText(source[key]);
    if (!value) {
      return;
    }
    if (next[key] && next[key] !== value) {
      throw new Error(`${context}["${normalizedFieldKey}"] has conflicting ${key} metadata.`);
    }
    next[key] = value;
  };

  mergeScalar("actualField");
  mergeScalar("parentRouteParamKey");

  const storage = source.storage && typeof source.storage === "object" ? source.storage : null;
  if (storage) {
    const currentStorage = next.storage || {};
    if (storage.mode && currentStorage.mode && currentStorage.mode !== storage.mode) {
      throw new Error(`${context}["${normalizedFieldKey}"] has conflicting storage.mode metadata.`);
    }
    if (storage.column && currentStorage.column && currentStorage.column !== storage.column) {
      throw new Error(`${context}["${normalizedFieldKey}"] has conflicting storage.column metadata.`);
    }
    if (storage.writeSerializer &&
      currentStorage.writeSerializer &&
      currentStorage.writeSerializer !== storage.writeSerializer
    ) {
      throw new Error(`${context}["${normalizedFieldKey}"] has conflicting storage.writeSerializer metadata.`);
    }
    next.storage = {
      ...currentStorage,
      ...storage
    };
  }

  if (source.relation && typeof source.relation === "object") {
    next.relation = {
      ...(next.relation && typeof next.relation === "object" ? next.relation : {}),
      ...source.relation
    };
  }

  if (source.ui && typeof source.ui === "object") {
    next.ui = {
      ...(next.ui && typeof next.ui === "object" ? next.ui : {}),
      ...source.ui
    };
  }

  return next;
}

function buildCrudFieldContractMap(resource = {}, { context = "crud resource field contract" } = {}) {
  const sections = [
    resolveCrudFieldSchemaProperties(resource?.operations?.view?.output, {
      context: `${context}.operations.view.output`
    }),
    resolveCrudFieldSchemaProperties(resource?.operations?.create?.body, {
      context: `${context}.operations.create.body`
    }),
    resolveCrudFieldSchemaProperties(resource?.operations?.patch?.body, {
      context: `${context}.operations.patch.body`
    })
  ];

  const entries = {};
  for (const definitions of sections) {
    for (const [rawKey, rawDefinition] of Object.entries(definitions)) {
      const key = normalizeText(rawKey);
      if (!key) {
        continue;
      }
      const definition = normalizeObject(rawDefinition);
      const storage = normalizeCrudFieldStorageConfig(definition, {
        context: `${context}.storage`,
        fieldKey: key
      });
      const relation = cloneStructuredFieldMetadata(definition.relation);
      const ui = cloneStructuredFieldMetadata(definition.ui);
      const parentRouteParamKey =
        normalizeText(definition.parentRouteParamKey) ||
        normalizeText(definition?.relation?.parentRouteParamKey);

      entries[key] = mergeFieldContractEntry(entries[key], {
        actualField: normalizeText(definition.actualField),
        parentRouteParamKey,
        storage,
        relation,
        ui
      }, {
        context,
        fieldKey: key
      });
    }
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(entries).map(([key, value]) => [
        key,
        Object.freeze({
          key,
          actualField: normalizeText(value.actualField),
          parentRouteParamKey: normalizeText(value.parentRouteParamKey),
          storage: Object.freeze({
            mode: normalizeText(value?.storage?.mode) || CRUD_FIELD_STORAGE_COLUMN,
            column: normalizeText(value?.storage?.column),
            writeSerializer: normalizeText(value?.storage?.writeSerializer).toLowerCase()
          }),
          relation: cloneStructuredFieldMetadata(value.relation),
          ui: cloneStructuredFieldMetadata(value.ui)
        })
      ])
    )
  );
}

function buildCrudOperationSchemaFields(fields = {}, operationName = "") {
  const definitions = {};

  for (const [fieldKey, fieldDefinition] of Object.entries(fields)) {
    const operationConfig = fieldDefinition?.operations?.[operationName];
    if (!operationConfig) {
      continue;
    }

    const nextDefinition = {
      ...fieldDefinition
    };
    delete nextDefinition.operations;

    if (operationConfig !== true) {
      Object.assign(nextDefinition, operationConfig);
    }

    definitions[fieldKey] = nextDefinition;
  }

  return definitions;
}

function resolveCrudFieldContractEntry(resource = {}, fieldKey = "", options = {}) {
  const normalizedFieldKey = normalizeText(fieldKey);
  if (!normalizedFieldKey) {
    return null;
  }

  const entries = buildCrudFieldContractMap(resource, options);
  return entries[normalizedFieldKey] || null;
}

export {
  CRUD_FIELD_STORAGE_COLUMN,
  CRUD_FIELD_STORAGE_VIRTUAL,
  CRUD_FIELD_WRITE_SERIALIZER_DATETIME_UTC,
  CRUD_LOOKUP_FORM_CONTROL_AUTOCOMPLETE,
  CRUD_LOOKUP_FORM_CONTROL_SELECT,
  checkCrudLookupFormControl,
  resolveCrudFieldSchemaProperties,
  normalizeCrudFieldStorageConfig,
  buildCrudOperationSchemaFields,
  buildCrudFieldContractMap,
  resolveCrudFieldContractEntry
};
