<script setup>
import { computed, ref } from "vue";
import { useShellWindowSizeClass } from "@jskit-ai/shell-web/client/composables/useShellWindowSizeClass";
import CrudListFilterSheet from "./CrudListFilterSheet.vue";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  filters: {
    type: Object,
    default: () => ({})
  },
  runtime: {
    type: /** @type {import("vue").PropType<import("../types.js").CrudListFilterRuntime>} */ (Object),
    required: true
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

// Material 3 filters: one row of chips. The Filters chip opens every control, in a bottom sheet on compact windows and a
// dialog on wider ones; on/off filters are filter chips in the row itself (aria-pressed, which material-web draws as
// Material 3's filter chip, selected with its check), and each other active filter is a chip that clears it.
const { isCompact } = useShellWindowSizeClass();

const sheetOpen = ref(false);

const filterEntries = computed(() =>
  Object.values(props.filters && typeof props.filters === "object" && !Array.isArray(props.filters)
    ? props.filters
    : {})
    .filter((filter) => filter?.key && filter?.type)
);
const flagFilters = computed(() => filterEntries.value.filter((filter) => filter.type === "flag"));
const runtimeValues = computed(() => props.runtime.values);
const activeChips = computed(() => props.runtime.activeChips.value);
const valueChips = computed(() =>
  activeChips.value.filter((chip) => !flagFilters.value.some((filter) => filter.key === chip.filterKey))
);
const hasActiveFilters = computed(() => props.runtime.hasActiveFilters.value);
const shouldRender = computed(() => filterEntries.value.length > 0);

function toggleFlag(filter) {
  runtimeValues.value[filter.key] = !runtimeValues.value[filter.key];
}

function clearChip(chip) {
  props.runtime.clearChip(chip);
}
</script>

<template>
  <section v-if="shouldRender" class="crud-list-filter-surface">
    <div class="crud-list-filter-surface__chips">
      <v-chip
        tag="button"
        type="button"
        class="crud-list-filter-surface__open"
        prepend-icon="$tune"
        :variant="hasActiveFilters ? 'flat' : 'outlined'"
        :color="hasActiveFilters ? 'secondary-container' : undefined"
        aria-haspopup="dialog"
        @click="sheetOpen = true"
      >
        {{ resolvedTitle }}
        <span v-if="activeChips.length > 0" class="crud-list-filter-surface__count">{{ activeChips.length }}</span>
      </v-chip>
      <v-chip
        v-for="filter in flagFilters"
        :key="filter.key"
        tag="button"
        type="button"
        :aria-pressed="runtimeValues[filter.key] ? 'true' : 'false'"
        @click="toggleFlag(filter)"
      >
        {{ text(filter.label) }}
      </v-chip>
      <v-chip
        v-for="chip in valueChips"
        :key="chip.id"
        variant="flat"
        color="secondary-container"
        closable
        :close-label="t('jskit.http.actions.clear')"
        @click:close="clearChip(chip)"
      >
        {{ chip.label }}
      </v-chip>
      <v-btn v-if="hasActiveFilters" variant="text" @click="props.runtime.clearFilters()">{{ t("jskit.http.actions.clearAll") }}</v-btn>
    </div>

    <v-bottom-sheet v-if="isCompact" v-model="sheetOpen">
      <CrudListFilterSheet :filters="filterEntries" :runtime="runtime" :title="resolvedTitle" @close="sheetOpen = false" />
    </v-bottom-sheet>
    <v-dialog v-else v-model="sheetOpen" max-width="560">
      <CrudListFilterSheet :filters="filterEntries" :runtime="runtime" :title="resolvedTitle" @close="sheetOpen = false" />
    </v-dialog>
  </section>
</template>

<style scoped>
.crud-list-filter-surface {
  min-width: 0;
}

.crud-list-filter-surface__chips {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.crud-list-filter-surface__count {
  margin-inline-start: 6px;
}
</style>
