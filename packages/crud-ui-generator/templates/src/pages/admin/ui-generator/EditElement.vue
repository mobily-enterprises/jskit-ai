<template>
  <section class="generated-ui-screen generated-ui-screen--operator ui-generator-edit-element d-flex flex-column ga-4">
    <header class="ui-generator-form-header">
      <div class="ui-generator-form-header__copy">
        <p class="text-overline text-medium-emphasis mb-1">Edit record</p>
        <h1 class="ui-generator-form-header__title">Edit __JSKIT_UI_RESOURCE_SINGULAR_TITLE__</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">Update the selected __JSKIT_UI_RESOURCE_SINGULAR_TITLE__.</p>
      </div>
      <div class="ui-generator-form-header__actions">
        <v-btn
          v-if="UI_CANCEL_URL"
          color="primary"
          variant="outlined"
          :to="{ path: formRuntime.addEdit.resolveParams(UI_CANCEL_URL), query: $route.query }"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="formRuntime.addEdit.isSaving"
          :disabled="formRuntime.addEdit.isSubmitDisabled"
          @click="formRuntime.addEdit.submit"
        >
          Save changes
        </v-btn>
      </div>
    </header>

    <v-sheet rounded="lg" border class="ui-generator-form-panel">
      <div v-if="formRuntime.addEdit.loadError" class="ui-generator-form-state">
        <h2 class="text-h6 mb-2">Unable to load __JSKIT_UI_RESOURCE_SINGULAR_TITLE__</h2>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ formRuntime.addEdit.loadError }}
        </p>
        <v-btn
          v-if="formRuntime.addEdit.canRetryLoad"
          color="primary"
          variant="tonal"
          :loading="formRuntime.addEdit.isFetching"
          @click="formRuntime.addEdit.refresh"
        >
          Retry
        </v-btn>
      </div>
      <template v-else-if="formRuntime.showFormSkeleton">
        <div class="pa-4">
          <v-skeleton-loader type="text@2, list-item-two-line@4, button" />
        </div>
      </template>
      <v-form v-else class="pa-4" @submit.prevent="formRuntime.addEdit.submit" novalidate>
        <v-progress-linear v-if="formRuntime.addEdit.isRefetching" indeterminate class="mb-4" />
        <v-row class="ui-generator-form-fields">
          <!-- jskit:crud-ui-fields:edit -->
__JSKIT_UI_EDIT_FORM_COLUMNS_DIRECT__
        </v-row>
      </v-form>
    </v-sheet>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useCrudAddEdit } from "@jskit-ai/users-web/client/composables/useCrudAddEdit";
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
const UI_EDIT_FORM_FIELDS = [];

// @jskit-contract crud.ui.form-fields.__JSKIT_UI_RESOURCE_NAMESPACE__.edit.v1
void UI_EDIT_FORM_FIELDS;
// jskit:crud-ui-form-fields:edit
__JSKIT_UI_EDIT_FORM_FIELD_PUSH_LINES__
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
const addEdit = formRuntime.addEdit;
const formState = formRuntime.form;

function resolveFieldErrors(fieldKey) {
  return formRuntime.resolveFieldErrors(fieldKey);
}
</script>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.35rem, 2vw, 1.85rem);
  --generated-ui-screen-state-padding: 2.5rem 1.25rem;
}

.generated-ui-screen--operator {
  --generated-ui-screen-state-padding: 2rem 1rem;
}

.ui-generator-form-header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.ui-generator-form-header__copy {
  min-width: 0;
}

.ui-generator-form-header__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.35rem;
}

.ui-generator-form-header__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.ui-generator-form-panel {
  overflow: hidden;
}

.ui-generator-form-state {
  margin-inline: auto;
  max-width: 30rem;
  padding: var(--generated-ui-screen-state-padding);
  text-align: center;
}

.ui-generator-form-fields :deep(.v-col) {
  min-width: 0;
}

@media (max-width: 960px) {
  .ui-generator-form-header {
    flex-direction: column;
  }

  .ui-generator-form-header__actions {
    width: 100%;
  }

  .ui-generator-form-header__actions :deep(.v-btn) {
    min-height: 48px;
    flex: 1 1 10rem;
  }

  .ui-generator-form-state :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
