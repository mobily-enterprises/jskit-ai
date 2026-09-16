<script setup>
import { mdiPencilOutline } from "@mdi/js";
defineProps({
  questions: { type: Array, default: () => [] },
  selectItems: { type: Object, default: () => ({}) },
  choices: { type: Array, default: () => [] }
});
const answers = defineModel("answers", { type: Object, default: () => ({}) });
const choice = defineModel("choice", { type: String, default: "" });
const emit = defineEmits(["dismiss"]);
</script>
<template>
  <div
    v-if="questions.length"
    class="assistant-questions__question-fields"
    aria-label="Assistant questions"
  >
    <div class="assistant-questions__question-fields-header">
      <v-btn
        aria-label="Answer normally instead"
        class="ml-auto"
        color="primary"
        :prepend-icon="mdiPencilOutline"
        size="small"
        variant="tonal"
        @click="emit('dismiss')"
      >
        Answer normally instead
      </v-btn>
    </div>
    <div
      v-for="question in questions"
      :key="question.name"
      class="assistant-questions__question-field"
    >
      <v-select
        v-if="question.choices.length"
        :model-value="answers[question.name]"
        @update:model-value="answers = { ...answers, [question.name]: $event }"
        class="assistant-questions__question-select"
        density="compact"
        hide-details="auto"
        item-title="selectLabel"
        item-value="value"
        :items="selectItems[question.name] || question.choices"
        :label="`[${question.number}] ${question.label}`"
        :title="question.label"
        variant="outlined"
      />
      <v-text-field
        v-else
        :model-value="answers[question.name]"
        @update:model-value="answers = { ...answers, [question.name]: $event }"
        autocomplete="off"
        density="compact"
        hide-details="auto"
        :label="`[${question.number}] ${question.label}`"
        :title="question.label"
        variant="outlined"
      />
    </div>
  </div>
  <div
    v-else-if="choices.length"
    class="assistant-questions__answer-choices"
    aria-label="Suggested answers"
  >
    <v-chip-group
      v-model="choice"
      column
      selected-class="text-primary"
    >
      <v-chip
        v-for="option in choices"
        :key="option.value"
        filter
        :value="option.value"
        variant="outlined"
      >
        {{ option.label }}
      </v-chip>
    </v-chip-group>
  </div>
</template>
<style scoped>
.assistant-questions__question-fields {
  display: grid;
  gap: 0.3rem;
  padding: 0.3rem 0.45rem 0;
}

.assistant-questions__question-fields-header {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.7);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.78rem;
  gap: 0.25rem 0.5rem;
  justify-content: space-between;
  min-width: 0;
}

.assistant-questions__question-field {
  min-width: 0;
}

.assistant-questions__question-select {
  max-width: 100%;
  min-width: 0;
}

.assistant-questions__answer-choices {
  padding: 0.35rem 0.55rem 0;
}

</style>
