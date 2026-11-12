import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRoutePolicyConfig } from "../support/routePolicyConfig.js";
import { createRouter } from "./lib/router.js";

const handler = async () => ({ ok: true });

test("a route's secondFactor is checked when it is defined and reaches the route's policy config", () => {
  const router = createRouter();
  router.post("/api/session-wide", { auth: "required", secondFactor: true }, handler);
  router.post("/api/fresh", { auth: "own", secondFactor: { maxAgeSeconds: 300 } }, handler);
  router.post("/api/plain", { auth: "required" }, handler);
  const [sessionWide, fresh, plain] = router.list();

  assert.equal(sessionWide.secondFactor, true);
  assert.deepEqual(fresh.secondFactor, { maxAgeSeconds: 300 });
  assert.equal(plain.secondFactor, false);
  assert.equal(normalizeRoutePolicyConfig({}, sessionWide).secondFactor, true);
  assert.deepEqual(normalizeRoutePolicyConfig({}, fresh).secondFactor, { maxAgeSeconds: 300 });
  assert.equal(Object.hasOwn(normalizeRoutePolicyConfig({}, plain), "secondFactor"), false);
});

test("a route refuses a secondFactor it cannot enforce", () => {
  for (const secondFactor of ["yes", 1, {}, { maxAgeSeconds: 0 }, { maxAgeSeconds: 1.5 }, { maxAgeSeconds: 60, extra: true }]) {
    assert.throws(
      () => createRouter().post("/api/bad", { auth: "required", secondFactor }, handler),
      /secondFactor must be true or \{ maxAgeSeconds \}/u,
      JSON.stringify(secondFactor)
    );
  }
  // A signed-out caller has no session, so nothing could prove its second factor.
  for (const auth of [undefined, "public"]) {
    assert.throws(
      () => createRouter().post("/api/public", { auth, secondFactor: true }, handler),
      /asks for a second factor, so its auth must be "required" or "own"/u
    );
  }
});
