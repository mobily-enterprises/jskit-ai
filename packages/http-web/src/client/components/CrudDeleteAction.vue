<script setup>
import { computed, useId } from "vue";
import { mdiDeleteOutline } from "@mdi/js";

const props = defineProps({
  action: {
    type: Object,
    required: true
  },
  resourceSingularTitle: {
    type: String,
    default: "Record"
  }
});

const resourceLabel = computed(() =>
  String(props.resourceSingularTitle || "Record").trim() || "Record"
);
const componentId = useId();
const titleId = `${componentId}-delete-title`;
const descriptionId = `${componentId}-delete-description`;

function closeDialog() {
  props.action.cancel();
}

function handleDialogModelUpdate(isOpen) {
  if (!isOpen) {
    closeDialog();
  }
}
</script>

<template>
  <v-btn
    color="error"
    variant="tonal"
    :prepend-icon="mdiDeleteOutline"
    min-height="48"
    :disabled="!action.canDelete"
    @click="action.request"
  >
    Delete {{ resourceLabel }}
  </v-btn>

  <v-dialog
    :model-value="action.isOpen"
    max-width="32rem"
    role="alertdialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
    :persistent="action.isDeleting"
    @update:model-value="handleDialogModelUpdate"
  >
    <v-card>
      <v-card-title :id="titleId">Delete {{ resourceLabel }}?</v-card-title>
      <v-card-text>
        <p :id="descriptionId" class="mb-0">
          This permanently deletes this {{ resourceLabel.toLowerCase() }}. This action cannot be undone.
        </p>
        <v-alert
          v-if="action.error"
          class="mt-4"
          type="error"
          variant="tonal"
        >
          {{ action.error }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          autofocus
          variant="text"
          :disabled="action.isDeleting"
          @click="closeDialog"
        >
          Cancel
        </v-btn>
        <v-btn
          color="error"
          variant="flat"
          :loading="action.isDeleting"
          :disabled="!action.canDelete"
          @click="action.confirm"
        >
          Delete
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
