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

test("console auth service decorator safely shadows authenticateRequest on a frozen service", async () => {
  const calls = [];
  const ownerSeeds = [];
  const originalAuthenticateRequest = async function authenticateRequest(request, ...args) {
    calls.push({ request, args });
    return {
      authenticated: true,
      profile: {
        id: request.profileId
      }
    };
  };
  const originalAuthService = Object.freeze({
    authenticateRequest: originalAuthenticateRequest,
    readMarker() {
      return "original-service";
    }
  });
  const decorator = createConsoleAuthServiceDecorator({
    consoleService: {
      async ensureInitialConsoleMember(userId) {
        ownerSeeds.push(String(userId || ""));
        return String(userId || "");
      }
    }
  });

  const decoratedAuthService = decorator.decorateAuthService(originalAuthService);
  const result = await decoratedAuthService.authenticateRequest(
    {
      profileId: "42",
      url: "/api/session"
    },
    "forwarded-argument"
  );

  assert.equal(Object.isFrozen(originalAuthService), true);
  assert.equal(Object.isFrozen(decoratedAuthService), true);
  assert.equal(Object.getPrototypeOf(decoratedAuthService), originalAuthService);
  assert.equal(originalAuthService.authenticateRequest, originalAuthenticateRequest);
  assert.equal(decoratedAuthService.readMarker(), "original-service");
  assert.equal(result.profile.id, "42");
  assert.deepEqual(ownerSeeds, ["42"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["forwarded-argument"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(decoratedAuthService, "authenticateRequest"), {
    configurable: false,
    enumerable: true,
    value: decoratedAuthService.authenticateRequest,
    writable: false
  });
});
