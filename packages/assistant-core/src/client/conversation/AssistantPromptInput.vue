<template>
  <div
    class="assistant-prompt-input"
    :class="{
      'assistant-prompt-input--compact': density === 'compact',
      'assistant-prompt-input--dragging': dragging,
      'assistant-prompt-input--has-attachments': attachmentState.count,
      'assistant-prompt-input--has-footer': $slots.footer,
      'assistant-prompt-input--has-input-start': $slots['input-start']
    }"
  >
    <slot name="attachments" />

    <div
      class="assistant-prompt-input__field"
      :class="{ 'assistant-prompt-input__field--disabled': disabled }"
    >
      <label
        v-if="label"
        class="assistant-prompt-input__label"
        :for="textareaId"
      >
        {{ label }}
      </label>

      <div
        v-if="$slots['input-start']"
        class="assistant-prompt-input__input-start"
      >
        <slot name="input-start" />
      </div>

      <textarea
        :id="textareaId"
        ref="textareaRef"
        :aria-describedby="describedBy || undefined"
        :aria-label="textareaAriaLabel"
        class="assistant-prompt-input__input"
        :disabled="disabled"
        :placeholder="placeholder"
        :rows="rows"
        :value="modelValue"
        @blur="handleTextareaBlur"
        @focus="handleTextareaFocus"
        @input="handleTextareaInput"
        @keydown="handleTextareaKeydown"
        @paste="emit('paste', $event)"
      />

      <div
        v-if="$slots.footer"
        class="assistant-prompt-input__footer"
      >
        <slot name="footer" :attachment-state="attachmentState" />
      </div>
    </div>

    <div
      v-if="detailsVisible"
      class="assistant-prompt-input__details"
    >
      <div
        v-for="message in combinedErrorMessages"
        :key="message"
        class="assistant-prompt-input__error"
      >
        {{ message }}
      </div>
      <div
        v-if="hintVisible"
        class="assistant-prompt-input__hint"
      >
        {{ hint }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
const emit = defineEmits(["blur", "escape", "focus", "input-activity", "submit", "tab-to-submit", "update:modelValue", "paste"]);
const props = defineProps({
  submitOnModifierEnter: { type: Boolean, default: false },
  ariaLabel: {
    default: "",
    type: String
  },
  attachmentState: { default: () => ({ canSubmit: true, count: 0 }), type: Object },
  dragging: { default: false, type: Boolean },
  autoGrow: {
    default: true,
    type: Boolean
  },
  disabled: {
    default: false,
    type: Boolean
  },
  describedBy: {
    default: "",
    type: String
  },
  errorMessages: {
    default: () => [],
    type: [Array, String]
  },
  hint: {
    default: "",
    type: String
  },
  label: {
    default: "",
    type: String
  },
  modelValue: {
    default: "",
    type: String
  },
  persistentHint: {
    default: false,
    type: Boolean
  },
  placeholderAffectsHeight: {
    default: true,
    type: Boolean
  },
  placeholder: {
    default: "",
    type: String
  },
  rows: {
    default: 4,
    type: [Number, String]
  },
  density: {
    default: "default",
    type: String
  },
  submitOnEnter: {
    default: false,
    type: Boolean
  },
  submitEnabled: {
    default: true,
    type: Boolean
  },
  tabToSubmit: {
    default: false,
    type: Boolean
  },
  variant: {
    default: "outlined",
    type: String
  }
});

const textareaRef = ref(null);
const textareaId = `assistant-prompt-${useId()}`;
let resizeFrame = 0;
let preserveHeightForNextModelValueChange = false;
const combinedErrorMessages = computed(() => {
  return Array.isArray(props.errorMessages)
    ? props.errorMessages
    : [props.errorMessages].filter(Boolean);
});
const hintVisible = computed(() => Boolean(
  props.hint &&
  (props.persistentHint || combinedErrorMessages.value.length < 1)
));
const detailsVisible = computed(() => Boolean(
  combinedErrorMessages.value.length ||
  hintVisible.value
));
const textareaAriaLabel = computed(() => (
  props.ariaLabel
    ? props.ariaLabel
    : undefined
));

function resizeTextarea() {
  if (!props.autoGrow) {
    return;
  }
  const textarea = textareaRef.value;
  if (!textarea) {
    return;
  }
  if (!props.placeholderAffectsHeight && !textarea.value) {
    return;
  }
  const style = window.getComputedStyle(textarea);
  const minHeight = Number.parseFloat(style.minHeight) || 0;
  const maxHeight = Number.parseFloat(style.maxHeight) || Number.POSITIVE_INFINITY;
  textarea.style.height = "auto";
  const contentHeight = Math.max(textarea.scrollHeight, minHeight);
  const targetHeight = Math.min(contentHeight, maxHeight);
  textarea.style.height = `${targetHeight}px`;
  textarea.style.overflowY = contentHeight > targetHeight + 1 ? "auto" : "hidden";
}

function queueResizeTextarea() {
  if (!props.autoGrow || typeof window === "undefined") {
    return;
  }
  if (resizeFrame) {
    window.cancelAnimationFrame(resizeFrame);
  }
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0;
    resizeTextarea();
  });
}

function preserveHeightForNextModelValue() {
  const textarea = textareaRef.value;
  if (!props.autoGrow || !textarea) {
    return false;
  }
  if (resizeFrame) {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
  }
  preserveHeightForNextModelValueChange = true;
  textarea.style.height = `${textarea.getBoundingClientRect().height}px`;
  textarea.style.overflowY = "auto";
  return true;
}

function handleTextareaInput(event = {}) {
  preserveHeightForNextModelValueChange = false;
  emit("input-activity");
  emit("update:modelValue", String(event?.target?.value || ""));
  queueResizeTextarea();
}

function handleTextareaFocus(event = {}) {
  emit("focus", event);
}

function handleTextareaBlur(event = {}) {
  emit("blur", event);
}

function handleTextareaKeydown(event = {}) {
  if (event.key === "Escape") {
    emit("escape", event);
    return;
  }
  if (
    props.tabToSubmit &&
    props.submitEnabled &&
    String(props.modelValue || "").trim() &&
    props.attachmentState.canSubmit &&
    event.key === "Tab" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    emit("tab-to-submit");
    return;
  }
  if (props.submitOnModifierEnter && event.key === "Enter" && (event.ctrlKey || event.metaKey) &&
    !event.shiftKey && !event.altKey && !event.isComposing && props.submitEnabled && props.attachmentState.canSubmit) {
    event.preventDefault();
    event.stopPropagation();
    emit("submit");
    return;
  }
  if (event.key === "Enter" && !props.submitOnEnter) {
    event.stopPropagation();
    return;
  }
  if (
    !props.submitOnEnter ||
    event.key !== "Enter" ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.isComposing ||
    !props.submitEnabled ||
    !props.attachmentState.canSubmit
  ) {
    return;
  }
  event.preventDefault();
  emit("submit");
}

function focusTextarea(options = { preventScroll: true }) {
  textareaRef.value?.focus?.(options);
}

onMounted(queueResizeTextarea);

onBeforeUnmount(() => {
  if (resizeFrame && typeof window !== "undefined") {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
  }
});

watch(() => [
  props.autoGrow,
  props.modelValue,
  props.placeholder,
  props.placeholderAffectsHeight,
  props.rows
], (values, previousValues = []) => {
  const modelValueChanged = values[1] !== previousValues[1];
  if (preserveHeightForNextModelValueChange && modelValueChanged) {
    preserveHeightForNextModelValueChange = false;
    return;
  }
  queueResizeTextarea();
});

defineExpose({ inputElement: textareaRef, focus: focusTextarea, preserveHeightForNextModelValue, queueResizeTextarea });
</script>
<style scoped>
.assistant-prompt-input {
  box-sizing: border-box;
  display: grid;
  gap: 0;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  position: relative;
  text-align: left;
  width: 100%;
}

.assistant-prompt-input__field {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.34);
  border-radius: 18px;
  box-sizing: border-box;
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-on-surface), 0.08);
  display: grid;
  max-width: 100%;
  min-width: 0;
  padding-top: 0.01rem;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.assistant-prompt-input__field:not(.assistant-prompt-input__field--disabled):focus-within {
  border-color: rgb(var(--v-theme-primary));
  box-shadow:
    0 0 0 2px rgba(var(--v-theme-primary), 0.28),
    inset 0 0 0 1px rgba(var(--v-theme-primary), 0.2);
}

.assistant-prompt-input__field--disabled {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: rgba(var(--v-theme-on-surface), 0.16);
  box-shadow: none;
}

.assistant-prompt-input__label {
  align-self: start;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.82);
  font-size: 0.78rem;
  line-height: 1.1;
  margin: -0.5rem 0 0 0.9rem;
  max-width: calc(100% - 1.8rem);
  overflow: hidden;
  padding-inline: 0.24rem;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: fit-content;
  z-index: 1;
}

.assistant-prompt-input__input {
  background: transparent;
  border: 0;
  box-sizing: border-box;
  color: rgb(var(--v-theme-on-surface));
  display: block;
  font: inherit;
  line-height: 1.4;
  max-height: min(16rem, 32dvh);
  min-height: 3.55rem;
  min-width: 0;
  outline: 0;
  overflow-x: hidden;
  overflow-y: hidden;
  padding: 0.5rem 1rem 0.2rem;
  resize: none;
  width: 100%;
  word-break: break-word;
}

.assistant-prompt-input__input-start {
  min-width: 0;
  padding: 0.5rem 1rem 0.08rem;
}

.assistant-prompt-input--has-input-start .assistant-prompt-input__input {
  padding-top: 0.24rem;
}

.assistant-prompt-input__input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.58);
  opacity: 1;
}

.assistant-prompt-input__input:disabled {
  color: rgba(var(--v-theme-on-surface), 0.38);
  cursor: not-allowed;
  opacity: 1;
  -webkit-text-fill-color: currentColor;
}

.assistant-prompt-input__input:disabled::placeholder {
  color: inherit;
  opacity: 1;
}

.assistant-prompt-input__footer {
  min-width: 0;
  padding: 0 0.55rem 0.55rem;
}

.assistant-prompt-input--compact .assistant-prompt-input__input {
  max-height: min(8rem, 20dvh);
  min-height: 2.5rem;
  padding: 0.4rem 0.65rem 0.15rem;
}

.assistant-prompt-input--compact .assistant-prompt-input__footer {
  padding: 0 0.3rem 0.25rem;
}

.assistant-prompt-input__details {
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: grid;
  font-size: 0.76rem;
  gap: 0.12rem;
  line-height: 1.3;
  min-width: 0;
  padding: 0.32rem 0.75rem 0;
}

.assistant-prompt-input__error {
  color: rgb(var(--v-theme-error));
}

.assistant-prompt-input--dragging {
  outline: 2px dashed rgb(var(--v-theme-primary));
  outline-offset: 4px;
}

.assistant-prompt-input__file-input {
  display: none;
}

.assistant-prompt-input--has-attachments .assistant-prompt-input__field {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  margin-top: -1px;
}

</style>
