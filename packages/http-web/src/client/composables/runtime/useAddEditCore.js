import { useQueryClient } from "@tanstack/vue-query";
import { computed, ref } from "vue";
import { resolveFieldErrors } from "@jskit-ai/http-runtime/client";
import { validateOperationInput } from "./operationValidationHelpers.js";
import { watchResourceModelState } from "./modelStateHelpers.js";

function useAddEditCore({
  model,
  resource,
  queryKey,
  canSave,
  fieldBag,
  feedback,
  input,
  mapLoadedToModel,
  buildRawPayload,
  buildSavePayload,
  onSaveSuccess,
  validationFeedback = true,
  messages = {}
} = {}) {
  const queryClient = useQueryClient();
  watchResourceModelState({
    resource,
    model,
    mapLoadedToModel,
    resolveMapContext() {
      return {
        queryClient,
        resource
      };
    }
  });

  const submitting = ref(false);
  const saving = computed(() => Boolean(submitting.value || resource?.isSaving?.value));
  const fieldErrors = fieldBag?.errors;
  const message = feedback?.message;
  const messageType = feedback?.messageType;
  const validationAttempted = ref(false);
  const validationErrors = computed(() => {
    if (!validationAttempted.value || !input) {
      return {};
    }

    // Revalidate without changing server field errors or reporting feedback.
    const result = validateOperationInput({ input, rawPayload: resolveRawPayload() });
    return result.ok ? {} : resolveFieldErrors(result.failure);
  });

  function resolveRawPayload() {
    return typeof buildRawPayload === "function" ? buildRawPayload(model, {
      queryClient,
      resource
    }) : {};
  }

  function resetValidation() {
    validationAttempted.value = false;
    fieldBag?.clear?.();
  }

  async function submit() {
    if (!canSave?.value || saving.value) {
      return;
    }

    feedback?.clear?.();
    fieldBag?.clear?.();
    validationAttempted.value = true;

    const rawPayload = resolveRawPayload();

    const validationResult = validateOperationInput({
      input,
      rawPayload,
      fieldBag,
      feedback: validationFeedback === false ? null : feedback,
      validationMessage: String(messages.validation || "Validation failed.")
    });
    if (!validationResult.ok) {
      return;
    }

    const { parsedInput } = validationResult;
    const savePayload = typeof buildSavePayload === "function"
      ? buildSavePayload(parsedInput, {
          rawPayload,
          queryClient,
          resource
        })
      : parsedInput;

    try {
      submitting.value = true;
      const queryKeySnapshot = queryKey?.value;
      const payload = await resource.save(savePayload);

      if (typeof mapLoadedToModel === "function") {
        mapLoadedToModel(model, payload, {
          queryClient,
          resource
        });
      }

      if (queryKeySnapshot !== undefined) {
        queryClient.setQueryData(queryKeySnapshot, payload);
      }

      if (typeof onSaveSuccess === "function") {
        await onSaveSuccess(payload, {
          queryClient,
          parsed: parsedInput,
          rawPayload,
          savePayload,
          resource
        });
      }

      feedback?.success?.(String(messages.saveSuccess || "Saved."));
    } catch (error) {
      fieldBag?.apply?.(resolveFieldErrors(error));
      feedback?.error?.(error, String(messages.saveError || "Unable to save."));
    } finally {
      submitting.value = false;
    }
  }

  return Object.freeze({
    saving,
    fieldErrors,
    message,
    messageType,
    validationAttempted,
    validationErrors,
    resetValidation,
    submit
  });
}

export { useAddEditCore };
