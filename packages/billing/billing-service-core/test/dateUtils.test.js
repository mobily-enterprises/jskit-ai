import assert from "node:assert/strict";
import test from "node:test";

import { pickLaterDate } from "../src/lib/dateUtils.js";

test("pickLaterDate returns null when both values are invalid", () => {
  assert.equal(pickLaterDate(null, undefined), null);
});

test("pickLaterDate returns the later valid date", () => {
  const earlier = "2025-01-01T00:00:00.000Z";
  const later = "2025-01-02T00:00:00.000Z";
  assert.equal(pickLaterDate(earlier, later)?.toISOString(), later);
  assert.equal(pickLaterDate(later, earlier)?.toISOString(), later);
});
