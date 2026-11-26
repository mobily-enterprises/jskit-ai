import { expect as playwrightExpect } from "@playwright/test";

// Playwright's expect.poll checks again after 100, 250 and 500 ms and then once a second, so a condition that holds
// 120 ms after an action is seen at 350 ms, and one that takes 1.1 s at 1.85 s. Browser contracts check every 20 ms
// instead: the same assertions with the same time limits, passing as soon as they hold. Playwright consumes the
// intervals array it is given, so each poll gets its own.
const POLL_INTERVAL_MS = 20;

/**
 * Playwright's `expect`, whose `poll` checks every 20 ms unless the caller passes its own `intervals`.
 * @type {typeof playwrightExpect}
 */
const expect = Object.assign((actual, messageOrOptions) => playwrightExpect(actual, messageOrOptions), playwrightExpect, {
  poll: (actual, messageOrOptions = {}) => playwrightExpect.poll(actual, typeof messageOrOptions === "string"
    ? { message: messageOrOptions, intervals: [POLL_INTERVAL_MS] }
    : { intervals: [POLL_INTERVAL_MS], ...messageOrOptions })
});

/**
 * Waits until the menu that `activator` opens has closed and left the page, so a click on the activator opens it
 * again. Vuetify 4.3 ignores a click on a menu's activator for 50 ms after the menu closes, so a click as soon as
 * aria-expanded turns "false" (after an action that closes the menu itself, such as the goal menu's Start) can be
 * lost, leaving the menu shut. The closed menu leaves the page when its close animation ends, later than that: at
 * least 85 ms for a menu's own transition and 100 ms for scale-transition.
 * @param {import("@playwright/test").Locator} activator
 */
async function expectMenuClosed(activator) {
  await expect(activator).toHaveAttribute("aria-expanded", "false");
  const menu = await activator.getAttribute("aria-controls");
  if (!menu) throw new Error("expectMenuClosed needs a menu activator, which names its menu in aria-controls.");
  await expect(activator.page().locator(`[id="${menu}"]`)).toHaveCount(0);
}

export { expect, expectMenuClosed };
