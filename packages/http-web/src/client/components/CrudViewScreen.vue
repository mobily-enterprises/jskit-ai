<script setup>
import { computed, unref } from "vue";
import { useJskitText } from "../i18n.js";

// Unset titles come from the catalog; passed titles may be message keys.
const props = defineProps({
  screen: {
    type: Object,
    required: true
  },
  resourceSingularTitle: {
    type: String,
    default: undefined
  },
  resourcePluralTitle: {
    type: String,
    default: undefined
  }
});

const { t, text } = useJskitText();
const singularTitle = computed(() =>
  props.resourceSingularTitle === undefined ? t("jskit.http.crud.record") : text(props.resourceSingularTitle)
);
const pluralTitle = computed(() =>
  props.resourcePluralTitle === undefined ? t("jskit.http.crud.records") : text(props.resourcePluralTitle)
);

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
        {{ t("jskit.http.crud.view.backTo", { resources: pluralTitle }) }}
      </v-btn>
      <slot name="actions" :screen="screen" :view="view" />
      <v-btn
        v-if="editLocation"
        color="primary"
        variant="flat"
        :to="editLocation"
      >
        {{ t("jskit.http.actions.edit") }}
      </v-btn>
    </div>

    <v-sheet rounded="lg" border class="crud-view-panel">
      <div v-if="view.loadError || view.isNotFound" class="crud-view-state">
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ view.loadError || t("jskit.http.crud.view.notFound", { resource: singularTitle }) }}
        </p>
        <div class="crud-view-state__actions">
          <v-btn
            v-if="view.loadError"
            color="primary"
            variant="tonal"
            :disabled="view.isFetching"
            @click="view.refresh"
          >
            {{ view.isFetching ? t("jskit.http.actions.retrying") : t("jskit.http.actions.retry") }}
          </v-btn>
          <v-btn
            v-else-if="listLocation"
            color="primary"
            variant="tonal"
            :to="listLocation"
          >
            {{ t("jskit.http.crud.view.backTo", { resources: pluralTitle }) }}
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
  padding: 2rem 1rem;
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
