<template>
  <section class="generated-ui-screen generated-ui-screen--operator ui-generator-view-element d-flex flex-column ga-4">
    <header class="ui-generator-view-header">
      <div class="ui-generator-view-header__copy">
        <p class="text-overline text-medium-emphasis mb-1">__JSKIT_UI_RESOURCE_SINGULAR_TITLE__</p>
        <h1 class="ui-generator-view-header__title">
          {{
            view.resolveRecordTitle(view.record, {
              fallbackKey: UI_VIEW_TITLE_FALLBACK_FIELD_KEY,
              defaultValue: "__JSKIT_UI_RESOURCE_SINGULAR_TITLE__"
            })
          }}
        </h1>
        <p class="text-body-2 text-medium-emphasis mb-0">Review this __JSKIT_UI_RESOURCE_SINGULAR_TITLE__ record.</p>
      </div>
      <div class="ui-generator-view-header__actions">
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
    </header>

    <v-sheet rounded="lg" border class="ui-generator-view-panel">
      <div v-if="view.loadError || view.isNotFound" class="ui-generator-view-state">
        <h2 class="text-h6 mb-2">Record unavailable</h2>
        <p class="text-body-2 text-medium-emphasis mb-0">
          {{ view.loadError || "This __JSKIT_UI_RESOURCE_SINGULAR_TITLE__ could not be found." }}
        </p>
      </div>

      <template v-else-if="view.isLoading">
        <div class="pa-4">
          <v-skeleton-loader type="text@2, list-item-two-line@5" />
        </div>
      </template>

      <template v-else>
        <v-progress-linear v-if="view.isRefetching" indeterminate />
        <div class="pa-4">
          <v-row class="ui-generator-view-fields">
__JSKIT_UI_VIEW_COLUMNS__
            <!-- jskit:crud-ui-fields:view -->
          </v-row>
        </div>
      </template>
    </v-sheet>
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

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.35rem, 2vw, 1.85rem);
  --generated-ui-screen-state-padding: 2.5rem 1.25rem;
}

.generated-ui-screen--operator {
  --generated-ui-screen-state-padding: 2rem 1rem;
}

.ui-generator-view-header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.ui-generator-view-header__copy {
  min-width: 0;
}

.ui-generator-view-header__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.35rem;
  overflow-wrap: anywhere;
}

.ui-generator-view-header__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.ui-generator-view-panel {
  overflow: hidden;
}

.ui-generator-view-state {
  margin-inline: auto;
  max-width: 30rem;
  padding: var(--generated-ui-screen-state-padding);
  text-align: center;
}

.ui-generator-view-fields :deep(.v-col) {
  min-width: 0;
}

@media (max-width: 960px) {
  .ui-generator-view-header {
    flex-direction: column;
  }

  .ui-generator-view-header__actions {
    width: 100%;
  }

  .ui-generator-view-header__actions :deep(.v-btn) {
    min-height: 48px;
    flex: 1 1 10rem;
  }
}
</style>
