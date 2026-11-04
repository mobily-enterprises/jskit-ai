import { buildValidationFailure } from "@jskit-ai/http-runtime/client";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { toUiFieldErrors } from "../support/errorMessageHelpers.js";
import { useJskitText } from "../../i18n.js";

const { t, text } = useJskitText();

// A check that only reads the result: it changes no field errors and reports nothing.
const SILENT_FIELD_BAG = Object.freeze({ apply() {} });
const SILENT_FEEDBACK = Object.freeze({ error() {} });

/** @param {import("../../types.js").OperationInputCheck} options */
function validateOperationInput({
  input,
  rawPayload = {},
  fieldBag = SILENT_FIELD_BAG,
  feedback = SILENT_FEEDBACK,
  validationMessage = ""
}) {
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
      ...buildValidationFailure({
        error: text(validationMessage) || t("jskit.http.feedback.validationFailed"),
        code: "validation_failed",
        fieldErrors: error?.fieldErrors
      }),
      ...(fieldErrorCodes ? { fieldErrorCodes } : {})
    };
    fieldBag.apply(toUiFieldErrors(failure));
    feedback.error(failure, failure.error);
    return {
      ok: false,
      failure,
      parsedInput: null
    };
  }
}

export { validateOperationInput };
