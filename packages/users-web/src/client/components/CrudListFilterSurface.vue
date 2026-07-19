<script setup>
import { computed, ref } from "vue";
import { useDisplay } from "vuetify";
import CrudListDateFilterControl from "./CrudListDateFilterControl.vue";

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
    default: "Filters"
  }
});

const display = useDisplay();
const sheetOpen = ref(false);

const filterEntries = computed(() =>
  Object.values(props.filters && typeof props.filters === "object" && !Array.isArray(props.filters)
    ? props.filters
    : {})
    .filter((filter) => filter?.key && filter?.type)
);
const runtimeValues = computed(() => props.runtime?.values || {});
const activeChips = computed(() => Array.isArray(props.runtime?.activeChips?.value) ? props.runtime.activeChips.value : []);
const hasActiveFilters = computed(() => Boolean(props.runtime?.hasActiveFilters?.value));
const shouldRender = computed(() => filterEntries.value.length > 0 && Boolean(props.runtime?.values));
const isCompactLayout = computed(() => {
  const displayName = String(display?.name?.value || "").trim().toLowerCase();
  return displayName === "xs" || displayName === "sm";
});

function optionItems(filter = {}) {
  return Array.isArray(filter.options) ? filter.options : [];
}

function placeholder(filter = {}, fallback = "") {
  return String(filter?.ui?.placeholder || fallback || "").trim();
}

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
        {{ title }}
        <v-chip v-if="activeChips.length > 0" class="ml-2" size="x-small" color="primary" variant="flat">
          {{ activeChips.length }}
        </v-chip>
      </v-btn>

      <div v-if="hasActiveFilters" class="crud-list-filter-surface__chips">
        <v-chip
          v-for="chip in activeChips"
          :key="chip.id"
          closable
          size="small"
          variant="tonal"
          @click:close="clearChip(chip)"
        >
          {{ chip.label }}
        </v-chip>
        <v-btn size="small" variant="text" @click="clearFilters">Clear all</v-btn>
      </div>
    </div>

    <v-sheet v-if="!isCompactLayout" rounded="lg" border class="crud-list-filter-surface__panel">
      <div class="crud-list-filter-surface__controls">
        <template v-for="filter in filterEntries" :key="filter.key">
          <v-switch
            v-if="filter.type === 'flag'"
            v-model="runtimeValues[filter.key]"
            :label="filter.label"
            color="primary"
            density="comfortable"
            hide-details
            class="crud-list-filter-surface__control"
          />
          <v-select
            v-else-if="filter.type === 'enum' || filter.type === 'enumMany' || filter.type === 'presence'"
            v-model="runtimeValues[filter.key]"
            :items="optionItems(filter)"
            :label="filter.label"
            :placeholder="placeholder(filter)"
            :multiple="filter.type === 'enumMany'"
            :chips="filter.type === 'enumMany'"
            :closable-chips="filter.type === 'enumMany'"
            clearable
            item-title="label"
            item-value="value"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="crud-list-filter-surface__control"
          />
          <v-combobox
            v-else-if="filter.type === 'recordIdMany'"
            v-model="runtimeValues[filter.key]"
            :label="filter.label"
            :placeholder="placeholder(filter, 'Enter ids')"
            multiple
            chips
            closable-chips
            clearable
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="crud-list-filter-surface__control"
          />
          <v-text-field
            v-else-if="filter.type === 'recordId'"
            v-model="runtimeValues[filter.key]"
            :label="filter.label"
            :placeholder="placeholder(filter, 'Enter id')"
            clearable
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="crud-list-filter-surface__control"
          />
          <div
            v-else-if="filter.type === 'dateRange'"
            class="crud-list-filter-surface__range crud-list-filter-surface__range--date"
            role="group"
            :aria-label="`${filter.label} date range`"
            :data-filter-key="filter.key"
            data-filter-type="date-range"
          >
            <CrudListDateFilterControl
              v-model="runtimeValues[filter.key].from"
              :label="`${filter.label} from`"
              :control-id="`${filter.key}-from`"
              :placeholder="placeholder(filter, 'Select start date')"
            />
            <CrudListDateFilterControl
              v-model="runtimeValues[filter.key].to"
              :label="`${filter.label} to`"
              :control-id="`${filter.key}-to`"
              :placeholder="placeholder(filter, 'Select end date')"
            />
          </div>
          <div v-else-if="filter.type === 'numberRange'" class="crud-list-filter-surface__range">
            <v-text-field
              v-model="runtimeValues[filter.key].min"
              :label="`${filter.label} min`"
              type="number"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            />
            <v-text-field
              v-model="runtimeValues[filter.key].max"
              :label="`${filter.label} max`"
              type="number"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            />
          </div>
          <CrudListDateFilterControl
            v-else-if="filter.type === 'date'"
            v-model="runtimeValues[filter.key]"
            :label="filter.label"
            :control-id="filter.key"
            :placeholder="placeholder(filter, 'Select date')"
            class="crud-list-filter-surface__control"
          />
        </template>
      </div>
    </v-sheet>

    <v-dialog v-model="sheetOpen" max-width="640" location="bottom">
      <v-card rounded="lg" class="crud-list-filter-surface__sheet">
        <v-card-title class="d-flex align-center justify-space-between">
          <span>{{ title }}</span>
          <v-btn variant="text" @click="sheetOpen = false">Close</v-btn>
        </v-card-title>
        <v-card-text>
          <div class="crud-list-filter-surface__controls crud-list-filter-surface__controls--stacked">
            <template v-for="filter in filterEntries" :key="filter.key">
              <v-switch
                v-if="filter.type === 'flag'"
                v-model="runtimeValues[filter.key]"
                :label="filter.label"
                color="primary"
                density="comfortable"
                hide-details
              />
              <v-select
                v-else-if="filter.type === 'enum' || filter.type === 'enumMany' || filter.type === 'presence'"
                v-model="runtimeValues[filter.key]"
                :items="optionItems(filter)"
                :label="filter.label"
                :placeholder="placeholder(filter)"
                :multiple="filter.type === 'enumMany'"
                :chips="filter.type === 'enumMany'"
                :closable-chips="filter.type === 'enumMany'"
                clearable
                item-title="label"
                item-value="value"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
              />
              <v-combobox
                v-else-if="filter.type === 'recordIdMany'"
                v-model="runtimeValues[filter.key]"
                :label="filter.label"
                :placeholder="placeholder(filter, 'Enter ids')"
                multiple
                chips
                closable-chips
                clearable
                variant="outlined"
                density="comfortable"
                hide-details="auto"
              />
              <v-text-field
                v-else-if="filter.type === 'recordId'"
                v-model="runtimeValues[filter.key]"
                :label="filter.label"
                :placeholder="placeholder(filter, 'Enter id')"
                clearable
                variant="outlined"
                density="comfortable"
                hide-details="auto"
              />
              <div
                v-else-if="filter.type === 'dateRange'"
                class="crud-list-filter-surface__range crud-list-filter-surface__range--date"
                role="group"
                :aria-label="`${filter.label} date range`"
                :data-filter-key="filter.key"
                data-filter-type="date-range"
              >
                <CrudListDateFilterControl
                  v-model="runtimeValues[filter.key].from"
                  :label="`${filter.label} from`"
                  :control-id="`${filter.key}-from`"
                  :placeholder="placeholder(filter, 'Select start date')"
                />
                <CrudListDateFilterControl
                  v-model="runtimeValues[filter.key].to"
                  :label="`${filter.label} to`"
                  :control-id="`${filter.key}-to`"
                  :placeholder="placeholder(filter, 'Select end date')"
                />
              </div>
              <div v-else-if="filter.type === 'numberRange'" class="crud-list-filter-surface__range">
                <v-text-field
                  v-model="runtimeValues[filter.key].min"
                  :label="`${filter.label} min`"
                  type="number"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                />
                <v-text-field
                  v-model="runtimeValues[filter.key].max"
                  :label="`${filter.label} max`"
                  type="number"
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                />
              </div>
              <CrudListDateFilterControl
                v-else-if="filter.type === 'date'"
                v-model="runtimeValues[filter.key]"
                :label="filter.label"
                :control-id="filter.key"
                :placeholder="placeholder(filter, 'Select date')"
              />
            </template>
          </div>
        </v-card-text>
        <v-card-actions class="justify-space-between">
          <v-btn variant="text" @click="clearFilters">Clear all</v-btn>
          <v-btn color="primary" variant="flat" @click="sheetOpen = false">Apply</v-btn>
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

.crud-list-filter-surface__controls {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
}

.crud-list-filter-surface__controls--stacked {
  grid-template-columns: 1fr;
}

.crud-list-filter-surface__control {
  min-width: 0;
}

.crud-list-filter-surface__range {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-width: 0;
}

.crud-list-filter-surface__range--date {
  grid-column: span 2;
  grid-template-columns: repeat(2, minmax(14rem, 1fr));
}

.crud-list-filter-surface__controls--stacked .crud-list-filter-surface__range--date {
  grid-column: auto;
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

  .crud-list-filter-surface__range {
    grid-template-columns: 1fr;
  }
}
</style>
