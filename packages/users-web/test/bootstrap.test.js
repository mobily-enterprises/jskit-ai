import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlacementUserFromBootstrapPayload } from "../src/client/lib/bootstrap.js";

test("resolvePlacementUserFromBootstrapPayload returns null for anonymous sessions", () => {
  assert.equal(
    resolvePlacementUserFromBootstrapPayload({
      session: {
        authenticated: false
      }
    }),
    null
  );
});

test("resolvePlacementUserFromBootstrapPayload maps profile fields used by placement avatar widget", () => {
  const user = resolvePlacementUserFromBootstrapPayload({
    session: {
      authenticated: true,
      userId: "42"
    },
    profile: {
      displayName: "Ada Lovelace",
      email: "ADA@EXAMPLE.COM",
      avatar: {
        effectiveUrl: "https://cdn.example.com/ada.png"
      }
    }
  });

  assert.deepEqual(user, {
    id: "42",
    displayName: "Ada Lovelace",
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarUrl: "https://cdn.example.com/ada.png"
  });
});
