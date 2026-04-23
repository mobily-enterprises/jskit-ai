import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_CRUD_LOOKUP_CONTAINER_KEY,
  normalizeCrudLookupContainerKey
} from "@jskit-ai/kernel/shared/support/crudLookup";

const CRUD_RUNTIME_LOOKUPS_FIELD_KEY = DEFAULT_CRUD_LOOKUP_CONTAINER_KEY;
const CRUD_LOOKUP_FORM_CONTROL_AUTOCOMPLETE = "autocomplete";
const CRUD_LOOKUP_FORM_CONTROL_SELECT = "select";
const CRUD_FIELD_REPOSITORY_STORAGE_COLUMN = "column";
const CRUD_FIELD_REPOSITORY_STORAGE_VIRTUAL = "virtual";
const CRUD_FIELD_REPOSITORY_WRITE_SERIALIZER_DATETIME_UTC = "datetime-utc";

function normalizeCrudFieldRepositoryWriteSerializer(
  value,
  {
    context = "crud fieldMeta repository",
    fieldKey = ""
  } = {}
) {
  const normalizedFieldKey = normalizeText(fieldKey);
  const normalizedValue = normalizeText(value).toLowerCase();
  if (!normalizedValue) {
    return "";
  }

  if (normalizedValue === CRUD_FIELD_REPOSITORY_WRITE_SERIALIZER_DATETIME_UTC) {
    return normalizedValue;
  }

  throw new Error(
    `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} repository.writeSerializer must be ` +
      `"${CRUD_FIELD_REPOSITORY_WRITE_SERIALIZER_DATETIME_UTC}" when provided.`
  );
}

function checkCrudLookupFormControl(
  value,
  {
    context = "crud fieldMeta ui.formControl",
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

function isCrudRuntimeOutputOnlyFieldKey(
  value = "",
  {
    lookupContainerKey = CRUD_RUNTIME_LOOKUPS_FIELD_KEY
  } = {}
) {
  const resolvedLookupContainerKey = normalizeCrudLookupContainerKey(lookupContainerKey, {
    context: "crud runtime lookup container key"
  });
  return normalizeText(value) === resolvedLookupContainerKey;
}

function normalizeCrudFieldRepositoryConfig(
  fieldMetaEntry = {},
  {
    context = "crud fieldMeta repository",
    fieldKey = ""
  } = {}
) {
  const normalizedFieldKey = normalizeText(fieldKey || fieldMetaEntry?.key);
  const repository = fieldMetaEntry?.repository;
  if (repository === undefined || repository === null) {
    return Object.freeze({
      storage: CRUD_FIELD_REPOSITORY_STORAGE_COLUMN,
      column: ""
    });
  }
  if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
    throw new TypeError(
      `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} must be an object when provided.`
    );
  }

  const repositoryKeys = Object.keys(repository);
  for (const repositoryKey of repositoryKeys) {
    if (repositoryKey !== "column" && repositoryKey !== "storage" && repositoryKey !== "writeSerializer") {
      throw new Error(
        `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} does not support repository.${repositoryKey}.`
      );
    }
  }

  const column = normalizeText(repository.column);
  const storage = normalizeText(repository.storage).toLowerCase();
  const writeSerializer = normalizeCrudFieldRepositoryWriteSerializer(repository.writeSerializer, {
    context,
    fieldKey: normalizedFieldKey
  });

  if (!column && !storage && !writeSerializer) {
    throw new Error(
      `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} requires repository.column, repository.storage, or repository.writeSerializer.`
    );
  }

  if (storage && storage !== CRUD_FIELD_REPOSITORY_STORAGE_VIRTUAL) {
    throw new Error(
      `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} repository.storage must be "virtual" when provided.`
    );
  }
  if (storage === CRUD_FIELD_REPOSITORY_STORAGE_VIRTUAL && column) {
    throw new Error(
      `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} repository.storage "virtual" cannot define repository.column.`
    );
  }
  if (storage === CRUD_FIELD_REPOSITORY_STORAGE_VIRTUAL && writeSerializer) {
    throw new Error(
      `${context}${normalizedFieldKey ? `["${normalizedFieldKey}"]` : ""} repository.storage "virtual" cannot define repository.writeSerializer.`
    );
  }

  return Object.freeze({
    storage: storage === CRUD_FIELD_REPOSITORY_STORAGE_VIRTUAL
      ? CRUD_FIELD_REPOSITORY_STORAGE_VIRTUAL
      : CRUD_FIELD_REPOSITORY_STORAGE_COLUMN,
    column,
    writeSerializer
  });
}

export {
  CRUD_FIELD_REPOSITORY_STORAGE_COLUMN,
  CRUD_FIELD_REPOSITORY_STORAGE_VIRTUAL,
  CRUD_FIELD_REPOSITORY_WRITE_SERIALIZER_DATETIME_UTC,
  CRUD_LOOKUP_FORM_CONTROL_AUTOCOMPLETE,
  CRUD_LOOKUP_FORM_CONTROL_SELECT,
  CRUD_RUNTIME_LOOKUPS_FIELD_KEY,
  checkCrudLookupFormControl,
  isCrudRuntimeOutputOnlyFieldKey,
  normalizeCrudFieldRepositoryConfig,
  normalizeCrudFieldRepositoryWriteSerializer
};
