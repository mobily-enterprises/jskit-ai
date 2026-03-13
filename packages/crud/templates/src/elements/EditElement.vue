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
          <v-btn variant="text" :to="detailPath || listPath">Cancel</v-btn>
          <v-btn color="primary" :loading="addEdit.isSaving" :disabled="addEdit.isLoading || !addEdit.canSave" @click="addEdit.submit">
            Save changes
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
import { computed, reactive } from "vue";
import { useRouter } from "vue-router";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import { useCrudClientContext, crudResource, toRouteRecordId } from "./clientSupport.js";

const router = useRouter();
const crudContext = useCrudClientContext();
const crudConfig = crudContext.crudConfig;
const listPath = crudContext.listPath;
const recordForm = reactive({
  name: "",
  surname: ""
});
const recordId = computed(() => toRouteRecordId(crudContext.route.params.recordId));
const detailPath = computed(() => crudContext.resolveViewPath(recordId.value));

const addEdit = useAddEdit({
  visibility: crudConfig.visibility,
  resource: crudResource,
  apiSuffix: () => `${crudConfig.relativePath}/${recordId.value}`,
  queryKeyFactory: (surfaceId = "") => crudContext.viewQueryKey(surfaceId, recordId.value),
  writeMethod: "PATCH",
  fallbackLoadError: "Unable to load record.",
  fallbackSaveError: "Unable to save record.",
  fieldErrorKeys: ["name", "surname"],
  model: recordForm,
  parseInput: (rawPayload) =>
    validateOperationSection({
      operation: crudResource.operations.patch,
      section: "bodyValidator",
      value: rawPayload
    }),
  mapLoadedToModel: (model, payload = {}) => {
    model.name = String(payload?.name || "");
    model.surname = String(payload?.surname || "");
  },
  buildRawPayload: (model) => ({
    name: model.name,
    surname: model.surname
  }),
  onSaveSuccess: async (payload, { queryClient }) => {
    await crudContext.invalidateQueries(queryClient);

    const targetPath = crudContext.resolveViewPath(payload?.id || recordId.value);
    if (targetPath) {
      await router.push(targetPath);
    }
  }
});
</script>
