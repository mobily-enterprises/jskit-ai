<script setup>
import { computed, ref } from "vue";
import { VAutocomplete, VSelect } from "vuetify/components";
import { optionTitle, optionValue, selectionFieldState } from "../support/selectFieldSupport.js";

// A v-select / v-autocomplete that never shows a stored id as text (see selectFieldSupport.js).
// Pass `searchable` for VAutocomplete, and `loading` while the options are being fetched.
defineOptions({ inheritAttrs: false });

const props = defineProps({
  searchable: { type: Boolean, default: false },
  modelValue: { type: null, default: null },
  items: { type: Array, default: () => [] },
  itemTitle: { type: [String, Array, Function], default: "title" },
  itemValue: { type: [String, Array, Function], default: "value" },
  multiple: { type: Boolean, default: false },
  returnObject: { type: Boolean, default: false },
  loading: { type: [Boolean, String], default: false }
});
const emit = defineEmits(["update:modelValue"]);

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
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps || {}" />
    </template>
  </component>
</template>
