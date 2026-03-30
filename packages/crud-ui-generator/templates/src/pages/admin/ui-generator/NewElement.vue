<template>
  <section class="ui-generator-new-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">New ${option:namespace|singular|pascal|default(Record)}</v-card-title>
            <v-card-subtitle class="px-0">Create a new ${option:namespace|singular|default(record)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn v-if="UI_LIST_URL" variant="text" :to="formRuntime.addEdit.resolveParams(UI_LIST_URL)">Cancel</v-btn>
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
            Save ${option:namespace|singular|default(record)}
          </v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <p v-if="formRuntime.addEdit.loadError" class="text-body-2 text-medium-emphasis mb-0">
          {{ formRuntime.addEdit.loadError }}
        </p>
        <v-form v-else @submit.prevent="formRuntime.addEdit.submit" novalidate>
          <v-row>
            <!-- jskit:crud-ui-fields:new -->
__JSKIT_UI_CREATE_FORM_COLUMNS__
          </v-row>
        </v-form>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useCrudSchemaForm } from "@jskit-ai/users-web/client/composables/useCrudSchemaForm";
import { createCrudLookupFieldRuntime } from "@jskit-ai/users-web/client/composables/crudLookupFieldRuntime";
import { resource as uiResource } from "/${option:resource-file|trim}";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "${option:id-param|trim}";
const UI_CREATE_API_URL = "${option:api-path|trim}";
const UI_LIST_URL = __JSKIT_UI_HAS_LIST_ROUTE__ ? ".." : "";
const UI_VIEW_URL = __JSKIT_UI_HAS_VIEW_ROUTE__ ? `../:${UI_RECORD_ID_PARAM}` : "";
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;
const UI_CREATE_FORM_FIELDS = [];

// @jskit-contract crud.ui.form-fields.${option:namespace|snake}.new.v1
void UI_CREATE_FORM_FIELDS;
// jskit:crud-ui-form-fields:new
__JSKIT_UI_CREATE_FORM_FIELD_PUSH_LINES__
Object.freeze(UI_CREATE_FORM_FIELDS);

const lookupFieldRuntime = createCrudLookupFieldRuntime({
  formFields: UI_CREATE_FORM_FIELDS,
  adapter: UI_OPERATION_ADAPTER || undefined,
  recordIdParam: UI_RECORD_ID_PARAM,
  lookupContainerKey: uiResource?.contract?.lookup?.containerKey,
  queryKeyPrefix: ["ui-generator", "${option:namespace|kebab}", "lookup", "new"],
  placementSourcePrefix: "ui-generator.${option:namespace|kebab}.new.lookup"
});
const {
  resolveLookupItems,
  resolveLookupLoading,
  resolveLookupSearch,
  setLookupSearch
} = lookupFieldRuntime;

const formRuntime = useCrudSchemaForm({
  resource: uiResource,
  operationName: "create",
  formFields: UI_CREATE_FORM_FIELDS,
  addEditOptions: {
    adapter: UI_OPERATION_ADAPTER || undefined,
    apiSuffix: UI_CREATE_API_URL,
    queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
      "ui-generator",
      "${option:namespace|kebab}",
      "create",
      String(surfaceId || ""),
      String(workspaceSlug || "")
    ],
    placementSource: "ui-generator.${option:namespace|kebab}.new",
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
    invalidateQueryKey: ["ui-generator", "${option:namespace|kebab}"],
    listUrlTemplate: UI_LIST_URL
  }
});
</script>
