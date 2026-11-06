<script setup>
import { computed } from "vue";
import { useShellWindowSizeClass } from "../composables/useShellWindowSizeClass.js";
import { useJskitText } from "../i18n.js";

// One page action in the top app bar. On compact windows a secondary action shows as an icon button named by its
// label; the page's primary action (`primary`, at most one) keeps its label as a filled button. Native button
// attributes such as `type="submit"` and `form` pass through, so an app bar Save can submit the page's form.
const props = defineProps({
  // A message key, { key, fallback } or plain text.
  label: {
    type: [String, Object],
    required: true
  },
  icon: {
    type: String,
    default: ""
  },
  to: {
    type: [String, Object],
    default: undefined
  },
  primary: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  }
});
const emit = defineEmits(["click"]);

const { text } = useJskitText();
const { isCompact } = useShellWindowSizeClass();
const resolvedLabel = computed(() => text(props.label));
const iconOnly = computed(() => Boolean(props.icon) && isCompact.value && !props.primary);

function handleClick(event) {
  emit("click", event);
}
</script>

<template>
  <v-tooltip v-if="iconOnly" :text="resolvedLabel" location="bottom">
    <template #activator="{ props: tooltipProps }">
      <v-btn
        v-bind="tooltipProps"
        class="shell-page-action"
        :icon="props.icon"
        variant="text"
        color="on-surface-variant"
        :to="props.to"
        :disabled="props.disabled"
        :loading="props.loading"
        :aria-label="resolvedLabel"
        @click="handleClick"
      />
    </template>
  </v-tooltip>
  <v-btn
    v-else
    class="shell-page-action shell-page-action--labelled"
    :variant="props.primary ? 'flat' : 'text'"
    :color="props.primary ? 'primary' : 'on-surface-variant'"
    :prepend-icon="props.icon || undefined"
    :to="props.to"
    :disabled="props.disabled"
    :loading="props.loading"
    @click="handleClick"
  >
    {{ resolvedLabel }}
  </v-btn>
</template>

<style scoped>
.shell-page-action--labelled {
  margin-inline: 4px;
}
</style>
