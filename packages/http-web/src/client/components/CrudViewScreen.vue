<script setup>
import { computed, unref, watch } from "vue";
import ShellPageAction from "@jskit-ai/shell-web/client/components/ShellPageAction";
import ShellPageActions from "@jskit-ai/shell-web/client/components/ShellPageActions";
import { useShellNavigation } from "@jskit-ai/shell-web/client/navigation/useShellNavigation";
import { useJskitText } from "../i18n.js";

// A record page as Material 3 lays it out: Edit and the page's own actions in the top app bar, a header naming the
// record, then its values as a two-line list, each value above its label. Up (the app bar's arrow) leaves the page.
// Unset titles come from the catalog; passed titles may be message keys.
const props = defineProps({
  screen: {
    type: /** @type {import("vue").PropType<import("../types.js").CrudViewScreen>} */ (Object),
    required: true
  },
  resourceSingularTitle: {
    type: String,
    default: undefined
  }
});

const { t, text } = useJskitText();
const singularTitle = computed(() =>
  props.resourceSingularTitle === undefined ? t("jskit.http.crud.record") : text(props.resourceSingularTitle)
);

const view = computed(() => props.screen.view);
const editLocation = computed(() => unref(props.screen.editLocation) || null);
const recordTitle = computed(() => String(unref(props.screen.recordTitle) || ""));
const isNotFound = computed(() => Boolean(unref(view.value.isNotFound)));

// A record that is gone when Up returns here sends the reader on to this page's parent instead.
const { pageUnavailable } = useShellNavigation();
watch(isNotFound, (notFound) => {
  if (notFound) {
    pageUnavailable();
  }
}, { immediate: true });
</script>

<template>
  <section class="crud-screen crud-view">
    <ShellPageActions>
      <slot name="actions" :screen="screen" :view="view" />
      <ShellPageAction
        v-if="editLocation && !isNotFound"
        icon="$edit"
        :label="t('jskit.http.actions.edit')"
        :to="editLocation"
      />
    </ShellPageActions>

    <div v-if="view.loadError" class="crud-view-state">
      <v-icon icon="$cloudOff" size="48" />
      <p class="text-body-large">{{ view.loadError }}</p>
      <v-btn
        color="secondary-container"
        prepend-icon="$refresh"
        :disabled="view.isFetching"
        @click="view.refresh"
      >
        {{ view.isFetching ? t("jskit.http.actions.retrying") : t("jskit.http.actions.retry") }}
      </v-btn>
    </div>

    <div v-else-if="isNotFound" class="crud-view-state">
      <v-icon icon="$searchOff" size="48" />
      <p class="text-body-large">{{ t("jskit.http.crud.view.notFound", { resource: singularTitle }) }}</p>
    </div>

    <v-card v-else-if="view.isLoading" class="crud-view-panel">
      <v-skeleton-loader type="heading, list-item-two-line@4" />
    </v-card>

    <template v-else>
      <header v-if="recordTitle" class="crud-view-header">
        <h2 class="text-headline-small">{{ recordTitle }}</h2>
      </header>
      <slot name="before-fields" :view="view" />
      <v-card class="crud-view-panel">
        <v-list class="crud-view-fields" lines="two">
          <slot name="fields" :view="view" />
        </v-list>
      </v-card>
      <slot name="after-fields" :view="view" />
    </template>

    <div v-if="$slots['supporting-content']" class="crud-view-supporting-content">
      <slot name="supporting-content" :view="view" />
    </div>
  </section>
</template>

<style scoped>
.crud-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-inline: auto;
  max-width: 840px;
  min-width: 0;
  width: 100%;
}

.crud-view-header h2 {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 400;
  margin: 0;
  overflow-wrap: anywhere;
}

.crud-view-panel {
  min-width: 0;
}

.crud-view-fields :deep(.v-list-item-title) {
  overflow-wrap: anywhere;
  white-space: normal;
}

.crud-view-state {
  align-items: center;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-inline: auto;
  max-width: 480px;
  padding: 48px 16px;
  text-align: center;
}

.crud-view-supporting-content {
  min-width: 0;
}
</style>
