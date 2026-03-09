import { watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";

function useUsersWebAddEditScreen({ provideSpec, queryClient: queryClientOverride = null } = {}) {
  const queryClient = queryClientOverride || useQueryClient();
  const spec = typeof provideSpec === "function" ? provideSpec() : {};
  const messages = spec.messages && typeof spec.messages === "object" ? spec.messages : {};

  watch(
    () => spec.resource?.data?.value,
    (payload) => {
      if (!payload || typeof spec.mapLoadedToModel !== "function") {
        return;
      }
      spec.mapLoadedToModel(spec.model, payload);
    },
    { immediate: true }
  );

  const saving = spec.resource?.isSaving;
  const fieldErrors = spec.fieldBag?.errors;
  const message = spec.feedback?.message;
  const messageType = spec.feedback?.messageType;

  async function submit() {
    if (!spec.canSave?.value || saving?.value) {
      return;
    }

    spec.feedback?.clear?.();
    spec.fieldBag?.clear?.();

    const rawPayload =
      typeof spec.buildRawPayload === "function" ? spec.buildRawPayload(spec.model, { queryClient }) : {};
    const parsed = typeof spec.parseInput === "function" ? spec.parseInput(rawPayload, { queryClient }) || {} : {};
    const parsedFieldErrors = parsed.fieldErrors && typeof parsed.fieldErrors === "object" ? parsed.fieldErrors : {};

    if (Object.keys(parsedFieldErrors).length > 0) {
      spec.fieldBag?.apply?.(parsedFieldErrors);
      spec.feedback?.error?.(null, String(messages.validation || "Validation failed."));
      return;
    }

    const savePayload =
      typeof spec.buildSavePayload === "function" ? spec.buildSavePayload(parsed, { queryClient }) : rawPayload;

    try {
      const payload = await spec.resource.save(savePayload);

      if (typeof spec.mapLoadedToModel === "function") {
        spec.mapLoadedToModel(spec.model, payload);
      }

      if (queryClient && spec.queryKey?.value !== undefined) {
        queryClient.setQueryData(spec.queryKey.value, payload);
      }

      if (typeof spec.onSaveSuccess === "function") {
        spec.onSaveSuccess(payload, {
          queryClient,
          parsed,
          savePayload
        });
      }

      spec.feedback?.success?.(String(messages.saveSuccess || "Saved."));
    } catch (error) {
      spec.fieldBag?.apply?.(error?.details?.fieldErrors);
      spec.feedback?.error?.(error, String(messages.saveError || "Unable to save."));
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

export { useUsersWebAddEditScreen };
