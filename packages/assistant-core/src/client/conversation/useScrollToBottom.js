import { nextTick, onBeforeUnmount, unref } from "vue";
import { hasWindowFunction, waitForLayoutFrame } from "../browser.js";

const DEFAULT_SETTLE_DELAYS_MS = [0, 80];

function readElement(value) {
  return unref(value) || null;
}

function normalizedScrollBehavior(value = "") {
  return value === "smooth" ? "smooth" : "auto";
}

function scrollElementToBottom(targetElement, behavior = "auto") {
  // readable-check: allow method-probe - platform object: an older browser's elements have no scrollTo()
  if (behavior === "smooth" && typeof targetElement.scrollTo === "function") {
    targetElement.scrollTo({
      behavior,
      top: targetElement.scrollHeight
    });
    return;
  }
  targetElement.scrollTop = targetElement.scrollHeight;
}

/**
 * Scrolls `target` to its end now, after the next layout, and again after each settle delay, while `enabled`.
 * @param {{
 *   anchor?: import("vue").MaybeRef<Element | null>,
 *   enabled?: import("vue").MaybeRef<boolean>,
 *   scrollAnchorIntoView?: boolean,
 *   settleDelaysMs?: number[],
 *   target: import("vue").MaybeRef<Element | null>
 * }} options
 */
function useScrollToBottom({
  anchor = null,
  enabled = true,
  scrollAnchorIntoView = true,
  settleDelaysMs = DEFAULT_SETTLE_DELAYS_MS,
  target
}) {
  const scheduledTimers = new Set();
  let disposed = false;
  let scheduleVersion = 0;

  function isEnabled() {
    return unref(enabled) !== false;
  }

  function clearScheduledTimers() {
    if (hasWindowFunction("clearTimeout")) {
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

  function scrollNow(options) {
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
      readElement(anchor)?.scrollIntoView(anchorOptions);
    }
    scrollElementToBottom(targetElement, behavior);
  }

  function scheduleScroll(delayMs, options = {}, version = scheduleVersion) {
    if (
      disposed ||
      version !== scheduleVersion ||
      !isEnabled() ||
      !hasWindowFunction("setTimeout")
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
