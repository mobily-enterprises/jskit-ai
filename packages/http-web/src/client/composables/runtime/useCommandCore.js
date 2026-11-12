import { useQueryClient } from "@tanstack/vue-query";
import { validateOperationInput } from "./operationValidationHelpers.js";
import { toUiFieldErrors } from "../support/errorMessageHelpers.js";
import { emptyRecord } from "../support/scopeHelpers.js";
import { useJskitText } from "../../i18n.js";

const { t, text } = useJskitText();

/** @param {import("../../types.js").CommandCoreOptions} options */
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
  buildCommandOptions = emptyRecord,
  onRunSuccess,
  onRunError,
  suppressSuccessMessage = false,
  messages = {}
}) {
  const queryClient = useQueryClient();
  const normalizedWriteMethod = String(writeMethod || "POST").trim().toUpperCase();
  // A DELETE sends its parsed input as its body only when the command declares one, by an input schema or a raw
  // payload builder; every other method always sends it.
  const sendsParsedInput = normalizedWriteMethod !== "DELETE" || Boolean(input) || buildRawPayload !== undefined;
  const readRawPayload = buildRawPayload ?? emptyRecord;

  const running = resource.isSaving;
  const fieldErrors = fieldBag.errors;
  const message = feedback.message;
  const messageType = feedback.messageType;

  async function run(context = {}) {
    if (!canRun.value || running.value) {
      return null;
    }

    feedback.clear();
    fieldBag.clear();

    const rawPayload = readRawPayload(model, {
      queryClient,
      resource,
      context
    });

    const validationResult = validateOperationInput({
      input,
      rawPayload,
      fieldBag,
      feedback,
      validationMessage: text(messages.validation) || t("jskit.http.feedback.validationFailed")
    });
    if (!validationResult.ok) {
      return null;
    }

    const { parsedInput } = validationResult;
    // readable-check: allow method-probe - optional operation: without buildCommandPayload a command sends its parsed input
    const payload = typeof buildCommandPayload === "function"
      ? buildCommandPayload(parsedInput, {
          rawPayload,
          queryClient,
          resource,
          context
        })
      : (sendsParsedInput ? parsedInput : undefined);

    const options = buildCommandOptions(parsedInput, {
      rawPayload,
      queryClient,
      resource,
      context
    });

    try {
      const response = await resource.save(payload, options);

      // readable-check: allow method-probe - optional operation: a command with no onRunSuccess reports its success in the same tick
      if (onRunSuccess) {
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
        feedback.success(text(messages.success) || t("jskit.http.feedback.completed"));
      }
      return response;
    } catch (error) {
      fieldBag.apply(toUiFieldErrors(error));

      // readable-check: allow method-probe - optional operation: a command with no onRunError reports its failure in the same tick
      if (onRunError) {
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

      feedback.error(error, text(messages.error) || t("jskit.http.feedback.actionFailed"));
      throw error;
    }
  }

  return {
    running,
    fieldErrors,
    message,
    messageType,
    run
  };
}

export { useCommandCore };
