import { createClient } from "@supabase/supabase-js";
import { AppError } from "../lib/errors.js";
import {
  AUTH_METHOD_PASSWORD_ID,
  AUTH_METHOD_PASSWORD_PROVIDER,
  buildOAuthMethodId
} from "../shared/auth/authMethods.js";
import { AUTH_OAUTH_DEFAULT_PROVIDER } from "../shared/auth/oauthProviders.js";
import { normalizeEmail } from "../shared/auth/utils.js";
import { validators } from "../shared/auth/validators.js";
import {
  validatePasswordRecoveryPayload,
  displayNameFromEmail,
  resolveDisplayName,
  resolveDisplayNameFromClaims,
  isTransientAuthMessage,
  isTransientSupabaseError,
  mapAuthError,
  validationError,
  isUserNotFoundLikeAuthError,
  mapRecoveryError,
  mapPasswordUpdateError,
  buildDisabledPasswordSecret,
  mapOtpVerifyError,
  mapProfileUpdateError,
  mapCurrentPasswordError,
  parseHttpUrl,
  buildPasswordResetRedirectUrl,
  buildOtpLoginRedirectUrl,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  buildOAuthRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOAuthLinkRedirectUrl,
  normalizeOAuthProviderInput,
  parseOAuthCompletePayload,
  parseOtpLoginVerifyPayload,
  mapOAuthCallbackError,
  normalizeIdentityProviderId,
  collectProviderIdsFromSupabaseUser,
  buildAuthMethodsStatusFromProviderIds,
  buildAuthMethodsStatusFromSupabaseUser,
  buildSecurityStatusFromAuthMethodsStatus,
  findAuthMethodById,
  findLinkedIdentityByProvider,
  safeRequestCookies,
  cookieOptions,
  loadJose,
  isExpiredJwtError,
  classifyJwtVerifyError
} from "./auth/lib/authServiceHelpers.js";

const ACCESS_TOKEN_COOKIE = "sb_access_token";
const REFRESH_TOKEN_COOKIE = "sb_refresh_token";
const DEFAULT_AUDIENCE = "authenticated";
function createAuthService(options) {
  const supabaseUrl = String(options.supabaseUrl || "");
  const supabasePublishableKey = String(options.supabasePublishableKey || "");
  const userProfilesRepository = options.userProfilesRepository;
  const userSettingsRepository = options.userSettingsRepository || null;
  const isProduction = options.nodeEnv === "production";
  const jwtAudience = String(options.jwtAudience || DEFAULT_AUDIENCE);
  const passwordResetRedirectUrl = buildPasswordResetRedirectUrl({
    appPublicUrl: options.appPublicUrl
  });
  const otpLoginRedirectUrl = buildOtpLoginRedirectUrl({
    appPublicUrl: options.appPublicUrl
  });
  const appPublicUrl = String(options.appPublicUrl || "");
  let supabaseClient = null;

  const issuerUrl = supabaseUrl ? new URL("/auth/v1", supabaseUrl).toString().replace(/\/$/, "") : "";
  const jwksUrl = issuerUrl ? `${issuerUrl}/.well-known/jwks.json` : "";

  let jwksResolver = null;

  function ensureConfigured() {
    if (!supabaseUrl || !supabasePublishableKey) {
      throw new AppError(500, "Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.");
    }
  }

  function getSupabaseClient() {
    ensureConfigured();
    if (supabaseClient) {
      return supabaseClient;
    }

    supabaseClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    return supabaseClient;
  }

  function createStatelessSupabaseClient() {
    ensureConfigured();
    return createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  async function getJwksResolver() {
    if (jwksResolver) {
      return jwksResolver;
    }

    const jose = await loadJose();
    jwksResolver = jose.createRemoteJWKSet(new URL(jwksUrl));
    return jwksResolver;
  }

  async function verifyAccessToken(accessToken) {
    const jose = await loadJose();
    const jwks = await getJwksResolver();

    try {
      const { payload } = await jose.jwtVerify(accessToken, jwks, {
        issuer: issuerUrl,
        audience: jwtAudience,
        clockTolerance: 5
      });

      return {
        status: "valid",
        payload
      };
    } catch (error) {
      return {
        status: classifyJwtVerifyError(error)
      };
    }
  }

  async function verifyAccessTokenViaSupabase(accessToken) {
    const supabase = getSupabaseClient();

    try {
      const response = await supabase.auth.getUser(accessToken);
      if (response.error) {
        if (isTransientSupabaseError(response.error)) {
          return { status: "transient" };
        }

        return { status: "invalid" };
      }

      if (!response.data?.user) {
        return { status: "invalid" };
      }

      const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email);
      return {
        status: "valid",
        profile
      };
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        return { status: "transient" };
      }

      return { status: "invalid" };
    }
  }

  async function setSessionFromRequestCookies(request) {
    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "").trim();
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "").trim();

    if (!accessToken || !refreshToken) {
      throw new AppError(401, "Authentication required.");
    }

    const supabase = getSupabaseClient();
    let sessionResponse;
    try {
      sessionResponse = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
    } catch (error) {
      throw mapRecoveryError(error);
    }

    const session = sessionResponse.data?.session || null;
    const user = sessionResponse.data?.user || null;

    if (sessionResponse.error || !session || !user) {
      throw mapRecoveryError(sessionResponse.error);
    }

    return {
      ...sessionResponse,
      data: {
        ...sessionResponse.data,
        session,
        user
      }
    };
  }

  async function resolveCurrentSupabaseUser(request) {
    const supabase = getSupabaseClient();
    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "").trim();
    let user = null;
    let session = null;

    if (accessToken) {
      try {
        const userResponse = await supabase.auth.getUser(accessToken);
        if (!userResponse.error && userResponse.data?.user) {
          user = userResponse.data.user;
        } else if (userResponse.error && isTransientSupabaseError(userResponse.error)) {
          throw mapAuthError(userResponse.error, 503);
        }
      } catch (error) {
        if (isTransientSupabaseError(error)) {
          throw mapAuthError(error, 503);
        }
      }
    }

    if (!user) {
      const sessionResponse = await setSessionFromRequestCookies(request);
      user = sessionResponse.data.user || null;
      session = sessionResponse.data.session || null;
    }

    if (typeof supabase.auth.getUser === "function") {
      try {
        const userResponse = await supabase.auth.getUser();
        if (!userResponse.error && userResponse.data?.user) {
          user = userResponse.data.user;
        } else if (userResponse.error && isTransientSupabaseError(userResponse.error)) {
          throw mapAuthError(userResponse.error, 503);
        }
      } catch (error) {
        if (isTransientSupabaseError(error)) {
          throw mapAuthError(error, 503);
        }
      }
    }

    if (typeof supabase.auth.getUserIdentities === "function") {
      try {
        const identitiesResponse = await supabase.auth.getUserIdentities();
        if (!identitiesResponse.error && Array.isArray(identitiesResponse.data?.identities)) {
          user = {
            ...(user || {}),
            identities: identitiesResponse.data.identities
          };
        } else if (identitiesResponse.error && isTransientSupabaseError(identitiesResponse.error)) {
          throw mapAuthError(identitiesResponse.error, 503);
        }
      } catch (error) {
        if (isTransientSupabaseError(error)) {
          throw mapAuthError(error, 503);
        }
      }
    }

    if (!user) {
      throw new AppError(401, "Authentication required.");
    }

    return {
      session,
      user
    };
  }

  function writeSessionCookies(reply, session) {
    const accessToken = String(session?.access_token || "");
    const refreshToken = String(session?.refresh_token || "");
    if (!accessToken || !refreshToken) {
      return;
    }

    const accessMaxAge = Number.isFinite(Number(session?.expires_in)) ? Number(session.expires_in) : 3600;
    const refreshMaxAge = Math.max(accessMaxAge * 24, 86400);

    reply.setCookie(ACCESS_TOKEN_COOKIE, accessToken, cookieOptions(isProduction, accessMaxAge));
    reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, cookieOptions(isProduction, refreshMaxAge));
  }

  function clearSessionCookies(reply) {
    const clearOptions = cookieOptions(isProduction, 0);
    reply.clearCookie(ACCESS_TOKEN_COOKIE, clearOptions);
    reply.clearCookie(REFRESH_TOKEN_COOKIE, clearOptions);
  }

  function profileNeedsUpdate(existing, nextProfile) {
    if (!existing) {
      return true;
    }

    return existing.email !== nextProfile.email || existing.displayName !== nextProfile.displayName;
  }

  function requireSynchronizedProfile(profile) {
    if (profile && Number.isFinite(Number(profile.id)) && String(profile.displayName || "").trim()) {
      return profile;
    }

    throw new AppError(500, "Authentication profile synchronization failed. Please retry.");
  }

  async function syncProfileMirror(nextProfile) {
    try {
      const existing = await userProfilesRepository.findBySupabaseUserId(nextProfile.supabaseUserId);
      if (!profileNeedsUpdate(existing, nextProfile)) {
        return requireSynchronizedProfile(existing);
      }

      const upserted = await userProfilesRepository.upsert(nextProfile);
      return requireSynchronizedProfile(upserted);
    } catch (error) {
      if (String(error?.code || "") === "USER_PROFILE_EMAIL_CONFLICT") {
        throw new AppError(
          409,
          "This email is already registered with another sign-in method. Sign in with that method, then link this provider in Settings > Security."
        );
      }

      throw error;
    }
  }

  async function syncProfileFromSupabaseUser(supabaseUser, fallbackEmail) {
    const supabaseUserId = String(supabaseUser?.id || "").trim();
    const email = normalizeEmail(supabaseUser?.email || fallbackEmail);

    if (!supabaseUserId || !email) {
      throw new AppError(500, "Supabase user payload is missing required fields.");
    }

    return syncProfileMirror({
      supabaseUserId,
      email,
      displayName: resolveDisplayName(supabaseUser, email)
    });
  }

  async function syncProfileFromJwtClaims(claims) {
    const supabaseUserId = String(claims?.sub || "").trim();
    if (!supabaseUserId) {
      throw new AppError(401, "Token is missing subject claim.");
    }

    const existing = await userProfilesRepository.findBySupabaseUserId(supabaseUserId);
    const emailFromToken = normalizeEmail(claims?.email || "");

    if (!emailFromToken) {
      if (existing) {
        return existing;
      }
      throw new AppError(401, "Token is missing email claim.");
    }

    return syncProfileMirror({
      supabaseUserId,
      email: emailFromToken,
      displayName: resolveDisplayNameFromClaims(claims, emailFromToken)
    });
  }

  async function resolvePasswordSignInPolicyForUserId(userId) {
    if (!userSettingsRepository || typeof userSettingsRepository.ensureForUserId !== "function") {
      return {
        passwordSignInEnabled: true,
        passwordSetupRequired: false
      };
    }

    const settings = await userSettingsRepository.ensureForUserId(userId);
    return {
      passwordSignInEnabled: settings?.passwordSignInEnabled !== false,
      passwordSetupRequired: settings?.passwordSetupRequired === true
    };
  }

  async function setPasswordSignInEnabledForUserId(userId, enabled, options = {}) {
    if (!userSettingsRepository || typeof userSettingsRepository.updatePasswordSignInEnabled !== "function") {
      throw new AppError(500, "Password sign-in settings repository is not configured.");
    }

    const updated = await userSettingsRepository.updatePasswordSignInEnabled(userId, enabled, options);
    return {
      passwordSignInEnabled: updated.passwordSignInEnabled !== false,
      passwordSetupRequired: updated.passwordSetupRequired === true
    };
  }

  async function setPasswordSetupRequiredForUserId(userId, required) {
    if (!userSettingsRepository || typeof userSettingsRepository.updatePasswordSetupRequired !== "function") {
      return;
    }

    await userSettingsRepository.updatePasswordSetupRequired(userId, required);
  }

  async function resolveCurrentAuthContext(request) {
    const current = await resolveCurrentSupabaseUser(request);
    const profile = await syncProfileFromSupabaseUser(current.user, current.user?.email || "");
    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(profile.id);
    const authMethodsStatus = buildAuthMethodsStatusFromSupabaseUser(current.user, passwordSignInPolicy);

    return {
      ...current,
      profile,
      passwordSignInEnabled: passwordSignInPolicy.passwordSignInEnabled,
      passwordSetupRequired: passwordSignInPolicy.passwordSetupRequired,
      authMethodsStatus
    };
  }

  async function register(payload) {
    ensureConfigured();

    const parsed = validators.registerInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const response = await supabase.auth.signUp({
      email: parsed.email,
      password: parsed.password,
      options: {
        data: {
          display_name: displayNameFromEmail(parsed.email)
        }
      }
    });

    if (response.error) {
      throw mapAuthError(response.error, 400);
    }

    if (!response.data?.user) {
      throw new AppError(500, "Supabase sign-up did not return a user.");
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, parsed.email);

    if (!response.data.session) {
      return {
        requiresEmailConfirmation: true,
        email: parsed.email,
        profile,
        session: null
      };
    }

    return {
      requiresEmailConfirmation: false,
      profile,
      session: response.data.session
    };
  }

  async function login(payload) {
    ensureConfigured();

    const parsed = validators.loginInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const response = await supabase.auth.signInWithPassword({
      email: parsed.email,
      password: parsed.password
    });

    if (response.error || !response.data?.user || !response.data?.session) {
      throw mapAuthError(response.error, 401);
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, parsed.email);
    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(profile.id);
    if (!passwordSignInPolicy.passwordSignInEnabled) {
      throw new AppError(401, "Invalid email or password.");
    }

    return {
      profile,
      session: response.data.session
    };
  }

  async function requestOtpLogin(payload) {
    ensureConfigured();

    const parsed = validators.forgotPasswordInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      response = await supabase.auth.signInWithOtp({
        email: parsed.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: otpLoginRedirectUrl
        }
      });
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        throw mapAuthError(error, 503);
      }

      return {
        ok: true,
        message: "If an account exists for that email, a one-time code has been sent."
      };
    }

    if (response.error) {
      if (isTransientSupabaseError(response.error)) {
        throw mapAuthError(response.error, 503);
      }

      if (isUserNotFoundLikeAuthError(response.error)) {
        return {
          ok: true,
          message: "If an account exists for that email, a one-time code has been sent."
        };
      }

      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }

    return {
      ok: true,
      message: "If an account exists for that email, a one-time code has been sent."
    };
  }

  async function verifyOtpLogin(payload) {
    ensureConfigured();

    const parsed = parseOtpLoginVerifyPayload(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      if (parsed.tokenHash) {
        response = await supabase.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: parsed.type
        });
      } else {
        response = await supabase.auth.verifyOtp({
          email: parsed.email,
          token: parsed.token,
          type: parsed.type
        });
      }
    } catch (error) {
      throw mapOtpVerifyError(error);
    }

    if (response.error || !response.data?.session || !response.data?.user) {
      throw mapOtpVerifyError(response.error);
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email || parsed.email);

    return {
      profile,
      session: response.data.session
    };
  }

  async function oauthStart(payload = {}) {
    ensureConfigured();

    const provider = normalizeOAuthProviderInput(payload.provider || AUTH_OAUTH_DEFAULT_PROVIDER);
    const returnTo = normalizeReturnToPath(payload.returnTo, { fallback: "/" });
    const redirectTo = buildOAuthLoginRedirectUrl({
      appPublicUrl,
      provider,
      returnTo
    });

    const supabase = getSupabaseClient();
    let response;
    try {
      response = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined
        }
      });
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error || !response.data?.url) {
      throw mapAuthError(response.error, 400);
    }

    return {
      provider,
      returnTo,
      url: String(response.data.url)
    };
  }

  async function startProviderLink(request, payload = {}) {
    ensureConfigured();

    const provider = normalizeOAuthProviderInput(payload.provider || AUTH_OAUTH_DEFAULT_PROVIDER);
    const returnTo = normalizeReturnToPath(payload.returnTo, { fallback: "/" });
    await setSessionFromRequestCookies(request);

    const supabase = getSupabaseClient();
    if (typeof supabase.auth.linkIdentity !== "function") {
      throw new AppError(500, "Supabase client does not support identity linking in this environment.");
    }

    const redirectTo = buildOAuthLinkRedirectUrl({
      appPublicUrl,
      provider,
      returnTo
    });

    let response;
    try {
      response = await supabase.auth.linkIdentity({
        provider,
        options: {
          redirectTo,
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined
        }
      });
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error || !response.data?.url) {
      throw mapAuthError(response.error, 400);
    }

    return {
      provider,
      returnTo,
      url: String(response.data.url)
    };
  }

  async function oauthComplete(payload = {}) {
    ensureConfigured();

    const parsed = parseOAuthCompletePayload(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    if (parsed.errorCode) {
      throw mapOAuthCallbackError(parsed.errorCode, parsed.errorDescription);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      if (parsed.hasSessionPair) {
        response = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken
        });
      } else {
        response = await supabase.auth.exchangeCodeForSession(parsed.code);
      }
    } catch (error) {
      throw mapRecoveryError(error);
    }

    if (response.error || !response.data?.session || !response.data?.user) {
      throw mapRecoveryError(response.error);
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email);

    return {
      provider: parsed.provider,
      profile,
      session: response.data.session
    };
  }

  async function requestPasswordReset(payload) {
    ensureConfigured();

    const parsed = validators.forgotPasswordInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const options = { redirectTo: passwordResetRedirectUrl };
    let response;
    try {
      response = await supabase.auth.resetPasswordForEmail(parsed.email, options);
      /* c8 ignore next 4 -- supabase-js returns auth/transport failures as response.error;
       * this catch exists only for unexpected non-Auth throws from SDK/runtime internals. */
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error) {
      throw mapAuthError(response.error, 400);
    }

    return {
      ok: true,
      message: "If an account exists for that email, a password reset link has been sent."
    };
  }

  async function completePasswordRecovery(payload) {
    ensureConfigured();

    const parsed = validatePasswordRecoveryPayload(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      if (parsed.hasCode) {
        response = await supabase.auth.exchangeCodeForSession(parsed.code);
      } else if (parsed.hasTokenHash) {
        response = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: parsed.tokenHash
        });
      } else {
        response = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken
        });
      }
      /* c8 ignore next 3 -- defensive: supabase-js usually surfaces failures via response.error. */
    } catch (error) {
      throw mapRecoveryError(error);
    }

    if (response.error) {
      throw mapRecoveryError(response.error);
    }

    /* c8 ignore next 3 -- defensive against malformed SDK responses without explicit error payload. */
    if (!response.data?.session || !response.data?.user) {
      throw new AppError(401, "Recovery link is invalid or has expired.");
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email);

    return {
      profile,
      session: response.data.session
    };
  }

  async function resetPassword(request, payload) {
    ensureConfigured();

    const parsed = validators.resetPasswordInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const sessionResponse = await setSessionFromRequestCookies(request);
    const profile = await syncProfileFromSupabaseUser(sessionResponse.data.user, sessionResponse.data.user?.email || "");
    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(profile.id);
    if (!passwordSignInPolicy.passwordSignInEnabled) {
      throw new AppError(409, "Password sign-in is disabled for this account.");
    }

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        password: parsed.password
      });
    } catch (error) {
      throw mapPasswordUpdateError(error);
    }

    if (updateResponse.error || !updateResponse.data?.user) {
      throw mapPasswordUpdateError(updateResponse.error);
    }

    const updatedProfile = await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
    await setPasswordSetupRequiredForUserId(updatedProfile.id, false);
  }

  async function updateDisplayName(request, displayName) {
    ensureConfigured();

    const normalizedDisplayName = String(displayName || "").trim();
    if (!normalizedDisplayName) {
      throw validationError({
        displayName: "Display name is required."
      });
    }

    const supabase = getSupabaseClient();
    const sessionResponse = await setSessionFromRequestCookies(request);

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        data: {
          display_name: normalizedDisplayName
        }
      });
    } catch (error) {
      throw mapProfileUpdateError(error);
    }

    if (updateResponse.error || !updateResponse.data?.user) {
      throw mapProfileUpdateError(updateResponse.error);
    }

    const profile = await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);

    return {
      profile,
      session: sessionResponse.data.session
    };
  }

  async function changePassword(request, payload) {
    ensureConfigured();

    const currentPassword = String(payload?.currentPassword || "");
    const newPassword = String(payload?.newPassword || "");
    const requireCurrentPassword = payload?.requireCurrentPassword !== false;
    const supabase = getSupabaseClient();
    const sessionResponse = await setSessionFromRequestCookies(request);

    const email = normalizeEmail(sessionResponse.data.user?.email || "");
    if (!email) {
      throw new AppError(500, "Authenticated user email could not be resolved.");
    }

    if (requireCurrentPassword) {
      const verificationClient = createStatelessSupabaseClient();
      let verifyResponse;
      try {
        verifyResponse = await verificationClient.auth.signInWithPassword({
          email,
          password: currentPassword
        });
      } catch (error) {
        throw mapCurrentPasswordError(error);
      }

      if (verifyResponse.error || !verifyResponse.data?.session) {
        throw mapCurrentPasswordError(verifyResponse.error);
      }
    }

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        password: newPassword
      });
    } catch (error) {
      throw mapPasswordUpdateError(error);
    }

    if (updateResponse.error || !updateResponse.data?.user) {
      throw mapPasswordUpdateError(updateResponse.error);
    }

    const profile = await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
    await setPasswordSetupRequiredForUserId(profile.id, false);

    return {
      profile,
      session: sessionResponse.data.session
    };
  }

  async function unlinkProvider(request, payload = {}) {
    ensureConfigured();

    const provider = normalizeOAuthProviderInput(payload.provider);
    const supabase = getSupabaseClient();
    if (typeof supabase.auth.unlinkIdentity !== "function") {
      throw new AppError(500, "Supabase client does not support identity unlinking in this environment.");
    }

    await setSessionFromRequestCookies(request);
    const current = await resolveCurrentAuthContext(request);
    const methodId = buildOAuthMethodId(provider);
    const providerMethod = findAuthMethodById(current.authMethodsStatus, methodId);
    if (!providerMethod || !providerMethod.configured) {
      throw validationError({
        provider: `${provider} is not linked to this account.`
      });
    }

    if (!providerMethod.canDisable) {
      throw new AppError(409, "At least one sign-in method must remain enabled.");
    }

    const identity = findLinkedIdentityByProvider(current.user, provider);
    if (!identity) {
      throw new AppError(409, "Linked identity details could not be resolved for this provider.");
    }

    let response;
    try {
      response = await supabase.auth.unlinkIdentity(identity);
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error) {
      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }

    const refreshed = await resolveCurrentAuthContext(request);
    return {
      securityStatus: buildSecurityStatusFromAuthMethodsStatus(refreshed.authMethodsStatus)
    };
  }

  async function setPasswordSignInEnabled(request, payload = {}) {
    ensureConfigured();

    if (typeof payload?.enabled !== "boolean") {
      throw validationError({
        enabled: "Enabled must be a boolean."
      });
    }

    const supabase = getSupabaseClient();
    await setSessionFromRequestCookies(request);
    const current = await resolveCurrentAuthContext(request);
    const passwordMethod = findAuthMethodById(current.authMethodsStatus, AUTH_METHOD_PASSWORD_ID);

    if (!passwordMethod) {
      throw new AppError(500, "Password method configuration could not be resolved.");
    }

    if (payload.enabled && !passwordMethod.configured) {
      throw validationError({
        enabled: "Set a password before enabling password sign-in."
      });
    }

    if (!payload.enabled && !passwordMethod.canDisable) {
      throw new AppError(409, "At least one sign-in method must remain enabled.");
    }

    if (!payload.enabled && passwordMethod.configured) {
      let updateResponse = null;
      try {
        updateResponse = await supabase.auth.updateUser({
          // Supabase does not support null password removal; rotate to high-entropy unknown secret.
          password: buildDisabledPasswordSecret()
        });
      } catch {
        // Some Supabase projects require re-authenticated password updates.
        // Treat secret rotation as best-effort and still disable app-level password sign-in.
        updateResponse = null;
      }

      if (!updateResponse || updateResponse.error || !updateResponse.data?.user) {
        updateResponse = null;
      }

      if (updateResponse?.data?.user) {
        await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
      }
    }

    const passwordSignInOptions = !payload.enabled && passwordMethod.configured ? { passwordSetupRequired: true } : {};
    const nextPasswordSignInPolicy = await setPasswordSignInEnabledForUserId(
      current.profile.id,
      payload.enabled,
      passwordSignInOptions
    );
    const nextAuthMethodsStatus = buildAuthMethodsStatusFromSupabaseUser(current.user, nextPasswordSignInPolicy);

    return {
      securityStatus: buildSecurityStatusFromAuthMethodsStatus(nextAuthMethodsStatus)
    };
  }

  async function signOutOtherSessions(request) {
    ensureConfigured();
    const supabase = getSupabaseClient();
    await setSessionFromRequestCookies(request);
    const response = await supabase.auth.signOut({
      scope: "others"
    });

    if (response.error) {
      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }
  }

  async function getSecurityStatus(request) {
    if (!request) {
      const authMethodsStatus = buildAuthMethodsStatusFromProviderIds([AUTH_METHOD_PASSWORD_PROVIDER], {
        passwordSignInEnabled: true,
        passwordSetupRequired: false
      });
      return buildSecurityStatusFromAuthMethodsStatus(authMethodsStatus);
    }

    const current = await resolveCurrentAuthContext(request);
    return buildSecurityStatusFromAuthMethodsStatus(current.authMethodsStatus);
  }

  async function authenticateRequest(request) {
    ensureConfigured();

    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "");
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "");

    if (!accessToken) {
      return {
        authenticated: false,
        clearSession: false,
        session: null,
        transientFailure: false
      };
    }

    const verification = await verifyAccessToken(accessToken);

    if (verification.status === "valid") {
      const profile = await syncProfileFromJwtClaims(verification.payload);
      return {
        authenticated: true,
        profile,
        clearSession: false,
        session: null,
        transientFailure: false
      };
    }

    if (verification.status === "transient") {
      return {
        authenticated: false,
        clearSession: false,
        session: null,
        transientFailure: true
      };
    }

    if (verification.status === "invalid") {
      const supabaseVerification = await verifyAccessTokenViaSupabase(accessToken);
      if (supabaseVerification.status === "valid") {
        return {
          authenticated: true,
          profile: supabaseVerification.profile,
          clearSession: false,
          session: null,
          transientFailure: false
        };
      }

      if (supabaseVerification.status === "transient") {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: true
        };
      }
    }

    if (!refreshToken) {
      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    const supabase = getSupabaseClient();
    let refreshResponse;
    try {
      refreshResponse = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      /* c8 ignore next 17 -- defensive: refreshSession usually resolves with { error } for auth/transport issues. */
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: true
        };
      }

      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    if (refreshResponse.error) {
      if (isTransientSupabaseError(refreshResponse.error)) {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: true
        };
      }

      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    if (!refreshResponse.data?.session || !refreshResponse.data?.user) {
      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    const profile = await syncProfileFromSupabaseUser(refreshResponse.data.user, refreshResponse.data.user.email);

    return {
      authenticated: true,
      profile,
      clearSession: false,
      session: refreshResponse.data.session,
      transientFailure: false
    };
  }

  function hasAccessTokenCookie(request) {
    const cookies = safeRequestCookies(request);
    return Boolean(cookies[ACCESS_TOKEN_COOKIE]);
  }

  function hasSessionCookie(request) {
    const cookies = safeRequestCookies(request);
    return Boolean(cookies[ACCESS_TOKEN_COOKIE] || cookies[REFRESH_TOKEN_COOKIE]);
  }

  return {
    register,
    login,
    requestOtpLogin,
    verifyOtpLogin,
    oauthStart,
    oauthComplete,
    startProviderLink,
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword,
    updateDisplayName,
    changePassword,
    setPasswordSignInEnabled,
    unlinkProvider,
    signOutOtherSessions,
    getSecurityStatus,
    authenticateRequest,
    hasAccessTokenCookie,
    hasSessionCookie,
    writeSessionCookies,
    clearSessionCookies
  };
}

const __testables = {
  validatePasswordRecoveryPayload,
  displayNameFromEmail,
  resolveDisplayName,
  resolveDisplayNameFromClaims,
  isTransientAuthMessage,
  isTransientSupabaseError,
  mapAuthError,
  validationError,
  isUserNotFoundLikeAuthError,
  mapRecoveryError,
  mapPasswordUpdateError,
  mapOtpVerifyError,
  mapProfileUpdateError,
  mapCurrentPasswordError,
  parseHttpUrl,
  buildPasswordResetRedirectUrl,
  buildOtpLoginRedirectUrl,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  buildOAuthRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOAuthLinkRedirectUrl,
  normalizeOAuthProviderInput,
  parseOAuthCompletePayload,
  parseOtpLoginVerifyPayload,
  mapOAuthCallbackError,
  normalizeIdentityProviderId,
  collectProviderIdsFromSupabaseUser,
  buildAuthMethodsStatusFromProviderIds,
  buildAuthMethodsStatusFromSupabaseUser,
  buildSecurityStatusFromAuthMethodsStatus,
  findAuthMethodById,
  findLinkedIdentityByProvider,
  safeRequestCookies,
  cookieOptions,
  isExpiredJwtError,
  classifyJwtVerifyError
};

export { createAuthService, __testables };
