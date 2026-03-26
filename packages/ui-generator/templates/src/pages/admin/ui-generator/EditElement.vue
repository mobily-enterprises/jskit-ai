<template>
  <section class="ui-generator-edit-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">Edit ${option:namespace|singular|pascal|default(Record)}</v-card-title>
            <v-card-subtitle class="px-0">Update the selected ${option:namespace|singular|default(record)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn v-if="addEdit.cancelUrl" variant="text" :to="addEdit.cancelUrl">Cancel</v-btn>
          <v-btn
            color="primary"
            :loading="addEdit.isSaving"
            :disabled="addEdit.isInitialLoading || addEdit.isRefetching || !addEdit.canSave"
            @click="addEdit.submit"
          >
            Save changes
          </v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <p v-if="addEdit.loadError" class="text-body-2 text-medium-emphasis mb-0">
          {{ addEdit.loadError }}
        </p>
        <template v-else-if="showFormSkeleton">
          <v-skeleton-loader type="text@2, list-item-two-line@4, button" />
        </template>
        <v-form v-else @submit.prevent="addEdit.submit" novalidate>
          <v-progress-linear v-if="addEdit.isRefetching" indeterminate class="mb-4" />
          <v-row>
            <v-col v-for="field in formFields" :key="field.key" cols="12" md="6">
              <v-switch
                v-if="field.component === 'switch'"
                v-model="recordForm[field.key]"
                :label="field.label"
                color="primary"
                hide-details="auto"
                :disabled="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                :error-messages="resolveFieldErrors(field.key)"
              />
              <v-text-field
                v-else
                v-model="recordForm[field.key]"
                :label="field.label"
                :type="field.inputType"
                variant="outlined"
                density="comfortable"
                :maxlength="field.maxLength || undefined"
                :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                :error-messages="resolveFieldErrors(field.key)"
              />
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed, reactive } from "vue";
import { useRoute } from "vue-router";
import { useRouter } from "vue-router";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import { ${option:resource-export|trim} as uiResource } from "/${option:resource-file|trim}";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "${option:id-param|trim}";
const UI_API_BASE_URL = "${option:api-path|trim}";
const UI_EDIT_API_URL = `${UI_API_BASE_URL}/:${UI_RECORD_ID_PARAM}`;
const UI_HAS_LIST_ROUTE = __JSKIT_UI_HAS_LIST_ROUTE__;
const UI_HAS_VIEW_ROUTE = __JSKIT_UI_HAS_VIEW_ROUTE__;
const UI_LIST_URL = UI_HAS_LIST_ROUTE ? "../.." : "";
const UI_VIEW_URL = UI_HAS_VIEW_ROUTE ? ".." : "";
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;
const UI_EDIT_FORM_FIELDS = Object.freeze(__JSKIT_UI_EDIT_FORM_FIELDS__);

const route = useRoute();
const router = useRouter();

const formFields = Array.isArray(UI_EDIT_FORM_FIELDS) ? UI_EDIT_FORM_FIELDS : [];
const fieldErrorKeys = formFields.map((field) => String(field?.key || "").trim()).filter(Boolean);
const recordForm = reactive(createFormModel(formFields));
const routeRecordId = computed(() => {
  const source = route.params?.[UI_RECORD_ID_PARAM];
  if (Array.isArray(source)) {
    return String(source[0] ?? "").trim();
  }

  return String(source ?? "").trim();
});

const addEdit = useAddEdit({
  adapter: UI_OPERATION_ADAPTER || undefined,
  resource: uiResource,
  apiUrlTemplate: UI_EDIT_API_URL,
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "ui-generator",
    "${option:namespace|kebab}",
    "edit",
    String(surfaceId || ""),
    String(workspaceSlug || ""),
    routeRecordId.value
  ],
  placementSource: "ui-generator.${option:namespace|kebab}.edit",
  writeMethod: "PATCH",
  fallbackLoadError: "Unable to load record.",
  fallbackSaveError: "Unable to save record.",
  fieldErrorKeys,
  model: recordForm,
  recordIdParam: UI_RECORD_ID_PARAM,
  routeRecordId,
  viewUrlTemplate: UI_VIEW_URL,
  listUrlTemplate: UI_LIST_URL,
  parseInput: (rawPayload) => normalizeByResourceOperation("patch", rawPayload),
  mapLoadedToModel: (model, payload = {}) => {
    applyPayloadToForm(formFields, model, payload);
  },
  buildRawPayload: (model) => buildFormPayload(formFields, model),
  realtime: UI_RECORD_CHANGED_EVENT
    ? {
        event: UI_RECORD_CHANGED_EVENT
      }
    : null,
  onSaveSuccess: async (payload, { queryClient }) => {
    await queryClient.invalidateQueries({
      queryKey: ["ui-generator", "${option:namespace|kebab}"]
    });

    const nextViewUrl = addEdit.resolveSavedViewUrl(payload) || addEdit.resolveViewUrl(addEdit.recordId);
    if (nextViewUrl) {
      await router.push(nextViewUrl);
      return;
    }

    if (addEdit.listUrl) {
      await router.push(addEdit.listUrl);
    }
  }
});

const showFormSkeleton = computed(() => Boolean(addEdit.isInitialLoading));

function toRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeByResourceOperation(operationName = "", payload = {}) {
  const operation = uiResource?.operations?.[operationName];
  const validator = operation?.bodyValidator;
  if (!validator || typeof validator.normalize !== "function") {
    return payload;
  }

  return validator.normalize(payload);
}

function createFormModel(fields = []) {
  const model = {};

  for (const field of Array.isArray(fields) ? fields : []) {
    const fieldKey = String(field?.key || "").trim();
    if (!fieldKey) {
      continue;
    }

    const fieldType = String(field?.type || "").trim().toLowerCase();
    model[fieldKey] = fieldType === "boolean" ? false : "";
  }

  return model;
}

function buildFormPayload(fields = [], model = {}) {
  const payload = {};
  const sourceModel = toRecord(model);

  for (const field of Array.isArray(fields) ? fields : []) {
    const fieldKey = String(field?.key || "").trim();
    if (!fieldKey) {
      continue;
    }

    const fieldType = String(field?.type || "").trim().toLowerCase();
    const rawValue = sourceModel[fieldKey];

    if (fieldType === "boolean") {
      payload[fieldKey] = Boolean(rawValue);
      continue;
    }

    if (fieldType === "integer" || fieldType === "number") {
      const normalizedValue = String(rawValue ?? "").trim();
      if (!normalizedValue) {
        continue;
      }

      const parsedNumber = Number(normalizedValue);
      payload[fieldKey] = Number.isFinite(parsedNumber)
        ? (fieldType === "integer" ? Math.trunc(parsedNumber) : parsedNumber)
        : rawValue;
      continue;
    }

    if (rawValue == null) {
      continue;
    }

    payload[fieldKey] = rawValue;
  }

  return payload;
}

function applyPayloadToForm(fields = [], model = {}, payload = {}) {
  const targetModel = toRecord(model);
  const sourcePayload = toRecord(payload);

  for (const field of Array.isArray(fields) ? fields : []) {
    const fieldKey = String(field?.key || "").trim();
    if (!fieldKey) {
      continue;
    }

    const fieldType = String(field?.type || "").trim().toLowerCase();
    const rawValue = sourcePayload[fieldKey];

    if (fieldType === "boolean") {
      targetModel[fieldKey] = Boolean(rawValue);
      continue;
    }

    if (fieldType === "integer" || fieldType === "number") {
      targetModel[fieldKey] = rawValue == null ? "" : String(rawValue);
      continue;
    }

    targetModel[fieldKey] = rawValue == null ? "" : String(rawValue);
  }
}

function resolveFieldErrors(fieldKey = "") {
  const normalizedKey = String(fieldKey || "").trim();
  if (!normalizedKey || !addEdit.fieldErrors?.[normalizedKey]) {
    return [];
  }

  return [addEdit.fieldErrors[normalizedKey]];
}
</script>
