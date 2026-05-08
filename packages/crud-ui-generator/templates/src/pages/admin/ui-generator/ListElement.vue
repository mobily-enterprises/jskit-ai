<template>
  <CrudListScreen
    :screen="screen"
    title-label="__JSKIT_UI_RESOURCE_PLURAL_TITLE__"
    :heading-title="listHeadingTitle"
    subtitle="Search, review, and update __JSKIT_UI_RESOURCE_PLURAL_TITLE__ from this screen."
    create-label="__JSKIT_UI_LIST_CREATE_LABEL__"
    load-error-title="__JSKIT_UI_LIST_LOAD_ERROR_TITLE__"
    load-error-body="__JSKIT_UI_LIST_LOAD_ERROR_BODY__"
    empty-title="__JSKIT_UI_LIST_EMPTY_TITLE__"
    empty-body="__JSKIT_UI_LIST_EMPTY_BODY__"
  >
    <template #card-fields="{ record, records, formatListCardValue }">
__JSKIT_UI_LIST_CARD_FIELDS__
      <!-- jskit:crud-ui-fields:list-card -->
    </template>

    <template #table-header>
__JSKIT_UI_LIST_HEADER_COLUMNS__
      <!-- jskit:crud-ui-fields:list-header -->
    </template>

    <template #table-row="{ record, records }">
__JSKIT_UI_LIST_ROW_COLUMNS__
      <!-- jskit:crud-ui-fields:list-row -->
    </template>
  </CrudListScreen>
</template>

<script setup>
import { computed } from "vue";
__JSKIT_UI_LIST_PARENT_TITLE_IMPORT_LINE__
import CrudListScreen from "@jskit-ai/users-web/client/components/CrudListScreen";
import { useCrudListScreen } from "@jskit-ai/users-web/client/composables/useCrudListScreen";
import { resource as uiResource } from "__JSKIT_UI_RESOURCE_IMPORT_PATH__";
import { listBulkActions } from "./listBulkActions.js";
import { listFilters } from "./listFilters.js";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "__JSKIT_UI_RECORD_ID_PARAM__";
const UI_LIST_API_URL = "__JSKIT_UI_API_BASE_URL__";
const UI_VIEW_URL = __JSKIT_UI_LIST_PAGE_VIEW_URL__;
const UI_EDIT_URL = __JSKIT_UI_LIST_PAGE_EDIT_URL__;
const UI_NEW_URL = __JSKIT_UI_LIST_PAGE_NEW_URL__;
const UI_RECORD_CHANGED_EVENTS = __JSKIT_UI_LIST_REALTIME_EVENTS__;
const UI_ROUTE_QUERY_BLACKLIST = Object.freeze(["include", "cursor", "limit"]);
const UI_LIST_TITLE_FALLBACK_FIELD_KEY = __JSKIT_UI_LIST_TITLE_FALLBACK_FIELD_KEY__;

const screen = useCrudListScreen({
  adapter: UI_OPERATION_ADAPTER || undefined,
  resource: uiResource,
  resourceNamespace: "__JSKIT_UI_RESOURCE_NAMESPACE__",
  apiSuffix: UI_LIST_API_URL,
  recordIdParam: UI_RECORD_ID_PARAM,
  recordIdSelector: (item = {}) => __JSKIT_UI_LIST_RECORD_ID_EXPR__,
  titleFallbackFieldKey: UI_LIST_TITLE_FALLBACK_FIELD_KEY,
  viewUrlTemplate: UI_VIEW_URL,
  editUrlTemplate: UI_EDIT_URL,
  newUrlTemplate: UI_NEW_URL,
  recordChangedEvents: UI_RECORD_CHANGED_EVENTS,
  listFilters,
  listBulkActions,
  routeQueryBlacklist: UI_ROUTE_QUERY_BLACKLIST,
  fallbackLoadError: "Unable to load records."
});
const records = screen.records;

__JSKIT_UI_LIST_HEADING_TITLE_SETUP__
</script>
