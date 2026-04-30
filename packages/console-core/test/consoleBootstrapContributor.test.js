import assert from "node:assert/strict";
import test from "node:test";
import { createConsoleBootstrapContributor } from "../src/server/consoleBootstrapContributor.js";

test("console bootstrap contributor exposes consoleowner when the authenticated user already owns the console", async () => {
  const contributor = createConsoleBootstrapContributor({
    consoleService: {
      async isConsoleOwnerUserId(userId) {
        return String(userId || "") === "12";
      }
    }
  });

  assert.equal(contributor.order, 300);
  const contribution = await contributor.contribute({
    payload: {
      session: {
        authenticated: true,
        userId: "12"
      },
      surfaceAccess: {
        existing: true
      }
    }
  });

  assert.deepEqual(contribution, {
    surfaceAccess: {
      existing: true,
      consoleowner: true
    }
  });
});

test("console bootstrap contributor exposes a false consoleowner flag for anonymous bootstrap", async () => {
  const contributor = createConsoleBootstrapContributor({
    consoleService: {
      async isConsoleOwnerUserId() {
        throw new Error("should not be called for anonymous payload");
      }
    }
  });

  const contribution = await contributor.contribute({
    payload: {
      session: {
        authenticated: false
      },
      surfaceAccess: {
        existing: true
      }
    }
  });

  assert.deepEqual(contribution, {
    surfaceAccess: {
      existing: true,
      consoleowner: false
    }
  });
});
