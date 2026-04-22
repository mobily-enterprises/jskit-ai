import assert from "node:assert/strict";
import test from "node:test";
import { redirectToChild } from "./pageRedirects.js";

test("redirectToChild resolves a child path and preserves incoming query and hash", () => {
  const redirect = redirectToChild("general");

  assert.deepEqual(redirect({
    path: "/home/settings/",
    query: {
      tab: "profile"
    },
    hash: "#advanced"
  }), {
    path: "/home/settings/general",
    query: {
      tab: "profile"
    },
    hash: "#advanced"
  });
});

test("redirectToChild uses child query and hash when the target declares them", () => {
  const redirect = redirectToChild("general?tab=security&filter=a&filter=b#advanced");

  assert.deepEqual(redirect({
    path: "/home/settings",
    query: {
      stale: "value"
    },
    hash: "#old"
  }), {
    path: "/home/settings/general",
    query: {
      tab: "security",
      filter: ["a", "b"]
    },
    hash: "#advanced"
  });
});
