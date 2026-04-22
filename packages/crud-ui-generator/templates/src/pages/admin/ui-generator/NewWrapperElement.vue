<template>
  <CrudAddEditForm
    mode="new"
    :form-runtime="formRuntime"
    title="New __JSKIT_UI_RESOURCE_SINGULAR_TITLE__"
    subtitle="Create a new __JSKIT_UI_RESOURCE_SINGULAR_TITLE__."
    save-label="Save __JSKIT_UI_RESOURCE_SINGULAR_TITLE__"
    :cancel-to="UI_CANCEL_URL"__JSKIT_UI_CREATE_LOOKUP_FORM_PROPS__
  />
</template>

<script setup>
import { useCrudAddEdit } from "@jskit-ai/users-web/client/composables/useCrudAddEdit";
__JSKIT_UI_CREATE_LOOKUP_IMPORT_LINE__
import { resource as uiResource } from "__JSKIT_UI_RESOURCE_IMPORT_PATH__";
import CrudAddEditForm from "./_components/__JSKIT_UI_FORM_COMPONENT_FILE__";
import { UI_CREATE_FORM_FIELDS } from "./_components/__JSKIT_UI_FORM_FIELDS_FILE__";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "__JSKIT_UI_RECORD_ID_PARAM__";
const UI_CREATE_API_URL = "__JSKIT_UI_API_BASE_URL__";
const UI_LIST_URL = __JSKIT_UI_NEW_PAGE_LIST_URL__;
const UI_VIEW_URL = __JSKIT_UI_NEW_PAGE_VIEW_URL__;
const UI_CANCEL_URL = UI_LIST_URL;
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;

// jskit:crud-ui-fields-target ./_components/__JSKIT_UI_FORM_COMPONENT_FILE__
// jskit:crud-ui-form-fields-target ./_components/__JSKIT_UI_FORM_FIELDS_FILE__

__JSKIT_UI_CREATE_LOOKUP_RUNTIME_SETUP__

const formRuntime = useCrudAddEdit({
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
