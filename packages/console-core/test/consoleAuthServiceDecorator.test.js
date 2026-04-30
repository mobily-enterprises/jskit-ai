import assert from "node:assert/strict";
import test from "node:test";
import { createConsoleAuthServiceDecorator } from "../src/server/consoleAuthServiceDecorator.js";

test("console auth service decorator seeds first owner during session reads only", async () => {
  const ownerSeeds = [];
  const decorator = createConsoleAuthServiceDecorator({
    consoleService: {
      async ensureInitialConsoleMember(userId) {
        ownerSeeds.push(String(userId || ""));
        return String(userId || "");
      }
    }
  });

  const authService = decorator.decorateAuthService({
    async authenticateRequest(request) {
      return {
        authenticated: true,
        profile: {
          id: request.profileId
        }
      };
    }
  });

  await authService.authenticateRequest({
    profileId: "12",
    url: "/api/bootstrap"
  });
  await authService.authenticateRequest({
    profileId: "12",
    url: "/api/session"
  });
  await authService.authenticateRequest({
    profileId: "99",
    url: "/api/session"
  });

  assert.deepEqual(ownerSeeds, ["12"]);
});

test("console auth service decorator leaves unauthenticated session reads alone", async () => {
  const decorator = createConsoleAuthServiceDecorator({
    consoleService: {
      async ensureInitialConsoleMember() {
        throw new Error("should not seed owner for anonymous session reads");
      }
    }
  });

  const authService = decorator.decorateAuthService({
    async authenticateRequest() {
      return {
        authenticated: false
      };
    }
  });

  const result = await authService.authenticateRequest({
    url: "/api/session"
  });

  assert.equal(result.authenticated, false);
});
