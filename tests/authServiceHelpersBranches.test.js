import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import {
  buildAuthMethodsStatusFromProviderIds,
  buildOAuthLinkRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOtpLoginRedirectUrl,
  buildOAuthRedirectUrl,
  collectProviderIdsFromSupabaseUser,
  findAuthMethodById,
  findLinkedIdentityByProvider,
  mapAuthError,
  mapOAuthCallbackError,
  normalizeOAuthIntent,
  normalizeOAuthProviderInput,
  normalizeReturnToPath,
  parseOAuthCompletePayload,
  parseOtpLoginVerifyPayload,
  buildSecurityStatusFromAuthMethodsStatus
} from "../server/modules/auth/lib/authServiceHelpers.js";
import {
  AUTH_ACCESS_TOKEN_MAX_LENGTH,
  AUTH_RECOVERY_TOKEN_MAX_LENGTH,
  AUTH_REFRESH_TOKEN_MAX_LENGTH
} from "../shared/auth/authConstraints.js";

test("auth helper error mapping covers provider-linking edge cases", () => {
  const alreadyLinked = mapAuthError(
    {
      message: "identity already exists for user"
    },
    400
  );
  assert.equal(alreadyLinked.statusCode, 409);

  const manualLinkingDisabled = mapAuthError(
    {
      message: "manual linking is disabled"
    },
    400
  );
  assert.equal(manualLinkingDisabled.statusCode, 409);
  assert.equal(manualLinkingDisabled.message.includes("Manual Linking"), true);

  const mustKeepOneIdentity = mapAuthError(
    {
      message: "at least one identity must remain linked"
    },
    400
  );
  assert.equal(mustKeepOneIdentity.statusCode, 409);

  const identityNotFound = mapAuthError(
    {
      message: "identity not found"
    },
    400
  );
  assert.equal(identityNotFound.statusCode, 409);
});

test("oauth redirect helpers validate intent, returnTo, provider, and callback path", () => {
  assert.throws(() => buildOtpLoginRedirectUrl({ appPublicUrl: "" }), /APP_PUBLIC_URL is required/);
  assert.equal(
    buildOtpLoginRedirectUrl({ appPublicUrl: "http://localhost:5173/app" }),
    "http://localhost:5173/app/login"
  );

  assert.equal(normalizeOAuthIntent("LINK"), "link");
  assert.equal(normalizeOAuthIntent("unknown"), "login");
  assert.equal(normalizeOAuthIntent("unknown", { fallback: "link" }), "link");

  assert.equal(normalizeReturnToPath("/w/acme", { fallback: "/" }), "/w/acme");
  assert.equal(normalizeReturnToPath("https://example.com", { fallback: "/" }), "/");
  assert.equal(normalizeReturnToPath("//evil.test", { fallback: "/" }), "/");

  assert.throws(
    () =>
      buildOAuthRedirectUrl({
        appPublicUrl: "http://localhost:5173",
        provider: "google",
        callbackPath: "   ",
        returnTo: "/"
      }),
    /callback path is required/i
  );

  const oauthUrl = buildOAuthRedirectUrl({
    appPublicUrl: "http://localhost:5173/app",
    provider: "google",
    callbackPath: "login",
    returnTo: "/settings"
  });
  assert.equal(oauthUrl.includes("oauthProvider=google"), true);
  assert.equal(oauthUrl.includes("oauthIntent=login"), true);
  assert.equal(oauthUrl.includes("oauthReturnTo=%2Fsettings"), true);

  const oauthLoginUrl = buildOAuthLoginRedirectUrl({
    appPublicUrl: "http://localhost:5173/app",
    provider: "google",
    returnTo: "/w/acme"
  });
  assert.equal(oauthLoginUrl.includes("oauthIntent=login"), true);

  const oauthLinkUrl = buildOAuthLinkRedirectUrl({
    appPublicUrl: "http://localhost:5173/app",
    provider: "google",
    returnTo: "/account/settings"
  });
  assert.equal(oauthLinkUrl.includes("oauthIntent=link"), true);

  assert.throws(
    () => normalizeOAuthProviderInput("github"),
    (error) => {
      return error instanceof AppError && error.statusCode === 400;
    }
  );
});

test("oauth payload parsers cover token limits and mixed token/email branches", () => {
  const overLimitPayload = parseOAuthCompletePayload({
    provider: "",
    code: "c".repeat(AUTH_RECOVERY_TOKEN_MAX_LENGTH + 1),
    accessToken: "a".repeat(AUTH_ACCESS_TOKEN_MAX_LENGTH + 1),
    refreshToken: "r".repeat(AUTH_REFRESH_TOKEN_MAX_LENGTH + 1),
    error: "e".repeat(129),
    errorDescription: "d".repeat(1025)
  });
  assert.equal(overLimitPayload.provider, "google");
  assert.equal(overLimitPayload.fieldErrors.code.includes("too long"), true);
  assert.equal(overLimitPayload.fieldErrors.error.includes("too long"), true);
  assert.equal(overLimitPayload.fieldErrors.errorDescription.includes("too long"), true);
  assert.equal(overLimitPayload.fieldErrors.accessToken.includes("too long"), true);
  assert.equal(overLimitPayload.fieldErrors.refreshToken.includes("too long"), true);

  const refreshOnly = parseOAuthCompletePayload({
    provider: "google",
    refreshToken: "refresh-only"
  });
  assert.equal(refreshOnly.fieldErrors.accessToken.includes("required"), true);

  const accessOnly = parseOAuthCompletePayload({
    provider: "google",
    accessToken: "access-only"
  });
  assert.equal(accessOnly.fieldErrors.refreshToken.includes("required"), true);

  const otpTokenTooLong = parseOtpLoginVerifyPayload({
    email: "bad-email",
    token: "x".repeat(AUTH_RECOVERY_TOKEN_MAX_LENGTH + 1),
    type: "email"
  });
  assert.equal(otpTokenTooLong.fieldErrors.token.includes("too long"), true);
  assert.equal(otpTokenTooLong.fieldErrors.email.includes("email"), true);

  const otpTokenHashTooLong = parseOtpLoginVerifyPayload({
    email: "bad-email",
    tokenHash: "x".repeat(AUTH_RECOVERY_TOKEN_MAX_LENGTH + 1),
    type: "email"
  });
  assert.equal(otpTokenHashTooLong.fieldErrors.tokenHash.includes("too long"), true);
  assert.equal(otpTokenHashTooLong.fieldErrors.email, undefined);

  const cancelled = mapOAuthCallbackError(" ACCESS_DENIED ", "");
  assert.equal(cancelled.statusCode, 401);
  assert.equal(cancelled.message.includes("cancelled"), true);

  const withDescription = mapOAuthCallbackError("server_error", "bad gateway");
  assert.equal(withDescription.message, "OAuth sign-in failed: bad gateway");
});

test("auth-method status helpers cover non-array inputs and fallback lookups", () => {
  const providerIds = collectProviderIdsFromSupabaseUser({
    app_metadata: {
      provider: "email",
      providers: null
    },
    identities: null
  });
  assert.deepEqual(providerIds, ["email"]);

  const statusFromNullProviders = buildAuthMethodsStatusFromProviderIds(null, {
    passwordSignInEnabled: false
  });
  assert.equal(Array.isArray(statusFromNullProviders.methods), true);
  assert.equal(statusFromNullProviders.minimumEnabledMethods, 1);

  const securityFallback = buildSecurityStatusFromAuthMethodsStatus({
    minimumEnabledMethods: null,
    enabledMethodsCount: null,
    methods: null
  });
  assert.equal(securityFallback.authPolicy.minimumEnabledMethods, 1);
  assert.equal(securityFallback.authPolicy.enabledMethodsCount, 0);
  assert.deepEqual(securityFallback.authMethods, []);

  const methodFromSparseList = findAuthMethodById({ methods: [{}] }, "password");
  assert.equal(methodFromSparseList, undefined);

  assert.equal(findLinkedIdentityByProvider({ identities: null }, "google"), null);
});
