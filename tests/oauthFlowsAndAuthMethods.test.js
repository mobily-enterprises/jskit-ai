import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../lib/errors.js";
import { createOauthFlows } from "../services/auth/lib/oauthFlows.js";
import {
  AUTH_METHOD_DEFINITIONS,
  AUTH_METHOD_EMAIL_OTP_ID,
  AUTH_METHOD_IDS,
  AUTH_METHOD_KINDS,
  AUTH_METHOD_PASSWORD_ID,
  buildOAuthMethodId,
  findAuthMethodDefinition,
  parseAuthMethodId
} from "../shared/auth/authMethods.js";

function createOauthFixture(overrides = {}) {
  const calls = {
    ensureConfigured: 0,
    normalizeOAuthProviderInput: [],
    normalizeReturnToPath: [],
    mapAuthError: [],
    setSessionFromRequestCookies: [],
    mapOAuthCallbackError: [],
    mapRecoveryError: [],
    resolveCurrentAuthContext: [],
    buildSecurityStatusFromAuthMethodsStatus: [],
    signInWithOAuth: [],
    linkIdentity: [],
    setSession: [],
    exchangeCodeForSession: [],
    unlinkIdentity: [],
    syncProfileFromSupabaseUser: []
  };

  const auth = {
    async signInWithOAuth(payload) {
      calls.signInWithOAuth.push(payload);
      return {
        data: {
          url: "https://oauth.example/start"
        }
      };
    },
    async linkIdentity(payload) {
      calls.linkIdentity.push(payload);
      return {
        data: {
          url: "https://oauth.example/link"
        }
      };
    },
    async setSession(payload) {
      calls.setSession.push(payload);
      return {
        data: {
          session: {
            access_token: "access-token"
          },
          user: {
            id: "supabase-user-1",
            email: "user@example.com",
            identities: [{ provider: "google", id: "identity-google" }]
          }
        }
      };
    },
    async exchangeCodeForSession(code) {
      calls.exchangeCodeForSession.push(code);
      return {
        data: {
          session: {
            access_token: "access-token"
          },
          user: {
            id: "supabase-user-1",
            email: "user@example.com",
            identities: [{ provider: "google", id: "identity-google" }]
          }
        }
      };
    },
    async unlinkIdentity(identity) {
      calls.unlinkIdentity.push(identity);
      return { error: null };
    }
  };

  if (overrides.supabaseAuth && typeof overrides.supabaseAuth === "object") {
    Object.assign(auth, overrides.supabaseAuth);
  }
  if (Array.isArray(overrides.removeSupabaseAuthMethods)) {
    for (const methodName of overrides.removeSupabaseAuthMethods) {
      delete auth[methodName];
    }
  }

  const supabase = {
    auth
  };

  const authContextQueue =
    Array.isArray(overrides.authContextQueue) && overrides.authContextQueue.length > 0
      ? [...overrides.authContextQueue]
      : [
          {
            user: {
              id: "supabase-user-1",
              email: "user@example.com",
              identities: [{ provider: "google", id: "identity-google" }]
            },
            authMethodsStatus: {
              methods: [
                {
                  id: "oauth:google",
                  provider: "google",
                  configured: true,
                  canDisable: true
                }
              ]
            }
          },
          {
            user: {
              id: "supabase-user-1",
              email: "user@example.com",
              identities: []
            },
            authMethodsStatus: {
              methods: []
            }
          }
        ];

  const deps = {
    ensureConfigured() {
      calls.ensureConfigured += 1;
    },
    normalizeOAuthProviderInput(provider) {
      const normalized =
        String(provider || "")
          .trim()
          .toLowerCase() || "google";
      calls.normalizeOAuthProviderInput.push(normalized);
      return normalized;
    },
    normalizeReturnToPath(value, { fallback }) {
      const resolved = String(value || fallback || "/");
      calls.normalizeReturnToPath.push({
        value,
        fallback,
        resolved
      });
      return resolved;
    },
    buildOAuthLoginRedirectUrl({ appPublicUrl, provider, returnTo }) {
      return `${appPublicUrl}/login?provider=${provider}&returnTo=${encodeURIComponent(returnTo)}`;
    },
    appPublicUrl: "http://localhost:5173",
    authOAuthDefaultProvider: "google",
    getSupabaseClient() {
      return supabase;
    },
    mapAuthError(error, statusCode = 400) {
      calls.mapAuthError.push({ error, statusCode });
      return new AppError(statusCode, `mapped auth error (${statusCode})`);
    },
    async setSessionFromRequestCookies(request, options = {}) {
      calls.setSessionFromRequestCookies.push({
        request,
        options
      });
      if (!options.supabaseClient) {
        throw new Error("Expected per-request supabase client.");
      }
      return {
        data: {
          session: {
            access_token: "access-token"
          }
        }
      };
    },
    buildOAuthLinkRedirectUrl({ appPublicUrl, provider, returnTo }) {
      return `${appPublicUrl}/settings/security?provider=${provider}&returnTo=${encodeURIComponent(returnTo)}`;
    },
    parseOAuthCompletePayload(payload) {
      if (overrides.parsedOAuthPayload) {
        return overrides.parsedOAuthPayload;
      }
      return {
        provider: "google",
        fieldErrors: {},
        errorCode: "",
        errorDescription: "",
        hasSessionPair: false,
        code: String(payload?.code || "oauth-code"),
        accessToken: String(payload?.accessToken || ""),
        refreshToken: String(payload?.refreshToken || "")
      };
    },
    validationError(fieldErrors) {
      return new AppError(400, "Validation failed.", {
        details: {
          fieldErrors
        }
      });
    },
    mapOAuthCallbackError(errorCode, errorDescription) {
      calls.mapOAuthCallbackError.push({ errorCode, errorDescription });
      return new AppError(401, `oauth callback: ${errorCode}`);
    },
    mapRecoveryError(error) {
      calls.mapRecoveryError.push(error);
      return new AppError(401, "Recovery failed.");
    },
    async syncProfileFromSupabaseUser(user, email) {
      calls.syncProfileFromSupabaseUser.push({ user, email });
      return {
        id: Number(user?.id?.replace?.(/\D/g, "") || 1),
        email: String(email || "")
      };
    },
    async resolveCurrentAuthContext(request, options = {}) {
      calls.resolveCurrentAuthContext.push({
        request,
        options
      });
      if (authContextQueue.length > 1) {
        return authContextQueue.shift();
      }
      return authContextQueue[0];
    },
    buildOAuthMethodId: (provider) => `oauth:${provider}`,
    findAuthMethodById(status, methodId) {
      return status?.methods?.find((method) => method.id === methodId) || null;
    },
    findLinkedIdentityByProvider(user, provider) {
      return user?.identities?.find((identity) => identity.provider === provider) || null;
    },
    buildSecurityStatusFromAuthMethodsStatus(status) {
      calls.buildSecurityStatusFromAuthMethodsStatus.push(status);
      return {
        methods: status?.methods || [],
        enabledMethodsCount: (status?.methods || []).length
      };
    }
  };

  const flows = createOauthFlows({
    ...deps,
    ...(overrides.deps || {})
  });

  return {
    flows,
    calls,
    supabase
  };
}

test("auth method helpers normalize ids and lookup definitions", () => {
  assert.equal(AUTH_METHOD_PASSWORD_ID, "password");
  assert.equal(AUTH_METHOD_EMAIL_OTP_ID, "email_otp");
  assert.equal(AUTH_METHOD_KINDS.includes("password"), true);
  assert.equal(AUTH_METHOD_KINDS.includes("otp"), true);
  assert.equal(AUTH_METHOD_KINDS.includes("oauth"), true);

  assert.equal(buildOAuthMethodId("google"), "oauth:google");
  assert.equal(buildOAuthMethodId(" GOOGLE "), "oauth:google");
  assert.equal(buildOAuthMethodId("github"), null);

  assert.deepEqual(parseAuthMethodId("password"), {
    id: "password",
    kind: "password",
    provider: "email"
  });
  assert.deepEqual(parseAuthMethodId("email_otp"), {
    id: "email_otp",
    kind: "otp",
    provider: "email"
  });
  assert.deepEqual(parseAuthMethodId("oauth:google"), {
    id: "oauth:google",
    kind: "oauth",
    provider: "google"
  });
  assert.equal(parseAuthMethodId("oauth:github"), null);
  assert.equal(parseAuthMethodId("unknown"), null);

  const oauthGoogleDefinition = findAuthMethodDefinition("oauth:google");
  assert.equal(oauthGoogleDefinition?.provider, "google");
  assert.equal(oauthGoogleDefinition?.label, "Google");
  assert.equal(oauthGoogleDefinition?.supportsSecretUpdate, false);
  assert.equal(findAuthMethodDefinition("oauth:github"), null);
  assert.equal(findAuthMethodDefinition("nope"), null);

  assert.equal(AUTH_METHOD_IDS.includes("password"), true);
  assert.equal(AUTH_METHOD_IDS.includes("email_otp"), true);
  assert.equal(AUTH_METHOD_DEFINITIONS.length >= 3, true);
});

test("oauthStart handles success and maps start errors", async () => {
  const successFixture = createOauthFixture();
  const success = await successFixture.flows.oauthStart({
    provider: "google",
    returnTo: "/w/acme"
  });
  assert.equal(success.provider, "google");
  assert.equal(success.returnTo, "/w/acme");
  assert.equal(success.url, "https://oauth.example/start");
  assert.equal(successFixture.calls.signInWithOAuth.length, 1);
  assert.deepEqual(successFixture.calls.signInWithOAuth[0].options.queryParams, {
    prompt: "select_account"
  });

  const throwFixture = createOauthFixture({
    supabaseAuth: {
      async signInWithOAuth() {
        throw new Error("network");
      }
    }
  });
  await assert.rejects(
    () => throwFixture.flows.oauthStart({ provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 500;
    }
  );
  assert.equal(throwFixture.calls.mapAuthError[0].statusCode, 500);

  const responseErrorFixture = createOauthFixture({
    supabaseAuth: {
      async signInWithOAuth() {
        return {
          error: {
            message: "bad oauth"
          },
          data: {}
        };
      }
    }
  });
  await assert.rejects(
    () => responseErrorFixture.flows.oauthStart({ provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 400;
    }
  );
  assert.equal(responseErrorFixture.calls.mapAuthError[0].statusCode, 400);
});

test("startProviderLink enforces capability and maps link errors", async () => {
  const unsupportedFixture = createOauthFixture({
    removeSupabaseAuthMethods: ["linkIdentity"]
  });
  await assert.rejects(
    () => unsupportedFixture.flows.startProviderLink({}, { provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 500;
    }
  );

  const successFixture = createOauthFixture();
  const linked = await successFixture.flows.startProviderLink(
    {
      marker: "request-a"
    },
    {
      provider: "google",
      returnTo: "/settings/security"
    }
  );
  assert.equal(linked.provider, "google");
  assert.equal(linked.url, "https://oauth.example/link");
  assert.equal(successFixture.calls.setSessionFromRequestCookies.length, 1);
  assert.equal(successFixture.calls.setSessionFromRequestCookies[0].options.supabaseClient, successFixture.supabase);
  assert.deepEqual(successFixture.calls.linkIdentity[0].options.queryParams, {
    prompt: "select_account"
  });

  const throwFixture = createOauthFixture({
    supabaseAuth: {
      async linkIdentity() {
        throw new Error("timeout");
      }
    }
  });
  await assert.rejects(
    () => throwFixture.flows.startProviderLink({}, { provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 500;
    }
  );
  assert.equal(throwFixture.calls.mapAuthError[0].statusCode, 500);

  const responseErrorFixture = createOauthFixture({
    supabaseAuth: {
      async linkIdentity() {
        return {
          error: {
            message: "invalid state",
            status: 400
          },
          data: {}
        };
      }
    }
  });
  await assert.rejects(
    () => responseErrorFixture.flows.startProviderLink({}, { provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 400;
    }
  );
  assert.equal(responseErrorFixture.calls.mapAuthError[0].statusCode, 400);
});

test("oauthComplete validates callback payload and supports both session recovery paths", async () => {
  const invalidPayloadFixture = createOauthFixture({
    parsedOAuthPayload: {
      provider: "google",
      fieldErrors: {
        code: "OAuth code is required."
      },
      errorCode: "",
      errorDescription: "",
      hasSessionPair: false,
      code: "",
      accessToken: "",
      refreshToken: ""
    }
  });
  await assert.rejects(
    () => invalidPayloadFixture.flows.oauthComplete({}),
    (error) => {
      return error instanceof AppError && error.statusCode === 400;
    }
  );

  const callbackErrorFixture = createOauthFixture({
    parsedOAuthPayload: {
      provider: "google",
      fieldErrors: {},
      errorCode: "access_denied",
      errorDescription: "User denied permissions",
      hasSessionPair: false,
      code: "",
      accessToken: "",
      refreshToken: ""
    }
  });
  await assert.rejects(
    () => callbackErrorFixture.flows.oauthComplete({}),
    (error) => {
      return error instanceof AppError && error.statusCode === 401;
    }
  );
  assert.equal(callbackErrorFixture.calls.mapOAuthCallbackError.length, 1);

  const setSessionFixture = createOauthFixture({
    parsedOAuthPayload: {
      provider: "google",
      fieldErrors: {},
      errorCode: "",
      errorDescription: "",
      hasSessionPair: true,
      code: "",
      accessToken: "access-token",
      refreshToken: "refresh-token"
    }
  });
  const setSessionResult = await setSessionFixture.flows.oauthComplete({});
  assert.equal(setSessionResult.provider, "google");
  assert.equal(setSessionFixture.calls.setSession.length, 1);
  assert.equal(setSessionFixture.calls.exchangeCodeForSession.length, 0);
  assert.equal(setSessionFixture.calls.syncProfileFromSupabaseUser.length, 1);

  const exchangeFixture = createOauthFixture({
    parsedOAuthPayload: {
      provider: "google",
      fieldErrors: {},
      errorCode: "",
      errorDescription: "",
      hasSessionPair: false,
      code: "oauth-code",
      accessToken: "",
      refreshToken: ""
    }
  });
  await exchangeFixture.flows.oauthComplete({});
  assert.equal(exchangeFixture.calls.exchangeCodeForSession[0], "oauth-code");
  assert.equal(exchangeFixture.calls.setSession.length, 0);

  const thrownRecoveryFixture = createOauthFixture({
    parsedOAuthPayload: {
      provider: "google",
      fieldErrors: {},
      errorCode: "",
      errorDescription: "",
      hasSessionPair: false,
      code: "oauth-code",
      accessToken: "",
      refreshToken: ""
    },
    supabaseAuth: {
      async exchangeCodeForSession() {
        throw new Error("exchange failed");
      }
    }
  });
  await assert.rejects(
    () => thrownRecoveryFixture.flows.oauthComplete({}),
    (error) => {
      return error instanceof AppError && error.statusCode === 401;
    }
  );
  assert.equal(thrownRecoveryFixture.calls.mapRecoveryError.length, 1);

  const invalidRecoveryFixture = createOauthFixture({
    parsedOAuthPayload: {
      provider: "google",
      fieldErrors: {},
      errorCode: "",
      errorDescription: "",
      hasSessionPair: false,
      code: "oauth-code",
      accessToken: "",
      refreshToken: ""
    },
    supabaseAuth: {
      async exchangeCodeForSession() {
        return {
          error: null,
          data: {
            session: null,
            user: null
          }
        };
      }
    }
  });
  await assert.rejects(
    () => invalidRecoveryFixture.flows.oauthComplete({}),
    (error) => {
      return error instanceof AppError && error.statusCode === 401;
    }
  );
  assert.equal(invalidRecoveryFixture.calls.mapRecoveryError.length, 1);
});

test("unlinkProvider validates provider state before unlinking", async () => {
  const unsupportedFixture = createOauthFixture({
    removeSupabaseAuthMethods: ["unlinkIdentity"]
  });
  await assert.rejects(
    () => unsupportedFixture.flows.unlinkProvider({}, { provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 500;
    }
  );

  const notLinkedFixture = createOauthFixture({
    authContextQueue: [
      {
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          identities: []
        },
        authMethodsStatus: {
          methods: []
        }
      }
    ]
  });
  await assert.rejects(
    () => notLinkedFixture.flows.unlinkProvider({}, { provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 400;
    }
  );

  const cannotDisableFixture = createOauthFixture({
    authContextQueue: [
      {
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          identities: [{ provider: "google", id: "identity-google" }]
        },
        authMethodsStatus: {
          methods: [
            {
              id: "oauth:google",
              provider: "google",
              configured: true,
              canDisable: false
            }
          ]
        }
      }
    ]
  });
  await assert.rejects(
    () => cannotDisableFixture.flows.unlinkProvider({}, { provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 409;
    }
  );

  const missingIdentityFixture = createOauthFixture({
    authContextQueue: [
      {
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          identities: [{ provider: "github", id: "identity-github" }]
        },
        authMethodsStatus: {
          methods: [
            {
              id: "oauth:google",
              provider: "google",
              configured: true,
              canDisable: true
            }
          ]
        }
      }
    ]
  });
  await assert.rejects(
    () => missingIdentityFixture.flows.unlinkProvider({}, { provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 409;
    }
  );
});

test("unlinkProvider maps supabase unlink failures and returns refreshed security status", async () => {
  const thrownFixture = createOauthFixture({
    supabaseAuth: {
      async unlinkIdentity() {
        throw new Error("unlink failed");
      }
    }
  });
  await assert.rejects(
    () => thrownFixture.flows.unlinkProvider({}, { provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 500;
    }
  );
  assert.equal(thrownFixture.calls.mapAuthError[0].statusCode, 500);

  const responseErrorFixture = createOauthFixture({
    supabaseAuth: {
      async unlinkIdentity() {
        return {
          error: {
            message: "bad request",
            status: 422
          }
        };
      }
    }
  });
  await assert.rejects(
    () => responseErrorFixture.flows.unlinkProvider({}, { provider: "google" }),
    (error) => {
      return error instanceof AppError && error.statusCode === 422;
    }
  );
  assert.equal(responseErrorFixture.calls.mapAuthError[0].statusCode, 422);

  const successFixture = createOauthFixture({
    authContextQueue: [
      {
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          identities: [{ provider: "google", id: "identity-google" }]
        },
        authMethodsStatus: {
          methods: [
            {
              id: "oauth:google",
              provider: "google",
              configured: true,
              canDisable: true
            }
          ]
        }
      },
      {
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          identities: []
        },
        authMethodsStatus: {
          methods: []
        }
      }
    ]
  });
  const unlinked = await successFixture.flows.unlinkProvider(
    {
      marker: "request-x"
    },
    {
      provider: "google"
    }
  );
  assert.equal(successFixture.calls.setSessionFromRequestCookies.length, 1);
  assert.equal(successFixture.calls.resolveCurrentAuthContext.length, 2);
  assert.equal(successFixture.calls.setSessionFromRequestCookies[0].options.supabaseClient, successFixture.supabase);
  assert.equal(successFixture.calls.resolveCurrentAuthContext[0].options.supabaseClient, successFixture.supabase);
  assert.equal(successFixture.calls.resolveCurrentAuthContext[1].options.supabaseClient, successFixture.supabase);
  assert.equal(successFixture.calls.buildSecurityStatusFromAuthMethodsStatus.length, 1);
  assert.deepEqual(unlinked.securityStatus, {
    methods: [],
    enabledMethodsCount: 0
  });
});
