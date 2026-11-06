import { computed, proxyRefs, reactive, watch } from "vue";
import { useRoute } from "vue-router";
import { useShellNavigation } from "@jskit-ai/shell-web/client/navigation/useShellNavigation";
import { asPlainObject } from "../support/scopeHelpers.js";
import { resolveCrudJsonApiTransport } from "../crud/crudJsonApiTransportSupport.js";
import { resolveCrudHttpClient } from "../crud/crudHttpClientSupport.js";
import { useAddEdit } from "./useAddEdit.js";
import { normalizeFieldErrorKeys } from "../runtime/useFieldErrorBag.js";
import {
  resolveCrudBoundValues,
} from "../crud/crudBindingSupport.js";
import { resolveOperationRealtimeOptions } from "../useRealtimeQueryInvalidation.js";
import {
  normalizeCrudFormFields,
  createCrudFormModel,
  buildCrudFormPayload,
  applyCrudPayloadToForm,
  resolveCrudRouteBoundFieldValues,
  resolveCrudFieldErrors
} from "../crud/crudSchemaFormHelpers.js";
import { hasResolvedQueryData } from "../support/resourceLoadStateHelpers.js";

// addEditOptions that pass unchanged to useAddEdit. client, transport, realtime,
// fieldErrorKeys, model and onSaveSuccess are read here first. Resource, input,
// payload building and model mapping have one home each: the top-level options.
const PASSED_ADD_EDIT_OPTIONS = Object.freeze([
  "ownershipFilter",
  "surfaceId",
  "access",
  "apiSuffix",
  "queryKeyFactory",
  "viewPermissions",
  "savePermissions",
  "readMethod",
  "readEnabled",
  "writeMethod",
  "requestRecovery",
  "requestRecoveryLabel",
  "placementSource",
  "fallbackLoadError",
  "fallbackSaveError",
  "clearOnRouteChange",
  "buildSavePayload",
  "validationFeedback",
  "requestQueryParams",
  "recordIdParam",
  "routeParams",
  "routeRecordId",
  "apiUrlTemplate",
  "viewUrlTemplate",
  "listUrlTemplate",
  "saveRecordIdSelector",
  "messages"
]);
const CONSUMED_ADD_EDIT_OPTIONS = Object.freeze([
  "client",
  "transport",
  "realtime",
  "fieldErrorKeys",
  "model",
  "onSaveSuccess"
]);
const TOP_LEVEL_ADD_EDIT_OPTIONS = Object.freeze({
  resource: "resource",
  input: "input",
  buildRawPayload: "buildPayload",
  mapLoadedToModel: "mapPayloadToModel"
});

function resolvePassedAddEditOptions(addEditOptions = {}) {
  const passed = {};
  for (const [key, value] of Object.entries(addEditOptions)) {
    if (Object.hasOwn(TOP_LEVEL_ADD_EDIT_OPTIONS, key)) {
      throw new TypeError(
        `useCrudAddEdit takes ${TOP_LEVEL_ADD_EDIT_OPTIONS[key]} as a top-level option, not addEditOptions.${key}.`
      );
    }
    if (PASSED_ADD_EDIT_OPTIONS.includes(key)) {
      passed[key] = value;
    } else if (!CONSUMED_ADD_EDIT_OPTIONS.includes(key)) {
      throw new TypeError(`useCrudAddEdit does not support addEditOptions.${key}.`);
    }
  }
  return passed;
}

function normalizeSaveSuccessOptions(options = {}) {
  const source = asPlainObject(options);
  const invalidateQueryKey = Array.isArray(source.invalidateQueryKey)
    ? source.invalidateQueryKey
    : null;
  const listUrlTemplate = String(source.listUrlTemplate || "").trim();
  const navigateToView = source.navigateToView !== false;
  const navigateToList = source.navigateToList !== false;

  return Object.freeze({
    invalidateQueryKey,
    listUrlTemplate,
    navigateToView,
    navigateToList
  });
}

function buildFormPayload(model, { fields }) {
  return buildCrudFormPayload(fields, model);
}

/** @param {import("../../types.js").CrudAddEditOptions} options */
function useCrudAddEdit({
  resource,
  operationName = "",
  formFields = [],
  addEditOptions = {},
  saveSuccess = {},
  fieldBinding = null,
  createModel = createCrudFormModel,
  buildPayload = buildFormPayload,
  mapPayloadToModel,
  input
}) {
  // Saving leaves the form by replacing its history entry, so neither Up nor Back reopens it.
  const navigation = useShellNavigation();
  const route = useRoute();
  const normalizedFields = normalizeCrudFormFields(formFields);
  const normalizedAddEditOptions = asPlainObject(addEditOptions);
  const passedAddEditOptions = resolvePassedAddEditOptions(normalizedAddEditOptions);
  const resolvedTransport = resolveCrudJsonApiTransport(
    normalizedAddEditOptions.transport,
    resource,
    {
      mode: "add-edit",
      operationName
    }
  );
  const resolvedRealtime = resolveOperationRealtimeOptions({
    realtime: normalizedAddEditOptions.realtime,
    fallbackRealtime: resource?.operations?.[operationName]?.realtime ||
      resource?.operations?.list?.realtime ||
      null
  });
  const saveSuccessOptions = normalizeSaveSuccessOptions(saveSuccess);
  const defaultFieldErrorKeys = normalizedFields.map((field) => field.key);
  const providedFieldErrorKeys = normalizeFieldErrorKeys(normalizedAddEditOptions.fieldErrorKeys);
  const fieldErrorKeys = providedFieldErrorKeys.length > 0 ? providedFieldErrorKeys : defaultFieldErrorKeys;
  const providedModel = normalizedAddEditOptions.model;
  const hasProvidedModel = Boolean(providedModel && typeof providedModel === "object" && !Array.isArray(providedModel));
  const form = hasProvidedModel ? providedModel : reactive(asPlainObject(createModel(normalizedFields)));
  const boundFieldValues = computed(() => {
    return resolveCrudBoundValues({
      binding: fieldBinding,
      routeValues: resolveCrudRouteBoundFieldValues(normalizedFields, route?.params || {}),
      context: Object.freeze({
        route,
        fields: normalizedFields
      })
    });
  });

  function applyBoundFieldValues(target = {}) {
    Object.assign(target, boundFieldValues.value);
    return target;
  }

  watch(
    boundFieldValues,
    () => {
      applyBoundFieldValues(form);
    },
    {
      immediate: true,
      deep: true
    }
  );
  const shouldApplyDefaultMapPayload = normalizedAddEditOptions.readEnabled !== false;
  const resolvedInput = input || resource?.operations?.[operationName]?.body || null;

  function resolveBuildRawPayload(model = {}, context = {}) {
    const payload = buildPayload(model, {
      ...context,
      fields: normalizedFields
    });
    applyBoundFieldValues(payload);

    return payload;
  }

  // readable-check: allow method-probe - optional operation: without mapPayloadToModel a form maps the payload by its fields, or not at all when it reads nothing
  const effectiveMapLoadedToModel = typeof mapPayloadToModel === "function"
    ? (model = {}, payload = {}, context = {}) => {
        mapPayloadToModel(model, payload, {
          ...context,
          fields: normalizedFields
        });
        applyBoundFieldValues(model);
      }
    : (shouldApplyDefaultMapPayload
        ? (model = {}, payload = {}) => {
            applyCrudPayloadToForm(normalizedFields, model, payload);
            applyBoundFieldValues(model);
          }
        : undefined);

  async function handleSaveSuccess(payload, { queryClient }) {
    if (saveSuccessOptions.invalidateQueryKey?.length > 0) {
      await queryClient.invalidateQueries({
        queryKey: saveSuccessOptions.invalidateQueryKey
      });
    }

    if (saveSuccessOptions.navigateToView) {
      const viewUrl = addEdit.resolveSavedViewUrl(payload) ||
        addEdit.resolveViewUrl(addEdit.recordId);
      if (viewUrl) {
        await navigation.finish(viewUrl);
        return;
      }
    }

    if (!saveSuccessOptions.navigateToList) {
      return;
    }

    const listUrl = addEdit.resolveParams(saveSuccessOptions.listUrlTemplate);
    if (listUrl) {
      await navigation.finish(listUrl);
    }
  }

  const addEdit = useAddEdit({
    ...passedAddEditOptions,
    resource,
    client: resolveCrudHttpClient(resource, {
      client: normalizedAddEditOptions.client
    }),
    transport: resolvedTransport,
    model: form,
    fieldErrorKeys,
    input: resolvedInput,
    buildRawPayload: resolveBuildRawPayload,
    mapLoadedToModel: effectiveMapLoadedToModel,
    realtime: resolvedRealtime,
    onSaveSuccess: normalizedAddEditOptions.onSaveSuccess ?? handleSaveSuccess
  });

  function resolveFieldErrors(fieldKey = "") {
    return resolveCrudFieldErrors(addEdit.fieldErrors, fieldKey);
  }

  const showFormSkeleton = computed(() => {
    const hasResolvedData = hasResolvedQueryData({
      query: addEdit.resource.query,
      data: addEdit.resource.data
    });

    return Boolean(addEdit.isInitialLoading) && !hasResolvedData;
  });

  return proxyRefs({
    formFields: normalizedFields,
    fieldErrorKeys,
    form,
    addEdit,
    showFormSkeleton,
    resolveFieldErrors
  });
}

export { useCrudAddEdit };
