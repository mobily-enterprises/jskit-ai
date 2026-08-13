import { computed, proxyRefs, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useJskitNavigation } from "@jskit-ai/kernel/client/navigation";
import { asPlainObject } from "../support/scopeHelpers.js";
import { resolveCrudJsonApiTransport } from "../crud/crudJsonApiTransportSupport.js";
import { resolveCrudHttpClient } from "../crud/crudHttpClientSupport.js";
import { useAddEdit } from "./useAddEdit.js";
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

function createCrudFormFingerprint(value, ancestors = new WeakSet()) {
  if (value === null) {
    return "null";
  }
  const valueType = typeof value;
  if (valueType !== "object") {
    if (valueType === "number" && Object.is(value, -0)) {
      return "number:-0";
    }
    if (valueType === "string") {
      return `string:${JSON.stringify(value)}`;
    }
    return `${valueType}:${String(value)}`;
  }
  if (ancestors.has(value)) {
    return "[circular]";
  }
  if (
    typeof value.name === "string" &&
    Number.isFinite(value.size) &&
    Number.isFinite(value.lastModified)
  ) {
    return `file:${JSON.stringify([value.name, value.size, value.lastModified, String(value.type || "")])}`;
  }
  if (value instanceof Date) {
    return `date:${Number.isFinite(value.getTime()) ? value.toISOString() : "invalid"}`;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `array:[${value.map((entry) => createCrudFormFingerprint(entry, ancestors)).join(",")}]`;
    }
    return `object:{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${createCrudFormFingerprint(value[key], ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function resolveCrudMachineryExitMode({ activeFullPath = "", targetFullPath = "", canPop = false } = {}) {
  return Boolean(canPop) && String(activeFullPath || "") === String(targetFullPath || "")
    ? "pop"
    : "replace";
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
  const navigation = useJskitNavigation();
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
  const resolvedRealtime = resolveOperationRealtimeOptions({
    realtime: normalizedAddEditOptions.realtime,
    fallbackRealtime: resolvedResource?.operations?.[operationName]?.realtime ||
      resolvedResource?.operations?.list?.realtime ||
      null
  });
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

  const savedFormFingerprint = ref("");
  function resetDirtyBaseline() {
    savedFormFingerprint.value = createCrudFormFingerprint(resolveBuildRawPayload(form));
  }
  const isDirty = computed(() =>
    createCrudFormFingerprint(resolveBuildRawPayload(form)) !== savedFormFingerprint.value
  );
  resetDirtyBaseline();

  const effectiveMapLoadedToModel = mapPayloadToModelOverride
    ? (model = {}, payload = {}, context = {}) => {
        mapPayloadToModelOverride(model, payload, {
          ...context,
          fields: normalizedFields
        });
        applyBoundFieldValues(model);
        resetDirtyBaseline();
      }
    : (shouldApplyDefaultMapPayload
        ? (model = {}, payload = {}) => {
            applyCrudPayloadToForm(normalizedFields, model, payload);
            applyBoundFieldValues(model);
            resetDirtyBaseline();
          }
        : undefined);

  let addEditRuntime = null;

  async function navigateFromMachinery(target, { reason = "programmatic" } = {}) {
    if (!target) {
      return Object.freeze({ status: "blocked", reason: "missing-machinery-exit-target" });
    }
    const resolved = router.resolve(target);
    const exitMode = resolveCrudMachineryExitMode({
      activeFullPath: navigation.activeEntry.value?.fullPath,
      targetFullPath: resolved.fullPath,
      canPop: navigation.canPop.value
    });
    if (exitMode === "pop") {
      return navigation.pop({ reason });
    }
    return navigation.replace(
      {
        path: resolved.path,
        query: resolved.query,
        hash: resolved.hash
      },
      {
        reason,
        preserveDestinationIdentity: false
      }
    );
  }

  async function handleSaveSuccess(payload, context = {}) {
    resetDirtyBaseline();
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
        await navigateFromMachinery(viewUrl, { reason: "save-complete" });
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
      await navigateFromMachinery(listUrl, { reason: "save-complete" });
    }
  }

  const addEdit = useAddEdit({
    ...normalizedAddEditOptions,
    resource: resolvedResource,
    client: resolveCrudHttpClient(resolvedResource, {
      client: normalizedAddEditOptions.client
    }),
    transport: resolvedTransport,
    model: form,
    fieldErrorKeys,
    input: resolvedInput,
    buildRawPayload: resolveBuildRawPayload,
    mapLoadedToModel: effectiveMapLoadedToModel,
    realtime: resolvedRealtime,
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
    isDirty,
    resetDirtyBaseline,
    navigateFromMachinery,
    addEdit,
    showFormSkeleton,
    resolveFieldErrors
  });
}

const __testables = Object.freeze({ createCrudFormFingerprint, resolveCrudMachineryExitMode });

export { __testables, useCrudAddEdit };
