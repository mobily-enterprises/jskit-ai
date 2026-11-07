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

export { expect };
