import assert from "node:assert/strict";
import test from "node:test";
import { createConsoleBootstrapContributor } from "../src/server/consoleBootstrapContributor.js";

test("console bootstrap contributor seeds the initial console owner into the existing bootstrap payload", async () => {
  const ownerSeeds = [];
  const contributor = createConsoleBootstrapContributor({
    consoleService: {
      async ensureInitialConsoleMember(userId) {
        ownerSeeds.push(String(userId || ""));
        return String(userId || "");
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

  assert.deepEqual(ownerSeeds, ["12"]);
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
      async ensureInitialConsoleMember() {
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
