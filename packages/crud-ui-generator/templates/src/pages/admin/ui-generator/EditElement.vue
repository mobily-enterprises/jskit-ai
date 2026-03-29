<template>
  <section class="ui-generator-edit-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">Edit ${option:namespace|singular|pascal|default(Record)}</v-card-title>
            <v-card-subtitle class="px-0">Update the selected ${option:namespace|singular|default(record)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn
            v-if="UI_CANCEL_URL"
            variant="text"
            :to="formRuntime.addEdit.resolveParams(UI_CANCEL_URL)"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            :loading="formRuntime.addEdit.isSaving"
            :disabled="
              formRuntime.addEdit.isInitialLoading ||
              formRuntime.addEdit.isRefetching ||
              !formRuntime.addEdit.canSave
            "
            @click="formRuntime.addEdit.submit"
          >
            Save changes
          </v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <p v-if="formRuntime.addEdit.loadError" class="text-body-2 text-medium-emphasis mb-0">
          {{ formRuntime.addEdit.loadError }}
        </p>
        <template v-else-if="formRuntime.showFormSkeleton">
          <v-skeleton-loader type="text@2, list-item-two-line@4, button" />
        </template>
        <v-form v-else @submit.prevent="formRuntime.addEdit.submit" novalidate>
          <v-progress-linear v-if="formRuntime.addEdit.isRefetching" indeterminate class="mb-4" />
          <v-row>
            <!-- jskit:crud-ui-fields:edit -->
__JSKIT_UI_EDIT_FORM_COLUMNS__
          </v-row>
        </v-form>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useCrudSchemaForm } from "@jskit-ai/users-web/client/composables/useCrudSchemaForm";
import { createCrudLookupFieldRuntime } from "@jskit-ai/users-web/client/composables/crudLookupFieldRuntime";
import { ${option:resource-export|trim} as uiResource } from "/${option:resource-file|trim}";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "${option:id-param|trim}";
const UI_API_BASE_URL = "${option:api-path|trim}";
const UI_EDIT_API_URL = `${UI_API_BASE_URL}/:${UI_RECORD_ID_PARAM}`;
const UI_LIST_URL = __JSKIT_UI_HAS_LIST_ROUTE__ ? "../.." : "";
const UI_VIEW_URL = __JSKIT_UI_HAS_VIEW_ROUTE__ ? ".." : "";
const UI_CANCEL_URL = UI_VIEW_URL || UI_LIST_URL;
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;
const UI_EDIT_FORM_FIELDS = [];

// @jskit-contract crud.ui.form-fields.${option:namespace|snake}.edit.v1
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
</script>
