import { unref } from "vue";
import { useJskitNavigationBlocker } from "@jskit-ai/kernel/client/navigation";

function useCrudFormNavigationBlocker({
  id,
  isDirty,
  title = "Discard changes?",
  message = "Your unsaved changes will be lost."
} = {}) {
  if (!String(id || "").trim()) {
    throw new TypeError("useCrudFormNavigationBlocker requires a stable id.");
  }
  return useJskitNavigationBlocker({
    id: String(id).trim(),
    isBlocked: () => Boolean(typeof isDirty === "function" ? isDirty() : unref(isDirty)),
    title,
    message
  });
}

export { useCrudFormNavigationBlocker };
