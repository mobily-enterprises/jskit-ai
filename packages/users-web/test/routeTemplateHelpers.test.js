import assert from "node:assert/strict";
import test from "node:test";
import {
  extractRouteParamNames,
  resolveRouteParamNamesInOrder
} from "../src/client/composables/routeTemplateHelpers.js";

test("extractRouteParamNames reads dynamic params from route templates", () => {
  assert.deepEqual(
    extractRouteParamNames("/w/:workspaceSlug/admin/contacts/:contactId/addresses/:addressId"),
    ["workspaceSlug", "contactId", "addressId"]
  );
});

test("resolveRouteParamNamesInOrder prefers matched route templates", () => {
  const route = {
    matched: [
      { path: "/w/:workspaceSlug/admin" },
      { path: "/contacts/:contactId/addresses/:addressId" }
    ],
    params: {
      workspaceSlug: "acme",
      contactId: "7",
      addressId: "42"
    }
  };

  assert.deepEqual(resolveRouteParamNamesInOrder(route), ["workspaceSlug", "contactId", "addressId"]);
});
