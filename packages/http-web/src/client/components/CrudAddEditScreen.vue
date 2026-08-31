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
  <section class="crud-screen crud-screen--operator crud-add-edit-form d-flex flex-column ga-4">
    <div class="crud-add-edit-form__actions">
      <v-btn v-if="cancelTo" color="primary" variant="outlined" :to="resolveCancelTo(cancelTo)">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :disabled="addEdit.isSubmitDisabled"
        @click="addEdit.submit"
      >
        {{ addEdit.isSaving ? "Saving…" : saveLabel }}
      </v-btn>
    </div>

    <v-sheet rounded="lg" border class="crud-add-edit-form__panel">
      <div v-if="addEdit.loadError" class="crud-add-edit-form__state">
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ addEdit.loadError }}
        </p>
        <v-btn
          v-if="addEdit.canRetryLoad"
          color="primary"
          variant="tonal"
          :disabled="addEdit.isFetching"
          @click="addEdit.refresh"
        >
          {{ addEdit.isFetching ? "Retrying…" : "Retry" }}
        </v-btn>
      </div>
      <template v-else-if="formRuntime.showFormSkeleton">
        <div class="pa-4">
          <v-skeleton-loader type="text@2, article" />
        </div>
      </template>
      <v-form v-else class="pa-4" @submit.prevent="addEdit.submit" novalidate>
        <v-row class="crud-add-edit-form__fields">
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
.crud-screen {
  --crud-screen-state-padding: 2.5rem 1.25rem;
}

.crud-screen--operator {
  --crud-screen-state-padding: 2rem 1rem;
}

.crud-add-edit-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.crud-add-edit-form__panel {
  overflow: hidden;
}

.crud-add-edit-form__state {
  margin-inline: auto;
  max-width: 30rem;
  padding: var(--crud-screen-state-padding);
  text-align: center;
}

.crud-add-edit-form__fields :deep(.v-col) {
  min-width: 0;
}

@media (max-width: 960px) {
  .crud-add-edit-form__actions {
    width: 100%;
  }

  .crud-add-edit-form__actions :deep(.v-btn) {
    min-height: 48px;
    flex: 1 1 10rem;
  }

  .crud-add-edit-form__state :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
