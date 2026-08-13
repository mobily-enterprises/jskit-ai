import assert from "node:assert/strict";
import test from "node:test";
import { createJskitNavigationScrollCoordinator } from "./navigationScroll.js";

test("navigation scroll coordinator composes app fallback and deferred restoration", () => {
  const calls = [];
  const coordinator = createJskitNavigationScrollCoordinator({
    fallback(to, from, savedPosition) {
      calls.push({ to, from, savedPosition });
      return savedPosition || { left: 4, top: 8 };
    }
  });

  assert.deepEqual(coordinator.scrollBehavior("to", "from", null), { left: 4, top: 8 });
  coordinator.attach({ shouldDeferScroll: (to) => to === "restore" });
  assert.equal(coordinator.scrollBehavior("restore", "from", { left: 1, top: 2 }), false);
  assert.deepEqual(coordinator.scrollBehavior("normal", "from", { left: 1, top: 2 }), { left: 1, top: 2 });
  assert.equal(calls.length, 2);
});

test("navigation scroll coordinator attaches once", () => {
  const coordinator = createJskitNavigationScrollCoordinator();
  const runtime = { shouldDeferScroll: () => false };
  coordinator.attach(runtime);
  coordinator.attach(runtime);
  assert.throws(() => coordinator.attach({}), /already attached/);
});
