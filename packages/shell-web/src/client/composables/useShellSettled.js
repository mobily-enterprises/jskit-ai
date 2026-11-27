import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { pageDocument } from "../browser.js";
import { useWebPlacementRevision, useWebPlacementRuntime } from "../placement/inject.js";

// The class each part of ShellLayout carries while it settles: unseen and untouchable while it waits, then shown with
// its transitions held for one more style pass, so it neither slides nor fades into the place it already has.
const SETTLING_CLASSES = Object.freeze({
  waiting: "shell-layout--waiting",
  placing: "shell-layout--placing",
  settled: ""
});

// Commits the page's styles and layout as they are now, so a change that follows starts from them.
function commitLayout() {
  pageDocument()?.documentElement.getBoundingClientRect();
}

/**
 * Whether ShellLayout shows its parts yet. Its navigation (the drawer, the rail, the navigation bar and the app bar's
 * menu control) follows the placement context, and an application can load part of that after the page opens, such as
 * a session's permissions, which it marks pending meanwhile (`mergeContext(value, source, { pending: true })`). Drawn as
 * they arrived, the navigation would push the page aside under a person's pointer. The shell lays its parts out unseen
 * until no part of the context is pending, fits its drawer (`settleNavigation`, which may wait for the page's fonts),
 * and only then shows them, all at once and where they stay. It waits once, as it mounts: later changes to the context
 * redraw the navigation in place. With nothing pending and no font loading it settles right after the render that
 * mounts it, before the page first paints.
 * @param {{ settleNavigation: () => void | Promise<void> }} options
 */
function useShellSettled({ settleNavigation }) {
  const placementRuntime = useWebPlacementRuntime();
  const revision = useWebPlacementRevision(placementRuntime);
  const mounted = ref(false);
  /** @type {import("vue").Ref<"waiting" | "placing" | "settled">} */
  const phase = ref("waiting");
  const contextPending = computed(() => {
    void revision.value;
    return placementRuntime.isContextPending();
  });
  const settlingClass = computed(() => SETTLING_CLASSES[phase.value]);
  const waiting = computed(() => phase.value === "waiting");

  watch(() => mounted.value && !contextPending.value, settleWhenReady);

  onMounted(() => {
    mounted.value = true;
  });
  onBeforeUnmount(() => {
    mounted.value = false;
  });

  function settleWhenReady(ready) {
    if (ready && phase.value === "waiting") {
      void settle();
    }
  }

  async function settle() {
    // The navigation the settled context draws is rendered; the drawer fits it, and the layout takes its final
    // places while the parts are still unseen.
    await nextTick();
    await settleNavigation();
    await nextTick();
    commitLayout();
    if (!mounted.value) {
      return;
    }
    phase.value = "placing";
    await nextTick();
    commitLayout();
    if (mounted.value) {
      phase.value = "settled";
    }
  }

  return { settlingClass, waiting };
}

export { useShellSettled };
