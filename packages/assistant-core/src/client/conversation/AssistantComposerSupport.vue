<template>
  <section
    class="assistant-composer-support"
    :class="`assistant-composer-support--${mode}`"
    data-assistant-composer-support
    @focusout="$emit('focusout', $event)"
    @keydown.esc.stop.prevent="$emit('dismiss')"
  >
    <span
      :id="statusId || undefined"
      aria-atomic="true"
      aria-live="polite"
      class="assistant-composer-support__sr-status"
      role="status"
    >{{ statusAnnouncement }}</span>

    <div
      v-if="mode === 'assistant'"
      aria-hidden="true"
      class="assistant-composer-support__assistant-status"
    >
      <slot name="activity" :activity="activity">
        <span v-if="activity.animated !== false" class="assistant-composer-support__assistant-mark" />
        <span>{{ activity.label }}</span>
      </slot>
    </div>

    <template v-else-if="mode !== 'hidden'">
      <v-icon
        aria-hidden="true"
        class="assistant-composer-support__marker"
        :icon="mdiLightbulbOnOutline"
        size="16"
      />

      <div
        v-if="mode === 'loading'"
        aria-hidden="true"
        class="assistant-composer-support__loading"
      >
        <span>Thinking of a few ideas</span>
      </div>

      <div
        v-else
        class="assistant-composer-support__options"
        aria-label="Suggested prompts"
        aria-orientation="horizontal"
        role="group"
      >
        <v-btn
          v-for="suggestion in suggestions"
          :key="suggestion.prompt"
          :aria-label="`Use suggestion: ${suggestion.prompt}`"
          class="assistant-composer-support__option"
          rounded="xl"
          size="small"
          type="button"
          variant="tonal"
          @blur="$emit('preview', null)"
          @mousedown.prevent
          @focus="$emit('preview', suggestion)"
          @mouseenter="$emit('preview', suggestion)"
          @mouseleave="$emit('preview', null)"
          @click="$emit('select', suggestion)"
        >
          <span>{{ suggestion.label }}</span>
        </v-btn>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { mdiLightbulbOnOutline } from "@mdi/js";

defineEmits(["dismiss", "focusout", "preview", "select"]);
const props = defineProps({
  activity: { type: Object, default: () => ({}) },
  loading: {
    default: false,
    type: Boolean
  },
  statusId: {
    default: "",
    type: String
  },
  suggestions: {
    default: () => [],
    type: Array
  }
});

const mode = computed(() => {
  if (String(props.activity.label || "").trim()) {
    return "assistant";
  }
  if (props.loading) {
    return "loading";
  }
  return props.suggestions.length > 0 ? "ready" : "hidden";
});
const statusAnnouncement = computed(() => {
  if (mode.value === "assistant") {
    return String(props.activity.label || "").trim();
  }
  if (mode.value === "loading") {
    return "Thinking of a few ideas.";
  }
  if (mode.value === "ready") {
    return `${props.suggestions.length} suggested prompts are available before the message controls.`;
  }
  return "";
});
</script>

<style scoped>
.assistant-composer-support {
  align-items: center;
  box-sizing: border-box;
  color: rgba(var(--v-theme-on-surface), 0.68);
  display: grid;
  grid-template-columns: 1.25rem minmax(0, 1fr);
  height: 2.25rem;
  max-width: 100%;
  min-height: 2.25rem;
  min-width: 0;
  overflow: hidden;
  padding-inline: 0.2rem;
  width: 100%;
}

.assistant-composer-support__sr-status {
  block-size: 1px;
  clip-path: inset(50%);
  inline-size: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
}

.assistant-composer-support__marker {
  justify-self: center;
}

.assistant-composer-support__assistant-status,
.assistant-composer-support__loading {
  align-items: center;
  display: flex;
}

.assistant-composer-support__assistant-status {
  font-size: 0.78rem;
  gap: 0.45rem;
  grid-column: 1 / -1;
  line-height: 1.35;
  min-width: 0;
  overflow-wrap: anywhere;
  padding-inline: 0.55rem;
}

.assistant-composer-support__assistant-mark {
  animation: assistant-composer-support-pulse 1.2s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  height: 0.42rem;
  width: 0.42rem;
}

.assistant-composer-support__loading {
  font-size: 0.76rem;
  grid-column: 2;
  min-width: 0;
  padding-inline: 0.5rem;
}

.assistant-composer-support__options {
  align-items: center;
  box-sizing: border-box;
  display: flex;
  gap: 0.35rem;
  grid-column: 2;
  height: 100%;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-inline: contain;
  padding: 0.1rem 0.2rem;
  scroll-snap-type: inline proximity;
  scrollbar-width: none;
  width: 100%;
}

.assistant-composer-support__options::-webkit-scrollbar {
  display: none;
}

.assistant-composer-support__option {
  color: rgb(var(--v-theme-on-surface));
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1.25;
  min-width: 0;
  padding-inline: 0.65rem;
  scroll-snap-align: start;
  text-transform: none;
}

.assistant-composer-support__option span {
  white-space: nowrap;
}

@keyframes assistant-composer-support-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-composer-support__assistant-mark {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
</style>
