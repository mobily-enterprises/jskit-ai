<template>
  <section class="crud-view-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">{{ title }}</v-card-title>
            <v-card-subtitle class="px-0">View and manage this ${option:namespace|singular|default(record)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="text" :to="listPath">Back to ${option:namespace|plural|default(records)}</v-btn>
          <v-btn color="primary" variant="outlined" :to="editPath || undefined" :disabled="!editPath">Edit</v-btn>
          <v-btn color="error" variant="tonal" :loading="deleteCommand.isRunning" @click="confirmDelete">Delete</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <div v-if="view.loadError.value || view.isNotFound.value" class="text-body-2 text-medium-emphasis py-2">
          Record unavailable.
        </div>

        <div v-else-if="view.isLoading.value" class="d-flex align-center ga-3 text-medium-emphasis">
          <v-progress-circular indeterminate size="18" width="2" />
          <span>Loading ${option:namespace|singular|default(record)}...</span>
        </div>

        <template v-else>
          <v-row>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Name</div>
              <div class="text-body-1">{{ record.name }}</div>
            </v-col>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Surname</div>
              <div class="text-body-1">{{ record.surname }}</div>
            </v-col>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Created</div>
              <div class="text-body-1">{{ crudContext.formatDateTime(record.createdAt) }}</div>
            </v-col>
            <v-col cols="12" md="6">
              <div class="text-caption text-medium-emphasis">Updated</div>
              <div class="text-body-1">{{ crudContext.formatDateTime(record.updatedAt) }}</div>
            </v-col>
          </v-row>
        </template>

      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed, reactive } from "vue";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useView } from "@jskit-ai/users-web/client/composables/useView";
import { crudModuleConfig } from "../shared/moduleConfig.js";
import { useCrudRecordRuntime } from "./clientSupport.js";

const {
  crudContext,
  listPath,
  recordId,
  editPath,
  apiSuffix,
  viewQueryKey,
  invalidateAndGoList
} = useCrudRecordRuntime();
const record = reactive({
  id: 0,
  name: "",
  surname: "",
  createdAt: "",
  updatedAt: ""
});

const title = computed(() => {
  const name = String(record.name || "").trim();
  const surname = String(record.surname || "").trim();
  return `${name} ${surname}`.trim() || "${option:namespace|singular|pascal|default(Record)}";
});

const view = useView({
  visibility: crudModuleConfig.visibility,
  apiSuffix,
  queryKeyFactory: viewQueryKey,
  fallbackLoadError: "Unable to load record.",
  notFoundMessage: "Record not found.",
  model: record,
  mapLoadedToModel: (model, payload = {}) => {
    model.id = Number(payload.id || 0);
    model.name = String(payload.name || "");
    model.surname = String(payload.surname || "");
    model.createdAt = String(payload.createdAt || "");
    model.updatedAt = String(payload.updatedAt || "");
  }
});
const deleteCommand = useCommand({
  visibility: crudModuleConfig.visibility,
  apiSuffix,
  writeMethod: "DELETE",
  fallbackRunError: "Unable to delete record.",
  messages: {
    success: "Record deleted.",
    error: "Unable to delete record."
  },
  onRunSuccess: async (_, { queryClient }) => {
    await invalidateAndGoList(queryClient);
  }
});

async function confirmDelete() {
  if (!window.confirm("Delete this record?")) {
    return;
  }

  await deleteCommand.run();
}
</script>
