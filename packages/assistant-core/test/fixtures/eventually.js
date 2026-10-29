import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

// Polls `check` until it holds, failing with `message` after two seconds.
export async function eventually(check, message) {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(message);
    await delay(5);
  }
}
