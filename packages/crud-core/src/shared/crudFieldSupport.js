import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_CRUD_LOOKUP_CONTAINER_KEY,
  normalizeCrudLookupContainerKey
} from "@jskit-ai/kernel/shared/support/crudLookup";

const CRUD_RUNTIME_LOOKUPS_FIELD_KEY = DEFAULT_CRUD_LOOKUP_CONTAINER_KEY;
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

export {
  CRUD_LOOKUP_FORM_CONTROL_AUTOCOMPLETE,
  CRUD_LOOKUP_FORM_CONTROL_SELECT,
  CRUD_RUNTIME_LOOKUPS_FIELD_KEY,
  checkCrudLookupFormControl,
  isCrudRuntimeOutputOnlyFieldKey
};
