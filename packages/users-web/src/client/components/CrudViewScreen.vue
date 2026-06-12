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
  },
  description: {
    type: String,
    default: ""
  },
  unavailableTitle: {
    type: String,
    default: "Record unavailable"
  }
});

const view = computed(() => props.screen?.view || {});
const recordTitle = computed(() => unref(props.screen?.recordTitle) || props.resourceSingularTitle);
const listLocation = computed(() => unref(props.screen?.listLocation) || null);
const editLocation = computed(() => unref(props.screen?.editLocation) || null);
const resolvedDescription = computed(() =>
  String(props.description || `Review this ${props.resourceSingularTitle} record.`).trim()
);
</script>

<template>
  <section class="generated-ui-screen generated-ui-screen--operator ui-generator-view-element d-flex flex-column ga-4">
    <header class="ui-generator-view-header">
      <div class="ui-generator-view-header__copy">
        <p class="text-overline text-medium-emphasis mb-1">{{ resourceSingularTitle }}</p>
        <h1 class="ui-generator-view-header__title">{{ recordTitle }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">{{ resolvedDescription }}</p>
      </div>
      <div class="ui-generator-view-header__actions">
        <v-btn
          v-if="listLocation"
          color="primary"
          variant="outlined"
          :to="listLocation"
        >
          Back to {{ resourcePluralTitle }}
        </v-btn>
        <v-btn
          v-if="editLocation"
          color="primary"
          variant="flat"
          :to="editLocation"
        >
          Edit
        </v-btn>
      </div>
    </header>

    <v-sheet rounded="lg" border class="ui-generator-view-panel">
      <div v-if="view.loadError || view.isNotFound" class="ui-generator-view-state">
        <h2 class="text-h6 mb-2">{{ unavailableTitle }}</h2>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ view.loadError || `This ${resourceSingularTitle} could not be found.` }}
        </p>
        <div class="ui-generator-view-state__actions">
          <v-btn
            v-if="view.loadError"
            color="primary"
            variant="tonal"
            :loading="view.isFetching"
            @click="view.refresh"
          >
            Retry
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
        <v-progress-linear v-if="view.isRefetching" indeterminate />
        <div class="pa-4">
          <slot name="before-fields" :view="view" />
          <v-row class="ui-generator-view-fields">
            <slot name="fields" :view="view" />
          </v-row>
          <slot name="after-fields" :view="view" />
        </div>
      </template>
    </v-sheet>

    <div v-if="$slots['supporting-content']" class="ui-generator-view-supporting-content">
      <slot name="supporting-content" :view="view" />
    </div>
  </section>
</template>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.35rem, 2vw, 1.85rem);
  --generated-ui-screen-state-padding: 2.5rem 1.25rem;
}

.generated-ui-screen--operator {
  --generated-ui-screen-state-padding: 2rem 1rem;
}

.ui-generator-view-header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.ui-generator-view-header__copy {
  min-width: 0;
}

.ui-generator-view-header__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.35rem;
  overflow-wrap: anywhere;
}

.ui-generator-view-header__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.ui-generator-view-panel {
  overflow: hidden;
}

.ui-generator-view-state {
  margin-inline: auto;
  max-width: 30rem;
  padding: var(--generated-ui-screen-state-padding);
  text-align: center;
}

.ui-generator-view-state__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.ui-generator-view-fields :deep(.v-col) {
  min-width: 0;
}

.ui-generator-view-supporting-content {
  min-width: 0;
}

@media (max-width: 960px) {
  .ui-generator-view-header {
    flex-direction: column;
  }

  .ui-generator-view-header__actions {
    width: 100%;
  }

  .ui-generator-view-header__actions :deep(.v-btn) {
    min-height: 48px;
    flex: 1 1 10rem;
  }

  .ui-generator-view-state__actions :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
