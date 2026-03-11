<template>
  <section class="contact-view-client-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">{{ title }}</v-card-title>
            <v-card-subtitle class="px-0">View and manage this contact.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="text" :to="listPath">Back to contacts</v-btn>
          <v-btn color="primary" variant="outlined" :to="editPath || undefined" :disabled="!editPath">Edit</v-btn>
          <v-btn color="error" variant="tonal" :loading="deleteCommand.isRunning" @click="confirmDelete">Delete</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
          {{ loadError }}
        </v-alert>

        <v-alert v-else-if="isNotFound" type="warning" variant="tonal" class="mb-4">
          {{ notFoundError }}
        </v-alert>

        <div v-else-if="isLoading" class="d-flex align-center ga-3 text-medium-emphasis">
          <v-progress-circular indeterminate size="18" width="2" />
          <span>Loading contact...</span>
        </div>

        <template v-else>
          <v-row>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Name</div>
              <div class="text-body-1">{{ contact.name }}</div>
            </v-col>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Surname</div>
              <div class="text-body-1">{{ contact.surname }}</div>
            </v-col>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Created</div>
              <div class="text-body-1">{{ formatDateTime(contact.createdAt) }}</div>
            </v-col>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Updated</div>
              <div class="text-body-1">{{ formatDateTime(contact.updatedAt) }}</div>
            </v-col>
          </v-row>
        </template>

        <v-alert v-if="deleteCommand.message" :type="deleteCommand.messageType" variant="tonal" class="mt-4 mb-0">
          {{ deleteCommand.message }}
        </v-alert>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useGlobalCommand } from "@jskit-ai/users-web/client/composables/useGlobalCommand";
import { useGlobalView } from "@jskit-ai/users-web/client/composables/useGlobalView";
import { useUsersWebWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useUsersWebWorkspaceRouteContext";
import {
  contactViewQueryKey,
  resolveAdminContactEditPath,
  resolveAdminContactsListPath,
  toRouteContactId
} from "./contactsClientSupport.js";

const route = useRoute();
const router = useRouter();
const { placementContext, workspaceSlugFromRoute } = useUsersWebWorkspaceRouteContext();
const listPath = computed(() => resolveAdminContactsListPath(placementContext.value, workspaceSlugFromRoute.value));
const contact = reactive({
  id: 0,
  name: "",
  surname: "",
  createdAt: "",
  updatedAt: ""
});

const contactId = computed(() => toRouteContactId(route.params.contactId));
const editPath = computed(() =>
  resolveAdminContactEditPath(contactId.value, placementContext.value, workspaceSlugFromRoute.value)
);
const title = computed(() => {
  const name = String(contact.name || "").trim();
  const surname = String(contact.surname || "").trim();
  return `${name} ${surname}`.trim() || "Contact";
});

const view = useGlobalView({
  apiSuffix: () => `/contacts/${contactId.value}`,
  queryKeyFactory: (surfaceId = "") => contactViewQueryKey(surfaceId, contactId.value),
  fallbackLoadError: "Unable to load contact.",
  notFoundMessage: "Contact not found.",
  model: contact,
  mapLoadedToModel: (model, payload = {}) => {
    model.id = Number(payload.id || 0);
    model.name = String(payload.name || "");
    model.surname = String(payload.surname || "");
    model.createdAt = String(payload.createdAt || "");
    model.updatedAt = String(payload.updatedAt || "");
  }
});
const loadError = computed(() => view.loadError.value);
const isNotFound = computed(() => view.isNotFound.value);
const notFoundError = computed(() => view.notFoundError.value);
const isLoading = computed(() => view.isLoading.value);

const deleteCommand = useGlobalCommand({
  apiSuffix: () => `/contacts/${contactId.value}`,
  writeMethod: "DELETE",
  fallbackRunError: "Unable to delete contact.",
  messages: {
    success: "Contact deleted.",
    error: "Unable to delete contact."
  },
  onRunSuccess: async (_, { queryClient }) => {
    await queryClient.invalidateQueries({
      queryKey: ["crud", "contacts"]
    });

    await router.push(listPath.value || "/admin/contacts");
  }
});

function formatDateTime(value) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "unknown";
  }

  return parsedDate.toLocaleString();
}

async function confirmDelete() {
  if (!window.confirm("Delete this contact?")) {
    return;
  }

  await deleteCommand.run();
}
</script>
