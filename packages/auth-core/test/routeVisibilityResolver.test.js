import assert from "node:assert/strict";
import test from "node:test";
import { createAuthRouteVisibilityResolver } from "../src/server/lib/routeVisibilityResolver.js";

test("auth route visibility resolver contributes actor scope for core user visibility only", () => {
  const resolver = createAuthRouteVisibilityResolver();

  assert.deepEqual(
    resolver.resolve({
      visibility: "user",
      context: {
        actor: {
          id: "user_7"
        }
      }
    }),
    {
      userId: "user_7",
      requiresActorScope: true
    }
  );

  assert.deepEqual(
    resolver.resolve({
      visibility: "workspace_user",
      context: {
        actor: {
          id: "user_7"
        }
      }
    }),
    {}
  );
});
