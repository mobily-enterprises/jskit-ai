<template>
  <CrudAddEditScreen
    :screen="screen"__JSKIT_UI_EDIT_LOOKUP_FORM_PROPS__
  >
    <template
      #fields="__JSKIT_UI_EDIT_FORM_SLOT_PROPS__"
    >
      <!-- jskit:crud-ui-fields:edit -->
__JSKIT_UI_EDIT_FORM_COLUMNS_DIRECT__
    </template>
  </CrudAddEditScreen>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import CrudAddEditScreen from "@jskit-ai/users-web/client/components/CrudAddEditScreen";
import { useCrudAddEditScreen } from "@jskit-ai/users-web/client/composables/useCrudAddEditScreen";
__JSKIT_UI_EDIT_LOOKUP_IMPORT_LINE__
import { resource as uiResource } from "__JSKIT_UI_RESOURCE_IMPORT_PATH__";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "__JSKIT_UI_RECORD_ID_PARAM__";
const UI_API_BASE_URL = "__JSKIT_UI_API_BASE_URL__";
const UI_EDIT_API_URL = `${UI_API_BASE_URL}/:${UI_RECORD_ID_PARAM}`;
const UI_LIST_URL = __JSKIT_UI_EDIT_PAGE_LIST_URL__;
const UI_VIEW_URL = __JSKIT_UI_EDIT_PAGE_VIEW_URL__;
const UI_CANCEL_URL = UI_VIEW_URL || UI_LIST_URL;
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;
const UI_EDIT_FORM_FIELDS = [
__JSKIT_UI_EDIT_FORM_FIELD_ARRAY_ENTRIES__  // jskit:crud-ui-form-fields:edit
];

// @jskit-contract crud.ui.form-fields.__JSKIT_UI_RESOURCE_NAMESPACE__.edit.v1
void UI_EDIT_FORM_FIELDS;
Object.freeze(UI_EDIT_FORM_FIELDS);

const route = useRoute();

const routeRecordId = computed(() => {
  const source = route.params?.[UI_RECORD_ID_PARAM];
  if (Array.isArray(source)) {
    return String(source[0] ?? "").trim();
  }

  return String(source ?? "").trim();
});

__JSKIT_UI_EDIT_LOOKUP_RUNTIME_SETUP__

const screen = useCrudAddEditScreen({
  mode: "edit",
  title: "Edit __JSKIT_UI_RESOURCE_SINGULAR_TITLE__",
  subtitle: "Update the selected __JSKIT_UI_RESOURCE_SINGULAR_TITLE__.",
  saveLabel: "Save changes",
  cancelTo: UI_CANCEL_URL,
  preserveCancelQuery: true,
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
    requestRecoveryLabel: "__JSKIT_UI_RESOURCE_SINGULAR_TITLE__",
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
</script>
