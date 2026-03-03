import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";
import { createSignOutAction as fromComposableCreateSignOutAction, performSignOutRequest as fromComposablePerformSignOutRequest } from "../src/client/composables/useSignOut.js";
import { createSignOutAction as fromRuntimeCreateSignOutAction, performSignOutRequest as fromRuntimePerformSignOutRequest } from "../src/client/runtime/useSignOut.js";

test("auth-web descriptor declares global ui routes", () => {
  const uiRoutes = Array.isArray(descriptor?.metadata?.ui?.routes) ? descriptor.metadata.ui.routes : [];
  const authRoutes = uiRoutes.filter((route) => String(route?.path || "").startsWith("/auth/"));

  assert.equal(authRoutes.length >= 2, true);
  for (const route of authRoutes) {
    assert.equal(String(route?.scope || "").trim().toLowerCase(), "global");
  }
});

test("auth-web composables/useSignOut re-exports runtime signout helpers", () => {
  assert.equal(fromComposableCreateSignOutAction, fromRuntimeCreateSignOutAction);
  assert.equal(fromComposablePerformSignOutRequest, fromRuntimePerformSignOutRequest);
});

test("auth-web package exports composables for default auth views", () => {
  const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};
  assert.equal(
    exportsMap["./client/composables/useDefaultLoginView"],
    "./src/client/composables/useDefaultLoginView.js"
  );
  assert.equal(
    exportsMap["./client/composables/useDefaultSignOutView"],
    "./src/client/composables/useDefaultSignOutView.js"
  );
});
