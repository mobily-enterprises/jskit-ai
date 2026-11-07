import { onScopeDispose, toValue } from "vue";
import { useShellNavigationRuntime } from "../navigation/useShellNavigation.js";

/**
 * Makes the calling page a task that closes, as Material 3 draws a full-screen form: while the calling component
 * lives, the top app bar's Up arrow is a close (X) labelled `label` that runs `close`, such as the form's Cancel, so
 * the bar shows no Up arrow beside an X. A page without an Up arrow is unchanged and shows its own Cancel.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<string>} options.label A message key or plain text.
 * @param {() => unknown} options.close
 */
function useShellPageClose({ label, close }) {
  const runtime = useShellNavigationRuntime();
  const release = runtime.setPageClose({ label: () => String(toValue(label) || ""), close });
  onScopeDispose(release);
}

export { useShellPageClose };
