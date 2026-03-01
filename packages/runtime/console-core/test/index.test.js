import assert from "node:assert/strict";
import test from "node:test";
import { createConsoleKernel } from "../src/shared/index.js";

test("console kernel runs registered commands", async () => {
  const kernel = createConsoleKernel();
  kernel.registerCommand({
    id: "cache:clear",
    description: "Clear cache",
    async execute(payload) {
      return { ok: true, args: payload.args || [] };
    }
  });

  const result = await kernel.runArgv(["cache:clear", "--all"]);
  assert.deepEqual(result, { ok: true, args: ["--all"] });
});

test("command and schedule listing is deterministic", () => {
  const kernel = createConsoleKernel();
  kernel.registerCommand({ id: "z", execute: async () => ({}) });
  kernel.registerCommand({ id: "a", execute: async () => ({}) });

  kernel.registerSchedule({ id: "nightly", cron: "0 0 * * *", run: async () => {} });

  assert.deepEqual(kernel.listCommands().map((entry) => entry.id), ["a", "z"]);
  assert.deepEqual(kernel.listSchedules().map((entry) => entry.id), ["nightly"]);
});
