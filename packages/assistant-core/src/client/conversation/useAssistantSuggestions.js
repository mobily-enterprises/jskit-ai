import { computed, onScopeDispose, ref, toValue, unref, watch } from "vue";

/** Suggestion requests use an application-supplied agent; credentials stay on its server. */
export function useAssistantSuggestions({
  active = true, requestKey = "", draft = "", configuration = {},
  generate, onSelect = () => false, debounceMs = 750
} = {}) {
  const items = ref([]);
  const loading = ref(false);
  const preview = ref("");
  const error = ref("");
  const dismissedKey = ref(null);
  const composerFocused = ref(false);
  const currentDraft = computed(() => String(toValue(draft) ?? "").trim());
  const configurationKey = computed(() => JSON.stringify(toValue(configuration) ?? {}));
  const key = computed(() => JSON.stringify([toValue(requestKey), currentDraft.value, configurationKey.value]));
  const eligible = computed(() => toValue(active) !== false && typeof unref(generate) === "function" && dismissedKey.value !== key.value);
  const visible = computed(() => eligible.value && (loading.value || items.value.length > 0));
  let timer;
  let request;

  function cancel() {
    clearTimeout(timer);
    const previous = request;
    request = null;
    previous?.abort();
    loading.value = false;
  }

  watch([eligible, key, () => unref(generate)], () => {
    cancel();
    items.value = [];
    preview.value = "";
    error.value = "";
    if (!eligible.value) return;
    const controller = new AbortController();
    request = controller;
    const input = {
      draft: currentDraft.value,
      configuration: JSON.parse(configurationKey.value),
      signal: controller.signal
    };
    const run = unref(generate);
    loading.value = true;
    timer = setTimeout(async () => {
      try {
        const result = await run(input);
        if (request !== controller) return;
        if (!Array.isArray(result) || result.some(item => !item?.label?.trim() || !item?.prompt?.trim())) {
          throw new TypeError("Suggestions must contain a label and prompt.");
        }
        items.value = result.map(({ label, prompt }) => ({ label: label.trim(), prompt: prompt.trim() }));
      } catch (failure) {
        if (request === controller && !controller.signal.aborted) error.value = String(failure.message || failure);
      } finally {
        if (request === controller) {
          request = null;
          loading.value = false;
        }
      }
    }, Math.max(0, Number(toValue(debounceMs)) || 0));
  }, { immediate: true, flush: "sync" });

  function currentSuggestion(value) {
    return items.value.find(item => item.label === value?.label && item.prompt === value?.prompt);
  }
  function previewSuggestion(value) {
    preview.value = currentDraft.value ? "" : currentSuggestion(value)?.prompt || "";
    return Boolean(preview.value);
  }
  function select(value) {
    const suggestion = currentSuggestion(value);
    if (!suggestion || !eligible.value) return false;
    preview.value = "";
    return onSelect(suggestion.prompt) !== false;
  }
  function dismiss() {
    preview.value = "";
    dismissedKey.value = key.value;
  }
  function focus() {
    if (toValue(active) === false || composerFocused.value) return;
    dismissedKey.value = null;
    composerFocused.value = true;
  }
  function blur() {
    preview.value = "";
    composerFocused.value = false;
  }
  watch(() => toValue(active), value => {
    if (value === false) {
      composerFocused.value = false;
      dismissedKey.value = null;
    }
  }, { flush: "sync" });
  watch(currentDraft, () => { preview.value = ""; }, { flush: "sync" });
  onScopeDispose(cancel);
  return { items, loading, preview, error, visible, composerFocused, previewSuggestion, select, dismiss, focus, blur };
}
