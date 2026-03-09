import { watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import {
  hasFieldErrors,
  resolveFieldErrors,
  resolveSavePayload
} from "./scopeHelpers.js";

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

    const parsed = typeof parseInput === "function"
      ? parseInput(rawPayload, {
          queryClient,
          resource
        }) || {}
      : rawPayload;

    if (hasFieldErrors(parsed)) {
      fieldBag?.apply?.(resolveFieldErrors(parsed));
      feedback?.error?.(null, String(messages.validation || "Validation failed."));
      return;
    }

    const savePayload = resolveSavePayload(buildSavePayload, parsed, rawPayload, {
      queryClient,
      resource
    });

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
          parsed,
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
