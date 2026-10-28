<script setup>
import { computed } from "vue";
import CrudListDateFilterControl from "./CrudListDateFilterControl.vue";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  filters: {
    type: Array,
    default: () => []
  },
  runtime: {
    type: Object,
    default: null
  },
  stacked: {
    type: Boolean,
    default: false
  }
});

const { t, text } = useJskitText();
const runtimeValues = computed(() => props.runtime?.values || {});

function optionItems(filter = {}) {
  return Array.isArray(filter.options) ? filter.options : [];
}

// Filter labels and placeholders may be message keys.
function filterLabel(filter = {}, key = "", params = {}) {
  const label = text(filter.label);
  return key ? t(key, { ...params, label }) : label;
}

function placeholder(filter = {}, fallbackKey = "") {
  return String(text(filter?.ui?.placeholder) || (fallbackKey ? t(fallbackKey) : "")).trim();
}
</script>

<template>
  <div
    class="crud-list-filter-surface__controls"
    :class="{ 'crud-list-filter-surface__controls--stacked': stacked }"
  >
    <template v-for="filter in filters" :key="filter.key">
      <v-switch
        v-if="filter.type === 'flag'"
        v-model="runtimeValues[filter.key]"
        :label="filterLabel(filter)"
        color="primary"
        density="comfortable"
        hide-details
        class="crud-list-filter-surface__control"
      />
      <v-select
        v-else-if="filter.type === 'enum' || filter.type === 'enumMany' || filter.type === 'presence'"
        v-model="runtimeValues[filter.key]"
        :items="optionItems(filter)"
        :label="filterLabel(filter)"
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
        :label="filterLabel(filter)"
        :placeholder="placeholder(filter, 'jskit.http.crud.filters.enterIds')"
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
        :label="filterLabel(filter)"
        :placeholder="placeholder(filter, 'jskit.http.crud.filters.enterId')"
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
        :aria-label="filterLabel(filter, 'jskit.http.crud.filters.dateRange')"
        :data-filter-key="filter.key"
        data-filter-type="date-range"
      >
        <CrudListDateFilterControl
          v-model="runtimeValues[filter.key].from"
          :label="filterLabel(filter, 'jskit.http.crud.filters.rangeFrom')"
          :control-id="`${filter.key}-from`"
          :placeholder="placeholder(filter, 'jskit.http.crud.filters.selectStartDate')"
        />
        <CrudListDateFilterControl
          v-model="runtimeValues[filter.key].to"
          :label="filterLabel(filter, 'jskit.http.crud.filters.rangeTo')"
          :control-id="`${filter.key}-to`"
          :placeholder="placeholder(filter, 'jskit.http.crud.filters.selectEndDate')"
        />
      </div>
      <div v-else-if="filter.type === 'numberRange'" class="crud-list-filter-surface__range">
        <v-text-field
          v-model="runtimeValues[filter.key].min"
          :label="filterLabel(filter, 'jskit.http.crud.filters.rangeMin')"
          type="number"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
        />
        <v-text-field
          v-model="runtimeValues[filter.key].max"
          :label="filterLabel(filter, 'jskit.http.crud.filters.rangeMax')"
          type="number"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
        />
      </div>
      <CrudListDateFilterControl
        v-else-if="filter.type === 'date'"
        v-model="runtimeValues[filter.key]"
        :label="filterLabel(filter)"
        :control-id="filter.key"
        :placeholder="placeholder(filter, 'jskit.http.crud.filters.selectDate')"
        class="crud-list-filter-surface__control"
      />
    </template>
  </div>
</template>

<style scoped>
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

@media (max-width: 640px) {
  .crud-list-filter-surface__range {
    grid-template-columns: 1fr;
  }
}
</style>
