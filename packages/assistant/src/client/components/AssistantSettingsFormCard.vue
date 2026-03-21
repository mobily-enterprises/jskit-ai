<template>
  <section :class="props.rootClass">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-h6">{{ props.title }}</v-card-title>
        <v-card-subtitle>{{ props.subtitle }}</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <template v-if="props.showFormSkeleton">
          <v-skeleton-loader type="text@2, list-item-two-line@4, button" />
        </template>

        <p v-else-if="props.addEdit.loadError" class="text-body-2 text-medium-emphasis mb-4">
          {{ props.addEdit.loadError }}
        </p>

        <p v-else-if="!props.addEdit.canView" class="text-body-2 text-medium-emphasis mb-4">
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
              <v-chip v-else color="secondary" label>Read-only</v-chip>
            </div>
          </v-form>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
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
