<template>
  <section class="record-create-client-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">New record</v-card-title>
            <v-card-subtitle class="px-0">Create a new CRUD record.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="text" :to="listPath || undefined">Cancel</v-btn>
          <v-btn color="primary" :loading="addEdit.isSaving" :disabled="addEdit.isLoading || !addEdit.canSave" @click="addEdit.submit">
            Save record
          </v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-form v-if="!addEdit.loadError" @submit.prevent="addEdit.submit" novalidate>
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
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { reactive } from "vue";
import { useRouter } from "vue-router";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import {
  useCrudClientContext,
  crudResource
} from "./clientSupport.js";

const router = useRouter();
const crudContext = useCrudClientContext();
const crudConfig = crudContext.crudConfig;
const listPath = crudContext.listPath;
const recordForm = reactive({
  name: "",
  surname: ""
});

const addEdit = useAddEdit({
  visibility: crudConfig.visibility,
  resource: crudResource,
  apiSuffix: crudConfig.relativePath,
  queryKeyFactory: (surfaceId = "") => [...crudContext.listQueryKey(surfaceId), "create"],
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
    await crudContext.invalidateQueries(queryClient);

    const targetPath = crudContext.resolveViewPath(payload?.id);
    if (targetPath) {
      await router.push(targetPath);
    }
  }
});
</script>
