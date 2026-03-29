import { computed, proxyRefs, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { asPlainObject } from "./scopeHelpers.js";
import { useAddEdit } from "./useAddEdit.js";
import {
  normalizeCrudFormFields,
  createCrudFormModel,
  buildCrudFormPayload,
  applyCrudPayloadToForm,
  applyCrudRouteBoundFieldValues,
  resolveCrudFieldErrors,
  parseCrudResourceOperationInput
} from "./crudSchemaFormHelpers.js";
import { hasResolvedQueryData } from "./resourceLoadStateHelpers.js";

function normalizeFieldErrorKeys(keys = []) {
  return Array.isArray(keys)
    ? keys.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
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

function useCrudSchemaForm({
  resource = null,
  operationName = "",
  formFields = [],
  addEditOptions = {},
  saveSuccess = {},
  createModel = null,
  buildPayload = null,
  mapPayloadToModel = null,
  parseInput = null
} = {}) {
  const router = useRouter();
  const route = useRoute();
  const normalizedFields = normalizeCrudFormFields(formFields);
  const normalizedAddEditOptions = asPlainObject(addEditOptions);
  const saveSuccessOptions = normalizeSaveSuccessOptions(saveSuccess);
  const defaultFieldErrorKeys = normalizedFields.map((field) => field.key);
  const providedFieldErrorKeys = normalizeFieldErrorKeys(normalizedAddEditOptions.fieldErrorKeys);
  const fieldErrorKeys = providedFieldErrorKeys.length > 0 ? providedFieldErrorKeys : defaultFieldErrorKeys;
  const providedModel = normalizedAddEditOptions.model;
  const hasProvidedModel = Boolean(providedModel && typeof providedModel === "object" && !Array.isArray(providedModel));
  const defaultModel = typeof createModel === "function"
    ? asPlainObject(createModel(normalizedFields))
    : createCrudFormModel(normalizedFields);
  const form = hasProvidedModel ? providedModel : reactive(defaultModel);

  function applyRouteBoundValues(target = {}) {
    return applyCrudRouteBoundFieldValues(normalizedFields, target, route?.params || {});
  }

  applyRouteBoundValues(form);
  watch(
    () => route?.params,
    () => {
      applyRouteBoundValues(form);
    },
    { deep: true }
  );
  const parseInputOverride = typeof parseInput === "function"
    ? parseInput
    : (typeof normalizedAddEditOptions.parseInput === "function" ? normalizedAddEditOptions.parseInput : null);
  const buildPayloadOverride = typeof buildPayload === "function"
    ? buildPayload
    : (typeof normalizedAddEditOptions.buildRawPayload === "function" ? normalizedAddEditOptions.buildRawPayload : null);
  const mapPayloadToModelOverride = typeof mapPayloadToModel === "function"
    ? mapPayloadToModel
    : (typeof normalizedAddEditOptions.mapLoadedToModel === "function" ? normalizedAddEditOptions.mapLoadedToModel : null);
  const onSaveSuccessOverride = typeof normalizedAddEditOptions.onSaveSuccess === "function"
    ? normalizedAddEditOptions.onSaveSuccess
    : null;
  const shouldApplyDefaultMapPayload = normalizedAddEditOptions.readEnabled !== false;
  const resolvedResource = normalizedAddEditOptions.resource || resource;

  function resolveParseInput(rawPayload = {}, context = {}) {
    if (parseInputOverride) {
      return parseInputOverride(rawPayload, context);
    }

    return parseCrudResourceOperationInput({
      resource: resolvedResource,
      operationName,
      rawPayload,
      context
    });
  }

  function resolveBuildRawPayload(model = {}, context = {}) {
    const payload = buildPayloadOverride
      ? buildPayloadOverride(model, {
          ...context,
          fields: normalizedFields
        })
      : buildCrudFormPayload(normalizedFields, model);
    applyRouteBoundValues(payload);

    return payload;
  }

  const effectiveMapLoadedToModel = mapPayloadToModelOverride
    ? (model = {}, payload = {}, context = {}) => {
        mapPayloadToModelOverride(model, payload, {
          ...context,
          fields: normalizedFields
        });
        applyRouteBoundValues(model);
      }
    : (shouldApplyDefaultMapPayload
        ? (model = {}, payload = {}) => {
            applyCrudPayloadToForm(normalizedFields, model, payload);
            applyRouteBoundValues(model);
          }
        : undefined);

  let addEditRuntime = null;

  async function handleSaveSuccess(payload, context = {}) {
    if (onSaveSuccessOverride) {
      await onSaveSuccessOverride(payload, context);
      return;
    }

    const queryClient = context?.queryClient;
    if (queryClient && saveSuccessOptions.invalidateQueryKey?.length > 0) {
      await queryClient.invalidateQueries({
        queryKey: saveSuccessOptions.invalidateQueryKey
      });
    }

    if (saveSuccessOptions.navigateToView) {
      const viewUrl = addEditRuntime?.resolveSavedViewUrl(payload) ||
        addEditRuntime?.resolveViewUrl(addEditRuntime?.recordId);
      if (viewUrl) {
        await router.push(viewUrl);
        return;
      }
    }

    if (!saveSuccessOptions.navigateToList) {
      return;
    }

    const listUrlTemplate = saveSuccessOptions.listUrlTemplate ||
      String(normalizedAddEditOptions.listUrlTemplate || "").trim();
    const listUrl = addEditRuntime?.resolveParams(listUrlTemplate);
    if (listUrl) {
      await router.push(listUrl);
    }
  }

  const addEdit = useAddEdit({
    ...normalizedAddEditOptions,
    resource: resolvedResource,
    model: form,
    fieldErrorKeys,
    parseInput: resolveParseInput,
    buildRawPayload: resolveBuildRawPayload,
    mapLoadedToModel: effectiveMapLoadedToModel,
    onSaveSuccess: handleSaveSuccess
  });
  addEditRuntime = addEdit;

  function resolveFieldErrors(fieldKey = "") {
    return resolveCrudFieldErrors(addEdit.fieldErrors, fieldKey);
  }

  const showFormSkeleton = computed(() => {
    const hasResolvedData = hasResolvedQueryData({
      query: addEdit?.resource?.query,
      data: addEdit?.resource?.data
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

export { useCrudSchemaForm };
