import { computed, proxyRefs, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { asPlainObject } from "../support/scopeHelpers.js";
import { resolveCrudJsonApiTransport } from "../crud/crudJsonApiTransportSupport.js";
import { useAddEdit } from "./useAddEdit.js";
import {
  resolveCrudBoundValues,
} from "../crud/crudBindingSupport.js";
import {
  normalizeCrudFormFields,
  createCrudFormModel,
  buildCrudFormPayload,
  applyCrudPayloadToForm,
  resolveCrudRouteBoundFieldValues,
  resolveCrudFieldErrors
} from "../crud/crudSchemaFormHelpers.js";
import { hasResolvedQueryData } from "../support/resourceLoadStateHelpers.js";

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

function useCrudAddEdit({
  resource = null,
  operationName = "",
  formFields = [],
  addEditOptions = {},
  saveSuccess = {},
  fieldBinding = null,
  createModel = null,
  buildPayload = null,
  mapPayloadToModel = null,
  input = null
} = {}) {
  const router = useRouter();
  const route = useRoute();
  const normalizedFields = normalizeCrudFormFields(formFields);
  const normalizedAddEditOptions = asPlainObject(addEditOptions);
  const resolvedResource = normalizedAddEditOptions.resource || resource;
  const resolvedTransport = resolveCrudJsonApiTransport(
    normalizedAddEditOptions.transport,
    resolvedResource,
    {
      mode: "add-edit",
      operationName
    }
  );
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
  const inputOverride = input || normalizedAddEditOptions.input || null;
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
  const resolvedInput = inputOverride || resolvedResource?.operations?.[operationName]?.body || null;

  function resolveBuildRawPayload(model = {}, context = {}) {
    const payload = buildPayloadOverride
      ? buildPayloadOverride(model, {
          ...context,
          fields: normalizedFields
        })
      : buildCrudFormPayload(normalizedFields, model);
    applyBoundFieldValues(payload);

    return payload;
  }

  const effectiveMapLoadedToModel = mapPayloadToModelOverride
    ? (model = {}, payload = {}, context = {}) => {
        mapPayloadToModelOverride(model, payload, {
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
    transport: resolvedTransport,
    model: form,
    fieldErrorKeys,
    input: resolvedInput,
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

export { useCrudAddEdit };
