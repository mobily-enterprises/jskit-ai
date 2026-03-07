import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import descriptor from "../package.descriptor.mjs";
import {
  useSignOut as fromComposableUseSignOut,
  createSignOutAction as fromComposableCreateSignOutAction,
  performSignOutRequest as fromComposablePerformSignOutRequest
} from "../src/client/composables/useSignOut.js";
import {
  useSignOut as fromRuntimeUseSignOut,
  createSignOutAction as fromRuntimeCreateSignOutAction,
  performSignOutRequest as fromRuntimePerformSignOutRequest
} from "../src/client/runtime/useSignOut.js";

test("auth-web descriptor declares global ui routes", () => {
  const uiRoutes = Array.isArray(descriptor?.metadata?.ui?.routes) ? descriptor.metadata.ui.routes : [];
  const authRoutes = uiRoutes.filter((route) => String(route?.path || "").startsWith("/auth/"));

  assert.equal(authRoutes.length >= 2, true);
  for (const route of authRoutes) {
    assert.equal(String(route?.scope || "").trim().toLowerCase(), "global");
  }
});

test("auth-web composables/useSignOut re-exports runtime signout helpers", () => {
  assert.equal(fromComposableUseSignOut, fromRuntimeUseSignOut);
  assert.equal(fromComposableCreateSignOutAction, fromRuntimeCreateSignOutAction);
  assert.equal(fromComposablePerformSignOutRequest, fromRuntimePerformSignOutRequest);
});

test("auth-web runtime/useLoginView delegates to useDefaultLoginView", () => {
  const runtimeUseLoginViewPath = fileURLToPath(new URL("../src/client/runtime/useLoginView.js", import.meta.url));
  const runtimeUseLoginViewSource = readFileSync(runtimeUseLoginViewPath, "utf8");

  assert.match(runtimeUseLoginViewSource, /import\s+\{\s*useDefaultLoginView\s*\}\s+from\s+"..\/composables\/useDefaultLoginView\.js";/);
  assert.match(runtimeUseLoginViewSource, /function\s+useLoginView\s*\(\)\s*\{\s*return\s+useDefaultLoginView\(\);\s*\}/);
  assert.match(runtimeUseLoginViewSource, /export\s+\{\s*useLoginView,\s*useDefaultLoginView\s*\};/);
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
  assert.equal(
    exportsMap["./client/routes"],
    "./src/client/routes/registerClientRoutes.js"
  );
  assert.equal(
    exportsMap["./client/views/AuthProfileWidget"],
    "./src/client/views/AuthProfileWidget.vue"
  );
  assert.equal(
    exportsMap["./client/views/AuthProfileMenuLinkItem"],
    "./src/client/views/AuthProfileMenuLinkItem.vue"
  );
});
