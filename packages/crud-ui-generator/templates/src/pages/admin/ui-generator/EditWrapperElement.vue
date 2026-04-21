<template>
  <CrudAddEditForm
    mode="edit"
    :form-runtime="formRuntime"
    title="Edit __JSKIT_UI_RESOURCE_SINGULAR_TITLE__"
    subtitle="Update the selected __JSKIT_UI_RESOURCE_SINGULAR_TITLE__."
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
import { useCrudAddEdit } from "@jskit-ai/users-web/client/composables/useCrudAddEdit";
import { createCrudLookupFieldRuntime } from "@jskit-ai/users-web/client/composables/crudLookupFieldRuntime";
import { resource as uiResource } from "__JSKIT_UI_RESOURCE_IMPORT_PATH__";
import CrudAddEditForm from "../_components/__JSKIT_UI_FORM_COMPONENT_FILE__";
import { UI_EDIT_FORM_FIELDS } from "../_components/__JSKIT_UI_FORM_FIELDS_FILE__";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "__JSKIT_UI_RECORD_ID_PARAM__";
const UI_API_BASE_URL = "__JSKIT_UI_API_BASE_URL__";
const UI_EDIT_API_URL = `${UI_API_BASE_URL}/:${UI_RECORD_ID_PARAM}`;
const UI_LIST_URL = __JSKIT_UI_EDIT_PAGE_LIST_URL__;
const UI_VIEW_URL = __JSKIT_UI_EDIT_PAGE_VIEW_URL__;
const UI_CANCEL_URL = UI_VIEW_URL || UI_LIST_URL;
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;
const route = useRoute();

// jskit:crud-ui-fields-target ../_components/__JSKIT_UI_FORM_COMPONENT_FILE__
// jskit:crud-ui-form-fields-target ../_components/__JSKIT_UI_FORM_FIELDS_FILE__

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
  queryKeyPrefix: ["ui-generator", "__JSKIT_UI_RESOURCE_NAMESPACE__", "lookup", "edit"],
  placementSourcePrefix: "ui-generator.__JSKIT_UI_RESOURCE_NAMESPACE__.edit.lookup"
});
const {
  resolveLookupItems,
  resolveLookupLoading,
  resolveLookupSearch,
  setLookupSearch
} = lookupFieldRuntime;

const formRuntime = useCrudAddEdit({
  resource: uiResource,
  operationName: "patch",
  formFields: UI_EDIT_FORM_FIELDS,
  addEditOptions: {
    adapter: UI_OPERATION_ADAPTER || undefined,
    apiUrlTemplate: UI_EDIT_API_URL,
    queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
      "ui-generator",
      "__JSKIT_UI_RESOURCE_NAMESPACE__",
      "edit",
      String(surfaceId || ""),
      String(workspaceSlug || ""),
      routeRecordId.value
    ],
    placementSource: "ui-generator.__JSKIT_UI_RESOURCE_NAMESPACE__.edit",
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
    invalidateQueryKey: ["ui-generator", "__JSKIT_UI_RESOURCE_NAMESPACE__"],
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
