import { useQueryClient } from "@tanstack/vue-query";
import { computed, ref } from "vue";
import { validateOperationInput } from "./operationValidationHelpers.js";
import { ignoreLoadedPayload, watchResourceModelState } from "./modelStateHelpers.js";
import { toUiFieldErrors } from "../support/errorMessageHelpers.js";
import { emptyRecord } from "../support/scopeHelpers.js";
import { useJskitText } from "../../i18n.js";

const { t, text } = useJskitText();

function saveParsedInput(parsedInput) {
  return parsedInput;
}

/** @param {import("../../types.js").AddEditCoreOptions} options */
function useAddEditCore({
  model,
  resource,
  queryKey,
  canSave,
  fieldBag,
  feedback,
  input,
  mapLoadedToModel = ignoreLoadedPayload,
  buildRawPayload = emptyRecord,
  buildSavePayload = saveParsedInput,
  onSaveSuccess,
  validationFeedback = true,
  messages = {}
}) {
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
  const saving = computed(() => Boolean(submitting.value || resource.isSaving.value));
  const fieldErrors = fieldBag.errors;
  const message = feedback.message;
  const messageType = feedback.messageType;
  const validationAttempted = ref(false);
  const validationErrors = computed(() => {
    if (!validationAttempted.value || !input) {
      return {};
    }

    // Revalidate without changing server field errors or reporting feedback.
    const result = validateOperationInput({ input, rawPayload: resolveRawPayload() });
    return result.ok ? {} : toUiFieldErrors(result.failure);
  });

  function resolveRawPayload() {
    return buildRawPayload(model, {
      queryClient,
      resource
    });
  }

  function resetValidation() {
    validationAttempted.value = false;
    fieldBag.clear();
  }

  async function submit() {
    if (!canSave.value || saving.value) {
      return;
    }

    feedback.clear();
    fieldBag.clear();
    validationAttempted.value = true;

    const rawPayload = resolveRawPayload();

    const validationResult = validateOperationInput({
      input,
      rawPayload,
      fieldBag,
      feedback: validationFeedback === false ? undefined : feedback,
      validationMessage: text(messages.validation) || t("jskit.http.feedback.validationFailed")
    });
    if (!validationResult.ok) {
      return;
    }

    const { parsedInput } = validationResult;
    const savePayload = buildSavePayload(parsedInput, {
      rawPayload,
      queryClient,
      resource
    });

    try {
      submitting.value = true;
      const queryKeySnapshot = queryKey.value;
      const payload = await resource.save(savePayload);

      mapLoadedToModel(model, payload, {
        queryClient,
        resource
      });

      if (queryKeySnapshot !== undefined) {
        queryClient.setQueryData(queryKeySnapshot, payload);
      }

      // readable-check: allow method-probe - optional operation: a form with no onSaveSuccess reports the save in the same tick
      if (onSaveSuccess) {
        await onSaveSuccess(payload, {
          queryClient,
          parsed: parsedInput,
          rawPayload,
          savePayload,
          resource
        });
      }

      feedback.success(text(messages.saveSuccess) || t("jskit.http.feedback.saved"));
    } catch (error) {
      fieldBag.apply(toUiFieldErrors(error));
      feedback.error(error, text(messages.saveError) || t("jskit.http.feedback.saveFailed"));
    } finally {
      submitting.value = false;
    }
  }

  return {
    saving,
    fieldErrors,
    message,
    messageType,
    validationAttempted,
    validationErrors,
    resetValidation,
    submit
  };
}

export { useAddEditCore };
