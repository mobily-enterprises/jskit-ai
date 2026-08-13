import assert from "node:assert/strict";
import test from "node:test";
import { inspectVueNavigationRoute } from "../src/server/shared/navigationRouteInspection.js";

test("navigation route inspection reads static definePage metadata without matching unrelated fields", () => {
  const route = inspectVueNavigationRoute(
    `<script setup lang="ts">
const unrelated = { behavior: "boundary", destinationKey: "wrong.key" };
definePage({
  name: "admin-record-edit",
  meta: {
    jskit: {
      surface: "admin",
      navigationRole: "none",
      navigation: {
        behavior: "preserve",
        machineryKey: "admin.record.edit",
        fallback: { name: "admin-records" },
        restore: ["admin.record.edit.v1"],
        persistence: { mode: "url-only" }
      }
    }
  }
});
void unrelated;
</script>
<template><main /></template>`,
    "packages/records/src/pages/admin/records/[recordId]/edit.vue"
  );

  assert.equal(route.routePath, "/admin/records/[recordId]/edit");
  assert.equal(route.routeName, "admin-record-edit");
  assert.equal(route.behavior, "preserve");
  assert.equal(route.machineryKey, "admin.record.edit");
  assert.deepEqual(route.fallback, { name: "admin-records" });
  assert.deepEqual(route.restore, ["admin.record.edit.v1"]);
  assert.equal(route.persistence, "url-only");
  assert.equal(route.redirectOnly, false);
});

test("navigation route inspection recognizes static definePage redirects without a template", () => {
  const route = inspectVueNavigationRoute(
    `<script setup>definePage({ redirect: { name: "home" } });</script>`,
    "src/pages/index.vue"
  );

  assert.equal(route.routePath, "/");
  assert.equal(route.redirectOnly, true);
  assert.equal(route.hasNavigationMetadata, false);
});

test("navigation route inspection recognizes definePage redirect helpers without executing them", () => {
  const route = inspectVueNavigationRoute(
    `<script setup>
import { redirectToChild } from "@jskit-ai/kernel/client/pageRedirects";
definePage({ redirect: redirectToChild("general") });
</script>`,
    "src/pages/settings/index.vue"
  );

  assert.equal(route.redirectOnly, true);
  assert.equal(route.hasNavigationMetadata, false);
});
