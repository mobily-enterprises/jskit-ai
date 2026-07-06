<template>
  <CrudAddEditScreen
    :screen="screen"__JSKIT_UI_CREATE_LOOKUP_FORM_PROPS__
  >
    <template
      #fields="__JSKIT_UI_CREATE_FORM_SLOT_PROPS__"
    >
      <!-- jskit:crud-ui-fields:new -->
__JSKIT_UI_CREATE_FORM_COLUMNS_DIRECT__
    </template>
  </CrudAddEditScreen>
</template>

<script setup>
import CrudAddEditScreen from "@jskit-ai/users-web/client/components/CrudAddEditScreen";
import { useCrudAddEditScreen } from "@jskit-ai/users-web/client/composables/useCrudAddEditScreen";
__JSKIT_UI_CREATE_LOOKUP_IMPORT_LINE__
import { resource as uiResource } from "__JSKIT_UI_RESOURCE_IMPORT_PATH__";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "__JSKIT_UI_RECORD_ID_PARAM__";
const UI_CREATE_API_URL = "__JSKIT_UI_API_BASE_URL__";
const UI_LIST_URL = __JSKIT_UI_NEW_PAGE_LIST_URL__;
const UI_VIEW_URL = __JSKIT_UI_NEW_PAGE_VIEW_URL__;
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;
const UI_CREATE_FORM_FIELDS = [
__JSKIT_UI_CREATE_FORM_FIELD_ARRAY_ENTRIES__  // jskit:crud-ui-form-fields:new
];

// @jskit-contract crud.ui.form-fields.__JSKIT_UI_RESOURCE_NAMESPACE__.new.v1
void UI_CREATE_FORM_FIELDS;
Object.freeze(UI_CREATE_FORM_FIELDS);

__JSKIT_UI_CREATE_LOOKUP_RUNTIME_SETUP__

const screen = useCrudAddEditScreen({
  mode: "new",
  title: "New __JSKIT_UI_RESOURCE_SINGULAR_TITLE__",
  subtitle: "Create a __JSKIT_UI_RESOURCE_SINGULAR_TITLE__ record.",
  saveLabel: "Save __JSKIT_UI_RESOURCE_SINGULAR_TITLE__",
  cancelTo: UI_LIST_URL,
  resource: uiResource,
  operationName: "create",
  formFields: UI_CREATE_FORM_FIELDS,
  addEditOptions: {
    adapter: UI_OPERATION_ADAPTER || undefined,
    apiSuffix: UI_CREATE_API_URL,
    queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
      "ui-generator",
      "__JSKIT_UI_RESOURCE_NAMESPACE__",
      "create",
      String(surfaceId || ""),
      String(workspaceSlug || "")
    ],
    placementSource: "ui-generator.__JSKIT_UI_RESOURCE_NAMESPACE__.new",
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
    invalidateQueryKey: ["ui-generator", "__JSKIT_UI_RESOURCE_NAMESPACE__"],
    listUrlTemplate: UI_LIST_URL
  }
});
</script>
