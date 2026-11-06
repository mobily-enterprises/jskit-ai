<script setup>
import CrudListFilterControls from "./CrudListFilterControls.vue";
import { useJskitText } from "../i18n.js";

// Every list filter control, the content of the Filters bottom sheet or dialog.
const props = defineProps({
  filters: {
    type: Array,
    default: () => []
  },
  runtime: {
    type: /** @type {import("vue").PropType<import("../types.js").CrudListFilterRuntime>} */ (Object),
    required: true
  },
  title: {
    type: String,
    required: true
  }
});
const emit = defineEmits(["close"]);

const { t } = useJskitText();

function close() {
  emit("close");
}
</script>

<template>
  <v-card class="crud-list-filter-sheet">
    <v-card-title class="crud-list-filter-sheet__headline">
      <h2 class="text-headline-small">{{ props.title }}</h2>
    </v-card-title>
    <v-card-text>
      <CrudListFilterControls :filters="props.filters" :runtime="props.runtime" stacked />
    </v-card-text>
    <v-card-actions class="crud-list-filter-sheet__actions">
      <v-btn variant="text" @click="props.runtime.clearFilters()">{{ t("jskit.http.actions.clearAll") }}</v-btn>
      <v-spacer />
      <v-btn variant="text" @click="close">{{ t("jskit.http.actions.apply") }}</v-btn>
    </v-card-actions>
  </v-card>
</template>

<style scoped>
.crud-list-filter-sheet__headline {
  padding: 24px 24px 16px;
}

.crud-list-filter-sheet__headline h2 {
  font-weight: 400;
  margin: 0;
  white-space: normal;
}

.crud-list-filter-sheet__actions {
  padding: 8px 24px 24px;
}
</style>
