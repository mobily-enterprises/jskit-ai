import assert from "node:assert/strict";
import test from "node:test";

import { startOfUtcDay, startOfUtcWeek } from "../src/shared/dateWindows.js";

test("startOfUtcDay resets time to UTC midnight", () => {
  const reference = new Date("2025-01-08T15:42:11.555Z");
  assert.equal(startOfUtcDay(reference).toISOString(), "2025-01-08T00:00:00.000Z");
});

test("startOfUtcWeek returns Monday UTC boundary", () => {
  const sunday = new Date("2025-01-12T23:59:59.000Z");
  const wednesday = new Date("2025-01-15T06:00:00.000Z");
  assert.equal(startOfUtcWeek(sunday).toISOString(), "2025-01-06T00:00:00.000Z");
  assert.equal(startOfUtcWeek(wednesday).toISOString(), "2025-01-13T00:00:00.000Z");
});
