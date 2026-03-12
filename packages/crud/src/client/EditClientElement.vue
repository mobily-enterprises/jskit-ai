<template>
  <section class="contact-edit-client-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">Edit record</v-card-title>
            <v-card-subtitle class="px-0">Update the selected CRUD record.</v-card-subtitle>
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
                v-model="contactForm.name"
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
                v-model="contactForm.surname"
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
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/contracts/operationValidation";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import {
  useContactsClientContext,
  contactsResource,
  toRouteContactId
} from "./clientSupport.js";

const router = useRouter();
const contactsContext = useContactsClientContext();
const contactsConfig = contactsContext.contactsConfig;
const listPath = contactsContext.listPath;
const contactForm = reactive({
  name: "",
  surname: ""
});
const contactId = computed(() => toRouteContactId(contactsContext.route.params.contactId));
const detailPath = computed(() => contactsContext.resolveViewPath(contactId.value));

const addEdit = useAddEdit({
  visibility: contactsConfig.visibility,
  resource: contactsResource,
  apiSuffix: () => `${contactsConfig.relativePath}/${contactId.value}`,
  queryKeyFactory: (surfaceId = "") => contactsContext.viewQueryKey(surfaceId, contactId.value),
  writeMethod: "PATCH",
  fallbackLoadError: "Unable to load record.",
  fallbackSaveError: "Unable to save record.",
  fieldErrorKeys: ["name", "surname"],
  model: contactForm,
  parseInput: (rawPayload) =>
    validateOperationSection({
      operation: contactsResource.operations.patch,
      section: "body",
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
    await queryClient.invalidateQueries({
      queryKey: ["crud", "crud", contactsConfig.namespace]
    });

    const targetPath = contactsContext.resolveViewPath(payload?.id || contactId.value);
    if (targetPath) {
      await router.push(targetPath);
    }
  }
});
</script>
