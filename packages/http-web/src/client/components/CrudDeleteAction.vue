<script setup>
import { computed, useId } from "vue";
import ShellPageAction from "@jskit-ai/shell-web/client/components/ShellPageAction";
import { useJskitText } from "../i18n.js";

// Delete as a page action (in the top app bar, an icon on compact windows), confirmed in a Material 3 dialog.

const props = defineProps({
  action: {
    type: /** @type {import("vue").PropType<import("../types.js").CrudDeleteAction>} */ (Object),
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
  <ShellPageAction
    icon="$delete"
    :label="t('jskit.http.crud.delete.button', { resource: resourceLabel })"
    :disabled="!action.canDelete"
    @click="action.request"
  />

  <v-dialog
    :model-value="action.isOpen"
    max-width="560"
    role="alertdialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
    :persistent="action.isDeleting"
    @update:model-value="handleDialogModelUpdate"
  >
    <v-card>
      <v-card-title :id="titleId" class="crud-delete-action__headline">
        {{ t("jskit.http.crud.delete.title", { resource: resourceLabel }) }}
      </v-card-title>
      <v-card-text>
        <p :id="descriptionId" class="mb-0">
          {{ t("jskit.http.crud.delete.description", { resource: resourceLabel.toLowerCase() }) }}
        </p>
        <v-alert
          v-if="action.error"
          class="mt-4"
          color="error-container"
          icon="$warning"
          variant="flat"
          :rounded="12"
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
          variant="text"
          :disabled="!action.canDelete"
          @click="action.confirm"
        >
          {{ action.isDeleting ? t("jskit.http.actions.deleting") : t("jskit.http.actions.delete") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.crud-delete-action__headline {
  font-size: 1.5rem;
  font-weight: 400;
  line-height: 2rem;
  padding: 24px 24px 16px;
  white-space: normal;
}
</style>
