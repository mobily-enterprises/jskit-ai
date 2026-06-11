<template>
  <CrudViewScreen
    :screen="screen"
    resource-singular-title="__JSKIT_UI_RESOURCE_SINGULAR_TITLE__"
    resource-plural-title="__JSKIT_UI_RESOURCE_PLURAL_TITLE__"
    description="Review this __JSKIT_UI_RESOURCE_SINGULAR_TITLE__ record."
  >
    <template #fields="{ view }">
__JSKIT_UI_VIEW_COLUMNS__
      <!-- jskit:crud-ui-fields:view -->
    </template>
  </CrudViewScreen>
</template>

<script setup>
import CrudViewScreen from "@jskit-ai/users-web/client/components/CrudViewScreen";
import { useCrudViewScreen } from "@jskit-ai/users-web/client/composables/useCrudViewScreen";
import { resource as uiResource } from "__JSKIT_UI_RESOURCE_IMPORT_PATH__";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "__JSKIT_UI_RECORD_ID_PARAM__";
const UI_API_BASE_URL = "__JSKIT_UI_API_BASE_URL__";
const UI_VIEW_API_URL = `${UI_API_BASE_URL}/:${UI_RECORD_ID_PARAM}`;
const UI_LIST_URL = __JSKIT_UI_VIEW_PAGE_LIST_URL__;
const UI_EDIT_URL = __JSKIT_UI_VIEW_PAGE_EDIT_URL__;
const UI_VIEW_TITLE_FALLBACK_FIELD_KEY = __JSKIT_UI_VIEW_TITLE_FALLBACK_FIELD_KEY__;
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;

const screen = useCrudViewScreen({
  adapter: UI_OPERATION_ADAPTER || undefined,
  resource: uiResource,
  resourceNamespace: "__JSKIT_UI_RESOURCE_NAMESPACE__",
  apiUrlTemplate: UI_VIEW_API_URL,
  recordIdParam: UI_RECORD_ID_PARAM,
  titleFallbackFieldKey: UI_VIEW_TITLE_FALLBACK_FIELD_KEY,
  listUrlTemplate: UI_LIST_URL,
  editUrlTemplate: UI_EDIT_URL,
  recordChangedEvent: UI_RECORD_CHANGED_EVENT,
  fallbackLoadError: "Unable to load record.",
  notFoundMessage: "Record not found."
});
</script>
