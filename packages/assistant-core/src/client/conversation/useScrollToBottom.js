import { nextTick, onBeforeUnmount, unref } from "vue";

const DEFAULT_SETTLE_DELAYS_MS = [0, 80];

function readElement(value) {
  return unref(value) || null;
}

function hasWindowTimer(name) {
  return typeof window !== "undefined" && typeof window[name] === "function";
}

function waitForLayoutFrame() {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.requestAnimationFrame(resolve);
  });
}

function normalizedScrollBehavior(value = "") {
  return value === "smooth" ? "smooth" : "auto";
}

function scrollElementToBottom(targetElement, behavior = "auto") {
  if (behavior === "smooth" && typeof targetElement.scrollTo === "function") {
    targetElement.scrollTo({
      behavior,
      top: targetElement.scrollHeight
    });
    return;
  }
  targetElement.scrollTop = targetElement.scrollHeight;
}

function useScrollToBottom({
  anchor = null,
  enabled = true,
  scrollAnchorIntoView = true,
  settleDelaysMs = DEFAULT_SETTLE_DELAYS_MS,
  target
} = {}) {
  const scheduledTimers = new Set();
  let disposed = false;
  let scheduleVersion = 0;

  function isEnabled() {
    return unref(enabled) !== false;
  }

  function clearScheduledTimers() {
    if (hasWindowTimer("clearTimeout")) {
      scheduledTimers.forEach((timer) => {
        window.clearTimeout(timer);
      });
    }
    scheduledTimers.clear();
  }

  function clearScheduledScrolls() {
    scheduleVersion += 1;
    clearScheduledTimers();
  }

  function scrollNow(options = {}) {
    if (disposed || !isEnabled()) {
      return;
    }

    const targetElement = readElement(target);
    if (!targetElement) {
      return;
    }

    const behavior = normalizedScrollBehavior(options?.behavior);
    scrollElementToBottom(targetElement, behavior);
    if (scrollAnchorIntoView !== false) {
      const anchorOptions = {
        block: "end"
      };
      if (behavior === "smooth") {
        anchorOptions.behavior = behavior;
      }
      readElement(anchor)?.scrollIntoView?.(anchorOptions);
    }
    scrollElementToBottom(targetElement, behavior);
  }

  function scheduleScroll(delayMs, options = {}, version = scheduleVersion) {
    if (
      disposed ||
      version !== scheduleVersion ||
      !isEnabled() ||
      !hasWindowTimer("setTimeout")
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      scheduledTimers.delete(timer);
      if (version !== scheduleVersion) {
        return;
      }
      scrollNow(options);
    }, delayMs);
    scheduledTimers.add(timer);
  }

  async function scrollAfterLayout(options = {}) {
    if (disposed || !isEnabled()) {
      return;
    }
    const version = scheduleVersion + 1;
    scheduleVersion = version;
    clearScheduledTimers();

    await nextTick();
    if (version !== scheduleVersion) {
      return;
    }
    scrollNow(options);

    await waitForLayoutFrame();
    if (version !== scheduleVersion) {
      return;
    }
    scrollNow(options);

    clearScheduledTimers();
    settleDelaysMs.forEach((delayMs) => {
      scheduleScroll(delayMs, options, version);
    });
  }

  onBeforeUnmount(() => {
    disposed = true;
    clearScheduledScrolls();
  });

  return {
    clearScheduledScrolls,
    scrollAfterLayout,
    scrollNow
  };
}

export {
  useScrollToBottom
};
