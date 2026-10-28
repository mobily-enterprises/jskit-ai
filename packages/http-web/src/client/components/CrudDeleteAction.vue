<script setup>
import { computed, useId } from "vue";
import { mdiDeleteOutline } from "@mdi/js";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  action: {
    type: Object,
    required: true
  },
  resourceSingularTitle: {
    type: String,
    default: ""
  }
});

const { t, text } = useJskitText();

const resourceLabel = computed(() =>
  String(text(props.resourceSingularTitle) || "").trim() || t("jskit.http.crud.record")
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
    {{ t("jskit.http.crud.delete.button", { resource: resourceLabel }) }}
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
      <v-card-title :id="titleId">{{ t("jskit.http.crud.delete.title", { resource: resourceLabel }) }}</v-card-title>
      <v-card-text>
        <p :id="descriptionId" class="mb-0">
          {{ t("jskit.http.crud.delete.description", { resource: resourceLabel.toLowerCase() }) }}
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
          {{ t("jskit.http.actions.cancel") }}
        </v-btn>
        <v-btn
          color="error"
          variant="flat"
          :disabled="!action.canDelete"
          @click="action.confirm"
        >
          {{ action.isDeleting ? t("jskit.http.actions.deleting") : t("jskit.http.actions.delete") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
