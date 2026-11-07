<template>
  <!-- The settings pane around it carries the page title, so the card adds no heading of its own: the title names the
       section for assistive technology and the subtitle says what the settings apply to. -->
  <section :class="props.rootClass" :aria-label="props.title">
    <v-card>
      <v-card-text>
        <p class="text-body-medium on-surface-variant mb-4">{{ props.subtitle }}</p>
        <template v-if="props.showFormSkeleton">
          <v-skeleton-loader type="text@2, list-item-two-line@4, button" />
        </template>

        <p v-else-if="props.addEdit.loadError" class="text-body-medium on-surface-variant mb-4">
          {{ props.addEdit.loadError }}
        </p>

        <p v-else-if="!props.addEdit.canView" class="text-body-medium on-surface-variant mb-4">
          {{ props.noPermissionMessage }}
        </p>

        <template v-else>
          <v-form @submit.prevent="props.addEdit.submit" novalidate>
            <v-progress-linear v-if="props.addEdit.isRefetching" indeterminate class="mb-4" />
            <slot />
            <div class="d-flex align-center justify-end ga-3 mt-2">
              <v-btn
                v-if="props.addEdit.canSave"
                type="submit"
                color="primary"
                :loading="props.addEdit.isSaving"
                :disabled="props.addEdit.isInitialLoading || props.addEdit.isRefetching"
              >
                {{ props.saveLabel }}
              </v-btn>
              <v-chip v-else color="secondary" label>{{ t("jskit.assistant.settings.readOnly") }}</v-chip>
            </div>
          </v-form>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();
const props = defineProps({
  rootClass: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  subtitle: {
    type: String,
    required: true
  },
  noPermissionMessage: {
    type: String,
    required: true
  },
  saveLabel: {
    type: String,
    required: true
  },
  addEdit: {
    type: Object,
    required: true
  },
  showFormSkeleton: {
    type: Boolean,
    default: false
  }
});
</script>
