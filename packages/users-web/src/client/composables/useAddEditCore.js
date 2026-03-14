import { watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { validateOperationInput } from "./operationValidationHelpers.js";

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

  watch(
    () => resource?.data?.value,
    (payload) => {
      if (!payload || typeof mapLoadedToModel !== "function") {
        return;
      }
      mapLoadedToModel(model, payload, {
        queryClient,
        resource
      });
    },
    {
      immediate: true
    }
  );

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

    const validationResult = validateOperationInput({
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
      const payload = await resource.save(savePayload);

      if (typeof mapLoadedToModel === "function") {
        mapLoadedToModel(model, payload, {
          queryClient,
          resource
        });
      }

      if (queryKey?.value !== undefined) {
        queryClient.setQueryData(queryKey.value, payload);
      }

      if (typeof onSaveSuccess === "function") {
        onSaveSuccess(payload, {
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
      fieldBag?.apply?.(error?.details?.fieldErrors || error?.fieldErrors);
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
