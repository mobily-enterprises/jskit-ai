<script setup>
import { ref } from "vue";
import CrudListRecordActionMenu from "../../src/client/components/CrudListRecordActionMenu.vue";

const record = { id: "2", title: "Kindred" };
const ran = ref([]);
// A list's row actions as useCrudListRowActions() exposes them: one available, one unavailable for this record.
const rowActions = {
  visibleActionsFor: () => [
    { key: "lend", label: "Lend", icon: "$send" },
    { key: "archive", label: "Archive", icon: "$delete" }
  ],
  isActionLoading: () => false,
  isActionDisabled: (action) => action.key === "archive",
  execute: (action) => {
    ran.value = [...ran.value, action.key];
  }
};
</script>

<template>
  <v-app>
    <v-main class="pa-4">
      <CrudListRecordActionMenu
        :record="record"
        :index="0"
        :title="record.title"
        :row-actions="rowActions"
        show-view
        :view-location="{ path: '/books/2' }"
        show-edit
        :edit-location="{ path: '/books/2/edit' }"
      />
      <output data-testid="record-action-menu-ran">{{ ran.join(",") }}</output>
    </v-main>
  </v-app>
</template>
