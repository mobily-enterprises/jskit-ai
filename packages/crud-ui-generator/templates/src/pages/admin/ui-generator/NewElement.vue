<template>
  <section class="ui-generator-new-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">New __JSKIT_UI_RESOURCE_SINGULAR_TITLE__</v-card-title>
            <v-card-subtitle class="px-0">Create a new __JSKIT_UI_RESOURCE_SINGULAR_TITLE__.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn v-if="UI_LIST_URL" variant="text" :to="formRuntime.addEdit.resolveParams(UI_LIST_URL)">Cancel</v-btn>
          <v-btn
            color="primary"
            :loading="formRuntime.addEdit.isSaving"
            :disabled="formRuntime.addEdit.isSubmitDisabled"
            @click="formRuntime.addEdit.submit"
          >
            Save __JSKIT_UI_RESOURCE_SINGULAR_TITLE__
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
import { useCrudAddEdit } from "@jskit-ai/users-web/client/composables/useCrudAddEdit";
import { createCrudLookupFieldRuntime } from "@jskit-ai/users-web/client/composables/crudLookupFieldRuntime";
import { resource as uiResource } from "__JSKIT_UI_RESOURCE_IMPORT_PATH__";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "__JSKIT_UI_RECORD_ID_PARAM__";
const UI_CREATE_API_URL = "__JSKIT_UI_API_BASE_URL__";
const UI_LIST_URL = __JSKIT_UI_NEW_PAGE_LIST_URL__;
const UI_VIEW_URL = __JSKIT_UI_NEW_PAGE_VIEW_URL__;
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;
const UI_CREATE_FORM_FIELDS = [];

// @jskit-contract crud.ui.form-fields.__JSKIT_UI_RESOURCE_NAMESPACE__.new.v1
void UI_CREATE_FORM_FIELDS;
// jskit:crud-ui-form-fields:new
__JSKIT_UI_CREATE_FORM_FIELD_PUSH_LINES__
Object.freeze(UI_CREATE_FORM_FIELDS);

const lookupFieldRuntime = createCrudLookupFieldRuntime({
  formFields: UI_CREATE_FORM_FIELDS,
  adapter: UI_OPERATION_ADAPTER || undefined,
  recordIdParam: UI_RECORD_ID_PARAM,
  lookupContainerKey: uiResource?.contract?.lookup?.containerKey,
  queryKeyPrefix: ["ui-generator", "__JSKIT_UI_RESOURCE_NAMESPACE__", "lookup", "new"],
  placementSourcePrefix: "ui-generator.__JSKIT_UI_RESOURCE_NAMESPACE__.new.lookup"
});
const {
  resolveLookupItems,
  resolveLookupLoading,
  resolveLookupSearch,
  setLookupSearch
} = lookupFieldRuntime;

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
const addEdit = formRuntime.addEdit;
const formState = formRuntime.form;

function resolveFieldErrors(fieldKey) {
  return formRuntime.resolveFieldErrors(fieldKey);
}
</script>
