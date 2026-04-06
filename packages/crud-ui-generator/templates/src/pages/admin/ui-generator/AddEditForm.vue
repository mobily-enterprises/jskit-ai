<template>
  <section class="ui-generator-add-edit-form d-flex flex-column ga-4">
    <v-card rounded="xl" elevation="1" border>
      <v-card-item class="pb-2">
        <div class="d-flex align-start ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">{{ title }}</v-card-title>
            <v-card-subtitle class="px-0">{{ subtitle }}</v-card-subtitle>
          </div>
          <v-spacer />
          <div class="d-flex ga-2 flex-wrap">
            <v-btn v-if="cancelTo" variant="tonal" :to="resolveCancelTo(cancelTo)">Cancel</v-btn>
            <v-btn
              color="primary"
              :loading="formRuntime.addEdit.isSaving"
              :disabled="formRuntime.addEdit.isSubmitDisabled"
              @click="formRuntime.addEdit.submit"
            >
              {{ saveLabel }}
            </v-btn>
          </div>
        </div>
      </v-card-item>

      <v-card-text class="pt-0">
        <p v-if="formRuntime.addEdit.loadError" class="text-body-2 text-medium-emphasis mb-0">
          {{ formRuntime.addEdit.loadError }}
        </p>
        <template v-else-if="formRuntime.showFormSkeleton">
          <v-skeleton-loader type="heading, text@2, article" />
        </template>
        <v-form v-else @submit.prevent="formRuntime.addEdit.submit" novalidate>
          <v-progress-linear v-if="formRuntime.addEdit.isRefetching" indeterminate class="mb-4" />
          <v-row>
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
      </v-card-text>
    </v-card>
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
  },
  resolveLookupItems: {
    type: Function,
    required: true
  },
  resolveLookupLoading: {
    type: Function,
    required: true
  },
  resolveLookupSearch: {
    type: Function,
    required: true
  },
  setLookupSearch: {
    type: Function,
    required: true
  }
});

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
