<script setup>
import { computed, ref } from "vue";
import { useDisplay } from "vuetify";
import CrudListFilterControls from "./CrudListFilterControls.vue";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  filters: {
    type: Object,
    default: () => ({})
  },
  runtime: {
    type: Object,
    default: null
  },
  title: {
    type: String,
    default: undefined
  }
});

const { t, text } = useJskitText();
const resolvedTitle = computed(() =>
  props.title === undefined ? t("jskit.http.crud.filters.title") : text(props.title)
);

const { smAndDown: isCompactLayout } = useDisplay();

const sheetOpen = ref(false);

const filterEntries = computed(() =>
  Object.values(props.filters && typeof props.filters === "object" && !Array.isArray(props.filters)
    ? props.filters
    : {})
    .filter((filter) => filter?.key && filter?.type)
);
const activeChips = computed(() => Array.isArray(props.runtime?.activeChips?.value) ? props.runtime.activeChips.value : []);
const hasActiveFilters = computed(() => Boolean(props.runtime?.hasActiveFilters?.value));
const shouldRender = computed(() => filterEntries.value.length > 0 && Boolean(props.runtime?.values));

function clearChip(chip = {}) {
  props.runtime?.clearChip?.(chip);
}

function clearFilters() {
  props.runtime?.clearFilters?.();
}
</script>

<template>
  <section v-if="shouldRender" class="crud-list-filter-surface">
    <div class="crud-list-filter-surface__summary">
      <v-btn
        v-if="isCompactLayout"
        color="primary"
        variant="tonal"
        class="crud-list-filter-surface__open"
        @click="sheetOpen = true"
      >
        {{ resolvedTitle }}
        <v-chip v-if="activeChips.length > 0" class="ml-2" size="x-small" color="primary" variant="flat">
          {{ activeChips.length }}
        </v-chip>
      </v-btn>

      <div v-if="hasActiveFilters" class="crud-list-filter-surface__chips">
        <v-chip
          v-for="chip in activeChips"
          :key="chip.id"
          closable
          :close-label="t('jskit.http.actions.close')"
          size="small"
          variant="tonal"
          @click:close="clearChip(chip)"
        >
          {{ chip.label }}
        </v-chip>
        <v-btn size="small" variant="text" @click="clearFilters">{{ t("jskit.http.actions.clearAll") }}</v-btn>
      </div>
    </div>

    <v-sheet v-if="!isCompactLayout" rounded="lg" border class="crud-list-filter-surface__panel">
      <CrudListFilterControls :filters="filterEntries" :runtime="runtime" />
    </v-sheet>

    <v-dialog v-model="sheetOpen" max-width="640" location="bottom">
      <v-card rounded="lg" class="crud-list-filter-surface__sheet">
        <v-card-title class="d-flex align-center justify-space-between">
          <span>{{ resolvedTitle }}</span>
          <v-btn variant="text" @click="sheetOpen = false">{{ t("jskit.http.actions.close") }}</v-btn>
        </v-card-title>
        <v-card-text>
          <CrudListFilterControls :filters="filterEntries" :runtime="runtime" stacked />
        </v-card-text>
        <v-card-actions class="justify-space-between">
          <v-btn variant="text" @click="clearFilters">{{ t("jskit.http.actions.clearAll") }}</v-btn>
          <v-btn color="primary" variant="flat" @click="sheetOpen = false">{{ t("jskit.http.actions.apply") }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.crud-list-filter-surface {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.crud-list-filter-surface__summary {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: space-between;
}

.crud-list-filter-surface__open {
  min-height: 48px;
}

.crud-list-filter-surface__chips {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
}

.crud-list-filter-surface__panel {
  padding: 1rem;
}

.crud-list-filter-surface__sheet {
  margin: 0.75rem;
}

.crud-list-filter-surface :deep(.v-field),
.crud-list-filter-surface :deep(.v-btn),
.crud-list-filter-surface :deep(.v-selection-control) {
  min-height: 48px;
}

@media (max-width: 640px) {
  .crud-list-filter-surface__summary {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
