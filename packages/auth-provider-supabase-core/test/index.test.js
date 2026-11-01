import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseAuthService } from "../src/server/lib/index.js";

test("auth provider supabase core exports its auth service factory", () => {
  assert.equal(typeof createSupabaseAuthService, "function");
});
