import { useQueryClient } from "@tanstack/vue-query";
import { resolveFieldErrors } from "@jskit-ai/http-runtime/client";
import { validateOperationInput } from "./operationValidationHelpers.js";

function useCommandCore({
  model,
  resource,
  writeMethod = "POST",
  canRun,
  fieldBag,
  feedback,
  input,
  buildRawPayload,
  buildCommandPayload,
  buildCommandOptions,
  onRunSuccess,
  onRunError,
  suppressSuccessMessage = false,
  messages = {}
} = {}) {
  const queryClient = useQueryClient();
  const normalizedWriteMethod = String(writeMethod || "POST").trim().toUpperCase();

  const running = resource?.isSaving;
  const fieldErrors = fieldBag?.errors;
  const message = feedback?.message;
  const messageType = feedback?.messageType;

  async function run(context = {}) {
    if (!canRun?.value || running?.value) {
      return null;
    }

    feedback?.clear?.();
    fieldBag?.clear?.();

    const rawPayload = typeof buildRawPayload === "function"
      ? buildRawPayload(model, {
          queryClient,
          resource,
          context
        })
      : {};

    const validationResult = validateOperationInput({
      input,
      rawPayload,
      fieldBag,
      feedback,
      validationMessage: String(messages.validation || "Validation failed.")
    });
    if (!validationResult.ok) {
      return null;
    }

    const { parsedInput } = validationResult;
    const payload = typeof buildCommandPayload === "function"
      ? buildCommandPayload(parsedInput, {
          rawPayload,
          queryClient,
          resource,
          context
        })
      : (normalizedWriteMethod === "DELETE" ? undefined : parsedInput);

    const options = typeof buildCommandOptions === "function"
      ? buildCommandOptions(parsedInput, {
          rawPayload,
          queryClient,
          resource,
          context
        })
      : {};

    try {
      const response = await resource.save(payload, options);

      if (typeof onRunSuccess === "function") {
        await onRunSuccess(response, {
          parsed: parsedInput,
          rawPayload,
          payload,
          options,
          queryClient,
          resource,
          context
        });
      }

      if (!suppressSuccessMessage) {
        feedback?.success?.(String(messages.success || "Completed."));
      }
      return response;
    } catch (error) {
      fieldBag?.apply?.(resolveFieldErrors(error));

      if (typeof onRunError === "function") {
        await onRunError(error, {
          parsed: parsedInput,
          rawPayload,
          payload,
          options,
          queryClient,
          resource,
          context
        });
      }

      feedback?.error?.(error, String(messages.error || "Unable to complete action."));
      throw error;
    }
  }

  return Object.freeze({
    running,
    fieldErrors,
    message,
    messageType,
    run
  });
}

export { useCommandCore };
