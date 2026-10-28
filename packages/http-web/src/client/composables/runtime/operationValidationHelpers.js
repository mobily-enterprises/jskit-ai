import { createValidationFailure } from "@jskit-ai/http-runtime/client";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { toUiFieldErrors } from "../support/errorMessageHelpers.js";
import { useJskitText } from "../../i18n.js";

const { t, text } = useJskitText();

function validateOperationInput({
  input,
  rawPayload = {},
  fieldBag = null,
  feedback = null,
  validationMessage = ""
} = {}) {
  if (!input) {
    return {
      ok: true,
      parsedInput: rawPayload
    };
  }

  try {
    const parsedInput = validateSchemaPayload(input, rawPayload, {
      phase: "input",
      context: "operation input"
    });

    return {
      ok: true,
      parsedInput
    };
  } catch (error) {
    if (!error?.fieldErrors || typeof error.fieldErrors !== "object") {
      throw error;
    }

    const fieldErrorCodes = error.fieldErrorCodes || error.details?.fieldErrorCodes;
    const failure = {
      ...createValidationFailure({
        error: text(validationMessage) || t("jskit.http.feedback.validationFailed"),
        code: "validation_failed",
        fieldErrors: error?.fieldErrors
      }),
      ...(fieldErrorCodes ? { fieldErrorCodes } : {})
    };
    fieldBag?.apply?.(toUiFieldErrors(failure));
    feedback?.error?.(failure, failure.error);
    return {
      ok: false,
      failure,
      parsedInput: null
    };
  }
}

export { validateOperationInput };
