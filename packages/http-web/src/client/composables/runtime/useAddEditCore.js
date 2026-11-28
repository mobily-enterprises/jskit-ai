import { useQueryClient } from "@tanstack/vue-query";
import { computed, ref, toValue, watch } from "vue";
import { validateOperationInput } from "./operationValidationHelpers.js";
import { ignoreLoadedPayload } from "./modelStateHelpers.js";
import { useUnsavedEdits } from "./useUnsavedEdits.js";
import { toUiFieldErrors } from "../support/errorMessageHelpers.js";
import { emptyRecord } from "../support/scopeHelpers.js";
import { useJskitText } from "../../i18n.js";

const { t, text } = useJskitText();

function saveParsedInput(parsedInput) {
  return parsedInput;
}

/** @param {import("../../types.js").AddEditCoreOptions} options */
function useAddEditCore({
  // readable-check: allow required-collaborators - data: the form's record, empty for a form whose fields live elsewhere
  model = {},
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
  // Every write of fetched data into the form goes through `edits`: a read of the record, a save's response and
  // applyLoaded() each keep what the person changed and has not saved, and list the fields whose server value changed
  // under such a change.
  const edits = useUnsavedEdits({ model });

  function writeLoaded(payload) {
    return (target) => mapLoadedToModel(target, payload, {
      queryClient,
      resource
    });
  }

  // A record with no data yet (a new query key, or one the cache dropped) starts from the form's initial values.
  watch(
    () => resource.query.isPending.value,
    (isPending) => {
      if (isPending) {
        edits.reset();
      }
    },
    {
      immediate: true
    }
  );

  // Each read of the record: its first load and every read again (a realtime event, the window regaining focus,
  // Retry, a save's write to the cache). The query key names the record, so another record's data starts over.
  watch(
    () => resource.data.value,
    (payload) => {
      if (!payload) {
        return;
      }

      edits.merge(writeLoaded(payload), JSON.stringify(toValue(queryKey)));
    },
    {
      immediate: true
    }
  );

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
    // What this save sends: its response replaces these fields, except one the person changes while it runs.
    const sent = edits.captureFields();

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

      edits.mergeSaved(writeLoaded(payload), sent);

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

  /** A record of the form's own read that other code read, such as a settings page's one read of all its forms. */
  function applyLoaded(payload) {
    edits.merge(writeLoaded(payload));
  }

  return {
    saving,
    fieldErrors,
    message,
    messageType,
    validationAttempted,
    validationErrors,
    resetValidation,
    submit,
    conflicts: edits.conflicts,
    acceptServerValue: edits.acceptServerValue,
    keepOwnValue: edits.keepOwnValue,
    applyLoaded
  };
}

export { useAddEditCore };
