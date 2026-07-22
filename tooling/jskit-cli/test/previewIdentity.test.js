import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PREVIEW_IDENTITY_PROTOCOL,
  executeJskitPreviewIdentityRequest
} from "../src/server/commandHandlers/appCommands/previewIdentity.js";

const PREVIEW_IDENTITY_ENV = Object.freeze({
  VIBE64_PREVIEW_IDENTITY_ENABLED: "true",
  VIBE64_PREVIEW_IDENTITY_SECRET: "a".repeat(64)
});

function response(payload = {}, {
  setCookie = [],
  status = 200
} = {}) {
  return {
    headers: {
      getSetCookie() {
        return setCookie;
      }
    },
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function request(overrides = {}) {
  return {
    operation: "login-as",
    protocol: PREVIEW_IDENTITY_PROTOCOL,
    requestId: "request-1",
    subject: {
      identifiers: [
        {
          type: "email",
          value: "ada@example.com"
        }
      ],
      kind: "viewer"
    },
    target: {
      href: "http://127.0.0.1:4100/app",
      origin: "http://127.0.0.1:4100"
    },
    ...overrides
  };
}

test("JSKIT preview identity creates a native session for the viewer email", async () => {
  const calls = [];
  const replies = [
    response({ csrfToken: "csrf-1" }, {
      setCookie: ["csrf=guest; Path=/; HttpOnly"]
    }),
    response({ ok: true }, {
      setCookie: ["access=; Max-Age=0; Path=/", "refresh=; Max-Age=0; Path=/"]
    }),
    response({
      email: "ada@example.com",
      ok: true,
      userId: "42",
      username: "Ada"
    }, {
      setCookie: ["access=native-access; Path=/; HttpOnly", "refresh=native-refresh; Path=/; HttpOnly"]
    })
  ];
  const result = await executeJskitPreviewIdentityRequest(request(), {
    env: PREVIEW_IDENTITY_ENV,
    fetchImpl: async (href, options = {}) => {
      calls.push({ href, options });
      return replies.shift();
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.protocol, PREVIEW_IDENTITY_PROTOCOL);
  assert.equal(result.identity.email, "ada@example.com");
  assert.equal(result.identity.userId, "42");
  assert.equal(result.setCookie.at(-1), "refresh=native-refresh; Path=/; HttpOnly");
  assert.deepEqual(calls.map((entry) => entry.href), [
    "http://127.0.0.1:4100/api/session",
    "http://127.0.0.1:4100/api/logout",
    "http://127.0.0.1:4100/api/dev-auth/login-as"
  ]);
  assert.equal(calls[2].options.headers["x-jskit-dev-auth-secret"], PREVIEW_IDENTITY_ENV.VIBE64_PREVIEW_IDENTITY_SECRET);
  assert.equal(calls[2].options.headers["csrf-token"], "csrf-1");
  assert.match(calls[2].options.headers.cookie, /csrf=guest/u);
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    email: "ada@example.com"
  });
});

test("JSKIT preview identity accepts an explicit existing user ID", async () => {
  const bodies = [];
  const replies = [
    response({ csrfToken: "csrf-2" }),
    response({ ok: true }, { setCookie: ["access=; Max-Age=0; Path=/"] }),
    response({ ok: true, userId: "189", username: "Tony" }, {
      setCookie: ["access=native; Path=/; HttpOnly"]
    })
  ];
  const result = await executeJskitPreviewIdentityRequest(request({
    subject: {
      kind: "selector",
      selector: {
        type: "user-id",
        value: "189"
      }
    }
  }), {
    env: PREVIEW_IDENTITY_ENV,
    fetchImpl: async (_href, options = {}) => {
      if (options.body) {
        bodies.push(JSON.parse(options.body));
      }
      return replies.shift();
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.identity.userId, "189");
  assert.deepEqual(bodies.at(-1), { userId: "189" });
});

test("JSKIT preview identity reports the application's missing-user error", async () => {
  const replies = [
    response({ csrfToken: "csrf-3" }),
    response({ ok: true }, { setCookie: ["access=; Max-Age=0; Path=/"] }),
    response({
      code: "user_not_found",
      message: "User not found."
    }, {
      status: 404
    })
  ];
  const result = await executeJskitPreviewIdentityRequest(request(), {
    env: PREVIEW_IDENTITY_ENV,
    fetchImpl: async () => replies.shift()
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "user_not_found");
  assert.equal(result.error, "User not found.");
  assert.equal(result.signedOut, true);
  assert.equal(result.statusCode, 404);
});

test("JSKIT preview identity logs out through the CSRF-protected application route", async () => {
  const calls = [];
  const replies = [
    response({ csrfToken: "csrf-logout" }, { setCookie: ["csrf=guest; Path=/; HttpOnly"] }),
    response({ ok: true }, { setCookie: ["access=; Max-Age=0; Path=/"] })
  ];
  const result = await executeJskitPreviewIdentityRequest(request({ operation: "logout" }), {
    env: PREVIEW_IDENTITY_ENV,
    fetchImpl: async (href, options = {}) => {
      calls.push({ href, options });
      return replies.shift();
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.signedOut, true);
  assert.equal(result.identity, null);
  assert.deepEqual(calls.map((entry) => entry.href), [
    "http://127.0.0.1:4100/api/session",
    "http://127.0.0.1:4100/api/logout"
  ]);
  assert.equal(calls[1].options.headers["csrf-token"], "csrf-logout");
  assert.match(calls[1].options.headers.cookie, /csrf=guest/u);
});

test("JSKIT preview identity rejects a session response without a CSRF token", async () => {
  let calls = 0;
  const result = await executeJskitPreviewIdentityRequest(request(), {
    env: PREVIEW_IDENTITY_ENV,
    fetchImpl: async () => {
      calls += 1;
      return response({ authenticated: false });
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, "jskit_preview_identity_csrf_missing");
  assert.equal(result.statusCode, 502);
});

for (const targetOrigin of ["https://example.com", "http://127.example.com", "not a URL"]) {
  test(`JSKIT preview identity rejects non-local target ${targetOrigin}`, async () => {
    let called = false;
    const result = await executeJskitPreviewIdentityRequest(request({
      target: {
        origin: targetOrigin
      }
    }), {
      env: PREVIEW_IDENTITY_ENV,
      fetchImpl: async () => {
        called = true;
        return response({ ok: true });
      }
    });

    assert.equal(called, false);
    assert.equal(result.ok, false);
    assert.equal(result.code, "jskit_preview_identity_target_invalid");
  });
}
