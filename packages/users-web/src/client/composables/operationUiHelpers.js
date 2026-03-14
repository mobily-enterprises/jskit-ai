import { watch } from "vue";

function setupRouteChangeCleanup({
  enabled = true,
  route = null,
  feedback = null,
  fieldBag = null
} = {}) {
  if (!enabled) {
    return;
  }

  watch(
    () => route?.fullPath,
    () => {
      feedback?.clear?.();
      fieldBag?.clear?.();
    }
  );
}

export { setupRouteChangeCleanup };
