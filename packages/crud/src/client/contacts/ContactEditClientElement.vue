<template>
  <section class="contact-edit-client-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">Edit contact</v-card-title>
            <v-card-subtitle class="px-0">Update the selected contact.</v-card-subtitle>
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
import { useRoute, useRouter } from "vue-router";
import { useGlobalAddEdit } from "@jskit-ai/users-web/client/composables/useGlobalAddEdit";
import { useUsersWebWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useUsersWebWorkspaceRouteContext";
import {
  contactsResource,
  contactViewQueryKey,
  createContactForm,
  assignContactToForm,
  buildContactPayload,
  parsePatchContactInput,
  resolveAdminContactViewPath,
  resolveAdminContactsListPath,
  toRouteContactId
} from "./contactsClientSupport.js";

const route = useRoute();
const router = useRouter();
const { placementContext, workspaceSlugFromRoute } = useUsersWebWorkspaceRouteContext();
const listPath = computed(() => resolveAdminContactsListPath(placementContext.value, workspaceSlugFromRoute.value));
const contactForm = reactive(createContactForm());
const contactId = computed(() => toRouteContactId(route.params.contactId));
const detailPath = computed(() =>
  resolveAdminContactViewPath(contactId.value, placementContext.value, workspaceSlugFromRoute.value)
);

const addEdit = useGlobalAddEdit({
  resource: contactsResource,
  apiSuffix: () => `/contacts/${contactId.value}`,
  queryKeyFactory: (surfaceId = "") => contactViewQueryKey(surfaceId, contactId.value),
  writeMethod: "PATCH",
  fallbackLoadError: "Unable to load contact.",
  fallbackSaveError: "Unable to save contact.",
  fieldErrorKeys: ["name", "surname"],
  model: contactForm,
  parseInput: parsePatchContactInput,
  mapLoadedToModel: assignContactToForm,
  buildRawPayload: buildContactPayload,
  onSaveSuccess: async (payload, { queryClient }) => {
    await queryClient.invalidateQueries({
      queryKey: ["crud", "contacts"]
    });

    const targetPath = resolveAdminContactViewPath(
      payload?.id || contactId.value,
      placementContext.value,
      workspaceSlugFromRoute.value
    );
    if (targetPath) {
      await router.push(targetPath);
    }
  }
});
</script>
