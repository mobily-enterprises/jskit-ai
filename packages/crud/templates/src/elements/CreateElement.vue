<template>
  <section class="crud-create-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">New ${option:namespace|singular|pascal|default(Record)}</v-card-title>
            <v-card-subtitle class="px-0">Create a new ${option:namespace|singular|default(record)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="text" :to="listPath || undefined">Cancel</v-btn>
          <v-btn color="primary" :loading="addEdit.isSaving" :disabled="addEdit.isLoading || !addEdit.canSave" @click="addEdit.submit">
            Save ${option:namespace|singular|default(record)}
          </v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-alert v-if="addEdit.loadError" type="error" variant="tonal" class="mb-4">
          {{ addEdit.loadError }}
        </v-alert>

        <v-form v-else @submit.prevent="addEdit.submit" novalidate>
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="recordForm.name"
                label="Name"
                variant="outlined"
                density="comfortable"
                maxlength="160"
                :readonly="!addEdit.canSave || addEdit.isSaving"
                :error-messages="addEdit.fieldErrors.name ? [addEdit.fieldErrors.name] : []"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="recordForm.surname"
                label="Surname"
                variant="outlined"
                density="comfortable"
                maxlength="160"
                :readonly="!addEdit.canSave || addEdit.isSaving"
                :error-messages="addEdit.fieldErrors.surname ? [addEdit.fieldErrors.surname] : []"
              />
            </v-col>
          </v-row>
        </v-form>

        <v-alert v-if="addEdit.message" :type="addEdit.messageType" variant="tonal" class="mt-4 mb-0">
          {{ addEdit.message }}
        </v-alert>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { reactive } from "vue";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import { crudModuleConfig } from "../shared/moduleConfig.js";
import { crudResource, useCrudCreateRuntime } from "./clientSupport.js";

const {
  listPath,
  apiSuffix,
  createQueryKey,
  invalidateAndGoView
} = useCrudCreateRuntime();
const recordForm = reactive({
  name: "",
  surname: ""
});

const addEdit = useAddEdit({
  visibility: crudModuleConfig.visibility,
  resource: crudResource,
  apiSuffix,
  queryKeyFactory: createQueryKey,
  readEnabled: false,
  writeMethod: "POST",
  fallbackSaveError: "Unable to save record.",
  fieldErrorKeys: ["name", "surname"],
  model: recordForm,
  parseInput: (rawPayload) =>
    validateOperationSection({
      operation: crudResource.operations.create,
      section: "bodyValidator",
      value: rawPayload
    }),
  buildRawPayload: (model) => ({
    name: model.name,
    surname: model.surname
  }),
  onSaveSuccess: async (payload, { queryClient }) => {
    await invalidateAndGoView(queryClient, payload?.id);
  }
});
</script>
