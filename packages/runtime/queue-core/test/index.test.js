import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerKernel } from "../src/lib/index.js";

test("worker kernel dispatches and drains jobs", async () => {
  const events = [];
  const kernel = createWorkerKernel();

  kernel.registerJob({
    id: "email.send",
    async run(payload) {
      events.push(payload.to);
      return { ok: true };
    }
  });

  await kernel.start();
  kernel.dispatch("email.send", { to: "a@example.com" });
  kernel.dispatch("email.send", { to: "b@example.com" });

  const completed = await kernel.drain();
  assert.equal(completed.length, 2);
  assert.deepEqual(events, ["a@example.com", "b@example.com"]);

  await kernel.stop();
});

test("worker fails fast on unregistered job", async () => {
  const kernel = createWorkerKernel();
  await kernel.start();
  assert.throws(() => kernel.dispatch("missing.job"), /not registered/);
  await kernel.stop();
});
