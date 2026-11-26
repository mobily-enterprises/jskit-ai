<script setup>
import { computed, ref, useAttrs } from "vue";
import { VAutocomplete } from "vuetify/components/VAutocomplete";
import { VProgressLinear } from "vuetify/components/VProgressLinear";
import { VSelect } from "vuetify/components/VSelect";
import { useJskitText } from "../i18n.js";
import { optionTitle, optionValue, selectionFieldState } from "../support/selectFieldSupport.js";

// A v-select / v-autocomplete that never shows a stored id as text (see selectFieldSupport.js).
// Pass `searchable` for VAutocomplete, and `loading` while the options are being fetched.
defineOptions({ inheritAttrs: false });

const props = defineProps({
  searchable: { type: Boolean, default: false },
  // readable-check: allow prop-untyped - data: a select's value is whatever its items hold, or a list of them
  modelValue: { type: null, default: null },
  items: { type: Array, default: () => [] },
  itemTitle: { type: [String, Array, Function], default: "title" },
  itemValue: { type: [String, Array, Function], default: "value" },
  multiple: { type: Boolean, default: false },
  returnObject: { type: Boolean, default: false },
  loading: { type: [Boolean, String], default: false }
});
const emit = defineEmits(["update:modelValue"]);

const attrs = useAttrs();
const { t } = useJskitText();
const field = ref(null);
const seen = new Map();
const state = computed(() => selectionFieldState(props, seen));
const titleOf = (item) => optionTitle(item, props.itemTitle);
const valueOf = (item) => optionValue(item, props.itemTitle, props.itemValue);

function update(value) {
  // A value hidden while its options load is kept when the user edits a multiple selection.
  const hidden = state.value.hiddenValues;
  emit("update:modelValue", props.multiple && hidden.length ? [...hidden, ...[].concat(value ?? [])] : value);
}

// Vuetify's loading bar has no accessible name (axe aria-progressbar-name), so the field draws the same bar with one,
// naming its field when it has a label. A loader slot the app passes still replaces it.
function loaderLabel() {
  return attrs.label ? t("jskit.http.selectField.loadingFor", { label: attrs.label }) : t("jskit.http.selectField.loading");
}

defineExpose({ focus: () => field.value?.focus() });
</script>

<template>
  <component
    :is="searchable ? VAutocomplete : VSelect"
    ref="field"
    v-bind="$attrs"
    :model-value="state.modelValue"
    :items="state.items"
    :item-title="returnObject ? itemTitle : titleOf"
    :item-value="returnObject ? itemValue : valueOf"
    :multiple="multiple"
    :return-object="returnObject"
    :loading="loading"
    @update:model-value="update"
  >
    <template v-if="!$slots.loader" #loader="{ color, isActive }">
      <VProgressLinear :active="isActive" :color="color" height="2" indeterminate :aria-label="loaderLabel()" />
    </template>
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps || {}" />
    </template>
  </component>
</template>
