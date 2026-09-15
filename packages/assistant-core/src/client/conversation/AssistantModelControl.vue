<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    location="top start"
    transition="scale-transition"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        aria-label="Choose AI"
        class="assistant-model-control__button"
        density="comfortable"
        :icon="mdiCogOutline"
        rounded="lg"
        size="small"
        :title="buttonTitle"
        type="button"
        variant="tonal"
      />
    </template>

    <v-sheet
      aria-label="AI session selector"
      border
      class="assistant-model-control"
      :elevation="3"
      rounded="xl"
    >
      <header class="assistant-model-control__header">
        <v-avatar color="primary" size="36" variant="tonal">
          <v-icon :icon="mdiBrain" size="20" />
        </v-avatar>
        <div>
          <strong class="text-title-small">AI controls</strong>
          <span class="text-body-small">{{ selectionSummary }}</span>
        </div>
      </header>

      <v-sheet
        v-if="changesDisabled"
        class="assistant-model-control__view-only"
        rounded="lg"
        role="status"
      >
        <v-icon :icon="mdiClockOutline" size="18" />
        <span>AI choices are view-only while the assistant is working.</span>
      </v-sheet>

      <div
        v-if="catalogLoading"
        aria-label="Loading available AIs"
        class="assistant-model-control__loading"
      >
        <v-skeleton-loader type="text, chip@4, text, chip@4" />
      </div>

      <div
        v-else-if="catalogError"
        class="assistant-model-control__state"
        role="alert"
      >
        <span>{{ catalogError }}</span>
        <v-btn size="small" variant="text" @click="emit('reload')">Try again</v-btn>
      </div>

      <div
        v-else-if="!providerRows.length"
        class="assistant-model-control__state"
        role="status"
      >
        No configured AIs are available for this session.
      </div>

      <div v-else class="assistant-model-control__choices">
        <slot name="before-choices" />
        <section
          v-if="providerRows.length > 1"
          aria-label="Provider"
          class="assistant-model-control__section"
        >
          <div class="assistant-model-control__label">Provider</div>
          <div class="assistant-model-control__options">
            <v-btn
              v-for="provider in providerRows"
              :key="provider.id"
              :active="modelProviderId === provider.id"
              :aria-pressed="modelProviderId === provider.id"
              class="assistant-model-control__option"
              :color="modelProviderId === provider.id ? 'primary' : undefined"
              :disabled="changesDisabled || saving"
              rounded="lg"
              size="small"
              type="button"
              :variant="modelProviderId === provider.id ? 'tonal' : 'outlined'"
              @click="selectProvider(provider.id)"
            >
              <span>{{ provider.label }}</span>
              <v-icon v-if="modelProviderId === provider.id" :icon="mdiCheck" size="15" />
            </v-btn>
          </div>
        </section>

        <section aria-label="Model" class="assistant-model-control__section">
          <div class="assistant-model-control__label">Model</div>
          <v-autocomplete
            v-if="modelRows.length > 6"
            auto-select-first="exact"
            hide-details
            :disabled="changesDisabled || saving"
            :items="modelRows"
            item-title="label"
            item-value="id"
            label="Choose model"
            :model-value="modelId"
            no-data-text="No matching models"
            variant="outlined"
            @update:model-value="selectModel"
          />
          <div v-else-if="modelRows.length" class="assistant-model-control__options">
            <v-btn
              v-for="model in modelRows"
              :key="model.id"
              :active="modelId === model.id"
              :aria-label="model.label"
              :aria-pressed="modelId === model.id"
              class="assistant-model-control__option"
              :color="modelId === model.id ? 'primary' : undefined"
              :disabled="changesDisabled || saving"
              rounded="lg"
              size="small"
              :title="changesDisabled ? 'Wait for the active turn to finish before changing models.' : model.label"
              type="button"
              :variant="modelId === model.id ? 'tonal' : 'outlined'"
              @click="selectModel(model.id)"
            >
              <span>{{ model.label }}</span>
              <v-icon v-if="modelId === model.id" :icon="mdiCheck" size="15" />
            </v-btn>
          </div>
          <span v-else class="assistant-model-control__empty">No available models.</span>
          <slot name="model-note" />
        </section>

        <slot name="provider-controls" />
        <section
          v-if="variantRows.length > 1"
          aria-label="Thinking"
          class="assistant-model-control__section"
        >
          <div class="assistant-model-control__label">Thinking</div>
          <div class="assistant-model-control__options">
            <v-btn
              v-for="variant in variantRows"
              :key="variant.id || 'automatic'"
              :active="variantId === variant.id"
              :aria-pressed="variantId === variant.id"
              class="assistant-model-control__option"
              :color="variantId === variant.id ? 'primary' : undefined"
              :disabled="changesDisabled || saving"
              rounded="lg"
              size="small"
              type="button"
              :variant="variantId === variant.id ? 'tonal' : 'outlined'"
              @click="selectVariant(variant.id)"
            >
              <span>{{ variant.label }}</span>
              <v-icon v-if="variantId === variant.id" :icon="mdiCheck" size="15" />
            </v-btn>
          </div>
        </section>
      </div>

      <footer class="assistant-model-control__actions">
        <slot name="footer" />
        <span />
        <v-btn
          color="primary"
          :disabled="!canSave || saving"
          size="small"
          variant="flat"
          @click="emit('apply')"
        >
          {{ saving ? "Applying…" : "Apply" }}
        </v-btn>
      </footer>
    </v-sheet>
  </v-menu>
</template>

<script setup>
import { mdiBrain, mdiCheck, mdiClockOutline, mdiCogOutline } from "@mdi/js";
const menuOpen = defineModel({ type: Boolean, default: false });
const props = defineProps({
  providerRows: { type: Array, default: () => [] },
  modelRows: { type: Array, default: () => [] },
  variantRows: { type: Array, default: () => [] },
  modelProviderId: { type: String, default: "" },
  modelId: { type: String, default: "" },
  variantId: { type: String, default: "" },
  selectionSummary: { type: String, default: "" },
  buttonTitle: { type: String, default: "Choose AI" },
  changesDisabled: Boolean,
  saving: Boolean,
  canSave: Boolean,
  catalogLoading: Boolean,
  catalogError: { type: String, default: "" }
});
const emit = defineEmits(["select-provider", "select-model", "select-variant", "apply", "reload"]);
function selectProvider(value) { if (!props.changesDisabled && !props.saving) emit("select-provider", value); }
function selectModel(value) { if (!props.changesDisabled && !props.saving) emit("select-model", value); }
function selectVariant(value) { if (!props.changesDisabled && !props.saving) emit("select-variant", value); }
</script>
<style scoped>
.assistant-model-control__button {
  flex: 0 0 2rem;
  height: 2rem;
  min-height: 2rem;
  min-width: 2rem;
  width: 2rem;
}

.assistant-model-control {
  display: grid;
  gap: 0.75rem;
  max-height: calc(100vh - 2rem);
  max-width: calc(100vw - 2rem);
  min-width: min(24rem, calc(100vw - 2rem));
  overflow-y: auto;
  padding: 0.75rem;
  width: min(24rem, calc(100vw - 2rem));
}

.assistant-model-control__header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  display: flex;
  gap: 0.65rem;
  padding: 0.1rem 0.1rem 0.7rem;
}

.assistant-model-control__header > div {
  display: grid;
  min-width: 0;
}

.assistant-model-control__header span {
  color: rgba(var(--v-theme-on-surface), 0.65);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-model-control__view-only {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.78);
  display: flex;
  font-size: 0.78rem;
  gap: 0.5rem;
  line-height: 1.35;
  padding: 0.6rem 0.7rem;
}

.assistant-model-control__choices,
.assistant-model-control__loading {
  display: grid;
  gap: 0.55rem;
}

.assistant-model-control__section {
  display: grid;
  gap: 0.32rem;
}

.assistant-model-control__label {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.72rem;
  font-weight: 650;
  line-height: 1.2;
  padding-inline: 0.12rem;
  text-transform: uppercase;
}

.assistant-model-control__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
}

.assistant-model-control__option {
  letter-spacing: 0;
  min-height: 2.5rem;
  text-transform: none;
}

.assistant-model-control__empty { color: rgba(var(--v-theme-on-surface), 0.62); font-size: 0.82rem; padding: 0.35rem 0.12rem; }

.assistant-model-control__state {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: flex;
  font-size: 0.84rem;
  gap: 0.5rem;
  justify-content: space-between;
  min-height: 4rem;
  padding: 0.5rem 0.25rem;
}

.assistant-model-control__actions {
  align-items: center;
  border-top: 1px solid rgba(var(--v-theme-outline), 0.12);
  display: grid;
  gap: 0.4rem;
  grid-template-columns: auto 1fr auto;
  min-height: 2.5rem;
  padding-top: 0.4rem;
}

@media (pointer: coarse) {
  .assistant-model-control__button {
    flex-basis: 3rem;
    height: 3rem;
    min-height: 3rem;
    min-width: 3rem;
    width: 3rem;
  }

  .assistant-model-control__option {
    min-height: 3rem;
  }
}

</style>
