import { useQueryClient } from "@tanstack/vue-query";
import {
  hasFieldErrors,
  resolveFieldErrors,
  resolveRunPayload
} from "./scopeHelpers.js";

function useCommandCore({
  model,
  resource,
  canRun,
  fieldBag,
  feedback,
  parseInput,
  buildRawPayload,
  buildCommandPayload,
  buildCommandOptions,
  onRunSuccess,
  onRunError,
  messages = {}
} = {}) {
  const queryClient = useQueryClient();

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

    const parsed = typeof parseInput === "function"
      ? parseInput(rawPayload, {
          queryClient,
          resource,
          context
        }) || {}
      : rawPayload;

    if (hasFieldErrors(parsed)) {
      fieldBag?.apply?.(resolveFieldErrors(parsed));
      feedback?.error?.(null, String(messages.validation || "Validation failed."));
      return null;
    }

    const payload = resolveRunPayload(buildCommandPayload, parsed, rawPayload, {
      queryClient,
      resource,
      context
    });

    const options = typeof buildCommandOptions === "function"
      ? buildCommandOptions(parsed, {
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
          parsed,
          rawPayload,
          payload,
          options,
          queryClient,
          resource,
          context
        });
      }

      feedback?.success?.(String(messages.success || "Completed."));
      return response;
    } catch (error) {
      fieldBag?.apply?.(error?.details?.fieldErrors || error?.fieldErrors);

      if (typeof onRunError === "function") {
        await onRunError(error, {
          parsed,
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
