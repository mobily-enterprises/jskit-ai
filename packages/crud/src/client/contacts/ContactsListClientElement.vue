<template>
  <section class="contacts-list-client-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">Contacts</v-card-title>
            <v-card-subtitle class="px-0">Manage the contacts available in the admin surface.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="outlined" :loading="isLoading" @click="contacts.reload">Refresh</v-btn>
          <v-btn color="primary" :to="createPath || undefined">New contact</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
          {{ loadError }}
        </v-alert>

        <v-table density="comfortable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Surname</th>
              <th>Updated</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="items.length < 1">
              <td colspan="4" class="text-center py-6 text-medium-emphasis">No contacts yet.</td>
            </tr>
            <tr v-for="contact in items" :key="contact.id">
              <td>{{ contact.name }}</td>
              <td>{{ contact.surname }}</td>
              <td>{{ formatDateTime(contact.updatedAt) }}</td>
              <td class="text-right">
                <v-btn
                  size="small"
                  variant="text"
                  :to="resolveAdminContactViewPath(contact.id, placementContext.value, workspaceSlugFromRoute.value) || undefined"
                >
                  Open
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>

        <div v-if="hasMore" class="d-flex justify-center pt-4">
          <v-btn variant="text" :loading="isLoadingMore" @click="contacts.loadMore">Load more</v-btn>
        </div>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useGlobalList } from "@jskit-ai/users-web/client/composables/useGlobalList";
import { useUsersWebWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useUsersWebWorkspaceRouteContext";
import {
  contactsListQueryKey,
  resolveAdminContactNewPath,
  resolveAdminContactViewPath
} from "./contactsClientSupport.js";

const { placementContext, workspaceSlugFromRoute } = useUsersWebWorkspaceRouteContext();
const createPath = computed(() => resolveAdminContactNewPath(placementContext.value, workspaceSlugFromRoute.value));

const contacts = useGlobalList({
  apiSuffix: "/contacts",
  queryKeyFactory: (surfaceId = "") => contactsListQueryKey(surfaceId),
  fallbackLoadError: "Unable to load contacts."
});
const items = computed(() => contacts.items.value);
const loadError = computed(() => contacts.loadError.value);
const isLoading = computed(() => contacts.isLoading.value);
const hasMore = computed(() => contacts.hasMore.value);
const isLoadingMore = computed(() => contacts.isLoadingMore.value);

function formatDateTime(value) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "unknown";
  }

  return parsedDate.toLocaleString();
}
</script>
