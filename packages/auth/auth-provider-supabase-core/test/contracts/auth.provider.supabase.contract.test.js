import assert from "node:assert/strict";
import test from "node:test";
import * as authProviderSupabase from "../../src/shared/index.js";

test("auth.provider.supabase contract exports required symbols", () => {
  assert.equal(typeof authProviderSupabase.createService, "function");
});

