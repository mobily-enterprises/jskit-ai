import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { AppError } from "../lib/errors.js";
import { __testables, createService as createAuthService } from "../server/modules/auth/service.js";

const SUPABASE_URL = "http://supabase.local";
const SUPABASE_PUBLISHABLE_KEY = "pk_test_123";
const APP_PUBLIC_URL = "http://localhost:5173";

let consoleErrorMock = null;
beforeEach(() => {
  consoleErrorMock = mock.method(console, "error", () => undefined);
});

afterEach(() => {
  consoleErrorMock?.mock.restore();
  consoleErrorMock = null;
});

function createUnsignedJwt(payloadOverrides = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "user-1",
    email: "user@example.com",
    iss: `${SUPABASE_URL}/auth/v1`,
    aud: "authenticated",
    role: "authenticated",
    aal: "aal1",
    amr: [{ method: "password", timestamp: nowSeconds }],
    session_id: "session-1",
    is_anonymous: false,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
    ...payloadOverrides
  };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = Buffer.from("sig").toString("base64url");
  return `${header}.${body}.${signature}`;
}

function createProfilesRepository({
  findBySupabaseUserId = async () => null,
  upsert = async (profile) => ({
    id: 1,
    ...profile,
    createdAt: "2024-01-01T00:00:00.000Z"
  })
} = {}) {
  return {
    findBySupabaseUserId,
    upsert
  };
}

function createAuthServiceForTest(options = {}) {
  return createAuthService({
    supabaseUrl: options.supabaseUrl ?? SUPABASE_URL,
    supabasePublishableKey: options.supabasePublishableKey ?? SUPABASE_PUBLISHABLE_KEY,
    appPublicUrl: options.appPublicUrl ?? APP_PUBLIC_URL,
    jwtAudience: options.jwtAudience ?? "authenticated",
    userProfilesRepository: options.userProfilesRepository ?? createProfilesRepository(),
    userSettingsRepository: options.userSettingsRepository ?? null,
    nodeEnv: options.nodeEnv ?? "test"
  });
}

function createSessionCookies({ sub = "supabase-user-1", email = "user@example.com" } = {}) {
  return {
    sb_access_token: createUnsignedJwt({
      sub,
      email
    }),
    sb_refresh_token: "rt"
  };
}

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
  let body = null;
  if (typeof init?.body === "string" && init.body) {
    body = JSON.parse(init.body);
  }

  return {
    url,
    method,
    body,
    headers: init?.headers || {}
  };
}

async function createJwtFixture({ issuer = `${SUPABASE_URL}/auth/v1`, audience = "authenticated" } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "kid-1";
  jwk.alg = "ES256";
  jwk.use = "sig";

  async function sign({
    sub = "supabase-user-1",
    email = "jwt-user@example.com",
    displayName = "jwt-user",
    expiresInSeconds = 3600,
    issuedAt = Math.floor(Date.now() / 1000),
    audienceOverride,
    issuerOverride,
    extraPayload = {}
  } = {}) {
    let jwt = new SignJWT({
      email,
      user_metadata: {
        display_name: displayName
      },
      ...extraPayload
    })
      .setProtectedHeader({ alg: "ES256", kid: "kid-1" })
      .setIssuer(issuerOverride || issuer)
      .setAudience(audienceOverride || audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + expiresInSeconds);

    if (sub != null) {
      jwt = jwt.setSubject(sub);
    }

    return jwt.sign(privateKey);
  }

  return {
    jwks: {
      keys: [jwk]
    },
    sign
  };
}

test("authService helpers cover validation, mapping, URL parsing, and jwt classification", () => {
  const parsed = __testables.validatePasswordRecoveryPayload({
    type: "signup",
    code: "x".repeat(5000),
    tokenHash: "x".repeat(5000),
    accessToken: "a",
    refreshToken: ""
  });
  assert.equal(parsed.hasCode, true);
  assert.equal(parsed.hasTokenHash, true);
  assert.equal(parsed.hasSessionPair, false);
  assert.equal(parsed.fieldErrors.type, "Only recovery password reset links are supported.");
  assert.equal(parsed.fieldErrors.code, "Recovery code is too long.");
  assert.equal(parsed.fieldErrors.tokenHash, "Recovery token is too long.");
  assert.equal(parsed.fieldErrors.refreshToken, "Refresh token is required when an access token is provided.");

  const parsedLongTokens = __testables.validatePasswordRecoveryPayload({
    accessToken: "x".repeat(9000),
    refreshToken: "x".repeat(9000)
  });
  assert.equal(parsedLongTokens.fieldErrors.accessToken, "Access token is too long.");
  assert.equal(parsedLongTokens.fieldErrors.refreshToken, "Refresh token is too long.");

  const parsedMissingAccess = __testables.validatePasswordRecoveryPayload({
    refreshToken: "refresh-only"
  });
  assert.equal(
    parsedMissingAccess.fieldErrors.accessToken,
    "Access token is required when a refresh token is provided."
  );

  const noRecoveryToken = __testables.validatePasswordRecoveryPayload({});
  assert.equal(noRecoveryToken.fieldErrors.recovery, "Recovery token is required.");

  assert.equal(__testables.displayNameFromEmail("alice@example.com"), "alice");
  assert.equal(__testables.displayNameFromEmail(""), "user");
  assert.equal(__testables.resolveDisplayName({ user_metadata: { display_name: "  Bob  " } }, "x@y.z"), "Bob");
  assert.equal(__testables.resolveDisplayName({}, "alice@example.com"), "alice");
  assert.equal(
    __testables.resolveDisplayNameFromClaims({ user_metadata: { display_name: " Claims " } }, "fallback@example.com"),
    "Claims"
  );
  assert.equal(__testables.resolveDisplayNameFromClaims({}, "fallback@example.com"), "fallback");

  assert.equal(__testables.isTransientAuthMessage("socket timeout"), true);
  assert.equal(__testables.isTransientAuthMessage("invalid credentials"), false);
  assert.equal(__testables.isTransientSupabaseError({ status: 503 }), true);
  assert.equal(__testables.isTransientSupabaseError({ message: "Network failure" }), true);
  assert.equal(__testables.isTransientSupabaseError({ status: 401, message: "invalid" }), false);
  assert.equal(__testables.isTransientSupabaseError(null), false);

  assert.equal(__testables.mapAuthError({ message: "already registered" }, 400).status, 409);
  assert.equal(__testables.mapAuthError({ message: "confirm your email" }, 400).status, 403);
  assert.equal(__testables.mapAuthError({ message: "invalid credentials" }, 400).status, 401);
  assert.equal(__testables.mapAuthError({ message: "other error" }, 500).status, 503);
  assert.equal(__testables.mapAuthError({ message: "other error" }, 401).status, 401);
  assert.equal(__testables.mapAuthError({ message: "other error" }, 422).status, 422);
  assert.equal(__testables.mapAuthError(null, undefined).status, 400);

  const validation = __testables.validationError({ email: "bad" });
  assert.ok(validation instanceof AppError);
  assert.equal(validation.status, 400);
  assert.deepEqual(validation.details.fieldErrors, { email: "bad" });

  assert.equal(__testables.mapRecoveryError({ status: 429 }).status, 429);
  assert.equal(__testables.mapRecoveryError({ statusCode: 429 }).status, 429);
  assert.equal(__testables.mapRecoveryError({ status: 503 }).status, 503);
  assert.equal(__testables.mapRecoveryError({ status: 400 }).status, 401);

  assert.equal(__testables.mapPasswordUpdateError({ message: "same password" }).status, 400);
  assert.equal(__testables.mapPasswordUpdateError({ message: "other" }).status, 400);
  assert.equal(__testables.mapPasswordUpdateError(null).status, 400);
  assert.equal(__testables.mapPasswordUpdateError({ status: 503 }).status, 503);
  assert.equal(__testables.mapProfileUpdateError({ status: 503 }).status, 503);
  assert.equal(__testables.mapProfileUpdateError({ status: 400 }).status, 400);
  assert.equal(__testables.mapCurrentPasswordError({ status: 401 }).status, 400);
  assert.equal(__testables.mapCurrentPasswordError({ status: 503 }).status, 503);
  assert.equal(
    __testables.mapCurrentPasswordError({ status: 418 }).details.fieldErrors.currentPassword,
    "Unable to verify current password."
  );

  assert.throws(() => __testables.parseHttpUrl("not-a-url", "APP_PUBLIC_URL"), /valid absolute URL/);
  assert.throws(() => __testables.parseHttpUrl("ftp://localhost", "APP_PUBLIC_URL"), /must start with http/);
  assert.equal(
    __testables.buildPasswordResetRedirectUrl({ appPublicUrl: "http://localhost:5173/app" }),
    "http://localhost:5173/app/reset-password"
  );
  assert.throws(() => __testables.buildPasswordResetRedirectUrl({ appPublicUrl: "" }), /APP_PUBLIC_URL is required/);
  assert.equal(
    __testables.buildOAuthLoginRedirectUrl({ appPublicUrl: "http://localhost:5173/app", provider: "google" }),
    "http://localhost:5173/app/login?oauthProvider=google&oauthIntent=login&oauthReturnTo=%2F"
  );
  assert.throws(() => __testables.buildOAuthLoginRedirectUrl({ appPublicUrl: "", provider: "google" }), /required/);
  assert.throws(
    () => __testables.buildOAuthLoginRedirectUrl({ appPublicUrl: "http://localhost:5173", provider: "x" }),
    /one of/
  );

  const parsedOAuthCode = __testables.parseOAuthCompletePayload({
    provider: "google",
    code: "oauth-code"
  });
  assert.equal(parsedOAuthCode.provider, "google");
  assert.equal(parsedOAuthCode.code, "oauth-code");
  assert.equal(parsedOAuthCode.hasSessionPair, false);
  assert.equal(Object.keys(parsedOAuthCode.fieldErrors).length, 0);

  const parsedOAuthPair = __testables.parseOAuthCompletePayload({
    provider: "google",
    accessToken: "oauth-access",
    refreshToken: "oauth-refresh"
  });
  assert.equal(parsedOAuthPair.hasSessionPair, true);
  assert.equal(parsedOAuthPair.accessToken, "oauth-access");
  assert.equal(parsedOAuthPair.refreshToken, "oauth-refresh");
  assert.equal(Object.keys(parsedOAuthPair.fieldErrors).length, 0);

  const parsedOAuthPairMissing = __testables.parseOAuthCompletePayload({
    provider: "google",
    accessToken: "oauth-access"
  });
  assert.equal(
    parsedOAuthPairMissing.fieldErrors.refreshToken,
    "Refresh token is required when an access token is provided."
  );

  const parsedOAuthMissing = __testables.parseOAuthCompletePayload({
    provider: "google"
  });
  assert.equal(
    parsedOAuthMissing.fieldErrors.code,
    "OAuth code is required when access/refresh tokens are not provided."
  );

  const parsedOAuthSnakeCase = __testables.parseOAuthCompletePayload({
    provider: "google",
    access_token: "oauth-access",
    refresh_token: "oauth-refresh",
    error_description: "oauth-description"
  });
  assert.equal(parsedOAuthSnakeCase.hasSessionPair, false);
  assert.equal(parsedOAuthSnakeCase.errorDescription, "");
  assert.equal(
    parsedOAuthSnakeCase.fieldErrors.code,
    "OAuth code is required when access/refresh tokens are not provided."
  );

  const parsedOtpVerify = __testables.parseOtpLoginVerifyPayload({
    email: "otp@example.com",
    token: "123456",
    type: "email"
  });
  assert.equal(Object.keys(parsedOtpVerify.fieldErrors).length, 0);

  const parsedOtpVerifyHash = __testables.parseOtpLoginVerifyPayload({
    email: "bad-email",
    tokenHash: "token-hash",
    type: "email"
  });
  assert.equal(parsedOtpVerifyHash.fieldErrors.email, undefined);

  const parsedOtpVerifyInvalid = __testables.parseOtpLoginVerifyPayload({
    email: "bad-email",
    type: "sms"
  });
  assert.equal(parsedOtpVerifyInvalid.fieldErrors.type, "Only email OTP verification is supported.");
  assert.equal(parsedOtpVerifyInvalid.fieldErrors.token, "One-time code is required.");

  assert.equal(__testables.mapOAuthCallbackError("access_denied").status, 401);
  assert.equal(
    __testables.mapOAuthCallbackError("server_error", "bad gateway").message,
    "OAuth sign-in failed: bad gateway"
  );
  assert.equal(__testables.mapOAuthCallbackError("server_error").message, "OAuth sign-in failed.");

  const collectedProviderIds = __testables.collectProviderIdsFromSupabaseUser({
    app_metadata: {
      provider: "email",
      providers: ["google", "email", ""]
    },
    identities: [{ provider: "github" }, { provider: "google" }]
  });
  assert.deepEqual([...collectedProviderIds].sort(), ["email", "github", "google"]);

  const authMethodsStatus = __testables.buildAuthMethodsStatusFromProviderIds(["email", "google"], {
    passwordSignInEnabled: false,
    passwordSetupRequired: true
  });
  const passwordMethodFromStatus = __testables.findAuthMethodById(authMethodsStatus, "password");
  assert.equal(passwordMethodFromStatus?.configured, true);
  assert.equal(passwordMethodFromStatus?.enabled, false);
  assert.equal(passwordMethodFromStatus?.canEnable, true);
  assert.equal(passwordMethodFromStatus?.requiresCurrentPassword, false);
  assert.equal(__testables.findAuthMethodById(authMethodsStatus, ""), null);

  const googleMethodFromStatus = authMethodsStatus.methods.find((method) => method.provider === "google");
  assert.equal(googleMethodFromStatus?.configured, true);
  assert.equal(googleMethodFromStatus?.canDisable, true);

  const securityFallback = __testables.buildSecurityStatusFromAuthMethodsStatus({
    methods: [{ enabled: true }, { enabled: false }]
  });
  assert.equal(securityFallback.authPolicy.minimumEnabledMethods, 1);
  assert.equal(securityFallback.authPolicy.enabledMethodsCount, 1);

  const securityExplicit = __testables.buildSecurityStatusFromAuthMethodsStatus({
    minimumEnabledMethods: 2,
    enabledMethodsCount: 4,
    methods: []
  });
  assert.equal(securityExplicit.authPolicy.minimumEnabledMethods, 2);
  assert.equal(securityExplicit.authPolicy.enabledMethodsCount, 4);

  const linkedIdentity = __testables.findLinkedIdentityByProvider(
    {
      identities: [
        { provider: "google", id: "id-google" },
        { provider: "github", id: "id-github" }
      ]
    },
    "google"
  );
  assert.equal(linkedIdentity?.id, "id-google");
  assert.equal(__testables.findLinkedIdentityByProvider({ identities: [] }, "google"), null);

  assert.deepEqual(__testables.safeRequestCookies({ cookies: { a: 1 } }), { a: 1 });
  assert.deepEqual(__testables.safeRequestCookies({ cookies: null }), {});
  assert.deepEqual(__testables.safeRequestCookies(null), {});

  assert.equal(__testables.cookieOptions(false, 10).maxAge, 10);
  assert.equal(__testables.cookieOptions(false, Infinity).maxAge, undefined);
  assert.equal(__testables.cookieOptions(true, 1).secure, true);

  assert.equal(__testables.isExpiredJwtError({ code: "ERR_JWT_EXPIRED" }), true);
  assert.equal(__testables.isExpiredJwtError({ name: "JWTExpired" }), true);
  assert.equal(__testables.isExpiredJwtError({ code: "OTHER" }), false);
  assert.equal(__testables.classifyJwtVerifyError({ code: "ERR_JWT_EXPIRED" }), "expired");
  assert.equal(__testables.classifyJwtVerifyError({ code: "ERR_JWT_INVALID" }), "invalid");
  assert.equal(__testables.classifyJwtVerifyError({ code: "ERR_JWKS_TIMEOUT" }), "transient");
  assert.equal(__testables.classifyJwtVerifyError({ message: "Network timeout" }), "transient");
  assert.equal(__testables.classifyJwtVerifyError({ code: "UNKNOWN" }), "invalid");
});

test("createAuthService validates APP_PUBLIC_URL and supports cookie helpers", () => {
  assert.throws(
    () =>
      createAuthService({
        supabaseUrl: SUPABASE_URL,
        supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
        appPublicUrl: "",
        userProfilesRepository: createProfilesRepository(),
        nodeEnv: "test"
      }),
    /APP_PUBLIC_URL is required/
  );

  assert.throws(
    () =>
      createAuthService({
        supabaseUrl: SUPABASE_URL,
        supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
        appPublicUrl: "invalid-url",
        userProfilesRepository: createProfilesRepository(),
        nodeEnv: "test"
      }),
    /valid absolute URL/
  );

  const service = createAuthServiceForTest();
  const reply = {
    setCalls: [],
    clearCalls: [],
    setCookie(name, value, options) {
      this.setCalls.push({ name, value, options });
    },
    clearCookie(name, options) {
      this.clearCalls.push({ name, options });
    }
  };

  service.writeSessionCookies(reply, null);
  service.writeSessionCookies(reply, {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 120
  });
  service.writeSessionCookies(reply, {
    access_token: "at-2",
    refresh_token: "rt-2",
    expires_in: "not-a-number"
  });
  assert.equal(reply.setCalls.length, 4);
  assert.equal(reply.setCalls[0].name, "sb_access_token");
  assert.equal(reply.setCalls[1].name, "sb_refresh_token");
  assert.equal(reply.setCalls[2].options.maxAge, 3600);

  service.clearSessionCookies(reply);
  assert.equal(reply.clearCalls.length, 2);

  assert.equal(service.hasAccessTokenCookie({ cookies: { sb_access_token: "x" } }), true);
  assert.equal(service.hasAccessTokenCookie({ cookies: {} }), false);
  assert.equal(service.hasAccessTokenCookie({}), false);
});

test("authService register/login/reset/recovery flows and error mapping", async () => {
  const upsertedProfiles = [];
  const repository = createProfilesRepository({
    async findBySupabaseUserId() {
      return null;
    },
    async upsert(profile) {
      upsertedProfiles.push(profile);
      if (profile.email === "conflict@example.com") {
        const error = new Error("conflict");
        error.code = "USER_PROFILE_EMAIL_CONFLICT";
        throw error;
      }
      if (profile.email === "nullprofile@example.com") {
        return null;
      }
      if (profile.email === "blankdisplay@example.com") {
        return {
          id: upsertedProfiles.length,
          ...profile,
          displayName: "   ",
          createdAt: "2024-01-01T00:00:00.000Z"
        };
      }
      if (profile.email === "emptydisplay@example.com") {
        return {
          id: upsertedProfiles.length,
          ...profile,
          displayName: "",
          createdAt: "2024-01-01T00:00:00.000Z"
        };
      }
      return {
        id: upsertedProfiles.length,
        ...profile,
        createdAt: "2024-01-01T00:00:00.000Z"
      };
    }
  });

  const service = createAuthServiceForTest({
    userProfilesRepository: repository
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);

    if (request.url.pathname === "/auth/v1/signup" && request.method === "POST") {
      if (request.body.email === "already@example.com") {
        return jsonResponse(400, { message: "User already registered" });
      }
      if (request.body.email === "nouser@example.com") {
        return jsonResponse(200, { user: 0, session: null });
      }
      if (request.body.email === "missingid@example.com") {
        return jsonResponse(200, {
          user: { id: "", email: "missingid@example.com" },
          session: null
        });
      }
      if (request.body.email === "fallbackemail@example.com") {
        return jsonResponse(200, {
          user: { id: "supabase-fallback-email" },
          session: null
        });
      }
      if (request.body.email === "confirm@example.com") {
        return jsonResponse(200, {
          user: { id: "supabase-confirm", email: "confirm@example.com" },
          session: null
        });
      }
      if (request.body.email === "conflict@example.com") {
        return jsonResponse(200, {
          user: { id: "supabase-conflict", email: "conflict@example.com" },
          session: null
        });
      }
      return jsonResponse(200, {
        access_token: createUnsignedJwt({ sub: "supabase-register", email: request.body.email }),
        refresh_token: "rt-register",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "supabase-register", email: request.body.email },
        session: null
      });
    }

    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "password") {
      if (request.body.email === "invalid@example.com") {
        return jsonResponse(400, { message: "Invalid login credentials" });
      }
      return jsonResponse(200, {
        access_token: createUnsignedJwt({ sub: "supabase-login", email: request.body.email }),
        refresh_token: "rt-login",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "supabase-login", email: request.body.email }
      });
    }

    if (request.url.pathname === "/auth/v1/recover" && request.method === "POST") {
      if (request.body.email === "throw@example.com") {
        throw new Error("network timeout");
      }
      if (request.body.email === "transient@example.com") {
        return jsonResponse(503, { message: "network timeout" });
      }
      return jsonResponse(200, {});
    }

    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "pkce") {
      if (request.body.auth_code === "throwcode") {
        throw new Error("network timeout");
      }
      if (request.body.auth_code === "badcode") {
        return jsonResponse(401, { message: "bad recovery" });
      }
      if (request.body.auth_code === "nosession") {
        return jsonResponse(200, {});
      }
      return jsonResponse(200, {
        access_token: createUnsignedJwt({ sub: "supabase-recovery", email: "recover@example.com" }),
        refresh_token: "rt-recovery",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "supabase-recovery", email: "recover@example.com" }
      });
    }

    if (request.url.pathname === "/auth/v1/verify" && request.method === "POST") {
      if (request.body.token_hash === "bad-hash") {
        return jsonResponse(429, { message: "too many attempts" });
      }
      return jsonResponse(200, {
        access_token: createUnsignedJwt({ sub: "supabase-verify", email: "verify@example.com" }),
        refresh_token: "rt-verify",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "supabase-verify", email: "verify@example.com" }
      });
    }

    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt({ sub: "supabase-reset", email: "reset@example.com" }),
        refresh_token: "rt-reset-next",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "supabase-reset", email: "reset@example.com" }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      if (String(request.headers.Authorization || "").includes("bad-session-token")) {
        return jsonResponse(401, { message: "invalid session" });
      }
      return jsonResponse(200, { id: "supabase-reset", email: "reset@example.com" });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      if (request.body.password === "SamePassword123") {
        return jsonResponse(400, { message: "same password" });
      }
      if (request.body.password === "BrokenPassword123") {
        return jsonResponse(400, { message: "broken password" });
      }
      if (request.body.password === "ThrowUpdatePassword123") {
        return jsonResponse(200, null);
      }
      return jsonResponse(200, { id: "supabase-reset", email: "reset@example.com" });
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    await assert.rejects(() => service.register({ email: "", password: "" }), /Validation failed/);

    await assert.rejects(
      () => service.register({ email: "already@example.com", password: "Password123" }),
      (error) => {
        assert.equal(error.status, 409);
        return true;
      }
    );

    await assert.rejects(
      () => service.register({ email: "nouser@example.com", password: "Password123" }),
      /did not return a user|missing required fields/
    );
    await assert.rejects(
      () => service.register({ email: "missingid@example.com", password: "Password123" }),
      /missing required fields/
    );
    await assert.rejects(
      () => service.register({ email: "nullprofile@example.com", password: "Password123" }),
      /profile synchronization failed/
    );
    await assert.rejects(
      () => service.register({ email: "blankdisplay@example.com", password: "Password123" }),
      /profile synchronization failed/
    );
    await assert.rejects(
      () => service.register({ email: "emptydisplay@example.com", password: "Password123" }),
      /profile synchronization failed/
    );

    const fallbackEmailRegister = await service.register({
      email: "fallbackemail@example.com",
      password: "Password123"
    });
    assert.equal(fallbackEmailRegister.profile.email, "fallbackemail@example.com");
    const confirm = await service.register({ email: "confirm@example.com", password: "Password123" });
    assert.equal(confirm.requiresEmailConfirmation, true);
    assert.equal(confirm.email, "confirm@example.com");
    assert.equal(confirm.profile.email, "confirm@example.com");

    await assert.rejects(
      () => service.register({ email: "conflict@example.com", password: "Password123" }),
      /already registered with another sign-in method/
    );

    const registered = await service.register({ email: "ok@example.com", password: "Password123" });
    assert.equal(registered.requiresEmailConfirmation, false);
    assert.equal(registered.profile.email, "ok@example.com");
    assert.ok(registered.session.access_token);

    await assert.rejects(() => service.login({ email: "", password: "" }), /Validation failed/);
    await assert.rejects(
      () => service.login({ email: "invalid@example.com", password: "Password123" }),
      (error) => {
        assert.equal(error.status, 401);
        return true;
      }
    );

    const login = await service.login({ email: "login@example.com", password: "Password123" });
    assert.equal(login.profile.email, "login@example.com");
    assert.ok(login.session.access_token);

    await assert.rejects(() => service.requestPasswordReset({ email: "" }), /Validation failed/);
    await assert.rejects(
      () => service.requestPasswordReset({ email: "transient@example.com" }),
      (error) => {
        assert.equal(error.status, 503);
        return true;
      }
    );

    const forgot = await service.requestPasswordReset({ email: "forgot@example.com" });
    assert.equal(forgot.ok, true);
    await assert.rejects(
      () => service.requestPasswordReset({ email: "throw@example.com" }),
      (error) => {
        assert.equal(error.status, 503);
        return true;
      }
    );

    await assert.rejects(() => service.completePasswordRecovery({}), /Validation failed/);
    await assert.rejects(
      () => service.completePasswordRecovery({ code: "badcode" }),
      (error) => {
        assert.equal(error.status, 401);
        return true;
      }
    );
    await assert.rejects(
      () =>
        createAuthServiceForTest({
          userProfilesRepository: repository
        }).completePasswordRecovery({ code: "nosession" }),
      (error) => {
        assert.equal(error.status, 503);
        return true;
      }
    );
    await assert.rejects(
      () => service.completePasswordRecovery({ tokenHash: "bad-hash" }),
      (error) => {
        assert.equal(error.status, 429);
        return true;
      }
    );

    const byCode = await service.completePasswordRecovery({ code: "goodcode" });
    assert.equal(byCode.profile.email, "recover@example.com");
    assert.ok(byCode.session.access_token);

    const byHash = await service.completePasswordRecovery({ tokenHash: "good-hash" });
    assert.equal(byHash.profile.email, "verify@example.com");
    assert.ok(byHash.session.access_token);

    const byPair = await service.completePasswordRecovery({
      accessToken: createUnsignedJwt({ sub: "supabase-pair", email: "pair@example.com" }),
      refreshToken: "rt-pair"
    });
    assert.equal(byPair.profile.email, "reset@example.com");
    assert.ok(byPair.session.access_token);

    await assert.rejects(() => service.resetPassword({}, { password: "Password123" }), /Authentication required/);
    await assert.rejects(
      () =>
        service.resetPassword(
          {
            cookies: {
              sb_access_token: createUnsignedJwt({ sub: "supabase-reset", email: "reset@example.com" }),
              sb_refresh_token: "rt"
            }
          },
          { password: "short" }
        ),
      /Validation failed/
    );

    await assert.rejects(
      () =>
        createAuthServiceForTest({
          userProfilesRepository: repository
        }).resetPassword(
          {
            cookies: {
              sb_access_token: "bad-session-token",
              sb_refresh_token: "rt"
            }
          },
          { password: "Password123" }
        ),
      /Recovery link is invalid or has expired/
    );

    await assert.rejects(
      () =>
        createAuthServiceForTest({
          userProfilesRepository: repository
        }).resetPassword(
          {
            cookies: {
              sb_access_token: createUnsignedJwt({ sub: "supabase-reset", email: "reset@example.com" }),
              sb_refresh_token: "rt"
            }
          },
          { password: "SamePassword123" }
        ),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.details.fieldErrors.password, "New password must be different from the current password.");
        return true;
      }
    );

    await assert.rejects(
      () =>
        createAuthServiceForTest({
          userProfilesRepository: repository
        }).resetPassword(
          {
            cookies: {
              sb_access_token: createUnsignedJwt({ sub: "supabase-reset", email: "reset@example.com" }),
              sb_refresh_token: "rt"
            }
          },
          { password: "ThrowUpdatePassword123" }
        ),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.details.fieldErrors.password, "Unable to update password with the provided value.");
        return true;
      }
    );

    await assert.rejects(
      () =>
        createAuthServiceForTest({
          userProfilesRepository: repository
        }).resetPassword(
          {
            cookies: {
              sb_access_token: createUnsignedJwt({ sub: "supabase-reset", email: "reset@example.com" }),
              sb_refresh_token: "rt"
            }
          },
          { password: "BrokenPassword123" }
        ),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.details.fieldErrors.password, "Unable to update password with the provided value.");
        return true;
      }
    );

    await createAuthServiceForTest({
      userProfilesRepository: repository
    }).resetPassword(
      {
        cookies: {
          sb_access_token: createUnsignedJwt({ sub: "supabase-reset", email: "reset@example.com" }),
          sb_refresh_token: "rt"
        }
      },
      { password: "NewPassword123" }
    );

    assert.ok(upsertedProfiles.length > 0);
  } finally {
    fetchMock.mock.restore();
  }
});

test("authenticateRequest handles jwt verify, supabase fallback, and refresh branches", async () => {
  const jwtFixture = await createJwtFixture();

  const profiles = new Map([
    [
      "supabase-user-existing",
      {
        id: 9,
        supabaseUserId: "supabase-user-existing",
        email: "existing@example.com",
        displayName: "existing",
        createdAt: "2024-01-01T00:00:00.000Z"
      }
    ],
    [
      "supabase-user-same",
      {
        id: 10,
        supabaseUserId: "supabase-user-same",
        email: "same@example.com",
        displayName: "same-user",
        createdAt: "2024-01-01T00:00:00.000Z"
      }
    ],
    [
      "supabase-user-changed",
      {
        id: 11,
        supabaseUserId: "supabase-user-changed",
        email: "old@example.com",
        displayName: "old-name",
        createdAt: "2024-01-01T00:00:00.000Z"
      }
    ]
  ]);

  const repository = createProfilesRepository({
    async findBySupabaseUserId(supabaseUserId) {
      return profiles.get(supabaseUserId) || null;
    },
    async upsert(profile) {
      if (profile.email === "dup@example.com") {
        const error = new Error("dup");
        error.code = "USER_PROFILE_EMAIL_CONFLICT";
        throw error;
      }
      if (profile.email === "upsert-error@example.com") {
        throw new Error("db write failed");
      }
      if (profile.email === "invalid-sync@example.com") {
        return {
          id: "not-a-number",
          ...profile,
          displayName: "",
          createdAt: "2024-01-01T00:00:00.000Z"
        };
      }
      const result = {
        id: profiles.size + 1,
        ...profile,
        createdAt: "2024-01-01T00:00:00.000Z"
      };
      profiles.set(profile.supabaseUserId, result);
      return result;
    }
  });

  const service = createAuthServiceForTest({
    userProfilesRepository: repository
  });

  const validToken = await jwtFixture.sign({
    sub: "supabase-user-valid",
    email: "valid@example.com",
    displayName: "valid-user"
  });
  const expiredToken = await jwtFixture.sign({
    sub: "supabase-user-expired",
    email: "expired@example.com",
    displayName: "expired-user",
    expiresInSeconds: -60,
    issuedAt: Math.floor(Date.now() / 1000) - 120
  });
  const noEmailExistingToken = await jwtFixture.sign({
    sub: "supabase-user-existing",
    email: "placeholder@example.com",
    extraPayload: { email: undefined, user_metadata: {} }
  });
  const noEmailNewToken = await jwtFixture.sign({
    sub: "supabase-user-no-email",
    email: "placeholder@example.com",
    extraPayload: { email: undefined, user_metadata: {} }
  });
  const noSubjectToken = await jwtFixture.sign({
    sub: null
  });
  const wrongAudienceToken = await jwtFixture.sign({
    sub: "supabase-user-wrong-aud",
    audienceOverride: "other-audience"
  });
  const sameProfileToken = await jwtFixture.sign({
    sub: "supabase-user-same",
    email: "same@example.com",
    displayName: "same-user"
  });
  const changedProfileToken = await jwtFixture.sign({
    sub: "supabase-user-changed",
    email: "changed@example.com",
    displayName: "changed-name"
  });
  const invalidSyncToken = await jwtFixture.sign({
    sub: "supabase-user-invalid-sync",
    email: "invalid-sync@example.com",
    displayName: "invalid"
  });
  const upsertErrorToken = await jwtFixture.sign({
    sub: "supabase-user-upsert-error",
    email: "upsert-error@example.com",
    displayName: "upsert-error"
  });
  const fallbackNoUserToken = await jwtFixture.sign({
    sub: "supabase-user-fallback-no-user",
    audienceOverride: "other-audience"
  });
  const fallbackThrowToken = await jwtFixture.sign({
    sub: "supabase-user-fallback-throw",
    audienceOverride: "other-audience"
  });
  const fallbackSyncTransientToken = await jwtFixture.sign({
    sub: "supabase-user-fallback-sync-transient",
    audienceOverride: "other-audience"
  });
  const fallbackSyncInvalidToken = await jwtFixture.sign({
    sub: "supabase-user-fallback-sync-invalid",
    audienceOverride: "other-audience"
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);

    if (request.url.pathname === "/auth/v1/.well-known/jwks.json") {
      if (request.url.searchParams.get("mode") === "timeout") {
        throw new Error("network timeout");
      }
      return jsonResponse(200, jwtFixture.jwks);
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      const authHeader = String(request.headers.Authorization || "");
      if (authHeader === `Bearer ${fallbackNoUserToken}`) {
        return jsonResponse(200, false);
      }
      if (authHeader === `Bearer ${fallbackThrowToken}`) {
        throw new Error("getUser exploded");
      }
      if (authHeader === `Bearer ${fallbackSyncTransientToken}`) {
        return jsonResponse(200, { id: "", email: "sync-transient@example.com" });
      }
      if (authHeader === `Bearer ${fallbackSyncInvalidToken}`) {
        return jsonResponse(200, {
          id: "supabase-user-fallback-sync-invalid",
          email: "upsert-error@example.com"
        });
      }
      if (authHeader.includes("fallback-valid")) {
        return jsonResponse(200, {
          id: "supabase-fallback-valid",
          email: "fallback@example.com"
        });
      }
      if (authHeader.includes("fallback-transient")) {
        return jsonResponse(503, { message: "network timeout" });
      }
      return jsonResponse(401, { message: "invalid token" });
    }

    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      if (request.body.refresh_token === "rt-invalid") {
        return jsonResponse(401, { message: "invalid refresh token" });
      }
      if (request.body.refresh_token === "rt-missing-data") {
        return jsonResponse(200, {});
      }
      if (request.body.refresh_token === "rt-transient") {
        return jsonResponse(400, { message: "network timeout" });
      }
      if (request.body.refresh_token === "rt-no-user") {
        return jsonResponse(200, {
          access_token: createUnsignedJwt({ sub: "supabase-refresh", email: "refresh@example.com" }),
          refresh_token: "rt-next",
          expires_in: 3600,
          token_type: "bearer"
        });
      }
      return jsonResponse(200, {
        access_token: createUnsignedJwt({ sub: "supabase-refresh", email: "refresh@example.com" }),
        refresh_token: "rt-next",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-refresh",
          email: "refresh@example.com"
        }
      });
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    const noToken = await service.authenticateRequest({ cookies: {} });
    assert.deepEqual(noToken, {
      authenticated: false,
      clearSession: false,
      session: null,
      transientFailure: false
    });

    const valid = await service.authenticateRequest({
      cookies: {
        sb_access_token: validToken
      }
    });
    assert.equal(valid.authenticated, true);
    assert.equal(valid.profile.email, "valid@example.com");

    const noEmailExisting = await service.authenticateRequest({
      cookies: {
        sb_access_token: noEmailExistingToken
      }
    });
    assert.equal(noEmailExisting.authenticated, true);
    assert.equal(noEmailExisting.profile.email, "existing@example.com");

    const sameProfile = await service.authenticateRequest({
      cookies: {
        sb_access_token: sameProfileToken
      }
    });
    assert.equal(sameProfile.authenticated, true);
    assert.equal(sameProfile.profile.email, "same@example.com");

    const changedProfile = await service.authenticateRequest({
      cookies: {
        sb_access_token: changedProfileToken
      }
    });
    assert.equal(changedProfile.authenticated, true);
    assert.equal(changedProfile.profile.email, "changed@example.com");

    await assert.rejects(
      () =>
        service.authenticateRequest({
          cookies: {
            sb_access_token: noEmailNewToken
          }
        }),
      /Token is missing email claim/
    );

    await assert.rejects(
      () =>
        service.authenticateRequest({
          cookies: {
            sb_access_token: noSubjectToken
          }
        }),
      /Token is missing subject claim/
    );

    await assert.rejects(
      () =>
        service.authenticateRequest({
          cookies: {
            sb_access_token: invalidSyncToken
          }
        }),
      /profile synchronization failed/
    );

    await assert.rejects(
      () =>
        service.authenticateRequest({
          cookies: {
            sb_access_token: upsertErrorToken
          }
        }),
      /db write failed/
    );

    const invalidFallbackValid = await service.authenticateRequest({
      cookies: {
        sb_access_token: "fallback-valid",
        sb_refresh_token: "rt"
      }
    });
    assert.equal(invalidFallbackValid.authenticated, true);
    assert.equal(invalidFallbackValid.profile.email, "fallback@example.com");

    const invalidFallbackTransient = await service.authenticateRequest({
      cookies: {
        sb_access_token: "fallback-transient",
        sb_refresh_token: "rt"
      }
    });

    const invalidFallbackNoUser = await service.authenticateRequest({
      cookies: {
        sb_access_token: fallbackNoUserToken
      }
    });
    assert.deepEqual(invalidFallbackNoUser, {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    });

    const invalidFallbackThrown = await service.authenticateRequest({
      cookies: {
        sb_access_token: fallbackThrowToken
      }
    });
    assert.deepEqual(invalidFallbackThrown, {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    });
    const invalidFallbackSyncTransient = await service.authenticateRequest({
      cookies: {
        sb_access_token: fallbackSyncTransientToken
      }
    });
    assert.deepEqual(invalidFallbackSyncTransient, {
      authenticated: false,
      clearSession: false,
      session: null,
      transientFailure: true
    });
    const invalidFallbackSyncInvalid = await service.authenticateRequest({
      cookies: {
        sb_access_token: fallbackSyncInvalidToken
      }
    });
    assert.deepEqual(invalidFallbackSyncInvalid, {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    });
    assert.deepEqual(invalidFallbackTransient, {
      authenticated: false,
      clearSession: false,
      session: null,
      transientFailure: true
    });

    const invalidNoRefresh = await service.authenticateRequest({
      cookies: {
        sb_access_token: "invalid-without-refresh"
      }
    });
    assert.deepEqual(invalidNoRefresh, {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    });

    const expiredNoRefresh = await service.authenticateRequest({
      cookies: {
        sb_access_token: expiredToken
      }
    });
    assert.deepEqual(expiredNoRefresh, {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    });

    const refreshInvalid = await service.authenticateRequest({
      cookies: {
        sb_access_token: expiredToken,
        sb_refresh_token: "rt-invalid"
      }
    });
    assert.deepEqual(refreshInvalid, {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    });

    const refreshMissingData = await service.authenticateRequest({
      cookies: {
        sb_access_token: expiredToken,
        sb_refresh_token: "rt-missing-data"
      }
    });
    assert.deepEqual(refreshMissingData, {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    });
    const refreshTransient = await service.authenticateRequest({
      cookies: {
        sb_access_token: expiredToken,
        sb_refresh_token: "rt-transient"
      }
    });
    assert.deepEqual(refreshTransient, {
      authenticated: false,
      clearSession: false,
      session: null,
      transientFailure: true
    });

    const refreshNoUser = await service.authenticateRequest({
      cookies: {
        sb_access_token: expiredToken,
        sb_refresh_token: "rt-no-user"
      }
    });
    assert.deepEqual(refreshNoUser, {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    });

    const refreshSuccess = await service.authenticateRequest({
      cookies: {
        sb_access_token: expiredToken,
        sb_refresh_token: "rt-success"
      }
    });
    assert.equal(refreshSuccess.authenticated, true);
    assert.ok(refreshSuccess.session);
    assert.equal(refreshSuccess.profile.email, "refresh@example.com");

    const wrongAudience = await service.authenticateRequest({
      cookies: {
        sb_access_token: wrongAudienceToken,
        sb_refresh_token: "rt-invalid"
      }
    });
    assert.equal(wrongAudience.authenticated, false);
  } finally {
    fetchMock.mock.restore();
  }
});

test("authService ensureConfigured guard applies to methods", async () => {
  const service = createAuthServiceForTest({
    supabaseUrl: "",
    supabasePublishableKey: "",
    appPublicUrl: APP_PUBLIC_URL
  });

  await assert.rejects(() => service.register({ email: "a@example.com", password: "Password123" }), /not configured/);
  await assert.rejects(() => service.login({ email: "a@example.com", password: "Password123" }), /not configured/);
  await assert.rejects(() => service.requestPasswordReset({ email: "a@example.com" }), /not configured/);
  await assert.rejects(() => service.completePasswordRecovery({ code: "abc" }), /not configured/);
  await assert.rejects(
    () =>
      service.resetPassword({ cookies: { sb_access_token: "a", sb_refresh_token: "b" } }, { password: "Password123" }),
    /not configured/
  );
  await assert.rejects(
    () => service.updateDisplayName({ cookies: { sb_access_token: "a", sb_refresh_token: "b" } }, "name"),
    /not configured/
  );
  await assert.rejects(
    () =>
      service.changePassword(
        { cookies: { sb_access_token: "a", sb_refresh_token: "b" } },
        { currentPassword: "old-password", newPassword: "new-password-123" }
      ),
    /not configured/
  );
  await assert.rejects(
    () => service.signOutOtherSessions({ cookies: { sb_access_token: "a", sb_refresh_token: "b" } }),
    /not configured/
  );
  await assert.rejects(() => service.authenticateRequest({ cookies: { sb_access_token: "a" } }), /not configured/);
  await assert.rejects(() => service.getSecurityStatus({}), /not configured/);
  await assert.doesNotReject(() => service.getSecurityStatus());
});

test("completePasswordRecovery maps thrown exchange errors to transient auth errors", async () => {
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository()
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "pkce") {
      throw new Error("network timeout");
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    await assert.rejects(
      () => service.completePasswordRecovery({ code: "throwcode" }),
      (error) => {
        assert.equal(error.status, 503);
        return true;
      }
    );
  } finally {
    fetchMock.mock.restore();
  }
});

test("authenticateRequest returns transient failure when jwks fetch is transiently unavailable", async () => {
  const jwtFixture = await createJwtFixture();
  const token = await jwtFixture.sign({
    sub: "supabase-user-transient",
    email: "transient@example.com",
    displayName: "transient-user"
  });

  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository()
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/auth/v1/.well-known/jwks.json") {
      throw new Error("network timeout while loading jwks");
    }

    throw new Error(`Unexpected fetch call: ${url.toString()}`);
  });

  try {
    const result = await service.authenticateRequest({
      cookies: {
        sb_access_token: token
      }
    });

    assert.deepEqual(result, {
      authenticated: false,
      clearSession: false,
      session: null,
      transientFailure: true
    });
  } finally {
    fetchMock.mock.restore();
  }
});

test("authService supports profile update, password change, and sign-out-other-sessions flows", async () => {
  const upsertedProfiles = [];
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository({
      async upsert(profile) {
        upsertedProfiles.push(profile);
        return {
          id: 7,
          ...profile,
          createdAt: "2024-01-01T00:00:00.000Z"
        };
      }
    })
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);

    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt({
          sub: "supabase-user-1",
          email: "user@example.com"
        }),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          user_metadata: {
            display_name: "seed-user"
          }
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      if (request.body?.data?.display_name) {
        return jsonResponse(200, {
          user: {
            id: "supabase-user-1",
            email: "user@example.com",
            user_metadata: {
              display_name: request.body.data.display_name
            }
          }
        });
      }

      if (request.body?.password) {
        return jsonResponse(200, {
          user: {
            id: "supabase-user-1",
            email: "user@example.com",
            user_metadata: {
              display_name: "updated-user"
            }
          }
        });
      }
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }

    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "password") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt({
          sub: "supabase-user-1",
          email: "user@example.com"
        }),
        refresh_token: "verified-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          user_metadata: {
            display_name: "updated-user"
          }
        }
      });
    }

    if (request.url.pathname === "/auth/v1/logout") {
      return jsonResponse(200, {});
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    const profileResult = await service.updateDisplayName(
      {
        cookies: {
          sb_access_token: createUnsignedJwt({
            sub: "supabase-user-1",
            email: "user@example.com"
          }),
          sb_refresh_token: "rt"
        }
      },
      "new-display-name"
    );

    assert.equal(profileResult.profile.displayName, "new-display-name");

    const passwordResult = await service.changePassword(
      {
        cookies: {
          sb_access_token: createUnsignedJwt({
            sub: "supabase-user-1",
            email: "user@example.com"
          }),
          sb_refresh_token: "rt"
        }
      },
      {
        currentPassword: "old-password",
        newPassword: "new-password-123"
      }
    );
    assert.equal(passwordResult.profile.email, "user@example.com");

    await assert.doesNotReject(() =>
      service.signOutOtherSessions({
        cookies: {
          sb_access_token: createUnsignedJwt({
            sub: "supabase-user-1",
            email: "user@example.com"
          }),
          sb_refresh_token: "rt"
        }
      })
    );

    const security = await service.getSecurityStatus();
    assert.equal(security.mfa.status, "not_enabled");
    assert.ok(upsertedProfiles.length >= 2);
  } finally {
    fetchMock.mock.restore();
  }
});

test("authService maps profile/password/session-management errors", async () => {
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository()
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);

    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(401, {
        error: "invalid_grant",
        error_description: "Invalid refresh token"
      });
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    await assert.rejects(
      () =>
        service.updateDisplayName(
          {
            cookies: {
              sb_access_token: "at",
              sb_refresh_token: "rt"
            }
          },
          "name"
        ),
      (error) => {
        assert.equal(error.status, 401);
        return true;
      }
    );

    await assert.rejects(
      () =>
        service.changePassword(
          {
            cookies: {
              sb_access_token: "at",
              sb_refresh_token: "rt"
            }
          },
          {
            currentPassword: "old-password",
            newPassword: "new-password-123"
          }
        ),
      (error) => {
        assert.equal(error.status, 401);
        return true;
      }
    );

    await assert.rejects(
      () =>
        service.signOutOtherSessions({
          cookies: {
            sb_access_token: "at",
            sb_refresh_token: "rt"
          }
        }),
      (error) => {
        assert.equal(error.status, 401);
        return true;
      }
    );
  } finally {
    fetchMock.mock.restore();
  }
});

test("authService updateDisplayName covers validation, session, and update error branches", async () => {
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository()
  });

  await assert.rejects(
    () => service.updateDisplayName({ cookies: {} }, " "),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.fieldErrors.displayName, "Display name is required.");
      return true;
    }
  );
  await assert.rejects(
    () => service.updateDisplayName({ cookies: {} }, undefined),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.fieldErrors.displayName, "Display name is required.");
      return true;
    }
  );

  const setSessionThrowFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          user_metadata: {
            display_name: "seed-user"
          }
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, null);
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () => service.updateDisplayName({ cookies: createSessionCookies() }, "display-name"),
      (error) => {
        assert.equal(error.status, 401);
        return true;
      }
    );
  } finally {
    setSessionThrowFetch.mock.restore();
  }

  const setSessionUserFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          user_metadata: {
            display_name: "seed-user"
          }
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(500, {
        message: "fetch user failed"
      });
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () => service.updateDisplayName({ cookies: createSessionCookies() }, "display-name"),
      (error) => {
        assert.equal(error.status, 503);
        return true;
      }
    );
  } finally {
    setSessionUserFetch.mock.restore();
  }

  const updateThrowFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          user_metadata: {
            display_name: "seed-user"
          }
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      return jsonResponse(200, null);
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () => service.updateDisplayName({ cookies: createSessionCookies() }, "display-name"),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.details.fieldErrors.displayName, "Unable to update profile details.");
        return true;
      }
    );
  } finally {
    updateThrowFetch.mock.restore();
  }

  const updateErrorFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          user_metadata: {
            display_name: "seed-user"
          }
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      return jsonResponse(400, {
        message: "failed to update profile"
      });
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () => service.updateDisplayName({ cookies: createSessionCookies() }, "display-name"),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.details.fieldErrors.displayName, "Unable to update profile details.");
        return true;
      }
    );
  } finally {
    updateErrorFetch.mock.restore();
  }

  const updateWithSessionFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          user_metadata: {
            display_name: "seed-user"
          }
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      return jsonResponse(200, {
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          user_metadata: {
            display_name: "updated-name"
          }
        },
        session: {
          access_token: "updated-access",
          refresh_token: "updated-refresh",
          expires_in: 3600,
          token_type: "bearer"
        }
      });
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    const result = await service.updateDisplayName({ cookies: createSessionCookies() }, "updated-name");
    assert.equal(result.profile.displayName, "updated-name");
    assert.ok(result.session?.access_token);
  } finally {
    updateWithSessionFetch.mock.restore();
  }
});

test("authService changePassword covers verification, update, and session fallback branches", async () => {
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository()
  });

  const missingEmailFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () => service.changePassword({ cookies: createSessionCookies() }, undefined),
      /Authenticated user email could not be resolved/
    );
  } finally {
    missingEmailFetch.mock.restore();
  }

  const verifyThrowFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "password") {
      return jsonResponse(200, null);
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () =>
        service.changePassword(
          { cookies: createSessionCookies() },
          {
            currentPassword: "old-password",
            newPassword: "new-password-123"
          }
        ),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.details.fieldErrors.currentPassword, "Unable to verify current password.");
        return true;
      }
    );
  } finally {
    verifyThrowFetch.mock.restore();
  }

  const verifyErrorFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "password") {
      return jsonResponse(401, {
        message: "Invalid current password"
      });
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () =>
        service.changePassword(
          { cookies: createSessionCookies() },
          {
            currentPassword: "old-password",
            newPassword: "new-password-123"
          }
        ),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.details.fieldErrors.currentPassword, "Current password is incorrect.");
        return true;
      }
    );
  } finally {
    verifyErrorFetch.mock.restore();
  }

  const updateThrowFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "password") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "verify-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      return jsonResponse(200, null);
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () =>
        service.changePassword(
          { cookies: createSessionCookies() },
          {
            currentPassword: "old-password",
            newPassword: "new-password-123"
          }
        ),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.details.fieldErrors.password, "Unable to update password with the provided value.");
        return true;
      }
    );
  } finally {
    updateThrowFetch.mock.restore();
  }

  const updateErrorFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "password") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "verify-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      return jsonResponse(400, {
        message: "update failed"
      });
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () =>
        service.changePassword(
          { cookies: createSessionCookies() },
          {
            currentPassword: "old-password",
            newPassword: "new-password-123"
          }
        ),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.details.fieldErrors.password, "Unable to update password with the provided value.");
        return true;
      }
    );
  } finally {
    updateErrorFetch.mock.restore();
  }

  const updateSuccessFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "password") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "verify-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      return jsonResponse(200, {
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          user_metadata: {
            display_name: "updated-user"
          }
        },
        session: {
          access_token: "updated-password-access",
          refresh_token: "updated-password-refresh",
          expires_in: 3600,
          token_type: "bearer"
        }
      });
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    const result = await service.changePassword(
      { cookies: createSessionCookies() },
      {
        currentPassword: "old-password",
        newPassword: "new-password-123"
      }
    );
    assert.equal(result.profile.email, "user@example.com");
    assert.ok(result.session?.access_token);
  } finally {
    updateSuccessFetch.mock.restore();
  }
});

test("authService signOutOtherSessions covers thrown and response error branches", async () => {
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository()
  });

  const signOutThrowFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/logout") {
      throw new Error("logout exploded");
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () => service.signOutOtherSessions({ cookies: createSessionCookies() }),
      (error) => {
        assert.equal(error.status, 400);
        return true;
      }
    );
  } finally {
    signOutThrowFetch.mock.restore();
  }

  const signOutErrorFetch = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt(),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/logout") {
      return jsonResponse(500, {
        message: "session invalid"
      });
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });
  try {
    await assert.rejects(
      () => service.signOutOtherSessions({ cookies: createSessionCookies() }),
      (error) => {
        assert.equal(error.status, 503);
        return true;
      }
    );
  } finally {
    signOutErrorFetch.mock.restore();
  }
});

test("authService oauthComplete accepts OAuth hash token pairs", async () => {
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository()
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt({ sub: "supabase-oauth", email: "oauth@example.com" }),
        refresh_token: "oauth-refresh-next",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-oauth",
          email: "oauth@example.com"
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-oauth",
        email: "oauth@example.com",
        user_metadata: {
          display_name: "oauth-user"
        }
      });
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    const result = await service.oauthComplete({
      provider: "google",
      accessToken: createUnsignedJwt({ sub: "supabase-oauth", email: "oauth@example.com" }),
      refreshToken: "oauth-refresh"
    });
    assert.equal(result.provider, "google");
    assert.equal(result.profile.email, "oauth@example.com");
    assert.ok(result.session?.access_token);
  } finally {
    fetchMock.mock.restore();
  }
});

test("authService setPasswordSignInEnabled disables even when password rotation is rejected", async () => {
  const updateCalls = [];
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository(),
    userSettingsRepository: {
      async ensureForUserId() {
        return {
          passwordSignInEnabled: true,
          passwordSetupRequired: false
        };
      },
      async updatePasswordSignInEnabled(userId, enabled, options = {}) {
        updateCalls.push([userId, enabled, options]);
        return {
          passwordSignInEnabled: enabled,
          passwordSetupRequired: options.passwordSetupRequired === true
        };
      }
    }
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);

    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt({
          sub: "supabase-user-1",
          email: "user@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email", "google"]
          }
        }),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-1",
          email: "user@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email", "google"]
          }
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-1",
        email: "user@example.com",
        app_metadata: {
          provider: "email",
          providers: ["email", "google"]
        },
        user_metadata: {
          display_name: "seed-user"
        }
      });
    }

    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      return jsonResponse(400, {
        message: "Requires recent reauthentication"
      });
    }

    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    const result = await service.setPasswordSignInEnabled(
      { cookies: createSessionCookies() },
      {
        enabled: false
      }
    );

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0][1], false);
    assert.equal(updateCalls[0][2].passwordSetupRequired, true);
    const passwordMethod = result.securityStatus.authMethods.find((method) => method.id === "password");
    assert.equal(passwordMethod?.configured, true);
    assert.equal(passwordMethod?.enabled, false);
  } finally {
    fetchMock.mock.restore();
  }
});

test("authService setPasswordSignInEnabled validates payload and requires configured password", async () => {
  const updateCalls = [];
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository(),
    userSettingsRepository: {
      async ensureForUserId() {
        return {
          passwordSignInEnabled: true,
          passwordSetupRequired: false
        };
      },
      async updatePasswordSignInEnabled(userId, enabled, options = {}) {
        updateCalls.push([userId, enabled, options]);
        return {
          passwordSignInEnabled: enabled,
          passwordSetupRequired: options.passwordSetupRequired === true
        };
      }
    }
  });

  await assert.rejects(
    () =>
      service.setPasswordSignInEnabled(
        { cookies: createSessionCookies() },
        {
          enabled: "yes"
        }
      ),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details?.fieldErrors?.enabled, "Enabled must be a boolean.");
      return true;
    }
  );

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt({
          sub: "supabase-oauth-only",
          email: "oauth-only@example.com",
          app_metadata: {
            provider: "google",
            providers: ["google"]
          }
        }),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-oauth-only",
          email: "oauth-only@example.com",
          app_metadata: {
            provider: "google",
            providers: ["google"]
          }
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-oauth-only",
        email: "oauth-only@example.com",
        app_metadata: {
          provider: "google",
          providers: ["google"]
        },
        user_metadata: {
          display_name: "oauth-only"
        }
      });
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    await assert.rejects(
      () =>
        service.setPasswordSignInEnabled(
          {
            cookies: createSessionCookies({
              sub: "supabase-oauth-only",
              email: "oauth-only@example.com"
            })
          },
          { enabled: true }
        ),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.details?.fieldErrors?.enabled, "Set a password before enabling password sign-in.");
        return true;
      }
    );
    assert.equal(updateCalls.length, 0);
  } finally {
    fetchMock.mock.restore();
  }
});

test("authService setPasswordSignInEnabled continues when password secret rotation throws", async () => {
  const updateCalls = [];
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository(),
    userSettingsRepository: {
      async ensureForUserId() {
        return {
          passwordSignInEnabled: true,
          passwordSetupRequired: false
        };
      },
      async updatePasswordSignInEnabled(userId, enabled, options = {}) {
        updateCalls.push([userId, enabled, options]);
        return {
          passwordSignInEnabled: enabled,
          passwordSetupRequired: options.passwordSetupRequired === true
        };
      }
    }
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt({
          sub: "supabase-user-throw",
          email: "throw@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email", "google"]
          }
        }),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-throw",
          email: "throw@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email", "google"]
          }
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-throw",
        email: "throw@example.com",
        app_metadata: {
          provider: "email",
          providers: ["email", "google"]
        },
        user_metadata: {
          display_name: "throw-user"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      throw new Error("Requires recent reauthentication");
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    const result = await service.setPasswordSignInEnabled(
      {
        cookies: createSessionCookies({
          sub: "supabase-user-throw",
          email: "throw@example.com"
        })
      },
      { enabled: false }
    );
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0][1], false);
    assert.equal(updateCalls[0][2].passwordSetupRequired, true);
    const passwordMethod = result.securityStatus.authMethods.find((method) => method.id === "password");
    assert.equal(passwordMethod?.configured, true);
    assert.equal(passwordMethod?.enabled, false);
  } finally {
    fetchMock.mock.restore();
  }
});

test("authService setPasswordSignInEnabled syncs profile when password secret rotation succeeds", async () => {
  const upsertCalls = [];
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository({
      upsert: async (profile) => {
        upsertCalls.push(profile);
        return {
          id: 1,
          ...profile,
          createdAt: "2024-01-01T00:00:00.000Z"
        };
      }
    }),
    userSettingsRepository: {
      async ensureForUserId() {
        return {
          passwordSignInEnabled: true,
          passwordSetupRequired: false
        };
      },
      async updatePasswordSignInEnabled(_userId, enabled, options = {}) {
        return {
          passwordSignInEnabled: enabled,
          passwordSetupRequired: options.passwordSetupRequired === true
        };
      }
    }
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt({
          sub: "supabase-user-sync",
          email: "sync@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email", "google"]
          }
        }),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-user-sync",
          email: "sync@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email", "google"]
          },
          user_metadata: {
            display_name: "sync-user"
          }
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-user-sync",
        email: "sync@example.com",
        app_metadata: {
          provider: "email",
          providers: ["email", "google"]
        },
        user_metadata: {
          display_name: "sync-user"
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "PUT") {
      return jsonResponse(200, {
        id: "supabase-user-sync",
        email: "sync@example.com",
        app_metadata: {
          provider: "email",
          providers: ["email", "google"]
        },
        user_metadata: {
          display_name: "rotated-user"
        }
      });
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    const result = await service.setPasswordSignInEnabled(
      {
        cookies: createSessionCookies({
          sub: "supabase-user-sync",
          email: "sync@example.com"
        })
      },
      { enabled: false }
    );
    assert.ok(upsertCalls.length >= 2);
    assert.equal(
      upsertCalls.some(
        (profile) => profile.supabaseUserId === "supabase-user-sync" && profile.displayName === "rotated-user"
      ),
      true
    );
    const passwordMethod = result.securityStatus.authMethods.find((method) => method.id === "password");
    assert.equal(passwordMethod?.enabled, false);
  } finally {
    fetchMock.mock.restore();
  }
});

test("authService getSecurityStatus resolves auth methods from current request context", async () => {
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository(),
    userSettingsRepository: {
      async ensureForUserId() {
        return {
          passwordSignInEnabled: false,
          passwordSetupRequired: true
        };
      }
    }
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt({
          sub: "supabase-security-status",
          email: "security@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email"]
          }
        }),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-security-status",
          email: "security@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email"]
          }
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-security-status",
        email: "security@example.com",
        app_metadata: {
          provider: "email",
          providers: ["email"]
        },
        user_metadata: {
          display_name: "security-user"
        }
      });
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    const result = await service.getSecurityStatus({
      cookies: createSessionCookies({
        sub: "supabase-security-status",
        email: "security@example.com"
      })
    });

    const passwordMethod = result.authMethods.find((method) => method.id === "password");
    assert.equal(passwordMethod?.configured, true);
    assert.equal(passwordMethod?.enabled, false);
    assert.equal(passwordMethod?.requiresCurrentPassword, false);
  } finally {
    fetchMock.mock.restore();
  }
});

test("authService setPasswordSignInEnabled rejects disabling when password sign-in is already disabled", async () => {
  const service = createAuthServiceForTest({
    userProfilesRepository: createProfilesRepository(),
    userSettingsRepository: {
      async ensureForUserId() {
        return {
          passwordSignInEnabled: false,
          passwordSetupRequired: true
        };
      },
      async updatePasswordSignInEnabled() {
        throw new Error("not expected");
      }
    }
  });

  const fetchMock = mock.method(globalThis, "fetch", async (input, init) => {
    const request = parseFetchInput(input, init);
    if (request.url.pathname === "/auth/v1/token" && request.url.searchParams.get("grant_type") === "refresh_token") {
      return jsonResponse(200, {
        access_token: createUnsignedJwt({
          sub: "supabase-password-disabled",
          email: "disabled@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email"]
          }
        }),
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "supabase-password-disabled",
          email: "disabled@example.com",
          app_metadata: {
            provider: "email",
            providers: ["email"]
          }
        }
      });
    }
    if (request.url.pathname === "/auth/v1/user" && request.method === "GET") {
      return jsonResponse(200, {
        id: "supabase-password-disabled",
        email: "disabled@example.com",
        app_metadata: {
          provider: "email",
          providers: ["email"]
        },
        user_metadata: {
          display_name: "disabled-user"
        }
      });
    }
    throw new Error(`Unexpected fetch call: ${request.method} ${request.url.toString()}`);
  });

  try {
    await assert.rejects(
      () =>
        service.setPasswordSignInEnabled(
          {
            cookies: createSessionCookies({
              sub: "supabase-password-disabled",
              email: "disabled@example.com"
            })
          },
          { enabled: false }
        ),
      (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.message, "At least one sign-in method must remain enabled.");
        return true;
      }
    );
  } finally {
    fetchMock.mock.restore();
  }
});
