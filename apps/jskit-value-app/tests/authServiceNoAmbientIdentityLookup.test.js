import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { createService as createAuthService } from "../server/modules/auth/service.js";

const SUPABASE_URL = "http://supabase.local";
const SUPABASE_PUBLISHABLE_KEY = "pk_test_123";
const APP_PUBLIC_URL = "http://localhost:5173";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function parseFetchInput(input, init) {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = String(init?.method || "GET").toUpperCase();
  return {
    url,
    method,
    headers: init?.headers || {}
  };
}

test("getSecurityStatus uses explicit-token user lookup and never calls identities endpoint", async () => {
  const repository = {
    async findBySupabaseUserId() {
      return null;
    },
    async upsert(profile) {
      return {
        id: 1,
        ...profile,
        createdAt: "2024-01-01T00:00:00.000Z"
      };
    }
  };

  const service = createAuthService({
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
    appPublicUrl: APP_PUBLIC_URL,
    userProfilesRepository: repository,
    userSettingsRepository: null,
    nodeEnv: "test"
  });

  const userAuthHeaders = [];
  let identitiesCalls = 0;

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);

    if (request.url.pathname.includes("/identities")) {
      identitiesCalls += 1;
      throw new Error("Unexpected identities endpoint request.");
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      userAuthHeaders.push(request.headers.Authorization || request.headers.authorization || "");
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        app_metadata: {
          provider: "email",
          providers: ["email", "google"]
        }
      });
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    const result = await service.getSecurityStatus({
      cookies: {
        sb_access_token: "access-token-user-1"
      }
    });

    assert.equal(identitiesCalls, 0);
    assert.ok(userAuthHeaders.length >= 1);
    assert.ok(userAuthHeaders.every((header) => String(header || "").startsWith("Bearer ")));
    assert.equal(Array.isArray(result.authMethods), true);
    assert.equal(
      result.authMethods.some((method) => method.provider === "google" && method.configured === true),
      true
    );
  } finally {
    fetchMock.mock.restore();
  }
});
