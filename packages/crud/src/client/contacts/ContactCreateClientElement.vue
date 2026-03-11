<template>
  <section class="contact-create-client-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">New contact</v-card-title>
            <v-card-subtitle class="px-0">Create a new contact record.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="text" :to="listPath || undefined">Cancel</v-btn>
          <v-btn color="primary" :loading="addEdit.isSaving" :disabled="addEdit.isLoading || !addEdit.canSave" @click="addEdit.submit">
            Save contact
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
import { reactive } from "vue";
import { useRouter } from "vue-router";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/contracts/operationValidation";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import {
  useContactsClientContext,
  contactsResource
} from "./contactsClientSupport.js";

const router = useRouter();
const contactsContext = useContactsClientContext();
const contactsConfig = contactsContext.contactsConfig;
const listPath = contactsContext.listPath;
const contactForm = reactive({
  name: "",
  surname: ""
});

const addEdit = useAddEdit({
  visibility: contactsConfig.visibility,
  resource: contactsResource,
  apiSuffix: contactsConfig.relativePath,
  queryKeyFactory: (surfaceId = "") => [...contactsContext.listQueryKey(surfaceId), "create"],
  readEnabled: false,
  writeMethod: "POST",
  fallbackSaveError: "Unable to save contact.",
  fieldErrorKeys: ["name", "surname"],
  model: contactForm,
  parseInput: (rawPayload) =>
    validateOperationSection({
      operation: contactsResource.operations.create,
      section: "body",
      value: rawPayload
    }),
  buildRawPayload: (model) => ({
    name: model.name,
    surname: model.surname
  }),
  onSaveSuccess: async (payload, { queryClient }) => {
    await queryClient.invalidateQueries({
      queryKey: ["crud", "contacts", contactsConfig.namespace]
    });

    const targetPath = contactsContext.resolveViewPath(payload?.id);
    if (targetPath) {
      await router.push(targetPath);
    }
  }
});
</script>
