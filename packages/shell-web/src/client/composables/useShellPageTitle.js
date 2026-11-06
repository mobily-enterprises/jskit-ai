import { onScopeDispose, toValue } from "vue";
import { useShellNavigationRuntime } from "../navigation/useShellNavigation.js";

/**
 * Shows `title` as the app bar's page title while the calling component lives, over the route's `meta.jskit.title`.
 * For a title known only at runtime, such as a record's name. The title may be a message key or plain text.
 * @param {import("vue").MaybeRefOrGetter<string>} title
 */
function useShellPageTitle(title) {
  const runtime = useShellNavigationRuntime();
  const release = runtime.setPageTitle(() => String(toValue(title) || ""));
  onScopeDispose(release);
}

export { useShellPageTitle };
