<script setup>
import { computed, nextTick, ref, useAttrs, useId } from "vue";
import { useLocale } from "vuetify";
import {
  parseDateOnlyValue,
  formatDateOnlyValue,
  formatDateOnlyDisplay
} from "../support/crudListDateFilterSupport.js";

defineOptions({
  inheritAttrs: false
});

const props = defineProps({
  modelValue: {
    type: String,
    default: ""
  },
  label: {
    type: String,
    required: true
  },
  controlId: {
    type: String,
    default: ""
  },
  placeholder: {
    type: String,
    default: "Select date"
  },
  disabled: {
    type: Boolean,
    default: false
  },
  readonly: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["update:modelValue"]);
const attrs = useAttrs();
const { current: currentLocale } = useLocale();
const generatedId = useId();
const menuOpen = ref(false);
const textFieldRef = ref(null);

const resolvedControlId = computed(() => props.controlId || `crud-list-date-${generatedId}`);
const pickerId = computed(() => `${resolvedControlId.value}-picker`);
const pickerValue = computed(() => parseDateOnlyValue(props.modelValue));
const displayValue = computed(() => formatDateOnlyDisplay(props.modelValue, {
  locale: currentLocale?.value
}));
const pickerTitle = computed(() => `${props.label} calendar`);

function restoreFocus() {
  void nextTick(() => {
    textFieldRef.value?.focus?.();
  });
}

function openMenu() {
  if (props.disabled || props.readonly) {
    return;
  }
  menuOpen.value = true;
}

function closeMenu() {
  menuOpen.value = false;
  restoreFocus();
}

function clearDate() {
  if (props.disabled || props.readonly) {
    return;
  }
  emit("update:modelValue", "");
  closeMenu();
}

function selectDate(value) {
  const nextValue = formatDateOnlyValue(value);
  if (!nextValue) {
    return;
  }
  emit("update:modelValue", nextValue);
  closeMenu();
}

function handleActivatorKeydown(event) {
  if (!["Enter", " ", "ArrowDown"].includes(event.key)) {
    return;
  }
  event.preventDefault();
  openMenu();
}
</script>

<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    :open-on-click="false"
    location="bottom start"
    :offset="6"
    min-width="0"
  >
    <template #activator="{ props: activatorProps }">
      <v-text-field
        v-bind="{ ...attrs, ...activatorProps }"
        :id="resolvedControlId"
        ref="textFieldRef"
        :model-value="displayValue"
        :label="label"
        :placeholder="placeholder"
        :aria-label="label"
        :aria-controls="pickerId"
        :aria-expanded="String(menuOpen)"
        aria-haspopup="dialog"
        :data-date-filter-control="resolvedControlId"
        append-inner-icon="$calendar"
        :disabled="disabled"
        :clearable="Boolean(modelValue) && !disabled && !readonly"
        persistent-clear
        persistent-placeholder
        readonly
        inputmode="none"
        variant="outlined"
        density="comfortable"
        hide-details="auto"
        class="crud-list-date-filter-control"
        @click:control="openMenu"
        @click:append-inner="openMenu"
        @click:clear.stop="clearDate"
        @keydown="handleActivatorKeydown"
      />
    </template>

    <v-card
      :id="pickerId"
      :aria-label="pickerTitle"
      role="dialog"
      class="crud-list-date-filter-control__picker"
      @keydown.esc.stop.prevent="closeMenu"
    >
      <v-date-picker
        :model-value="pickerValue"
        :title="pickerTitle"
        :header="label"
        :disabled="disabled || readonly"
        color="primary"
        show-adjacent-months
        width="100%"
        @update:model-value="selectDate"
      />
      <v-divider />
      <v-card-actions>
        <v-btn
          variant="text"
          :disabled="disabled || readonly || !modelValue"
          @click="clearDate"
        >
          Clear
        </v-btn>
        <v-spacer />
        <v-btn color="primary" variant="text" @click="closeMenu">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>

<style scoped>
.crud-list-date-filter-control {
  min-width: 0;
  width: 100%;
}

.crud-list-date-filter-control__picker {
  max-width: calc(100vw - 2rem);
  overflow: hidden;
  width: 22rem;
}

.crud-list-date-filter-control__picker :deep(.v-date-picker) {
  max-width: 100%;
}
</style>
