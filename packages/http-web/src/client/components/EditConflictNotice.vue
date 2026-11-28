<script setup>
import { useJskitText } from "../i18n.js";

// What a form says when the server's value of a field changed while the person was editing it: one line per field,
// with the server's value, and the choice to use it or keep the person's own. Until they choose the form keeps theirs,
// and saving saves theirs. A form puts it after its fields, so nothing the person is typing in moves, and its region
// announces each new line politely: a line is no alert of its own, and takes no name a field already has.

defineProps({
  items: {
    type: /** @type {import("vue").PropType<import("../types.js").EditConflictItem[]>} */ (Array),
    required: true
  }
});
const emit = defineEmits(["accept", "keep"]);
const { t } = useJskitText();

// A long value, such as a prompt, shows its start; using it takes the whole value.
const SHOWN_LENGTH = 160;

function message(item) {
  if (item.value === "") {
    return t("jskit.http.form.conflict.cleared", { field: item.label });
  }
  if (item.value === null) {
    return t("jskit.http.form.conflict.changed", { field: item.label });
  }
  const shown = item.value.length > SHOWN_LENGTH ? `${item.value.slice(0, SHOWN_LENGTH).trimEnd()}…` : item.value;
  return t("jskit.http.form.conflict.changedTo", { field: item.label, value: shown });
}
</script>

<template>
  <div class="edit-conflict-notice" role="status" aria-live="polite">
    <v-alert
      v-for="item in items"
      :key="item.key"
      role="none"
      color="warning-container"
      icon="$warning"
      variant="flat"
      density="comfortable"
      :rounded="12"
    >
      <div class="d-flex align-center ga-3 flex-wrap">
        <span>{{ message(item) }}</span>
        <v-spacer />
        <v-btn variant="text" size="small" class="text-none" @click="emit('accept', item.key)">
          {{ t("jskit.http.form.conflict.accept", { field: item.label }) }}
        </v-btn>
        <v-btn variant="text" size="small" class="text-none" @click="emit('keep', item.key)">
          {{ t("jskit.http.form.conflict.keep", { field: item.label }) }}
        </v-btn>
      </div>
    </v-alert>
  </div>
</template>

<style scoped>
.edit-conflict-notice {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-conflict-notice:not(:empty) {
  margin-top: 16px;
}
</style>
