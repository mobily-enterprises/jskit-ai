<script setup>
import { computed, unref } from "vue";

const props = defineProps({
  screen: {
    type: Object,
    required: true
  },
  resolveLookupItems: {
    type: Function,
    default: null
  },
  resolveLookupLoading: {
    type: Function,
    default: null
  },
  resolveLookupSearch: {
    type: Function,
    default: null
  },
  setLookupSearch: {
    type: Function,
    default: null
  }
});

const formRuntime = computed(() => props.screen?.formRuntime || {});
const addEdit = computed(() => props.screen?.addEdit || formRuntime.value?.addEdit || {});
const formState = computed(() => props.screen?.formState || formRuntime.value?.form || {});
const mode = computed(() => String(unref(props.screen?.mode) || "new").trim() || "new");
const title = computed(() => String(unref(props.screen?.title) || "").trim());
const subtitle = computed(() => String(unref(props.screen?.subtitle) || "").trim());
const saveLabel = computed(() => String(unref(props.screen?.saveLabel) || "Save").trim() || "Save");
const cancelTo = computed(() => unref(props.screen?.cancelTo) || "");

function resolveFieldErrors(fieldKey) {
  if (typeof props.screen?.resolveFieldErrors === "function") {
    return props.screen.resolveFieldErrors(fieldKey);
  }
  if (typeof formRuntime.value?.resolveFieldErrors === "function") {
    return formRuntime.value.resolveFieldErrors(fieldKey);
  }
  return [];
}

function resolveCancelTo(target = cancelTo.value) {
  if (typeof props.screen?.resolveCancelTo === "function") {
    return props.screen.resolveCancelTo(target);
  }
  return target || "";
}
</script>

<template>
  <section class="generated-ui-screen generated-ui-screen--operator ui-generator-add-edit-form d-flex flex-column ga-4">
    <header class="ui-generator-add-edit-form__header">
      <div class="ui-generator-add-edit-form__copy">
        <h1 class="ui-generator-add-edit-form__title">{{ title }}</h1>
        <p v-if="subtitle" class="text-body-2 text-medium-emphasis mb-0">{{ subtitle }}</p>
      </div>
      <div class="ui-generator-add-edit-form__actions">
        <v-btn v-if="cancelTo" color="primary" variant="outlined" :to="resolveCancelTo(cancelTo)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="addEdit.isSaving"
          :disabled="addEdit.isSubmitDisabled"
          @click="addEdit.submit"
        >
          {{ saveLabel }}
        </v-btn>
      </div>
    </header>

    <v-sheet rounded="lg" border class="ui-generator-add-edit-form__panel">
      <div v-if="addEdit.loadError" class="ui-generator-add-edit-form__state">
        <h2 class="text-h6 mb-2">Unable to load form</h2>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ addEdit.loadError }}
        </p>
        <v-btn
          v-if="addEdit.canRetryLoad"
          color="primary"
          variant="tonal"
          :loading="addEdit.isFetching"
          @click="addEdit.refresh"
        >
          Retry
        </v-btn>
      </div>
      <template v-else-if="formRuntime.showFormSkeleton">
        <div class="pa-4">
          <v-skeleton-loader type="heading, text@2, article" />
        </div>
      </template>
      <v-form v-else class="pa-4" @submit.prevent="addEdit.submit" novalidate>
        <v-progress-linear v-if="addEdit.isRefetching" indeterminate class="mb-4" />
        <v-row class="ui-generator-add-edit-form__fields">
          <slot
            name="fields"
            :mode="mode"
            :form-runtime="formRuntime"
            :form-state="formState"
            :add-edit="addEdit"
            :resolve-field-errors="resolveFieldErrors"
            :resolve-lookup-items="resolveLookupItems"
            :resolve-lookup-loading="resolveLookupLoading"
            :resolve-lookup-search="resolveLookupSearch"
            :set-lookup-search="setLookupSearch"
          />
        </v-row>
      </v-form>
    </v-sheet>
  </section>
</template>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.35rem, 2vw, 1.85rem);
  --generated-ui-screen-state-padding: 2.5rem 1.25rem;
}

.generated-ui-screen--operator {
  --generated-ui-screen-state-padding: 2rem 1rem;
}

.ui-generator-add-edit-form__header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.ui-generator-add-edit-form__copy {
  min-width: 0;
}

.ui-generator-add-edit-form__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.35rem;
}

.ui-generator-add-edit-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.ui-generator-add-edit-form__panel {
  overflow: hidden;
}

.ui-generator-add-edit-form__state {
  margin-inline: auto;
  max-width: 30rem;
  padding: var(--generated-ui-screen-state-padding);
  text-align: center;
}

.ui-generator-add-edit-form__fields :deep(.v-col) {
  min-width: 0;
}

@media (max-width: 960px) {
  .ui-generator-add-edit-form__header {
    flex-direction: column;
  }

  .ui-generator-add-edit-form__actions {
    width: 100%;
  }

  .ui-generator-add-edit-form__actions :deep(.v-btn) {
    min-height: 48px;
    flex: 1 1 10rem;
  }

  .ui-generator-add-edit-form__state :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
