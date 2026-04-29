import { useQueryClient } from "@tanstack/vue-query";
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
  parseInput,
  mapLoadedToModel,
  buildRawPayload,
  buildSavePayload,
  onSaveSuccess,
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

  const saving = resource?.isSaving;
  const fieldErrors = fieldBag?.errors;
  const message = feedback?.message;
  const messageType = feedback?.messageType;

  async function submit() {
    if (!canSave?.value || saving?.value) {
      return;
    }

    feedback?.clear?.();
    fieldBag?.clear?.();

    const rawPayload = typeof buildRawPayload === "function" ? buildRawPayload(model, {
      queryClient,
      resource
    }) : {};

    const validationResult = await validateOperationInput({
      parseInput,
      rawPayload,
      context: {
        queryClient,
        resource
      },
      fieldBag,
      feedback,
      validationMessage: String(messages.validation || "Validation failed.")
    });
    if (!validationResult.ok) {
      return;
    }

    const { parseResult, parsedInput } = validationResult;
    const savePayload = typeof buildSavePayload === "function"
      ? buildSavePayload(parsedInput, {
          rawPayload,
          queryClient,
          resource
        })
      : parsedInput;

    try {
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
          parseResult,
          rawPayload,
          savePayload,
          resource
        });
      }

      feedback?.success?.(String(messages.saveSuccess || "Saved."));
    } catch (error) {
      fieldBag?.apply?.(resolveFieldErrors(error));
      feedback?.error?.(error, String(messages.saveError || "Unable to save."));
    }
  }

  return Object.freeze({
    saving,
    fieldErrors,
    message,
    messageType,
    submit
  });
}

export { useAddEditCore };
