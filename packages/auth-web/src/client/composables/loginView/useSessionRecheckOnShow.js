import { onBeforeUnmount, onMounted } from "vue";

// Runs recheck whenever the page is shown again: focused, made visible, or
// restored from the back-forward cache, where nothing mounts again.
export function useSessionRecheckOnShow(recheck) {
  function recheckWhenShown() {
    if (document.visibilityState === "visible") {
      recheck();
    }
  }

  onMounted(() => {
    window.addEventListener("focus", recheckWhenShown);
    window.addEventListener("pageshow", recheckWhenShown);
    document.addEventListener("visibilitychange", recheckWhenShown);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("focus", recheckWhenShown);
    window.removeEventListener("pageshow", recheckWhenShown);
    document.removeEventListener("visibilitychange", recheckWhenShown);
  });
}
