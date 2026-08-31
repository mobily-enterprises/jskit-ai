<script setup>
import { computed, unref } from "vue";

const props = defineProps({
  screen: {
    type: Object,
    required: true
  },
  resourceSingularTitle: {
    type: String,
    default: "Record"
  },
  resourcePluralTitle: {
    type: String,
    default: "Records"
  }
});

const view = computed(() => props.screen?.view || {});
const listLocation = computed(() => unref(props.screen?.listLocation) || null);
const editLocation = computed(() => unref(props.screen?.editLocation) || null);
</script>

<template>
  <section class="crud-screen crud-screen--operator crud-view-element d-flex flex-column ga-4">
    <div class="crud-view-actions">
      <v-btn
        v-if="listLocation"
        color="primary"
        variant="outlined"
        :to="listLocation"
      >
        Back to {{ resourcePluralTitle }}
      </v-btn>
      <slot name="actions" :screen="screen" :view="view" />
      <v-btn
        v-if="editLocation"
        color="primary"
        variant="flat"
        :to="editLocation"
      >
        Edit
      </v-btn>
    </div>

    <v-sheet rounded="lg" border class="crud-view-panel">
      <div v-if="view.loadError || view.isNotFound" class="crud-view-state">
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ view.loadError || `This ${resourceSingularTitle} could not be found.` }}
        </p>
        <div class="crud-view-state__actions">
          <v-btn
            v-if="view.loadError"
            color="primary"
            variant="tonal"
            :disabled="view.isFetching"
            @click="view.refresh"
          >
            {{ view.isFetching ? "Retrying…" : "Retry" }}
          </v-btn>
          <v-btn
            v-else-if="listLocation"
            color="primary"
            variant="tonal"
            :to="listLocation"
          >
            Back to {{ resourcePluralTitle }}
          </v-btn>
        </div>
      </div>

      <template v-else-if="view.isLoading">
        <div class="pa-4">
          <v-skeleton-loader type="text@2, list-item-two-line@5" />
        </div>
      </template>

      <template v-else>
        <div class="pa-4">
          <slot name="before-fields" :view="view" />
          <v-row class="crud-view-fields">
            <slot name="fields" :view="view" />
          </v-row>
          <slot name="after-fields" :view="view" />
        </div>
      </template>
    </v-sheet>

    <div v-if="$slots['supporting-content']" class="crud-view-supporting-content">
      <slot name="supporting-content" :view="view" />
    </div>
  </section>
</template>

<style scoped>
.crud-screen {
  --crud-screen-state-padding: 2.5rem 1.25rem;
}

.crud-screen--operator {
  --crud-screen-state-padding: 2rem 1rem;
}

.crud-view-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.crud-view-panel {
  overflow: hidden;
}

.crud-view-state {
  margin-inline: auto;
  max-width: 30rem;
  padding: var(--crud-screen-state-padding);
  text-align: center;
}

.crud-view-state__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.crud-view-fields :deep(.v-col) {
  min-width: 0;
}

.crud-view-supporting-content {
  min-width: 0;
}

@media (max-width: 960px) {
  .crud-view-actions {
    width: 100%;
  }

  .crud-view-actions :deep(.v-btn) {
    min-height: 48px;
    flex: 1 1 10rem;
  }

  .crud-view-state__actions :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
