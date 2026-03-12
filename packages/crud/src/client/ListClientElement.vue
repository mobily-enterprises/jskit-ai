<template>
  <section class="contacts-list-client-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">Crud</v-card-title>
            <v-card-subtitle class="px-0">Manage records available in the admin surface.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="outlined" :loading="isLoading" @click="contacts.reload">Refresh</v-btn>
          <v-btn color="primary" :to="createPath || undefined">New record</v-btn>
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
              <td colspan="4" class="text-center py-6 text-medium-emphasis">No records yet.</td>
            </tr>
            <tr v-for="contact in items" :key="contact.id">
              <td>{{ contact.name }}</td>
              <td>{{ contact.surname }}</td>
              <td>{{ formatDateTime(contact.updatedAt) }}</td>
              <td class="text-right">
                <v-btn size="small" variant="text" :to="contactsContext.resolveViewPath(contact.id) || undefined">
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
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import {
  useContactsClientContext
} from "./clientSupport.js";

const contactsContext = useContactsClientContext();
const contactsConfig = contactsContext.contactsConfig;
const createPath = contactsContext.createPath;

const contacts = useList({
  visibility: contactsConfig.visibility,
  apiSuffix: contactsConfig.relativePath,
  queryKeyFactory: (surfaceId = "") => contactsContext.listQueryKey(surfaceId),
  fallbackLoadError: "Unable to load records."
});

const items = contacts.items;
const loadError = contacts.loadError;
const isLoading = contacts.isLoading;
const hasMore = contacts.hasMore;
const isLoadingMore = contacts.isLoadingMore;

function formatDateTime(value) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "unknown";
  }

  return parsedDate.toLocaleString();
}
</script>
