<template>
  <section class="contact-view-client-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">{{ title }}</v-card-title>
            <v-card-subtitle class="px-0">View and manage this CRUD record.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="text" :to="listPath">Back to crud</v-btn>
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
          <span>Loading record...</span>
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
import { useRouter } from "vue-router";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useView } from "@jskit-ai/users-web/client/composables/useView";
import {
  useContactsClientContext,
  toRouteContactId
} from "./clientSupport.js";

const router = useRouter();
const contactsContext = useContactsClientContext();
const contactsConfig = contactsContext.contactsConfig;
const listPath = contactsContext.listPath;
const contact = reactive({
  id: 0,
  name: "",
  surname: "",
  createdAt: "",
  updatedAt: ""
});

const contactId = computed(() => toRouteContactId(contactsContext.route.params.contactId));
const editPath = computed(() => contactsContext.resolveEditPath(contactId.value));
const title = computed(() => {
  const name = String(contact.name || "").trim();
  const surname = String(contact.surname || "").trim();
  return `${name} ${surname}`.trim() || "Record";
});

const view = useView({
  visibility: contactsConfig.visibility,
  apiSuffix: () => `${contactsConfig.relativePath}/${contactId.value}`,
  queryKeyFactory: (surfaceId = "") => contactsContext.viewQueryKey(surfaceId, contactId.value),
  fallbackLoadError: "Unable to load record.",
  notFoundMessage: "Record not found.",
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

const deleteCommand = useCommand({
  visibility: contactsConfig.visibility,
  apiSuffix: () => `${contactsConfig.relativePath}/${contactId.value}`,
  writeMethod: "DELETE",
  fallbackRunError: "Unable to delete record.",
  messages: {
    success: "Record deleted.",
    error: "Unable to delete record."
  },
  onRunSuccess: async (_, { queryClient }) => {
    await queryClient.invalidateQueries({
      queryKey: ["crud", "crud", contactsConfig.namespace]
    });

    if (listPath.value) {
      await router.push(listPath.value);
    }
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
  if (!window.confirm("Delete this record?")) {
    return;
  }

  await deleteCommand.run();
}
</script>
