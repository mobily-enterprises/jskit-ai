import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/lib/index.js";

test("auth provider supabase core validates required provider options", () => {
  assert.throws(() => createService({}), /authProvider is required/);
});
