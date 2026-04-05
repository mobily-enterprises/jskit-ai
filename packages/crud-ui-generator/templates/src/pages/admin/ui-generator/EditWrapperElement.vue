<template>
  <${option:namespace|singular|pascal|default(Record)}AddEditForm
    mode="edit"
    :form-runtime="formRuntime"
    title="Edit ${option:namespace|singular|pascal|default(Record)}"
    subtitle="Update the selected ${option:namespace|singular|default(record)}."
    save-label="Save changes"
    :cancel-to="cancelTo"
    :resolve-lookup-items="resolveLookupItems"
    :resolve-lookup-loading="resolveLookupLoading"
    :resolve-lookup-search="resolveLookupSearch"
    :set-lookup-search="setLookupSearch"
  />
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useCrudSchemaForm } from "@jskit-ai/users-web/client/composables/useCrudSchemaForm";
import { createCrudLookupFieldRuntime } from "@jskit-ai/users-web/client/composables/crudLookupFieldRuntime";
import { resource as uiResource } from "/${option:resource-file|trim}";
import ${option:namespace|singular|pascal|default(Record)}AddEditForm from "../_components/${option:namespace|singular|pascal|default(Record)}AddEditForm.vue";
import { UI_EDIT_FORM_FIELDS } from "../_components/${option:namespace|singular|pascal|default(Record)}AddEditFormFields.js";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "${option:id-param|trim}";
const UI_API_BASE_URL = "${option:api-path|trim}";
const UI_EDIT_API_URL = `${UI_API_BASE_URL}/:${UI_RECORD_ID_PARAM}`;
const UI_LIST_URL = __JSKIT_UI_HAS_LIST_ROUTE__ ? "../.." : "";
const UI_VIEW_URL = __JSKIT_UI_HAS_VIEW_ROUTE__ ? ".." : "";
const UI_CANCEL_URL = UI_VIEW_URL || UI_LIST_URL;
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;
const route = useRoute();

// jskit:crud-ui-fields-target ../_components/${option:namespace|singular|pascal|default(Record)}AddEditForm.vue
// jskit:crud-ui-form-fields-target ../_components/${option:namespace|singular|pascal|default(Record)}AddEditFormFields.js

const routeRecordId = computed(() => {
  const source = route.params?.[UI_RECORD_ID_PARAM];
  if (Array.isArray(source)) {
    return String(source[0] ?? "").trim();
  }

  return String(source ?? "").trim();
});

const lookupFieldRuntime = createCrudLookupFieldRuntime({
  formFields: UI_EDIT_FORM_FIELDS,
  adapter: UI_OPERATION_ADAPTER || undefined,
  recordIdParam: UI_RECORD_ID_PARAM,
  lookupContainerKey: uiResource?.contract?.lookup?.containerKey,
  queryKeyPrefix: ["ui-generator", "${option:namespace|kebab}", "lookup", "edit"],
  placementSourcePrefix: "ui-generator.${option:namespace|kebab}.edit.lookup"
});
const {
  resolveLookupItems,
  resolveLookupLoading,
  resolveLookupSearch,
  setLookupSearch
} = lookupFieldRuntime;

const formRuntime = useCrudSchemaForm({
  resource: uiResource,
  operationName: "patch",
  formFields: UI_EDIT_FORM_FIELDS,
  addEditOptions: {
    adapter: UI_OPERATION_ADAPTER || undefined,
    apiUrlTemplate: UI_EDIT_API_URL,
    queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
      "ui-generator",
      "${option:namespace|kebab}",
      "edit",
      String(surfaceId || ""),
      String(workspaceSlug || ""),
      routeRecordId.value
    ],
    placementSource: "ui-generator.${option:namespace|kebab}.edit",
    writeMethod: "PATCH",
    fallbackLoadError: "Unable to load record.",
    fallbackSaveError: "Unable to save record.",
    recordIdParam: UI_RECORD_ID_PARAM,
    routeRecordId,
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

const cancelTo = computed(() => {
  const resolvedPath = formRuntime.addEdit.resolveParams(UI_CANCEL_URL);
  if (!resolvedPath) {
    return "";
  }

  return {
    path: resolvedPath,
    query: route.query
  };
});
</script>
