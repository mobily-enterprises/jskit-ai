<template>
  <${option:namespace|singular|pascal|default(Record)}AddEditForm
    mode="new"
    :form-runtime="formRuntime"
    title="New ${option:namespace|singular|pascal|default(Record)}"
    subtitle="Create a new ${option:namespace|singular|default(record)}."
    save-label="Save ${option:namespace|singular|default(record)}"
    :cancel-to="UI_CANCEL_URL"
    :resolve-lookup-items="resolveLookupItems"
    :resolve-lookup-loading="resolveLookupLoading"
    :resolve-lookup-search="resolveLookupSearch"
    :set-lookup-search="setLookupSearch"
  />
</template>

<script setup>
import { useCrudAddEdit } from "@jskit-ai/users-web/client/composables/useCrudAddEdit";
import { createCrudLookupFieldRuntime } from "@jskit-ai/users-web/client/composables/crudLookupFieldRuntime";
import { resource as uiResource } from "/${option:resource-file|trim}";
import ${option:namespace|singular|pascal|default(Record)}AddEditForm from "./_components/${option:namespace|singular|pascal|default(Record)}AddEditForm.vue";
import { UI_CREATE_FORM_FIELDS } from "./_components/${option:namespace|singular|pascal|default(Record)}AddEditFormFields.js";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "${option:id-param|trim}";
const UI_CREATE_API_URL = "${option:api-path|trim}";
const UI_LIST_URL = __JSKIT_UI_HAS_LIST_ROUTE__ ? ".." : "";
const UI_VIEW_URL = __JSKIT_UI_HAS_VIEW_ROUTE__ ? `../:${UI_RECORD_ID_PARAM}` : "";
const UI_CANCEL_URL = UI_LIST_URL;
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;

// jskit:crud-ui-fields-target ./_components/${option:namespace|singular|pascal|default(Record)}AddEditForm.vue
// jskit:crud-ui-form-fields-target ./_components/${option:namespace|singular|pascal|default(Record)}AddEditFormFields.js

const lookupFieldRuntime = createCrudLookupFieldRuntime({
  formFields: UI_CREATE_FORM_FIELDS,
  adapter: UI_OPERATION_ADAPTER || undefined,
  recordIdParam: UI_RECORD_ID_PARAM,
  lookupContainerKey: uiResource?.contract?.lookup?.containerKey,
  queryKeyPrefix: ["ui-generator", "${option:namespace|kebab}", "lookup", "new"],
  placementSourcePrefix: "ui-generator.${option:namespace|kebab}.new.lookup"
});
const {
  resolveLookupItems,
  resolveLookupLoading,
  resolveLookupSearch,
  setLookupSearch
} = lookupFieldRuntime;

const formRuntime = useCrudAddEdit({
  resource: uiResource,
  operationName: "create",
  formFields: UI_CREATE_FORM_FIELDS,
  addEditOptions: {
    adapter: UI_OPERATION_ADAPTER || undefined,
    apiSuffix: UI_CREATE_API_URL,
    queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
      "ui-generator",
      "${option:namespace|kebab}",
      "create",
      String(surfaceId || ""),
      String(workspaceSlug || "")
    ],
    placementSource: "ui-generator.${option:namespace|kebab}.new",
    readEnabled: false,
    writeMethod: "POST",
    fallbackSaveError: "Unable to save record.",
    recordIdParam: UI_RECORD_ID_PARAM,
    viewUrlTemplate: UI_VIEW_URL,
    listUrlTemplate: UI_LIST_URL,
    realtime: UI_RECORD_CHANGED_EVENT
      ? {
          event: UI_RECORD_CHANGED_EVENT
        }
      : null
  },
  saveSuccess: {
    invalidateQueryKey: ["ui-generator", "${option:namespace|kebab}"],
    listUrlTemplate: UI_LIST_URL
  }
});
</script>
