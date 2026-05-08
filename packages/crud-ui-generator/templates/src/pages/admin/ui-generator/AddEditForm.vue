<template>
  <section class="ui-generator-add-edit-form d-flex flex-column ga-4">
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
        <p class="text-body-2 text-medium-emphasis mb-0">
          {{ addEdit.loadError }}
        </p>
      </div>
      <template v-else-if="formRuntime.showFormSkeleton">
        <div class="pa-4">
          <v-skeleton-loader type="heading, text@2, article" />
        </div>
      </template>
      <v-form v-else class="pa-4" @submit.prevent="addEdit.submit" novalidate>
        <v-progress-linear v-if="addEdit.isRefetching" indeterminate class="mb-4" />
        <v-row class="ui-generator-add-edit-form__fields">
          <template v-if="mode === 'new'">
            <!-- jskit:crud-ui-fields:new -->
__JSKIT_UI_CREATE_FORM_COLUMNS__
          </template>
          <template v-else>
            <!-- jskit:crud-ui-fields:edit -->
__JSKIT_UI_EDIT_FORM_COLUMNS__
          </template>
        </v-row>
      </v-form>
    </v-sheet>
  </section>
</template>

<script setup>
const props = defineProps({
  mode: {
    type: String,
    default: "new"
  },
  formRuntime: {
    type: Object,
    required: true
  },
  title: {
    type: String,
    default: ""
  },
  subtitle: {
    type: String,
    default: ""
  },
  saveLabel: {
    type: String,
    default: "Save"
  },
  cancelTo: {
    type: [String, Object],
    default: ""
  }
__JSKIT_UI_FORM_LOOKUP_PROP_DEFS__
});

const formRuntime = props.formRuntime;
const addEdit = formRuntime.addEdit;
const formState = formRuntime.form;

function resolveFieldErrors(fieldKey) {
  return formRuntime.resolveFieldErrors(fieldKey);
}

function resolveCancelTo(target) {
  if (!target) {
    return "";
  }

  if (typeof target === "string") {
    return props.formRuntime.addEdit.resolveParams(target);
  }

  return target;
}
</script>

<style scoped>
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
  font-size: clamp(1.35rem, 2vw, 1.85rem);
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
  padding: 3rem 1.25rem;
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
}
</style>
