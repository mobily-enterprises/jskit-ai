<script setup>
import { computed, onBeforeUnmount } from "vue";
import CrudListDateFilterControl from "./CrudListDateFilterControl.vue";
import { createFilterTyping } from "../composables/support/filterTypingSupport.js";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  filters: {
    type: Array,
    default: () => []
  },
  runtime: {
    type: /** @type {import("vue").PropType<import("../types.js").CrudListFilterRuntime>} */ (Object),
    required: true
  },
  stacked: {
    type: Boolean,
    default: false
  }
});

const { t, text } = useJskitText();
const runtimeValues = computed(() => props.runtime.values);

// An id or a number range's bound reaches the list when the person pauses, presses Enter or leaves the field: each
// key would otherwise ask for a list. A key is the filter's, or "filter:min" and "filter:max" for a range's bounds.
const typing = createFilterTyping({
  read(key) {
    const [filterKey, bound] = key.split(":");
    return bound ? runtimeValues.value[filterKey]?.[bound] : runtimeValues.value[filterKey];
  },
  write(key, value) {
    const [filterKey, bound] = key.split(":");
    if (bound) {
      runtimeValues.value[filterKey][bound] = value;
    } else {
      runtimeValues.value[filterKey] = value;
    }
  }
});
onBeforeUnmount(typing.applyAll);

// Option labels may be message keys, such as the presence filter's.
function optionItems(filter = {}) {
  return Array.isArray(filter.options)
    ? filter.options.map((option) => ({ ...option, label: text(option.label) }))
    : [];
}

// Filter labels and placeholders may be message keys.
function filterLabel(filter = {}, key = "", params = {}) {
  const label = text(filter.label);
  return key ? t(key, { ...params, label }) : label;
}

function placeholder(filter = {}, fallbackKey = "") {
  return String(text(filter.ui?.placeholder) || (fallbackKey ? t(fallbackKey) : "")).trim();
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
        hide-details
        class="crud-list-filter-surface__control"
      />
      <!-- readable-check: allow selection-field - data: an enum or presence filter lists its options in its definition, so nothing loads -->
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
        hide-details="auto"
        class="crud-list-filter-surface__control"
      />
      <v-text-field
        v-else-if="filter.type === 'recordId'"
        :model-value="typing.value(filter.key)"
        :label="filterLabel(filter)"
        :placeholder="placeholder(filter, 'jskit.http.crud.filters.enterId')"
        clearable
        hide-details="auto"
        class="crud-list-filter-surface__control"
        @update:model-value="typing.type(filter.key, $event)"
        @blur="typing.apply(filter.key)"
        @keydown.enter="typing.apply(filter.key)"
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
          v-for="bound in ['min', 'max']"
          :key="bound"
          :model-value="typing.value(`${filter.key}:${bound}`)"
          :label="filterLabel(filter, bound === 'min' ? 'jskit.http.crud.filters.rangeMin' : 'jskit.http.crud.filters.rangeMax')"
          type="number"
          hide-details="auto"
          @update:model-value="typing.type(`${filter.key}:${bound}`, $event)"
          @blur="typing.apply(`${filter.key}:${bound}`)"
          @keydown.enter="typing.apply(`${filter.key}:${bound}`)"
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
