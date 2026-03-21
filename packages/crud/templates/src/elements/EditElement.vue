<template>
  <section class="crud-edit-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">Edit ${option:namespace|singular|pascal|default(Record)}</v-card-title>
            <v-card-subtitle class="px-0">Update the selected ${option:namespace|singular|default(record)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="text" :to="viewPath || listPath">Cancel</v-btn>
          <v-btn color="primary" :loading="addEdit.isSaving" :disabled="addEdit.isLoading || !addEdit.canSave" @click="addEdit.submit">
            Save changes
          </v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-form v-if="!addEdit.loadError" @submit.prevent="addEdit.submit" novalidate>
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="recordForm.textField"
                label="Text field"
                variant="outlined"
                density="comfortable"
                maxlength="160"
                :readonly="!addEdit.canSave || addEdit.isSaving"
                :error-messages="addEdit.fieldErrors.textField ? [addEdit.fieldErrors.textField] : []"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="recordForm.dateField"
                label="Date field"
                type="date"
                variant="outlined"
                density="comfortable"
                :readonly="!addEdit.canSave || addEdit.isSaving"
                :error-messages="addEdit.fieldErrors.dateField ? [addEdit.fieldErrors.dateField] : []"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="recordForm.numberField"
                label="Number field"
                type="number"
                variant="outlined"
                density="comfortable"
                :readonly="!addEdit.canSave || addEdit.isSaving"
                :error-messages="addEdit.fieldErrors.numberField ? [addEdit.fieldErrors.numberField] : []"
              />
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { reactive } from "vue";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import {
  crudResource,
  useCrudRecordRuntime,
  useCrudModulePolicyRuntime
} from "./clientSupport.js";

const {
  listPath,
  recordId,
  viewPath,
  apiSuffix,
  viewQueryKey,
  invalidateAndGoView
} = useCrudRecordRuntime();
const { ownershipFilter, surfaceId } = useCrudModulePolicyRuntime();
const recordForm = reactive({
  textField: "",
  dateField: "",
  numberField: ""
});

function toDateInputValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return normalized.slice(0, 10);
}

const addEdit = useAddEdit({
  ownershipFilter,
  surfaceId,
  resource: crudResource,
  apiSuffix,
  queryKeyFactory: viewQueryKey,
  writeMethod: "PATCH",
  fallbackLoadError: "Unable to load record.",
  fallbackSaveError: "Unable to save record.",
  fieldErrorKeys: ["textField", "dateField", "numberField"],
  model: recordForm,
  parseInput: (rawPayload) =>
    validateOperationSection({
      operation: crudResource.operations.patch,
      section: "bodyValidator",
      value: rawPayload
    }),
  mapLoadedToModel: (model, payload = {}) => {
    model.textField = String(payload?.textField || "");
    model.dateField = toDateInputValue(payload?.dateField);
    model.numberField = String(payload?.numberField ?? "");
  },
  buildRawPayload: (model) => ({
    textField: model.textField,
    dateField: model.dateField,
    numberField: model.numberField
  }),
  onSaveSuccess: async (payload, { queryClient }) => {
    await invalidateAndGoView(queryClient, payload?.id || recordId.value);
  }
});
</script>
