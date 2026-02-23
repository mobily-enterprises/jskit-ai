import assert from "node:assert/strict";
import test from "node:test";

import { createScopeDebugMatcher, createScopedLogger } from "../server/lib/logging/scopeLogger.js";

test("createScopeDebugMatcher supports include/exclude scope prefixes", () => {
  const isEnabled = createScopeDebugMatcher("billing,auth,-auth.tokens");

  assert.equal(isEnabled("billing"), true);
  assert.equal(isEnabled("billing.checkout"), true);
  assert.equal(isEnabled("auth.session"), true);
  assert.equal(isEnabled("auth.tokens"), false);
  assert.equal(isEnabled("chat"), false);
});

test("createScopedLogger emits debug only for enabled scopes", () => {
  const writes = [];
  const logger = {
    debug(...args) {
      writes.push(["debug", ...args]);
    },
    info(...args) {
      writes.push(["info", ...args]);
    },
    warn(...args) {
      writes.push(["warn", ...args]);
    },
    error(...args) {
      writes.push(["error", ...args]);
    }
  };
  const isEnabled = createScopeDebugMatcher("billing");

  const billingLogger = createScopedLogger({
    logger,
    scope: "billing.checkout",
    isScopeDebugEnabled: isEnabled
  });
  const chatLogger = createScopedLogger({
    logger,
    scope: "chat.realtime",
    isScopeDebugEnabled: isEnabled
  });

  billingLogger.debug({ checkout_id: "cs_123" }, "billing debug");
  chatLogger.debug({ thread_id: "th_123" }, "chat debug");
  billingLogger.info({ phase: "start" }, "billing info");

  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], ["debug", "[billing.checkout]", { checkout_id: "cs_123" }, "billing debug"]);
  assert.deepEqual(writes[1], ["info", "[billing.checkout]", { phase: "start" }, "billing info"]);
});
