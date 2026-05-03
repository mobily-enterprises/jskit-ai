<template>
  <section class="ui-generator-view-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">
              {{
                view.resolveRecordTitle(view.record, {
                  fallbackKey: UI_VIEW_TITLE_FALLBACK_FIELD_KEY,
                  defaultValue: "__JSKIT_UI_RESOURCE_SINGULAR_TITLE__"
                })
              }}
            </v-card-title>
            <v-card-subtitle class="px-0">View and manage this __JSKIT_UI_RESOURCE_SINGULAR_TITLE__.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn
            v-if="UI_LIST_URL"
            color="primary"
            variant="outlined"
            :to="{ path: view.resolveParams(UI_LIST_URL), query: $route.query }"
          >
            Back to __JSKIT_UI_RESOURCE_PLURAL_TITLE__
          </v-btn>
          <v-btn
            v-if="UI_EDIT_URL"
            color="primary"
            variant="flat"
            :to="{ path: view.resolveParams(UI_EDIT_URL), query: $route.query }"
          >
            Edit
          </v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <div v-if="view.loadError || view.isNotFound" class="text-body-2 text-medium-emphasis py-2">
          Record unavailable.
        </div>

        <template v-else-if="view.isLoading">
          <v-skeleton-loader type="text@2, list-item-two-line@5" />
        </template>

        <template v-else>
          <v-progress-linear v-if="view.isRefetching" indeterminate class="mb-4" />
          <v-row>
__JSKIT_UI_VIEW_COLUMNS__
            <!-- jskit:crud-ui-fields:view -->
          </v-row>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useCrudView } from "@jskit-ai/users-web/client/composables/useCrudView";
import { resource as uiResource } from "__JSKIT_UI_RESOURCE_IMPORT_PATH__";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "__JSKIT_UI_RECORD_ID_PARAM__";
const UI_API_BASE_URL = "__JSKIT_UI_API_BASE_URL__";
const UI_VIEW_API_URL = `${UI_API_BASE_URL}/:${UI_RECORD_ID_PARAM}`;
const UI_LIST_URL = __JSKIT_UI_VIEW_PAGE_LIST_URL__;
const UI_EDIT_URL = __JSKIT_UI_VIEW_PAGE_EDIT_URL__;
const UI_VIEW_TITLE_FALLBACK_FIELD_KEY = __JSKIT_UI_VIEW_TITLE_FALLBACK_FIELD_KEY__;
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;

const view = useCrudView({
  adapter: UI_OPERATION_ADAPTER || undefined,
  resource: uiResource,
  apiUrlTemplate: UI_VIEW_API_URL,
  recordIdParam: UI_RECORD_ID_PARAM,
  includeRecordIdInQueryKey: true,
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "ui-generator",
    "__JSKIT_UI_RESOURCE_NAMESPACE__",
    "view",
    String(surfaceId || ""),
    String(workspaceSlug || "")
  ],
  placementSource: "ui-generator.__JSKIT_UI_RESOURCE_NAMESPACE__.view",
  fallbackLoadError: "Unable to load record.",
  notFoundMessage: "Record not found.",
  listUrlTemplate: UI_LIST_URL,
  editUrlTemplate: UI_EDIT_URL,
  realtime: UI_RECORD_CHANGED_EVENT
    ? {
        event: UI_RECORD_CHANGED_EVENT
      }
    : null
});

</script>
